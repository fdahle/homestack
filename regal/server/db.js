import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createUserStore } from './kit/users.js';

export const DATA_DIR = process.env.DATA_DIR || './data';
export const COVER_DIR = join(DATA_DIR, 'covers');
mkdirSync(COVER_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'regal.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  -- One row per book: what the catalogs or Calibre know about it, and what you did with it.
  -- source: where it came from: 'openlibrary', 'google', 'calibre' or 'manual'.
  -- authors, isbns (ISBN-13), tags (Calibre's), formats (Calibre's: EPUB, PDF, …): JSON arrays.
  -- language: 'de', 'en', … (three letters where there is no two-letter code).
  -- cover_url: the catalog's cover, downloaded into cover_file.
  -- cover_source: 'catalog' (downloaded), 'calibre' (copied from the library) or 'photo' (your own, never replaced).
  -- calibre_*: the Calibre book it is linked to; in_calibre = 0 once it is gone from the library.
  -- calibre_cover: size and time of the cover.jpg last copied, to notice a new one.
  -- status: want, reading, read, dropped. rating: 1–10, shown as half stars.
  -- started_on / finished_on: 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD', as precise as you remember it.
  -- current_page: where you are while reading.
  -- updated_at: your last change (a Calibre sync doesn't count; that is synced_at).
  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL DEFAULT 'manual',
    title TEXT NOT NULL,
    subtitle TEXT,
    authors TEXT NOT NULL DEFAULT '[]',
    series TEXT,
    series_index REAL,
    year INTEGER,
    publisher TEXT,
    pages INTEGER,
    isbns TEXT NOT NULL DEFAULT '[]',
    language TEXT,
    description TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    ol_work TEXT,
    ol_edition TEXT,
    google_id TEXT,
    cover_url TEXT,
    cover_file TEXT,
    cover_source TEXT,
    calibre_id INTEGER,
    calibre_uuid TEXT UNIQUE,
    in_calibre INTEGER NOT NULL DEFAULT 0,
    formats TEXT NOT NULL DEFAULT '[]',
    calibre_cover TEXT,
    status TEXT NOT NULL DEFAULT 'want',
    rating INTEGER,
    started_on TEXT,
    finished_on TEXT,
    current_page INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    synced_at TEXT
  );
  CREATE INDEX IF NOT EXISTS books_status ON books (status);
`);

export const now = () => new Date().toISOString();

// 'YYYY-MM-DD' in the server's time zone (TZ), not UTC
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Accounts and settings (users, settings tables)
export const users = createUserStore(db);

// --- books ---

// Columns that may be written through insertBook/updateBook
const BOOK_COLUMNS = [
  'source', 'title', 'subtitle', 'authors', 'series', 'series_index', 'year', 'publisher', 'pages', 'isbns', 'language',
  'description', 'tags', 'ol_work', 'ol_edition', 'google_id', 'cover_url', 'cover_file', 'cover_source',
  'calibre_id', 'calibre_uuid', 'in_calibre', 'formats', 'calibre_cover',
  'status', 'rating', 'started_on', 'finished_on', 'current_page', 'notes',
];
const JSON_COLUMNS = ['authors', 'isbns', 'tags', 'formats'];

function toRow(fields) {
  const row = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!BOOK_COLUMNS.includes(k) || v === undefined) continue;
    row[k] = JSON_COLUMNS.includes(k) ? JSON.stringify(v ?? []) : v;
  }
  return row;
}

function fromRow(row) {
  if (!row) return row;
  const book = { ...row };
  for (const k of JSON_COLUMNS) if (k in row) book[k] = JSON.parse(row[k] || '[]');
  return book;
}

// The list leaves out the long texts
const LIST_COLUMNS = `id, source, title, subtitle, authors, series, series_index, year, publisher, pages, isbns, language,
  cover_file, in_calibre, calibre_id, formats, status, rating, started_on, finished_on, current_page, created_at, updated_at`;

export const listBooks = () => db.prepare(`SELECT ${LIST_COLUMNS} FROM books ORDER BY title COLLATE NOCASE`).all().map(fromRow);
export const getBook = (id) => fromRow(db.prepare('SELECT * FROM books WHERE id = ?').get(id));
export const allBooks = () => db.prepare('SELECT * FROM books').all().map(fromRow);

// The ways a catalog book may already be in Regal: its work, edition, Google volume or an ISBN.
// Returns a function hit/book → id or null.
export function libraryIndex() {
  const rows = db.prepare('SELECT id, isbns, ol_work, google_id FROM books').all();
  const keys = new Map();
  for (const r of rows) {
    for (const isbn of JSON.parse(r.isbns || '[]')) keys.set(`isbn:${isbn}`, r.id);
    if (r.ol_work) keys.set(`ol:${r.ol_work}`, r.id);
    if (r.google_id) keys.set(`gb:${r.google_id}`, r.id);
  }
  return (b) => {
    const candidates = [b.work && `ol:${b.work}`, b.ol_work && `ol:${b.ol_work}`, b.volume && `gb:${b.volume}`, b.google_id && `gb:${b.google_id}`,
      b.isbn && `isbn:${b.isbn}`, ...(b.isbns || []).map((i) => `isbn:${i}`)];
    for (const k of candidates) if (k && keys.has(k)) return keys.get(k);
    return null;
  };
}

export function insertBook(fields, { at = now() } = {}) {
  const row = toRow(fields);
  const keys = Object.keys(row);
  const { lastInsertRowid } = db.prepare(`INSERT INTO books (${keys.join(', ')}, created_at, updated_at) VALUES (${keys.map(() => '?').join(', ')}, ?, ?)`)
    .run(...Object.values(row), at, at);
  return Number(lastInsertRowid);
}

// touch: false for changes that aren't yours (the Calibre sync), so "recently changed" stays yours
export function updateBook(id, fields, { touch = true } = {}) {
  const row = toRow(fields);
  const keys = Object.keys(row);
  if (!keys.length) return;
  const stamp = touch ? 'updated_at' : 'synced_at';
  db.prepare(`UPDATE books SET ${keys.map((k) => `${k} = ?`).join(', ')}, ${stamp} = ? WHERE id = ?`).run(...Object.values(row), now(), id);
}

export const deleteBook = (id) => db.prepare('DELETE FROM books WHERE id = ?').run(id).changes > 0;

// Several writes as one: all or nothing
export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// --- settings ---

export const getJsonSetting = (key, fallback = null) => {
  const value = users.getSetting(key);
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
};
export const setJsonSetting = (key, value) => users.setSetting(key, JSON.stringify(value));

export const exportAll = () => ({
  books: db.prepare('SELECT * FROM books ORDER BY title COLLATE NOCASE').all().map(fromRow)
    .map(({ cover_file, cover_source, cover_url, calibre_cover, synced_at, ...b }) => b),
});
