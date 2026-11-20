// A small Calibre library for the tests (and for trying the sync by hand): metadata.db with
// Calibre's own table layout, and a cover.jpg in each book's folder that has one.
//
//   makeCalibreLibrary(dir, [{ title, authors, series, seriesIndex, pubdate, isbn, uuid, comments,
//                              publisher, lang, tags, formats, pages, google, cover: Buffer }])

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// As calibre creates them (resources/metadata_sqlite.sql), without the triggers, views and
// the tables Regal doesn't read
const SCHEMA = `
  CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE, sort TEXT COLLATE NOCASE, link TEXT NOT NULL DEFAULT '', UNIQUE(name));
  CREATE TABLE books (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL DEFAULT 'Unknown' COLLATE NOCASE, sort TEXT COLLATE NOCASE,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, pubdate TIMESTAMP DEFAULT CURRENT_TIMESTAMP, series_index REAL NOT NULL DEFAULT 1.0,
    author_sort TEXT COLLATE NOCASE, isbn TEXT DEFAULT '' COLLATE NOCASE, lccn TEXT DEFAULT '' COLLATE NOCASE, path TEXT NOT NULL DEFAULT '',
    flags INTEGER NOT NULL DEFAULT 1, uuid TEXT, has_cover BOOL DEFAULT 0, last_modified TIMESTAMP NOT NULL DEFAULT '2000-01-01 00:00:00+00:00');
  CREATE TABLE books_authors_link (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, author INTEGER NOT NULL, UNIQUE(book, author));
  CREATE TABLE series (id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE, sort TEXT COLLATE NOCASE, link TEXT NOT NULL DEFAULT '', UNIQUE(name));
  CREATE TABLE books_series_link (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, series INTEGER NOT NULL, UNIQUE(book));
  CREATE TABLE identifiers (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, type TEXT NOT NULL DEFAULT 'isbn' COLLATE NOCASE, val TEXT NOT NULL COLLATE NOCASE, UNIQUE(book, type));
  CREATE TABLE comments (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, text TEXT NOT NULL COLLATE NOCASE, UNIQUE(book));
  CREATE TABLE publishers (id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE, sort TEXT COLLATE NOCASE, link TEXT NOT NULL DEFAULT '', UNIQUE(name));
  CREATE TABLE books_publishers_link (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, publisher INTEGER NOT NULL, UNIQUE(book));
  CREATE TABLE languages (id INTEGER PRIMARY KEY, lang_code TEXT NOT NULL COLLATE NOCASE, link TEXT NOT NULL DEFAULT '', UNIQUE(lang_code));
  CREATE TABLE books_languages_link (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, lang_code INTEGER NOT NULL, item_order INTEGER NOT NULL DEFAULT 0, UNIQUE(book, lang_code));
  CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE, link TEXT NOT NULL DEFAULT '', UNIQUE(name));
  CREATE TABLE books_tags_link (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, tag INTEGER NOT NULL, UNIQUE(book, tag));
  CREATE TABLE data (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, format TEXT NOT NULL COLLATE NOCASE, uncompressed_size INTEGER NOT NULL, name TEXT NOT NULL, UNIQUE(book, format));
  CREATE TABLE custom_columns (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, name TEXT NOT NULL, datatype TEXT NOT NULL,
    mark_for_delete BOOL DEFAULT 0 NOT NULL, editable BOOL DEFAULT 1 NOT NULL, display TEXT DEFAULT '{}' NOT NULL,
    is_multiple BOOL DEFAULT 0 NOT NULL, normalized BOOL NOT NULL, UNIQUE(label));
`;

// A tiny but real JPEG-looking file (Regal only copies covers, it never decodes them)
export const fakeJpeg = (seed = 1) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, seed), Buffer.from([0xff, 0xd9])]);

export function makeCalibreLibrary(dir, books) {
  rmSync(join(dir, 'metadata.db'), { force: true });
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'metadata.db'));
  db.exec(SCHEMA);
  const usesPages = books.some((b) => b.pages);
  if (usesPages) {
    db.exec("INSERT INTO custom_columns (id, label, name, datatype, normalized) VALUES (1, 'pages', 'Pages', 'int', 0)");
    db.exec('CREATE TABLE custom_column_1 (id INTEGER PRIMARY KEY AUTOINCREMENT, book INTEGER, value INT NOT NULL, UNIQUE(book))');
  }
  // name → id in a lookup table (authors, series, …)
  const idOf = (table, column, name) => {
    db.prepare(`INSERT OR IGNORE INTO ${table} (${column}) VALUES (?)`).run(name);
    return db.prepare(`SELECT id FROM ${table} WHERE ${column} = ?`).get(name).id;
  };

  books.forEach((b, i) => {
    const id = b.id ?? i + 1;
    const authors = b.authors || ['Unknown'];
    const path = `${authors[0]}/${b.title} (${id})`;
    db.prepare('INSERT INTO books (id, title, sort, pubdate, series_index, author_sort, path, uuid, has_cover) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, b.title, b.title, b.pubdate ?? '0101-01-01 00:00:00+00:00', b.seriesIndex ?? 1, authors[0], path, b.uuid ?? `uuid-${id}`, b.cover ? 1 : 0);
    for (const a of authors) db.prepare('INSERT INTO books_authors_link (book, author) VALUES (?, ?)').run(id, idOf('authors', 'name', a));
    if (b.series) db.prepare('INSERT INTO books_series_link (book, series) VALUES (?, ?)').run(id, idOf('series', 'name', b.series));
    if (b.isbn) db.prepare("INSERT INTO identifiers (book, type, val) VALUES (?, 'isbn', ?)").run(id, b.isbn);
    if (b.google) db.prepare("INSERT INTO identifiers (book, type, val) VALUES (?, 'google', ?)").run(id, b.google);
    if (b.comments) db.prepare('INSERT INTO comments (book, text) VALUES (?, ?)').run(id, b.comments);
    if (b.publisher) db.prepare('INSERT INTO books_publishers_link (book, publisher) VALUES (?, ?)').run(id, idOf('publishers', 'name', b.publisher));
    if (b.lang) db.prepare('INSERT INTO books_languages_link (book, lang_code) VALUES (?, ?)').run(id, idOf('languages', 'lang_code', b.lang));
    for (const t of b.tags || []) db.prepare('INSERT INTO books_tags_link (book, tag) VALUES (?, ?)').run(id, idOf('tags', 'name', t));
    for (const f of b.formats || []) db.prepare('INSERT INTO data (book, format, uncompressed_size, name) VALUES (?, ?, 1000, ?)').run(id, f, b.title);
    if (b.pages) db.prepare('INSERT INTO custom_column_1 (book, value) VALUES (?, ?)').run(id, b.pages);
    if (b.cover) {
      mkdirSync(join(dir, path), { recursive: true });
      writeFileSync(join(dir, path, 'cover.jpg'), b.cover);
    }
  });
  db.close();
}
