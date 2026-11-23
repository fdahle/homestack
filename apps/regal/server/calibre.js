// Reading a Calibre library, and working out what a sync changes in Regal.
// Calibre → Regal only: Regal never writes to the library. Calibre-Web writes to
// metadata.db while it runs, so Regal reads a copy of it, never the file itself.
// No Regal database here (sync.js applies the plan), so this can be tested on its own.

import { DatabaseSync } from 'node:sqlite';
import { copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { htmlToText, normLanguage, NOT_STARTED, titleKey } from './books.js';
import { isbnList } from './isbn.js';

export class CalibreError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

// Calibre stores dates in UTC, so a book published on 1 January 2005 in Germany is
// '2004-12-31 23:00:00+00:00'. Half a day later is the right year. '0101-01-01' means unknown.
export function calibreYear(pubdate) {
  const d = new Date(String(pubdate || '').replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return null;
  const year = new Date(d.getTime() + 12 * 3600_000).getUTCFullYear();
  return year > 1000 ? year : null;
}

// Calibre keeps a comma in an author's name as '|' (it separates authors with '&' and sorts by
// commas). A name entered last name first ('Camilleri, Andrea') becomes 'Andrea Camilleri', the
// way Calibre's other books and the catalogs write it; 'Martin Luther King, Jr.' stays as it is.
const SUFFIX = /^(jr|sr|jun|sen|[ivx]+)\.?$/i;
export function calibreAuthor(name) {
  const s = String(name || '').replace(/\|/g, ',').replace(/\s+/g, ' ').trim();
  const parts = s.split(',').map((p) => p.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1] || SUFFIX.test(parts[1])) return s;
  return `${parts[1]} ${parts[0]}`;
}

const hasTable = (db, name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

// rows [{ book, value }] → Map book → [values] (in row order)
function grouped(rows) {
  const map = new Map();
  for (const r of rows) {
    if (r.value == null || r.value === '') continue;
    if (!map.has(r.book)) map.set(r.book, []);
    map.get(r.book).push(r.value);
  }
  return map;
}

// A page count from the "Count Pages" plugin's custom column, if the library has one
function pageCounts(db) {
  if (!hasTable(db, 'custom_columns')) return new Map();
  const col = db.prepare("SELECT id FROM custom_columns WHERE lower(label) IN ('pages', 'seiten', 'pagecount', 'page_count') AND datatype IN ('int', 'float') ORDER BY id").get();
  if (!col || !hasTable(db, `custom_column_${col.id}`)) return new Map();
  const rows = db.prepare(`SELECT book, value FROM custom_column_${col.id}`).all();
  return new Map(rows.filter((r) => r.value > 0).map((r) => [r.book, Math.round(r.value)]));
}

// Calibre's "read" yes/no column (#read, which Calibre-Web uses for its read status), if the
// library has one: book id → true/false
function readFlags(db) {
  if (!hasTable(db, 'custom_columns')) return new Map();
  const col = db.prepare("SELECT id FROM custom_columns WHERE lower(label) IN ('read', 'gelesen') AND datatype = 'bool' ORDER BY id").get();
  if (!col || !hasTable(db, `custom_column_${col.id}`)) return new Map();
  const rows = db.prepare(`SELECT book, value FROM custom_column_${col.id}`).all();
  return new Map(rows.map((r) => [r.book, !!r.value]));
}

// Every book in an open metadata.db, as Regal's fields (plus where its cover is and whether
// Calibre has it as read)
export function readBooks(db, libraryDir) {
  const all = (sql) => db.prepare(sql).all();
  const authors = grouped(all('SELECT l.book, a.name AS value FROM books_authors_link l JOIN authors a ON a.id = l.author ORDER BY l.id'));
  const series = grouped(all('SELECT l.book, s.name AS value FROM books_series_link l JOIN series s ON s.id = l.series'));
  const publishers = grouped(all('SELECT l.book, p.name AS value FROM books_publishers_link l JOIN publishers p ON p.id = l.publisher'));
  const languages = grouped(all('SELECT l.book, g.lang_code AS value FROM books_languages_link l JOIN languages g ON g.id = l.lang_code ORDER BY l.item_order'));
  const comments = grouped(all('SELECT book, text AS value FROM comments'));
  const ids = new Map();
  for (const r of all('SELECT book, lower(type) AS type, val FROM identifiers')) {
    if (!ids.has(r.book)) ids.set(r.book, {});
    ids.get(r.book)[r.type] = r.val;
  }
  const tags = hasTable(db, 'books_tags_link') ? grouped(all('SELECT l.book, t.name AS value FROM books_tags_link l JOIN tags t ON t.id = l.tag ORDER BY t.name')) : new Map();
  const formats = hasTable(db, 'data') ? grouped(all('SELECT book, upper(format) AS value FROM data ORDER BY format')) : new Map();
  const pages = pageCounts(db);
  const read = readFlags(db);
  const root = resolve(libraryDir);

  return all('SELECT id, title, pubdate, series_index, isbn, path, uuid, has_cover FROM books ORDER BY id').map((b) => {
    const id = ids.get(b.id) || {};
    const inSeries = series.get(b.id)?.[0] || null;
    // The cover lives in the book's folder; a path that leads out of the library is ignored
    const folder = resolve(root, String(b.path || ''));
    const cover = b.has_cover && b.path && folder.startsWith(root + sep) ? join(folder, 'cover.jpg') : null;
    return {
      calibre_id: b.id,
      calibre_uuid: b.uuid || `calibre-${b.id}`,
      title: String(b.title || '').trim() || '?',
      authors: [...new Set((authors.get(b.id) || []).map(calibreAuthor).filter(Boolean))],
      series: inSeries,
      series_index: inSeries ? b.series_index : null,
      year: calibreYear(b.pubdate),
      publisher: publishers.get(b.id)?.[0] || null,
      pages: pages.get(b.id) || null,
      isbns: isbnList([id.isbn, b.isbn].filter(Boolean)),
      language: normLanguage(languages.get(b.id)?.[0]),
      description: htmlToText(comments.get(b.id)?.[0]),
      tags: tags.get(b.id) || [],
      formats: [...new Set(formats.get(b.id) || [])],
      google_id: id.google || null,
      cover,
      read: read.get(b.id) === true,
    };
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Copies metadata.db (and its WAL file, if Calibre left one) into workDir and reads the copy.
// A copy taken in the middle of a write may be broken; then it tries again a little later.
export async function readLibrary(libraryDir, workDir, { tries = 3 } = {}) {
  const source = join(libraryDir, 'metadata.db');
  if (!existsSync(source)) throw new CalibreError('calibre_not_found', `No metadata.db in ${libraryDir}`);
  const copy = join(workDir, 'calibre-metadata.copy.db');
  let lastError;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      await copyFile(source, copy);
      if (existsSync(`${source}-wal`)) await copyFile(`${source}-wal`, `${copy}-wal`);
      const db = new DatabaseSync(copy, { readOnly: true });
      try {
        return readBooks(db, libraryDir);
      } finally {
        db.close();
      }
    } catch (err) {
      lastError = err;
      if (attempt < tries) await sleep(1500 * attempt);
    } finally {
      for (const f of [copy, `${copy}-wal`, `${copy}-shm`]) await rm(f, { force: true });
    }
  }
  throw new CalibreError('calibre_unreadable', `metadata.db could not be read: ${lastError.message}`);
}

// --- the sync rules ---

// The fields Calibre decides. A field Calibre leaves empty keeps what Regal has
// (a book you added by hand keeps Open Library's description if Calibre has none).
// Your own entries (status, rating, dates, page, notes, your cover photo) are not among them.
const CALIBRE_FIELDS = ['title', 'authors', 'series', 'series_index', 'year', 'publisher', 'pages', 'isbns', 'language', 'description', 'google_id'];
// Calibre's own things, taken as they are, even when empty
const CALIBRE_OWN = ['calibre_id', 'calibre_uuid', 'tags', 'formats'];

const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// What a Calibre book changes on a Regal book: only the fields that differ
export function calibreChanges(book, c) {
  const out = {};
  for (const k of CALIBRE_FIELDS) if (!empty(c[k]) && !same(book[k], c[k])) out[k] = c[k];
  // series_index belongs to the series: no series in Calibre, no number from it either
  if (empty(c.series)) delete out.series_index;
  for (const k of CALIBRE_OWN) if (!same(book[k] ?? (Array.isArray(c[k]) ? [] : null), c[k])) out[k] = c[k];
  if (!book.in_calibre) out.in_calibre = 1;
  return out;
}

// calibreBooks: from readBooks. regalBooks: every book in Regal (with calibre_uuid,
// in_calibre, isbns, title, authors and the CALIBRE_FIELDS).
// → { add: [fields], update: [{ id, fields, linked }], gone: [id], unchanged: n }
//
// A Calibre book is found in Regal by its uuid. If it isn't there yet, a book you added
// yourself (not linked to Calibre, or linked to a Calibre book that is gone) with the same
// ISBN is linked to it, else one with the same title and first author; only then is it
// added: as read when Calibre has it as read, else with defaultStatus. Books that disappear
// from Calibre stay, marked as gone.
//
// Calibre's read mark only ever moves a book you haven't started ("want" or "unread") to
// "read": a book you're reading, dropped or already marked yourself keeps its status.
export function planSync(calibreBooks, regalBooks, { defaultStatus = 'unread' } = {}) {
  const present = new Set(calibreBooks.map((c) => c.calibre_uuid));
  const byUuid = new Map(regalBooks.filter((b) => b.calibre_uuid).map((b) => [b.calibre_uuid, b]));
  const linkable = regalBooks.filter((b) => !b.calibre_uuid || !present.has(b.calibre_uuid));
  const byIsbn = new Map();
  const byTitle = new Map();
  for (const b of linkable) {
    for (const isbn of b.isbns || []) if (!byIsbn.has(isbn)) byIsbn.set(isbn, b);
    const key = titleKey(b.title, b.authors);
    if (!byTitle.has(key)) byTitle.set(key, b);
  }
  const used = new Set();
  const plan = { add: [], update: [], gone: [], unchanged: 0 };

  for (const c of calibreBooks) {
    let book = byUuid.get(c.calibre_uuid);
    let linked = false;
    if (!book) {
      book = c.isbns.map((isbn) => byIsbn.get(isbn)).find((b) => b && !used.has(b.id))
        // Same title and author, unless both have ISBNs and none match (another edition)
        || [byTitle.get(titleKey(c.title, c.authors))].find((b) => b && !used.has(b.id) && !(b.isbns?.length && c.isbns.length));
      linked = !!book;
    }
    const { cover, read, ...fields } = c;
    if (!book) {
      plan.add.push({ ...fields, in_calibre: 1, source: 'calibre', status: read ? 'read' : defaultStatus });
      continue;
    }
    used.add(book.id);
    const changes = calibreChanges(book, fields);
    if (read && NOT_STARTED.includes(book.status)) changes.status = 'read';
    if (Object.keys(changes).length) plan.update.push({ id: book.id, fields: changes, linked });
    else plan.unchanged++;
  }

  for (const b of regalBooks) {
    if (b.calibre_uuid && b.in_calibre && !present.has(b.calibre_uuid) && !used.has(b.id)) plan.gone.push(b.id);
  }
  return plan;
}
