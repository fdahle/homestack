// Client for TMDB's API v3 (https://developer.themoviedb.org). It takes either the
// "API Read Access Token" (TMDB_TOKEN, sent as a Bearer token) or the older v3 key
// (TMDB_API_KEY, sent as ?api_key=). TMDB allows about 40 requests a second; Watchlist
// stays far below that, one request at a time, at least 150 ms apart.

import { episodesFromSeason, fromTmdbMovie, fromTmdbTv, providersFor, searchHit } from './titles.js';

const TOKEN = process.env.TMDB_TOKEN || '';
const API_KEY = process.env.TMDB_API_KEY || '';
const API = 'https://api.themoviedb.org/3';
const IMAGES = 'https://image.tmdb.org/t/p';
const SPACING_MS = 150;

export const TMDB_ENABLED = Boolean(TOKEN || API_KEY);
export const LANGUAGE = process.env.TMDB_LANGUAGE || 'de-DE';
export const REGION = (process.env.WATCH_REGION || 'DE').toUpperCase();

export class TmdbError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

// Requests wait for each other
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

async function get(path, params = {}) {
  if (!TMDB_ENABLED) throw new TmdbError('tmdb_not_configured');
  const url = new URL(API + path);
  url.searchParams.set('language', LANGUAGE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { Accept: 'application/json' };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  else url.searchParams.set('api_key', API_KEY);
  const res = await queued(() => fetch(url, { headers, signal: AbortSignal.timeout(20_000) }));
  if (res.ok) return res.json();
  await res.body?.cancel();
  if (res.status === 401) throw new TmdbError('tmdb_login_failed', 'TMDB rejects the token or key');
  if (res.status === 404) throw new TmdbError('not_found');
  if (res.status === 429) throw new TmdbError('tmdb_busy');
  console.warn(`TMDB ${path} answered ${res.status}`);
  throw new TmdbError('tmdb_failed');
}

const tmdbId = (id) => {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new TmdbError('not_found');
  return n;
};

// mode: 'films' or 'series'
export async function search(mode, q) {
  const data = await get(mode === 'series' ? '/search/tv' : '/search/movie', { query: q.slice(0, 100), include_adult: 'false', page: '1' });
  return (data.results || []).slice(0, 20).map(searchHit);
}

// Everything Watchlist keeps about a film, ready for the database
export async function movieDetails(id) {
  const d = await get(`/movie/${tmdbId(id)}`, { append_to_response: 'credits,translations,watch/providers' });
  return fromTmdbMovie(d, REGION);
}

// A series and all its episodes. Seasons come appended to the show (up to 20 per
// request), so even a long show takes only two or three requests.
export async function tvDetails(id) {
  const n = tmdbId(id);
  const d = await get(`/tv/${n}`, { append_to_response: 'credits,translations,watch/providers' });
  const series = fromTmdbTv(d, REGION);
  const numbers = series.seasons.map((s) => s.number);
  const episodes = [];
  for (let i = 0; i < numbers.length; i += 20) {
    const chunk = numbers.slice(i, i + 20);
    const data = await get(`/tv/${n}`, { append_to_response: chunk.map((s) => `season/${s}`).join(',') });
    for (const s of chunk) episodes.push(...episodesFromSeason(data[`season/${s}`]));
  }
  return { series, episodes };
}

// Just the streaming offers (they change more often than the rest)
export async function watchProviders(mode, id) {
  const data = await get(`/${mode === 'series' ? 'tv' : 'movie'}/${tmdbId(id)}/watch/providers`);
  return providersFor(data, REGION);
}

// Pictures are public on TMDB's image server. Sizes used here: w92 (search, logos), w185, w500 (posters).
export const IMAGE_SIZES = ['w45', 'w92', 'w154', 'w185', 'w342', 'w500'];
const IMAGE_PATH = /^\/[A-Za-z0-9_-]{1,80}\.(jpg|png|svg)$/;
export const isImagePath = (path) => IMAGE_PATH.test(String(path || ''));

export async function fetchImage(path, size = 'w500') {
  if (!isImagePath(path) || !IMAGE_SIZES.includes(size)) throw new TmdbError('not_found');
  const res = await fetch(`${IMAGES}/${size}${path}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    await res.body?.cancel();
    throw new TmdbError(res.status === 404 ? 'not_found' : 'tmdb_failed', `TMDB image answered ${res.status}`);
  }
  return { type: res.headers.get('content-type') || 'image/jpeg', data: Buffer.from(await res.arrayBuffer()) };
}
