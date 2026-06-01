import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data')

mkdirSync(DATA_DIR, { recursive: true })

const db = new DatabaseSync(join(DATA_DIR, 'mapper.db'))

db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3b82f6'
  );

  CREATE TABLE IF NOT EXISTS collections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT,
    start_date  TEXT,
    end_date    TEXT,
    color       TEXT NOT NULL DEFAULT '#10b981'
  );

  CREATE TABLE IF NOT EXISTS markers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    lat         REAL NOT NULL,
    lng         REAL NOT NULL,
    label       TEXT,
    description TEXT,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    visited_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS marker_collections (
    marker_id     INTEGER NOT NULL REFERENCES markers(id)     ON DELETE CASCADE,
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    PRIMARY KEY (marker_id, collection_id)
  );

  CREATE TABLE IF NOT EXISTS marker_categories (
    marker_id   INTEGER NOT NULL REFERENCES markers(id)   ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (marker_id, category_id)
  );
`)

// Idempotent migrations
try { db.exec('ALTER TABLE markers ADD COLUMN color TEXT') } catch {}
try { db.exec('ALTER TABLE trips RENAME TO collections') } catch {}
try { db.exec('ALTER TABLE marker_trips RENAME TO marker_collections') } catch {}
try { db.exec('ALTER TABLE marker_collections RENAME COLUMN trip_id TO collection_id') } catch {}
try { db.exec('ALTER TABLE collections ADD COLUMN is_trip INTEGER NOT NULL DEFAULT 0') } catch {}
// Migrate single category_id → marker_categories junction table
try {
  db.exec(`
    INSERT OR IGNORE INTO marker_categories (marker_id, category_id)
    SELECT id, category_id FROM markers WHERE category_id IS NOT NULL
  `)
} catch {}

export default db
