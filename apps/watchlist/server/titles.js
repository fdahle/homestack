// Checking what the app sends, and turning TMDB's answers into films and series.
// No database and no network here, so it can be tested on its own.

import { BadRequest } from './kit/errors.js';

export { BadRequest };

export const FILM_STATUSES = ['watchlist', 'watched', 'dropped'];
export const SERIES_STATUSES = ['watchlist', 'watching', 'paused', 'finished', 'dropped'];

// 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD', as precise as you remember it
export function isPartialDate(v) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(String(v));
  if (!m) return false;
  const [, y, mo, d] = m.map(Number);
  if (y < 1900 || y > 2100) return false;
  if (m[2] && (mo < 1 || mo > 12)) return false;
  if (m[3] && (d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate())) return false;
  return true;
}

// Optional text: trimmed, cut to max, '' → null. undefined stays undefined (= not changed).
const text = (v, max) => (v === undefined ? undefined : String(v ?? '').trim().slice(0, max) || null);

export function partialDate(v, code = 'bad_date') {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (!isPartialDate(v)) throw new BadRequest(code);
  return String(v);
}

function nameList(v, code) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new BadRequest(code);
  return [...new Set(v.map((s) => String(s ?? '').trim().slice(0, 80)).filter(Boolean))].slice(0, 30);
}

// Country codes ('US', 'DE') as sent for a title entered by hand
function countryList(v) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new BadRequest('bad_countries');
  const codes = v.map((s) => String(s ?? '').trim().toUpperCase());
  if (codes.some((c) => !/^[A-Z]{2}$/.test(c))) throw new BadRequest('bad_countries');
  return [...new Set(codes)].slice(0, 10);
}

function minutes(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 1500) throw new BadRequest('bad_runtime');
  return n;
}

function yourEntries(body, statuses) {
  const out = {};
  if (body.status !== undefined) {
    if (!statuses.includes(body.status)) throw new BadRequest('bad_status');
    out.status = body.status;
  }
  if (body.rating !== undefined) {
    const r = body.rating === null || body.rating === '' ? null : Number(body.rating);
    if (r !== null && !(Number.isInteger(r) && r >= 1 && r <= 10)) throw new BadRequest('bad_rating');
    out.rating = r;
  }
  out.notes = text(body.notes, 20_000);
  return out;
}

const dropUndefined = (out) => {
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
};

function titleField(body, out) {
  if (body.title === undefined) return;
  out.title = text(body.title, 200);
  if (!out.title) throw new BadRequest('title_required');
}

// What you can change about a film. `manual` also allows the catalog fields
// (for films entered by hand, which TMDB doesn't fill in).
export function cleanFilmInput(body, { manual = false } = {}) {
  const out = yourEntries(body, FILM_STATUSES);
  if (manual) {
    titleField(body, out);
    out.release_date = partialDate(body.releaseDate);
    out.runtime = minutes(body.runtime);
    out.director = text(body.director, 200);
    out.overview = text(body.overview, 5000);
    out.genres = nameList(body.genres, 'bad_genres');
    out.countries = countryList(body.countries);
  }
  return dropUndefined(out);
}

export function cleanSeriesInput(body, { manual = false } = {}) {
  const out = yourEntries(body, SERIES_STATUSES);
  if (manual) {
    titleField(body, out);
    out.first_air_date = partialDate(body.firstAirDate);
    out.episode_runtime = minutes(body.episodeRuntime);
    out.creators = text(body.creators, 200);
    out.overview = text(body.overview, 5000);
    out.genres = nameList(body.genres, 'bad_genres');
    out.countries = countryList(body.countries);
  }
  return dropUndefined(out);
}

// --- TMDB ---

const names = (list) => [...new Set((list || []).map((x) => String(x?.name || '').trim()).filter(Boolean))];
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
const positive = (n) => (Number.isFinite(n) && n > 0 ? Math.round(n) : null);

// TMDB answers in the language asked for, with '' where nobody translated the
// description; then the English one from the translations fills in.
export function overviewOf(d) {
  const own = String(d.overview || '').trim();
  if (own) return own;
  const list = d.translations?.translations || [];
  const en = list.find((x) => x.iso_639_1 === 'en' && x.iso_3166_1 === 'US') || list.find((x) => x.iso_639_1 === 'en');
  return String(en?.data?.overview || '').trim() || null;
}

// Where a title comes from: TMDB's origin_country (codes), else the production countries
export function countriesOf(d) {
  const origin = Array.isArray(d.origin_country) ? d.origin_country : [];
  const codes = origin.length ? origin : (d.production_countries || []).map((c) => c?.iso_3166_1);
  return [...new Set(codes.map((c) => String(c || '').toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))].slice(0, 10);
}

const topCast = (credits, n = 6) => [...(credits?.cast || [])]
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
  .slice(0, n)
  .map((c) => String(c.name || '').trim())
  .filter(Boolean);

// TMDB's "all offers" page. It ends up as a link in the browser, so it is kept only
// when it goes to themoviedb.org over https (never javascript: or some other site).
export function tmdbLink(v) {
  try {
    const url = new URL(String(v || ''));
    const tmdb = url.hostname === 'themoviedb.org' || url.hostname.endsWith('.themoviedb.org');
    return url.protocol === 'https:' && tmdb ? url.href : null;
  } catch {
    return null;
  }
}

