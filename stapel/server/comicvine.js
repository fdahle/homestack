// Client for the Comic Vine API (https://comicvine.gamespot.com/api/), used for covers.
// GCD stays the catalog; Comic Vine only supplies cover images, which Stapel stores.
// Comic Vine allows 200 requests per resource an hour and asks for no bursts, so
// requests go out one at a time, at least 2 seconds apart, and are cached.

import { db } from './db.js';

const BASE = 'https://comicvine.gamespot.com/api';
const KEY = process.env.COMICVINE_API_KEY || '';
const USER_AGENT = process.env.USER_AGENT || 'Stapel/1.0 (self-hosted comic collection tracker)';
const SPACING_MS = 2000;
const HOUR = 3_600_000;
const PER_HOUR = 150; // per resource; Comic Vine's limit is 200

export const COMICVINE_ENABLED = Boolean(KEY);

export class ComicVineBusyError extends Error {
  constructor(retryAt) {
    super('Comic Vine rate limit reached');
    this.retryAt = retryAt;
  }
}

let lastRequestAt = 0;
let cooldownUntil = 0;
let chain = Promise.resolve();
const recent = new Map(); // resource → request timestamps of the last hour

function reserve(resource) {
  const t = Date.now();
  const list = (recent.get(resource) || []).filter((at) => at > t - HOUR);
  recent.set(resource, list);
  if (cooldownUntil > t) throw new ComicVineBusyError(new Date(cooldownUntil).toISOString());
  if (list.length >= PER_HOUR) throw new ComicVineBusyError(new Date(list[0] + HOUR).toISOString());
  list.push(t);
}

async function request(resource, params) {
  const wait = lastRequestAt + SPACING_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  reserve(resource);
  lastRequestAt = Date.now();
  const url = new URL(`${BASE}/${resource}/`);
  for (const [k, v] of Object.entries({ ...params, api_key: KEY, format: 'json' })) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(25_000) });
  if (res.status === 420 || res.status === 429) {
    cooldownUntil = Date.now() + 15 * 60_000;
    await res.body?.cancel();
    throw new ComicVineBusyError(new Date(cooldownUntil).toISOString());
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Comic Vine answered ${res.status}`);
  }
  const data = await res.json();
  // status_code 1 = OK; 107 = rate limit; others are errors (bad key, bad filter, …)
  if (data.status_code === 107) {
    cooldownUntil = Date.now() + 15 * 60_000;
    throw new ComicVineBusyError(new Date(cooldownUntil).toISOString());
  }
  if (data.status_code !== 1) throw new Error(`Comic Vine: ${data.error || data.status_code}`);
  return data;
}

// Cached GET; the cache key leaves out the API key
function cvGet(resource, params, maxAgeMs) {
  const path = `cv:${resource}?${new URLSearchParams(params)}`;
  const cached = db.prepare('SELECT body, fetched_at FROM gcd_cache WHERE path = ?').get(path);
  if (cached && Date.now() - cached.fetched_at < maxAgeMs) return Promise.resolve(JSON.parse(cached.body));
  const run = chain.then(() => request(resource, params));
  chain = run.catch(() => {});
  return run.then(
    (data) => {
      db.prepare('INSERT INTO gcd_cache (path, body, fetched_at) VALUES (?, ?, ?) ON CONFLICT (path) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at')
        .run(path, JSON.stringify(data), Date.now());
      return data;
    },
    (err) => {
      if (cached && err instanceof ComicVineBusyError) return JSON.parse(cached.body);
      throw err;
    },
  );
}

const volumeOf = (v) => ({
  id: v.id,
  name: v.name,
  startYear: Number(v.start_year) || null,
  issueCount: v.count_of_issues ?? null,
  publisher: v.publisher?.name || null,
  image: v.image?.thumb_url || v.image?.small_url || null,
  url: v.site_detail_url || null,
});

// Comic Vine series ("volumes") matching a name
export async function searchVolumes(query) {
  const data = await cvGet('search', {
    query: query.trim(),
    resources: 'volume',
    limit: 20,
    field_list: 'id,name,start_year,count_of_issues,publisher,image,site_detail_url',
  }, 3 * 24 * HOUR);
  return (data.results || []).map(volumeOf);
}

export async function getVolume(volumeId) {
  const data = await cvGet(`volume/4050-${Number(volumeId)}`, { field_list: 'id,name,start_year,count_of_issues,publisher,image,site_detail_url' }, 7 * 24 * HOUR);
  return volumeOf(data.results);
}

// All issues of a volume: [{ id, number, coverUrl }]; 100 per request
export async function volumeIssues(volumeId, { maxAgeMs = 24 * HOUR } = {}) {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const data = await cvGet('issues', {
      filter: `volume:${Number(volumeId)}`,
      field_list: 'id,issue_number,image',
      sort: 'id:asc',
      limit: 100,
      offset,
    }, maxAgeMs);
    for (const i of data.results || []) {
      const coverUrl = i.image?.medium_url || i.image?.original_url || null;
      out.push({ id: i.id, number: String(i.issue_number ?? '').trim(), coverUrl: coverUrl && !/blank\.png|6373148-blank/i.test(coverUrl) ? coverUrl : null });
    }
    if (!data.results?.length || offset + 100 >= (data.number_of_total_results ?? 0)) break;
  }
  return out;
}

// How well a Comic Vine volume fits a series: higher is better, 0 = not a candidate
export function matchScore(series, volume, issueCount) {
  if (!volume.startYear || !series.year_began) return 0;
  const yearDiff = Math.abs(volume.startYear - series.year_began);
  if (yearDiff > 1) return 0;
  let score = yearDiff === 0 ? 3 : 1;
  if (issueCount && volume.issueCount) {
    const ratio = Math.min(issueCount, volume.issueCount) / Math.max(issueCount, volume.issueCount);
    if (ratio < 0.5) return 0;
    score += ratio >= 0.9 ? 3 : ratio >= 0.75 ? 2 : 1;
  }
  const pub = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const a = pub(series.publisher_name);
  const b = pub(volume.publisher);
  if (a && b && (a.includes(b) || b.includes(a) || a.split(' ')[0] === b.split(' ')[0])) score += 2;
  const name = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim();
  if (name(series.name) === name(volume.name)) score += 2;
  return score;
}

export const comicVineUsage = () => ({
  enabled: COMICVINE_ENABLED,
  cooldownUntil: cooldownUntil > Date.now() ? new Date(cooldownUntil).toISOString() : null,
});
