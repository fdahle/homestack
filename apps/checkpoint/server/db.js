import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createUserStore } from './kit/users.js';

export const DATA_DIR = process.env.DATA_DIR || './data';
export const COVER_DIR = join(DATA_DIR, 'covers');
mkdirSync(COVER_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'checkpoint.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  -- One row per game: what IGDB knows about it, and what you did with it.
  -- igdb_id NULL = entered by hand.
  -- platforms, genres: JSON arrays of names (where it came out, not what you played it on).
  -- hours_main / hours_complete: IGDB's "time to beat" (main story, 100 %).
  -- cover_source: 'igdb' (downloaded) or 'photo' (your own, never replaced).
  -- status: wishlist, backlog, playing, finished, completed (100 %), dropped.
  -- rating: 1–10, shown as half stars. played_on: JSON array of the platforms you played it on.
  -- started_on / finished_on: 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD', as precise as you remember it.
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY,
    igdb_id INTEGER UNIQUE,
    name TEXT NOT NULL,
    slug TEXT,
    igdb_url TEXT,
    summary TEXT,
    release_date TEXT,
    platforms TEXT NOT NULL DEFAULT '[]',
    genres TEXT NOT NULL DEFAULT '[]',
    developer TEXT,
    franchise TEXT,
    hours_main REAL,
    hours_complete REAL,
    igdb_cover_id TEXT,
    cover_file TEXT,
    cover_source TEXT,
    status TEXT NOT NULL DEFAULT 'backlog',
    rating INTEGER,
    played_on TEXT,
    started_on TEXT,
    finished_on TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS games_status ON games (status);
`);

export const now = () => new Date().toISOString();

// 'YYYY-MM-DD' in the server's time zone (TZ), not UTC
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Accounts and settings (users, settings tables)
export const users = createUserStore(db);

// Once per database, counted in user_version:
// 1: played_on was one platform as text; now it's a list, so a game can be played on several
const MIGRATIONS = [
  () => db.exec(`UPDATE games SET played_on = CASE WHEN played_on IS NULL OR trim(played_on) = '' THEN '[]'
    ELSE json_array(trim(played_on)) END`),
];
for (let v = db.prepare('PRAGMA user_version').get().user_version; v < MIGRATIONS.length; v++) {
  db.exec('BEGIN');
  try {
    MIGRATIONS[v]();
    db.exec(`PRAGMA user_version = ${v + 1}`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// --- games ---

// Columns that may be written through insertGame/updateGame
const GAME_COLUMNS = [
  'igdb_id', 'name', 'slug', 'igdb_url', 'summary', 'release_date', 'platforms', 'genres', 'developer', 'franchise',
  'hours_main', 'hours_complete', 'igdb_cover_id', 'cover_file', 'cover_source',
  'status', 'rating', 'played_on', 'started_on', 'finished_on', 'notes',
];
const JSON_COLUMNS = ['platforms', 'genres', 'played_on'];

function toRow(fields) {
  const row = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!GAME_COLUMNS.includes(k) || v === undefined) continue;
    row[k] = JSON_COLUMNS.includes(k) ? JSON.stringify(v ?? []) : v;
  }
  return row;
}

function fromRow(row) {
  if (!row) return row;
  const game = { ...row };
  for (const k of JSON_COLUMNS) game[k] = JSON.parse(row[k] || '[]');
  return game;
}

// The list leaves out the long texts
const LIST_COLUMNS = `id, igdb_id, name, release_date, platforms, genres, developer, franchise, hours_main, hours_complete,
  cover_file, status, rating, played_on, started_on, finished_on, created_at, updated_at`;

export const listGames = () => db.prepare(`SELECT ${LIST_COLUMNS} FROM games ORDER BY name COLLATE NOCASE`).all().map(fromRow);
export const getGame = (id) => fromRow(db.prepare('SELECT * FROM games WHERE id = ?').get(id));
export const gameByIgdbId = (igdbId) => db.prepare('SELECT id FROM games WHERE igdb_id = ?').get(igdbId)?.id ?? null;

// IGDB id → our game id, for marking search results that are already in the library
export function idsByIgdbId(igdbIds) {
  if (!igdbIds.length) return new Map();
  const rows = db.prepare(`SELECT id, igdb_id FROM games WHERE igdb_id IN (${igdbIds.map(() => '?').join(',')})`).all(...igdbIds);
  return new Map(rows.map((r) => [r.igdb_id, r.id]));
}

export function insertGame(fields) {
  const row = toRow(fields);
  const keys = Object.keys(row);
  const t = now();
  const { lastInsertRowid } = db.prepare(`INSERT INTO games (${keys.join(', ')}, created_at, updated_at) VALUES (${keys.map(() => '?').join(', ')}, ?, ?)`)
    .run(...Object.values(row), t, t);
  return Number(lastInsertRowid);
}

export function updateGame(id, fields) {
  const row = toRow(fields);
  const keys = Object.keys(row);
  if (!keys.length) return;
  db.prepare(`UPDATE games SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...Object.values(row), now(), id);
}

export const deleteGame = (id) => db.prepare('DELETE FROM games WHERE id = ?').run(id).changes > 0;

// Platforms you have played on, most used first (suggestions for "played on")
export const usedPlatforms = () => db.prepare(`SELECT p.value AS name, COUNT(*) AS n FROM games, json_each(games.played_on) p
  WHERE json_valid(games.played_on) GROUP BY p.value COLLATE NOCASE ORDER BY n DESC, name`).all().map((r) => r.name);

export const exportAll = () => ({
  games: db.prepare('SELECT * FROM games ORDER BY name COLLATE NOCASE').all().map(fromRow)
    .map(({ cover_file, cover_source, igdb_cover_id, ...g }) => g),
});