// What a picture from TMDB's image server really is, told by its first bytes rather than
// by the server's header: only plain JPEG, PNG or WebP is ever sent from Watchlist's own
// address (an SVG there could run script). null for anything else.
export function imageType(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 4).toString('hex') === '89504e47') return 'image/png';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// One country's streaming offers from TMDB's watch/providers (data by JustWatch):
// { link, flatrate: [{ id, name, logo }], free, rent, buy } or null when there are none
export function providersFor(watchProviders, region) {
  const r = watchProviders?.results?.[region];
  if (!r) return null;
  const list = (items) => {
    const seen = new Set();
    return [...(items || [])]
      .sort((a, b) => (a.display_priority ?? 99) - (b.display_priority ?? 99))
      .filter((p) => p?.provider_id && !seen.has(p.provider_id) && seen.add(p.provider_id))
      .map((p) => ({ id: p.provider_id, name: String(p.provider_name || '').trim(), logo: p.logo_path || null }));
  };
  const out = { link: tmdbLink(r.link), flatrate: list(r.flatrate), free: list([...(r.free || []), ...(r.ads || [])]), rent: list(r.rent), buy: list(r.buy) };
  return out.flatrate.length || out.free.length || out.rent.length || out.buy.length ? out : null;
}

// A search hit, for the list on the add page
export function searchHit(r) {
  const title = String(r.title || r.name || '').trim();
  const original = String(r.original_title || r.original_name || '').trim();
  const released = date(r.release_date || r.first_air_date);
  return {
    tmdbId: r.id,
    title: title || original || `TMDB ${r.id}`,
    originalTitle: original && original !== title ? original : null,
    year: released ? Number(released.slice(0, 4)) : null,
    overview: String(r.overview || '').trim().slice(0, 300) || null,
    poster: r.poster_path || null,
  };
}

// A film from TMDB's /movie/{id} (with credits, translations and watch/providers appended) → database fields
export function fromTmdbMovie(d, region = 'DE') {
  const title = String(d.title || '').trim() || String(d.original_title || '').trim() || `TMDB ${d.id}`;
  const original = String(d.original_title || '').trim();
  const directors = names((d.credits?.crew || []).filter((c) => c.job === 'Director'));
  return {
    tmdb_id: d.id,
    title,
    original_title: original && original !== title ? original : null,
    tagline: String(d.tagline || '').trim() || null,
    overview: overviewOf(d),
    release_date: date(d.release_date),
    runtime: positive(d.runtime),
    genres: names(d.genres),
    director: directors.slice(0, 2).join(', ') || null,
    cast_names: topCast(d.credits),
    countries: countriesOf(d),
    tmdb_poster: d.poster_path || null,
    providers: providersFor(d['watch/providers'], region),
  };
}

// Runtime of an episode: TMDB's list of typical runtimes is often empty for newer shows
function typicalRuntime(d) {
  const list = (d.episode_run_time || []).filter((n) => n > 0).sort((a, b) => a - b);
  if (list.length) return list[Math.floor(list.length / 2)];
  return positive(d.last_episode_to_air?.runtime) || positive(d.next_episode_to_air?.runtime);
}

// A series from TMDB's /tv/{id} (with credits, translations and watch/providers) → database fields.
// Specials (season 0) are left out: they don't count towards having seen a show.
export function fromTmdbTv(d, region = 'DE') {
  const title = String(d.name || '').trim() || String(d.original_name || '').trim() || `TMDB ${d.id}`;
  const original = String(d.original_name || '').trim();
  return {
    tmdb_id: d.id,
    title,
    original_title: original && original !== title ? original : null,
    tagline: String(d.tagline || '').trim() || null,
    overview: overviewOf(d),
    first_air_date: date(d.first_air_date),
    last_air_date: date(d.last_air_date),
    tmdb_status: d.status || null,
    genres: names(d.genres),
    creators: names(d.created_by).slice(0, 3).join(', ') || null,
    networks: names(d.networks).slice(0, 3),
    cast_names: topCast(d.credits),
    countries: countriesOf(d),
    episode_runtime: typicalRuntime(d) || null,
    seasons: (d.seasons || [])
      .filter((s) => s.season_number > 0)
      .map((s) => ({ number: s.season_number, name: String(s.name || '').trim() || null, air_date: date(s.air_date), episode_count: s.episode_count || 0 })),
    next_air_date: date(d.next_episode_to_air?.air_date),
    tmdb_poster: d.poster_path || null,
    providers: providersFor(d['watch/providers'], region),
  };
}

// The episodes of one season from TMDB's /tv/{id}/season/{n}
export function episodesFromSeason(season) {
  return (season?.episodes || [])
    .filter((e) => Number.isInteger(e.season_number) && e.season_number > 0 && Number.isInteger(e.episode_number))
    .map((e) => ({
      season: e.season_number,
      number: e.episode_number,
      name: String(e.name || '').trim() || null,
      air_date: date(e.air_date),
      runtime: positive(e.runtime),
    }));
}
