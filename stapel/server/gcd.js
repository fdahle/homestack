// Client for the Grand Comics Database API (https://www.comics.org/api/).
// With an account GCD allows roughly 20 requests a minute, 200 an hour and 2000 a
// day; without one it blocks after about 50 an hour. Every request goes through one
// queue that counts against those limits, and responses are cached.
//
// Background work (covers, refreshes) goes slowly on purpose: at most
// GCD_BACKGROUND_PER_HOUR requests an hour, counting what you did in the app, and
// spread evenly over the hour. What you do in the app always comes first.

import { db } from './db.js';

const BASE = 'https://www.comics.org/api';
const USER_AGENT = process.env.USER_AGENT || 'Stapel/1.0 (self-hosted comic collection tracker)';
const AUTH = process.env.GCD_EMAIL && process.env.GCD_PASSWORD
  ? `Basic ${Buffer.from(`${process.env.GCD_EMAIL}:${process.env.GCD_PASSWORD}`).toString('base64')}`
  : null;
export const HAS_ACCOUNT = Boolean(AUTH);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const env = (name, fallback) => Number(process.env[name]) || fallback;
const PER_HOUR = env('GCD_PER_HOUR', AUTH ? 200 : 40);
const PER_DAY = env('GCD_PER_DAY', AUTH ? 2000 : 400);
export const BACKGROUND_PER_HOUR = Math.min(env('GCD_BACKGROUND_PER_HOUR', AUTH ? 100 : 25), PER_HOUR);
// background: how many requests in the window (yours included) background work may go up to
const LIMITS = [
  { window: MINUTE, max: env('GCD_PER_MINUTE', AUTH ? 20 : 10), background: 3 },
  { window: HOUR, max: PER_HOUR, background: BACKGROUND_PER_HOUR },
  { window: DAY, max: PER_DAY, background: Math.min(BACKGROUND_PER_HOUR * 24, Math.floor(PER_DAY * 0.8)) },
];
const MIN_SPACING_MS = 1500;
// Background requests are spread over the hour instead of going out in a burst
export const BACKGROUND_SPACING_MS = Math.ceil(HOUR / BACKGROUND_PER_HOUR);
let lastBackgroundAt = 0;

export class GcdBusyError extends Error {
  constructor(retryAt) {
    super('GCD rate limit reached');
    this.retryAt = retryAt;
  }
}

export class GcdNotFoundError extends Error {}

// Set when GCD answers 429; kept in the database so a restart doesn't ask again right away
let cooldownUntil = Number(db.prepare("SELECT value FROM settings WHERE key = 'gcd_cooldown_until'").get()?.value) || 0;
let lastRequestAt = 0;
let chain = Promise.resolve();

const countSince = (t) => db.prepare('SELECT COUNT(*) AS n, MIN(at) AS first FROM gcd_requests WHERE at > ?').get(t);

export function usage() {
  const t = Date.now();
  db.prepare('DELETE FROM gcd_requests WHERE at < ?').run(t - DAY);
  return {
    minute: countSince(t - MINUTE).n,
    hour: countSince(t - HOUR).n,
    day: countSince(t - DAY).n,
    limits: { minute: LIMITS[0].max, hour: LIMITS[1].max, day: LIMITS[2].max },
    backgroundPerHour: BACKGROUND_PER_HOUR,
    account: HAS_ACCOUNT,
    cooldownUntil: cooldownUntil > t ? new Date(cooldownUntil).toISOString() : null,
  };
}

// Returns 0 if a request may go out now, otherwise the time when one may.
function nextSlot(background) {
  const t = Date.now();
  let wait = Math.max(cooldownUntil, lastRequestAt + MIN_SPACING_MS);
  if (background) wait = Math.max(wait, lastBackgroundAt + BACKGROUND_SPACING_MS);
  for (const { window, max, background: backgroundMax } of LIMITS) {
    const allowed = background ? backgroundMax : max;
    const { n, first } = countSince(t - window);
    if (n >= allowed) {
      // The oldest requests in the window have to expire first
      const over = n - allowed;
      const row = db.prepare('SELECT at FROM gcd_requests WHERE at > ? ORDER BY at LIMIT 1 OFFSET ?').get(t - window, over);
      wait = Math.max(wait, (row?.at ?? first) + window + 1);
    }
  }
  return wait > t ? wait : 0;
}

// When background work may send its next request (a timestamp; now or earlier = right away)
export function nextBackgroundAt() {
  return nextSlot(true) || Date.now();
}

async function request(path, { background }) {
  // Interactive requests wait up to this long for a free slot; longer means the
  // hourly or daily budget is used up and the user is told to try later.
  const maxWait = background ? 0 : 25_000;
  for (;;) {
    const slot = nextSlot(background);
    if (!slot) break;
    if (slot - Date.now() > maxWait) throw new GcdBusyError(new Date(slot).toISOString());
    await new Promise((r) => setTimeout(r, slot - Date.now()));
  }

  lastRequestAt = Date.now();
  if (background) lastBackgroundAt = lastRequestAt;
  db.prepare('INSERT INTO gcd_requests (at) VALUES (?)').run(lastRequestAt);
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...(AUTH ? { Authorization: AUTH } : {}) },
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status === 429) {
    const retry = Number(res.headers.get('retry-after')) || 600;
    cooldownUntil = Date.now() + retry * 1000;
    db.prepare("INSERT INTO settings (key, value) VALUES ('gcd_cooldown_until', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
      .run(String(cooldownUntil));
    const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    console.warn(`GCD rate limit (429), pausing ${retry}s. ${body}`);
    throw new GcdBusyError(new Date(cooldownUntil).toISOString());
  }
  if (res.status === 404) throw new GcdNotFoundError(`Not found in GCD: ${path}`);
  if (!res.ok) throw new Error(`GCD answered ${res.status} for ${path}`);
  return res.json();
}

// GET a GCD API path (e.g. "/series/123/"), from cache when it is younger than maxAgeMs.
// When the rate limit is reached, an older cached copy is better than nothing.
// cache: false is for responses that get stored elsewhere anyway (issue details).
export function gcdGet(path, { maxAgeMs = 7 * DAY, background = false, cache = true } = {}) {
  const cached = cache ? db.prepare('SELECT body, fetched_at FROM gcd_cache WHERE path = ?').get(path) : null;
  if (cached && Date.now() - cached.fetched_at < maxAgeMs) return Promise.resolve(JSON.parse(cached.body));

  // One request at a time, in order
  const run = chain.then(() => request(path, { background }));
  chain = run.catch(() => {});
  return run.then(
    (data) => {
      if (cache) {
        db.prepare('INSERT INTO gcd_cache (path, body, fetched_at) VALUES (?, ?, ?) ON CONFLICT (path) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at')
          .run(path, JSON.stringify(data), Date.now());
      }
      return data;
    },
    (err) => {
      if (cached && err instanceof GcdBusyError) return JSON.parse(cached.body);
      throw err;
    },
  );
}

export const idFromUrl = (url) => Number(/\/(\d+)\/?(?:\?|$)/.exec(url || '')?.[1]) || null;

export const DAY_MS = DAY;
