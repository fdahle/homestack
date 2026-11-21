// Client for the IGDB API (https://api-docs.igdb.com). IGDB belongs to Twitch:
// a Twitch application's client ID and secret get an app token (valid for about
// two months), which every request sends along. IGDB allows 4 requests a second,
// so requests go out one after another, at least 260 ms apart.

import { fromIgdb, searchHit } from './games.js';

const CLIENT_ID = process.env.IGDB_CLIENT_ID || '';
const CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET || '';
const API = 'https://api.igdb.com/v4';
const SPACING_MS = 260;

export const IGDB_ENABLED = Boolean(CLIENT_ID && CLIENT_SECRET);

export class IgdbError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

let token = null; // { value, expiresAt }

async function accessToken() {
  if (token && token.expiresAt > Date.now()) return token.value;
  const url = new URL('https://id.twitch.tv/oauth2/token');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('client_secret', CLIENT_SECRET);
  url.searchParams.set('grant_type', 'client_credentials');
  const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    await res.body?.cancel();
    // 400/403: wrong client ID or secret
    throw new IgdbError(res.status < 500 ? 'igdb_login_failed' : 'igdb_failed', `Twitch token request answered ${res.status}`);
  }
  const data = await res.json();
  // Renew a day early
  token = { value: data.access_token, expiresAt: Date.now() + Math.max(60, (data.expires_in || 0) - 86_400) * 1000 };
  return token.value;
}

// Requests wait for each other, so IGDB sees at most ~4 a second
let chain = Promise.resolve();
let lastRequestAt = 0;

function queued(fn) {
  const run = chain.then(async () => {
    const wait = lastRequestAt + SPACING_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  chain = run.catch(() => {});
  return run;
}

// body is an Apicalypse query: "fields name; where id = 1;"
async function query(endpoint, body, retried = false) {
  if (!IGDB_ENABLED) throw new IgdbError('igdb_not_configured');
  const res = await queued(async () => fetch(`${API}/${endpoint}`, {
    method: 'POST',
    headers: { 'Client-ID': CLIENT_ID, Authorization: `Bearer ${await accessToken()}`, Accept: 'application/json', 'Content-Type': 'text/plain' },
    body,
    signal: AbortSignal.timeout(20_000),
  }));
  if (res.status === 401 && !retried) {
    // The token expired early or was revoked: get a new one, once
    await res.body?.cancel();
    token = null;
    return query(endpoint, body, true);
  }
  if (res.status === 429) {
    await res.body?.cancel();
    throw new IgdbError('igdb_busy');
  }
  if (!res.ok) {
    console.warn(`IGDB ${endpoint} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    throw new IgdbError('igdb_failed');
  }
  return res.json();
}

// Apicalypse strings are in double quotes; there is no escaping for them
const quoted = (s) => `"${String(s).replace(/["\\]/g, ' ').trim()}"`;

export async function search(q) {
  // version_parent = null hides editions ("Deluxe Edition", "GOTY") of the same game
  const games = await query('games', `search ${quoted(q.slice(0, 100))};
    fields name, first_release_date, cover.image_id, platforms.name, platforms.abbreviation, game_type.type;
    where version_parent = null;
    limit 25;`);
  return games.map(searchHit);
}

// Everything Checkpoint keeps about a game, ready for the database
export async function gameDetails(igdbId) {
  const id = Number(igdbId);
  if (!Number.isInteger(id) || id <= 0) throw new IgdbError('not_found');
  const [game] = await query('games', `fields name, slug, url, summary, first_release_date, cover.image_id,
    platforms.name, platforms.abbreviation, genres.name, involved_companies.developer, involved_companies.company.name,
    franchises.name, collections.name;
    where id = ${id};`);
  if (!game) throw new IgdbError('not_found');
  let timeToBeat = null;
  try {
    [timeToBeat] = await query('game_time_to_beats', `fields hastily, normally, completely; where game_id = ${id};`);
  } catch (err) {
    // Nice to have; the game is added without it
    console.warn(`IGDB time to beat for ${id}: ${err.message}`);
  }
  return fromIgdb(game, timeToBeat);
}

// Cover images are public on IGDB's image server. Sizes: cover_small (90×128), cover_big (264×374), cover_big_2x (528×748).
const IMAGE_ID = /^[a-z0-9]{1,40}$/i;
export const isImageId = (imageId) => IMAGE_ID.test(String(imageId || ''));

export async function fetchImage(imageId, size = 'cover_big_2x') {
  if (!isImageId(imageId)) throw new IgdbError('not_found');
  const res = await fetch(`https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    await res.body?.cancel();
    throw new IgdbError(res.status === 404 ? 'not_found' : 'igdb_failed', `IGDB image answered ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
