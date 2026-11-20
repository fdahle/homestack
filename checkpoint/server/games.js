// Checking what the app sends, and turning IGDB's answers into games.
// No database and no network here, so it can be tested on its own.

import { BadRequest } from './kit/errors.js';

export { BadRequest };

export const STATUSES = ['wishlist', 'backlog', 'playing', 'finished', 'completed', 'dropped'];
// Statuses that mean you are done with the game, so it gets a finish date
export const DONE_STATUSES = ['finished', 'completed', 'dropped'];

// 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD', as precise as you remember it
export function isPartialDate(v) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(String(v));
  if (!m) return false;
  const [, y, mo, d] = m.map(Number);
  if (y < 1950 || y > 2100) return false;
  if (m[2] && (mo < 1 || mo > 12)) return false;
  if (m[3] && (d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate())) return false;
  return true;
}

// Optional text: trimmed, cut to max, '' → null. undefined stays undefined (= not changed).
const text = (v, max) => (v === undefined ? undefined : String(v ?? '').trim().slice(0, max) || null);

function partialDate(v, code) {
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

// What you can change about a game. `manual` also allows the catalog fields
// (for games entered by hand, which IGDB doesn't fill in).
export function cleanGameInput(body, { manual = false } = {}) {
  const out = {};
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) throw new BadRequest('bad_status');
    out.status = body.status;
  }
  if (body.rating !== undefined) {
    const r = body.rating === null || body.rating === '' ? null : Number(body.rating);
    if (r !== null && !(Number.isInteger(r) && r >= 1 && r <= 10)) throw new BadRequest('bad_rating');
    out.rating = r;
  }
  out.played_on = text(body.playedOn, 60);
  out.started_on = partialDate(body.startedOn, 'bad_date');
  out.finished_on = partialDate(body.finishedOn, 'bad_date');
  out.notes = text(body.notes, 20_000);

  if (manual) {
    if (body.name !== undefined) {
      out.name = text(body.name, 200);
      if (!out.name) throw new BadRequest('name_required');
    }
    out.release_date = partialDate(body.releaseDate, 'bad_date');
    out.developer = text(body.developer, 200);
    out.franchise = text(body.franchise, 200);
    out.summary = text(body.summary, 5000);
    out.platforms = nameList(body.platforms, 'bad_platforms');
    out.genres = nameList(body.genres, 'bad_genres');
  }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

// Partial dates compared as far as both go: '2020' and '2020-05-03' are in order either way
export function datesInOrder(started, finished) {
  if (!started || !finished) return true;
  const n = Math.min(started.length, finished.length);
  return finished.slice(0, n) >= started.slice(0, n);
}

// Dates filled in for you when the status changes in the app (not when a game is
// added: a game added as "finished" may have been finished years ago).
export function datesForStatusChange(game, newStatus, today) {
  const out = {};
  if (!newStatus || newStatus === game.status) return out;
  if (newStatus === 'playing' && !game.started_on) out.started_on = today;
  if (DONE_STATUSES.includes(newStatus) && !game.finished_on && game.status === 'playing') out.finished_on = today;
  return out;
}

// --- IGDB ---

const isoDay = (unixSeconds) => (Number.isFinite(unixSeconds) ? new Date(unixSeconds * 1000).toISOString().slice(0, 10) : null);
// Short platform names: "PS5", "Switch", "PC" rather than "PlayStation 5", "PC (Microsoft Windows)"
export const platformName = (p) => (p?.abbreviation || p?.name || '').trim();
const names = (list, pick = (x) => x?.name) => [...new Set((list || []).map(pick).map((s) => String(s || '').trim()).filter(Boolean))];
// Seconds → hours, to the half hour
const hours = (seconds) => (seconds > 0 ? Math.max(0.5, Math.round(seconds / 1800) / 2) : null);

// A search hit, for the list on the add page
export function searchHit(g) {
  return {
    igdbId: g.id,
    name: g.name,
    year: g.first_release_date ? Number(isoDay(g.first_release_date).slice(0, 4)) : null,
    platforms: names(g.platforms, platformName),
    coverId: g.cover?.image_id || null,
    type: g.game_type?.type || null,
  };
}

// A game from IGDB's /games (with the fields igdb.js asks for) and its time to beat → database fields
export function fromIgdb(g, timeToBeat = null) {
  const developers = names((g.involved_companies || []).filter((c) => c.developer), (c) => c.company?.name);
  return {
    igdb_id: g.id,
    name: String(g.name || '').trim() || `IGDB ${g.id}`,
    slug: g.slug || null,
    igdb_url: g.url || null,
    summary: g.summary || null,
    release_date: isoDay(g.first_release_date),
    platforms: names(g.platforms, platformName),
    genres: names(g.genres),
    developer: developers.slice(0, 2).join(', ') || null,
    franchise: g.franchises?.[0]?.name || g.collections?.[0]?.name || null,
    hours_main: hours(timeToBeat?.normally ?? timeToBeat?.hastily),
    hours_complete: hours(timeToBeat?.completely),
    igdb_cover_id: g.cover?.image_id || null,
  };
}
