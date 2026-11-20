import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createUserStore } from './kit/users.js';
import { byEpisode, summary } from './progress.js';

export const DATA_DIR = process.env.DATA_DIR || './data';
export const POSTER_DIR = join(DATA_DIR, 'posters');
mkdirSync(POSTER_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'flimmer.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  -- Films and series are kept apart on purpose: two tables, two libraries.
  -- tmdb_id NULL = entered by hand. genres, cast_names, networks: JSON arrays of names.
  -- tmdb_poster: TMDB's poster path; poster_file: the copy in posters/;
  -- poster_source: 'tmdb' (downloaded) or 'photo' (your own, never replaced).
  -- providers: where to stream it in WATCH_REGION (JSON, from TMDB/JustWatch), as of providers_at.
  -- rating: 1–10, shown as half stars.

  -- status: watchlist, watched, dropped. runtime in minutes.
  CREATE TABLE IF NOT EXISTS films (
    id INTEGER PRIMARY KEY,
    tmdb_id INTEGER UNIQUE,
    title TEXT NOT NULL,
    original_title TEXT,
    tagline TEXT,
    overview TEXT,
    release_date TEXT,
    runtime INTEGER,
    genres TEXT NOT NULL DEFAULT '[]',
    director TEXT,
    cast_names TEXT NOT NULL DEFAULT '[]',
    tmdb_poster TEXT,
    poster_file TEXT,
    poster_source TEXT,
    providers TEXT,
    providers_at TEXT,
    status TEXT NOT NULL DEFAULT 'watchlist',
    rating INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS films_status ON films (status);

  -- Each time you watched a film. watched_on: 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD', NULL = don't know when.
  CREATE TABLE IF NOT EXISTS film_watches (
    id INTEGER PRIMARY KEY,
    film_id INTEGER NOT NULL REFERENCES films (id) ON DELETE CASCADE,
    watched_on TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS film_watches_film ON film_watches (film_id);

  -- status: watchlist, watching, paused, finished, dropped.
  -- tmdb_status: TMDB's 'Returning Series', 'Ended', 'Canceled', 'In Production', …
  -- seasons: JSON [{ number, name, air_date, episode_count }] without specials.
  -- episode_runtime: minutes, for episodes TMDB has no runtime for.
  -- refreshed_at: when TMDB's data was last fetched (shows still running are fetched daily).
  CREATE TABLE IF NOT EXISTS series (
    id INTEGER PRIMARY KEY,
    tmdb_id INTEGER UNIQUE,
    title TEXT NOT NULL,
    original_title TEXT,
    tagline TEXT,
    overview TEXT,
    first_air_date TEXT,
    last_air_date TEXT,
    tmdb_status TEXT,
    genres TEXT NOT NULL DEFAULT '[]',
    creators TEXT,
    networks TEXT NOT NULL DEFAULT '[]',
    cast_names TEXT NOT NULL DEFAULT '[]',
    episode_runtime INTEGER,
    seasons TEXT NOT NULL DEFAULT '[]',
    next_air_date TEXT,
    tmdb_poster TEXT,
    poster_file TEXT,
    poster_source TEXT,
    providers TEXT,
    providers_at TEXT,
    status TEXT NOT NULL DEFAULT 'watchlist',
    rating INTEGER,
    notes TEXT,
    refreshed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS series_status ON series (status);

  -- The episodes of a series (from TMDB, or numbered by hand) and whether you saw them.
  -- watched_on: 'YYYY-MM-DD' when you ticked it, NULL when that isn't known (imports).
  CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY,
    series_id INTEGER NOT NULL REFERENCES series (id) ON DELETE CASCADE,
    season INTEGER NOT NULL,
    number INTEGER NOT NULL,
    name TEXT,
    air_date TEXT,
    runtime INTEGER,
    watched INTEGER NOT NULL DEFAULT 0,
    watched_on TEXT,
    UNIQUE (series_id, season, number)
  );
`);

export const now = () => new Date().toISOString();

// 'YYYY-MM-DD' in the server's time zone (TZ), not UTC
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Accounts and settings (users, settings tables)
export const users = createUserStore(db);

// --- shared by films and series ---

function table(name, columns, jsonColumns) {
  const toRow = (fields) => {
    const row = {};
    for (const [k, v] of Object.entries(fields)) {
      if (!columns.includes(k) || v === undefined) continue;
      row[k] = jsonColumns.includes(k) ? (v == null && k === 'providers' ? null : JSON.stringify(v ?? [])) : v;
    }
    return row;
  };
  const fromRow = (row) => {
    if (!row) return row;
    const item = { ...row };
    for (const k of jsonColumns) item[k] = row[k] == null ? (k === 'providers' ? null : []) : JSON.parse(row[k]);
    return item;
  };
  return {
    fromRow,
    insert(fields, createdAt = null) {
      const row = toRow(fields);
      const keys = Object.keys(row);
      const t = now();
      const { lastInsertRowid } = db.prepare(`INSERT INTO ${name} (${keys.join(', ')}, created_at, updated_at) VALUES (${keys.map(() => '?').join(', ')}, ?, ?)`)
        .run(...Object.values(row), createdAt || t, t);
      return Number(lastInsertRowid);
    },
    update(id, fields, { touch = true } = {}) {
      const row = toRow(fields);
      const keys = Object.keys(row);
      if (!keys.length) return;
      // touch: false for TMDB's updates, so "recently changed" means changed by you
      const sets = keys.map((k) => `${k} = ?`);
      const values = Object.values(row);
      if (touch) {
        sets.push('updated_at = ?');
        values.push(now());
      }
      db.prepare(`UPDATE ${name} SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
    },
    remove: (id) => db.prepare(`DELETE FROM ${name} WHERE id = ?`).run(id).changes > 0,
    byTmdbId: (tmdbId) => db.prepare(`SELECT id FROM ${name} WHERE tmdb_id = ?`).get(tmdbId)?.id ?? null,
    // TMDB id → our id, for marking search results that are already in the library
    idsByTmdbId(tmdbIds) {
      if (!tmdbIds.length) return new Map();
      const rows = db.prepare(`SELECT id, tmdb_id FROM ${name} WHERE tmdb_id IN (${tmdbIds.map(() => '?').join(',')})`).all(...tmdbIds);
      return new Map(rows.map((r) => [r.tmdb_id, r.id]));
    },
  };
}

