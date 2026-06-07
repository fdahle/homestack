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

  CREATE TABLE IF NOT EXISTS trip_waypoints (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id  INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    from_marker_id INTEGER NOT NULL REFERENCES markers(id)     ON DELETE CASCADE,
    to_marker_id   INTEGER NOT NULL REFERENCES markers(id)     ON DELETE CASCADE,
    mode           TEXT    NOT NULL DEFAULT 'walk',
    via_points     TEXT    NOT NULL DEFAULT '[]',
    UNIQUE(collection_id, from_marker_id, to_marker_id)
  );

  CREATE TABLE IF NOT EXISTS persons (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#8b5cf6'
  );

  CREATE TABLE IF NOT EXISTS marker_persons (
    marker_id INTEGER NOT NULL REFERENCES markers(id)  ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES persons(id)  ON DELETE CASCADE,
    PRIMARY KEY (marker_id, person_id)
  );
`)

// Idempotent migrations — errors are expected when a migration was already applied
function migrate(sql) {
  try { db.exec(sql) } catch (err) {
    if (!err.message.includes('duplicate column') && !err.message.includes('already exists') && !err.message.includes('no such table') && !err.message.includes('no such column')) {
      console.error('Migration failed:', err.message, '\nSQL:', sql)
    }
  }
}
migrate('ALTER TABLE markers ADD COLUMN color TEXT')
migrate('ALTER TABLE markers ADD COLUMN country TEXT')
migrate('ALTER TABLE trips RENAME TO collections')
migrate('ALTER TABLE marker_trips RENAME TO marker_collections')
migrate('ALTER TABLE marker_collections RENAME COLUMN trip_id TO collection_id')
migrate('ALTER TABLE collections ADD COLUMN is_trip INTEGER NOT NULL DEFAULT 0')
migrate('ALTER TABLE collections ADD COLUMN show_route_line INTEGER NOT NULL DEFAULT 0')
migrate('ALTER TABLE collections ADD COLUMN show_exact_route INTEGER NOT NULL DEFAULT 0')
migrate('ALTER TABLE marker_collections ADD COLUMN position INTEGER')
migrate('ALTER TABLE markers ADD COLUMN image_url TEXT')
migrate('ALTER TABLE markers ADD COLUMN address TEXT')
migrate('ALTER TABLE markers ADD COLUMN updated_at TEXT')
migrate("UPDATE markers SET updated_at = created_at WHERE updated_at IS NULL")
migrate('ALTER TABLE markers ADD COLUMN rating INTEGER')
migrate('ALTER TABLE markers ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0')
migrate('ALTER TABLE markers ADD COLUMN external_url TEXT')
migrate('ALTER TABLE markers ADD COLUMN planned_at TEXT')
migrate('ALTER TABLE markers ADD COLUMN source TEXT')
migrate("UPDATE markers SET source = 'manual' WHERE source IS NULL")
migrate('ALTER TABLE categories ADD COLUMN created_at TEXT')
migrate("UPDATE categories SET created_at = datetime('now') WHERE created_at IS NULL")
migrate('ALTER TABLE collections ADD COLUMN created_at TEXT')
migrate("UPDATE collections SET created_at = datetime('now') WHERE created_at IS NULL")
migrate('ALTER TABLE persons ADD COLUMN created_at TEXT')
migrate("UPDATE persons SET created_at = datetime('now') WHERE created_at IS NULL")
migrate(`
  INSERT OR IGNORE INTO marker_categories (marker_id, category_id)
  SELECT id, category_id FROM markers WHERE category_id IS NOT NULL
`)
migrate(`
  CREATE TABLE IF NOT EXISTS share_links (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    token         TEXT NOT NULL UNIQUE,
    name          TEXT,
    password_hash TEXT,
    filter_json   TEXT NOT NULL DEFAULT '{"all":false,"categories":[],"collections":[],"persons":[],"markers":[]}',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at    TEXT
  )
`)

export default db