// --- films ---

const films = table('films', [
  'tmdb_id', 'title', 'original_title', 'tagline', 'overview', 'release_date', 'runtime', 'genres', 'director', 'cast_names',
  'tmdb_poster', 'poster_file', 'poster_source', 'providers', 'providers_at', 'status', 'rating', 'notes',
], ['genres', 'cast_names', 'providers']);

export const insertFilm = films.insert;
export const updateFilm = films.update;
export const deleteFilm = films.remove;
export const filmByTmdbId = films.byTmdbId;
export const filmIdsByTmdbId = films.idsByTmdbId;

// The list leaves out the long texts; watch_dates are for the stats
export const listFilms = () => db.prepare(`
  SELECT f.id, f.tmdb_id, f.title, f.original_title, f.release_date, f.runtime, f.genres, f.director, f.cast_names,
    f.poster_file, f.status, f.rating, f.created_at, f.updated_at,
    (SELECT COUNT(*) FROM film_watches w WHERE w.film_id = f.id) AS watch_count,
    (SELECT MAX(watched_on) FROM film_watches w WHERE w.film_id = f.id) AS last_watched,
    (SELECT json_group_array(watched_on) FROM film_watches w WHERE w.film_id = f.id AND watched_on IS NOT NULL) AS watch_dates
  FROM films f ORDER BY f.title COLLATE NOCASE`).all()
  .map((r) => ({ ...films.fromRow({ ...r, providers: null }), watch_dates: JSON.parse(r.watch_dates || '[]') }));

// Undated watches first (they are the oldest, as a rule), then by date
export const watchesOf = (filmId) => db.prepare(`SELECT id, watched_on, created_at FROM film_watches WHERE film_id = ?
  ORDER BY watched_on IS NOT NULL, watched_on, id`).all(filmId);

export function getFilm(id) {
  const film = films.fromRow(db.prepare('SELECT * FROM films WHERE id = ?').get(id));
  if (!film) return film;
  const watches = watchesOf(id);
  return { ...film, watches, watch_count: watches.length, last_watched: watches.map((w) => w.watched_on).filter(Boolean).sort().pop() || null };
}

export function addWatch(filmId, watchedOn) {
  const { lastInsertRowid } = db.prepare('INSERT INTO film_watches (film_id, watched_on, created_at) VALUES (?, ?, ?)').run(filmId, watchedOn ?? null, now());
  return Number(lastInsertRowid);
}
export const updateWatch = (filmId, watchId, watchedOn) =>
  db.prepare('UPDATE film_watches SET watched_on = ? WHERE id = ? AND film_id = ?').run(watchedOn ?? null, watchId, filmId).changes > 0;
export const deleteWatch = (filmId, watchId) => db.prepare('DELETE FROM film_watches WHERE id = ? AND film_id = ?').run(watchId, filmId).changes > 0;
export const touchFilm = (id) => db.prepare('UPDATE films SET updated_at = ? WHERE id = ?').run(now(), id);

// --- series ---

const seriesTable = table('series', [
  'tmdb_id', 'title', 'original_title', 'tagline', 'overview', 'first_air_date', 'last_air_date', 'tmdb_status', 'genres', 'creators',
  'networks', 'cast_names', 'episode_runtime', 'seasons', 'next_air_date', 'tmdb_poster', 'poster_file', 'poster_source',
  'providers', 'providers_at', 'status', 'rating', 'notes', 'refreshed_at',
], ['genres', 'networks', 'cast_names', 'seasons', 'providers']);

export const insertSeries = seriesTable.insert;
export const updateSeries = seriesTable.update;
export const deleteSeries = seriesTable.remove;
export const seriesByTmdbId = seriesTable.byTmdbId;
export const seriesIdsByTmdbId = seriesTable.idsByTmdbId;
export const touchSeries = (id) => db.prepare('UPDATE series SET updated_at = ? WHERE id = ?').run(now(), id);

const EPISODE_COLUMNS = 'id, series_id, season, number, name, air_date, runtime, watched, watched_on';
const episodeFromRow = (r) => ({ ...r, watched: Boolean(r.watched) });
export const episodesOf = (seriesId) => db.prepare(`SELECT ${EPISODE_COLUMNS} FROM episodes WHERE series_id = ? ORDER BY season, number`).all(seriesId).map(episodeFromRow);

function allEpisodesBySeries() {
  const bySeries = new Map();
  for (const r of db.prepare(`SELECT ${EPISODE_COLUMNS} FROM episodes ORDER BY series_id, season, number`).all()) {
    if (!bySeries.has(r.series_id)) bySeries.set(r.series_id, []);
    bySeries.get(r.series_id).push(episodeFromRow(r));
  }
  return bySeries;
}

const LIST_SERIES = `SELECT id, tmdb_id, title, original_title, first_air_date, last_air_date, tmdb_status, genres, creators, networks,
  cast_names, episode_runtime, next_air_date, poster_file, status, rating, created_at, updated_at FROM series ORDER BY title COLLATE NOCASE`;

const withSummary = (s, episodes, today) => ({ ...s, ...summary(episodes, today, { manual: !s.tmdb_id, runtime: s.episode_runtime }) });

// The library: each series with its progress (no episode lists)
export function listSeries(today) {
  const episodes = allEpisodesBySeries();
  return db.prepare(LIST_SERIES).all().map((r) => withSummary(seriesTable.fromRow({ ...r, seasons: null, providers: null }), episodes.get(r.id) || [], today));
}

// For the up next page: each series with its episodes
export function seriesWithEpisodes(today) {
  const episodes = allEpisodesBySeries();
  return db.prepare(LIST_SERIES).all().map((r) => {
    const eps = episodes.get(r.id) || [];
    return { ...withSummary(seriesTable.fromRow({ ...r, seasons: null, providers: null }), eps, today), episodes: eps };
  });
}

export function getSeries(id, today) {
  const s = seriesTable.fromRow(db.prepare('SELECT * FROM series WHERE id = ?').get(id));
  if (!s) return s;
  const episodes = episodesOf(id);
  return { ...withSummary(s, episodes, today), episodes };
}

// Takes TMDB's episode list: new episodes are added, known ones get their new names and
// dates, and episodes TMDB no longer has go away unless you have seen them.
export function saveEpisodes(seriesId, episodes) {
  const upsert = db.prepare(`INSERT INTO episodes (series_id, season, number, name, air_date, runtime) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (series_id, season, number) DO UPDATE SET name = excluded.name, air_date = excluded.air_date, runtime = excluded.runtime`);
  const keep = new Set(episodes.map((e) => `${e.season}x${e.number}`));
  db.exec('BEGIN');
  try {
    for (const e of episodes) upsert.run(seriesId, e.season, e.number, e.name ?? null, e.air_date ?? null, e.runtime ?? null);
    const del = db.prepare('DELETE FROM episodes WHERE id = ?');
    for (const e of episodesOf(seriesId)) if (!e.watched && !keep.has(`${e.season}x${e.number}`)) del.run(e.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Ticks or unticks episodes. watchedOn: the date to note (NULL = not known); an episode
// that is already ticked keeps its date.
export function setWatched(seriesId, episodeIds, watched, watchedOn = null) {
  if (!episodeIds.length) return 0;
  const marks = episodeIds.map(() => '?').join(',');
  const sql = watched
    ? `UPDATE episodes SET watched = 1, watched_on = ? WHERE series_id = ? AND watched = 0 AND id IN (${marks})`
    : `UPDATE episodes SET watched = 0, watched_on = NULL WHERE series_id = ? AND watched = 1 AND id IN (${marks})`;
  const args = watched ? [watchedOn, seriesId, ...episodeIds] : [seriesId, ...episodeIds];
  return Number(db.prepare(sql).run(...args).changes);
}

// Ticks episodes with a date each (imports): [{ id, on }]
export function tickEpisodes(seriesId, ticks) {
  const update = db.prepare('UPDATE episodes SET watched = 1, watched_on = ? WHERE id = ? AND series_id = ? AND watched = 0');
  db.exec('BEGIN');
  try {
    for (const { id, on } of ticks) update.run(on ?? null, id, seriesId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// A season of numbered episodes, for series entered by hand
export function addSeason(seriesId, count) {
  const season = (db.prepare('SELECT MAX(season) AS n FROM episodes WHERE series_id = ?').get(seriesId).n || 0) + 1;
  const insert = db.prepare('INSERT INTO episodes (series_id, season, number) VALUES (?, ?, ?)');
  for (let n = 1; n <= count; n++) insert.run(seriesId, season, n);
  return season;
}

// Removes the last season of a series entered by hand
export function removeLastSeason(seriesId) {
  const season = db.prepare('SELECT MAX(season) AS n FROM episodes WHERE series_id = ?').get(seriesId).n;
  if (season) db.prepare('DELETE FROM episodes WHERE series_id = ? AND season = ?').run(seriesId, season);
}

// Shows that may still get episodes and whose TMDB data is older than `before`
export const seriesToRefresh = (before) => db.prepare(`SELECT id, tmdb_id, title FROM series
  WHERE tmdb_id IS NOT NULL AND (tmdb_status IS NULL OR tmdb_status NOT IN ('Ended', 'Canceled'))
  AND (refreshed_at IS NULL OR refreshed_at < ?) ORDER BY refreshed_at`).all(before);

// --- export ---

const withoutFiles = ({ poster_file, poster_source, tmdb_poster, ...item }) => item;

export const exportAll = () => ({
  films: db.prepare('SELECT * FROM films ORDER BY title COLLATE NOCASE').all().map(films.fromRow)
    .map((f) => ({ ...withoutFiles(f), watches: watchesOf(f.id).map((w) => w.watched_on) })),
  series: db.prepare('SELECT * FROM series ORDER BY title COLLATE NOCASE').all().map(seriesTable.fromRow)
    .map((s) => ({
      ...withoutFiles(s),
      watched: episodesOf(s.id).filter((e) => e.watched).sort(byEpisode).map((e) => ({ season: e.season, episode: e.number, on: e.watched_on })),
    })),
});
