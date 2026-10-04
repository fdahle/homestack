import { randomBytes } from 'node:crypto'
import { transaction } from './utils/transaction.js'
import { normalizeLegacyMarker } from './utils/validation.js'

// Ordered schema migrations. Each runs once in its own transaction and is recorded in schema_migrations.
const MIGRATIONS = [
  { version: 1, up: initialSchema },
  { version: 2, up: repairLegacyData },
  { version: 3, up: db => db.exec('CREATE TABLE IF NOT EXISTS deleted_markers (id INTEGER PRIMARY KEY, label TEXT, deleted_at TEXT NOT NULL, snapshot TEXT NOT NULL)') },
]

export function initializeDatabase(db) {
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)')
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version))
  for (const { version, up } of MIGRATIONS) {
    if (applied.has(version)) continue
    transaction(db, () => {
      up(db)
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error(`Migration ${version} failed foreign key validation`)
      db.prepare('INSERT INTO schema_migrations VALUES (?)').run(version)
    })
  }
}

// Values written before validation existed would otherwise block backup restores.
function repairLegacyData(db) {
  const fields = ['label', 'description', 'image_url', 'address', 'country', 'color', 'external_url', 'source', 'visited_at', 'planned_at', 'rating', 'is_favorite', 'use_coords']
  const update = db.prepare(`UPDATE markers SET ${fields.map(f => f + '=?').join(',')} WHERE id=?`)
  for (const row of db.prepare(`SELECT id, ${fields.join(',')} FROM markers`).all()) {
    const before = JSON.stringify(row)
    normalizeLegacyMarker(row, { dropInvalid: true })
    if (JSON.stringify(row) !== before) update.run(...fields.map(f => row[f]), row.id)
  }
  // Route segments of collections that are no longer trips, or whose endpoints left the trip.
  db.exec(`DELETE FROM trip_waypoints WHERE collection_id NOT IN (SELECT id FROM collections WHERE is_trip=1)
    OR NOT EXISTS (SELECT 1 FROM marker_collections WHERE marker_id=from_marker_id AND collection_id=trip_waypoints.collection_id)
    OR NOT EXISTS (SELECT 1 FROM marker_collections WHERE marker_id=to_marker_id AND collection_id=trip_waypoints.collection_id)`)
}

function initialSchema(db) {
  const exists = table => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
  const columns = table => db.prepare('PRAGMA table_info(' + table + ')').all().map(c => c.name)
  const hadCategories = exists('marker_categories')
  const renamedTrips = exists('trips') && !exists('collections')
  if (renamedTrips) db.exec('ALTER TABLE trips RENAME TO collections')
  if (!exists('trips') && exists('marker_trips') && !exists('marker_collections')) db.exec('ALTER TABLE marker_trips RENAME TO marker_collections')
  if (exists('marker_collections') && columns('marker_collections').includes('trip_id')) db.exec('ALTER TABLE marker_collections RENAME COLUMN trip_id TO collection_id')
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


  const additions = [
    'ALTER TABLE markers ADD COLUMN color TEXT',
    'ALTER TABLE markers ADD COLUMN country TEXT',
    'ALTER TABLE collections ADD COLUMN is_trip INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE collections ADD COLUMN show_route_line INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE collections ADD COLUMN show_exact_route INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE marker_collections ADD COLUMN position INTEGER',
    'ALTER TABLE markers ADD COLUMN image_url TEXT',
    'ALTER TABLE markers ADD COLUMN address TEXT',
    'ALTER TABLE markers ADD COLUMN updated_at TEXT',
    'ALTER TABLE markers ADD COLUMN rating INTEGER',
    'ALTER TABLE markers ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE markers ADD COLUMN external_url TEXT',
    'ALTER TABLE markers ADD COLUMN planned_at TEXT',
    'ALTER TABLE markers ADD COLUMN source TEXT',
    'ALTER TABLE markers ADD COLUMN use_coords INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE categories ADD COLUMN created_at TEXT',
    'ALTER TABLE collections ADD COLUMN created_at TEXT',
    'ALTER TABLE persons ADD COLUMN created_at TEXT',
    'ALTER TABLE persons ADD COLUMN first_name TEXT',
    'ALTER TABLE persons ADD COLUMN last_name TEXT',
    'ALTER TABLE persons ADD COLUMN address_marker_id INTEGER REFERENCES markers(id) ON DELETE SET NULL',
  ]
  for (const sql of additions) {
    const [, table, column] = sql.match(/ALTER TABLE (\w+) ADD COLUMN (\w+)/)
    if (!columns(table).includes(column)) db.exec(sql)
  }
  if (renamedTrips) db.exec('UPDATE collections SET is_trip=1')
  // Recover databases that already have both the old and new trip tables.
  if (exists('trips')) {
    const idMap = new Map()
    const fields = columns('trips').filter(c => c !== 'id' && columns('collections').includes(c))
    const insert = db.prepare('INSERT INTO collections (' + fields.join(',') + ') VALUES (' + fields.map(() => '?').join(',') + ')')
    for (const trip of db.prepare('SELECT * FROM trips').all()) {
      const id = insert.run(...fields.map(f => trip[f])).lastInsertRowid
      db.prepare('UPDATE collections SET is_trip=1 WHERE id=?').run(id)
      idMap.set(trip.id, id)
    }
    if (exists('marker_trips')) {
      for (const link of db.prepare('SELECT * FROM marker_trips').all()) {
        db.prepare('INSERT OR IGNORE INTO marker_collections (marker_id,collection_id,position) VALUES (?,?,?)').run(link.marker_id, idMap.get(link.trip_id), link.position ?? null)
      }
    }
    // Preserve route data even when an old foreign key still targets trips.
    const oldRoute = db.prepare('PRAGMA foreign_key_list(trip_waypoints)').all().some(f => f.table === 'trips')
    if (oldRoute || columns('trip_waypoints').includes('trip_id')) {
      const rows = db.prepare('SELECT * FROM trip_waypoints').all()
      db.exec('DROP TABLE trip_waypoints')
      db.exec(`CREATE TABLE trip_waypoints (id INTEGER PRIMARY KEY AUTOINCREMENT, collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE, from_marker_id INTEGER NOT NULL REFERENCES markers(id) ON DELETE CASCADE, to_marker_id INTEGER NOT NULL REFERENCES markers(id) ON DELETE CASCADE, mode TEXT NOT NULL DEFAULT 'walk', via_points TEXT NOT NULL DEFAULT '[]', UNIQUE(collection_id,from_marker_id,to_marker_id))`)
      for (const r of rows) db.prepare('INSERT INTO trip_waypoints (collection_id,from_marker_id,to_marker_id,mode,via_points) VALUES (?,?,?,?,?)').run(idMap.get(r.trip_id ?? r.collection_id), r.from_marker_id, r.to_marker_id, r.mode ?? 'walk', r.via_points ?? '[]')
    }
    if (exists('marker_trips')) db.exec('DROP TABLE marker_trips')
    db.exec('DROP TABLE trips')
  }
  if (columns('trip_waypoints').includes('trip_id')) db.exec('ALTER TABLE trip_waypoints RENAME COLUMN trip_id TO collection_id')
  if (!hadCategories) db.exec('INSERT OR IGNORE INTO marker_categories (marker_id,category_id) SELECT id,category_id FROM markers WHERE category_id IS NOT NULL')
  db.exec('UPDATE markers SET category_id=NULL')
  db.exec("UPDATE markers SET updated_at=created_at WHERE updated_at IS NULL; UPDATE markers SET source='manual' WHERE source IS NULL")
  for (const table of ['categories','collections','persons']) db.exec("UPDATE " + table + " SET created_at=datetime('now') WHERE created_at IS NULL")
  db.exec('UPDATE persons SET first_name=name WHERE first_name IS NULL')
  db.exec(`CREATE TABLE IF NOT EXISTS share_links (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL UNIQUE, name TEXT, password_hash TEXT, filter_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT)`)
  if (!columns('users').includes('session_version')) db.exec('ALTER TABLE users ADD COLUMN session_version TEXT')
  for (const user of db.prepare('SELECT id FROM users').all()) db.prepare('UPDATE users SET session_version=? WHERE id=?').run(randomBytes(32).toString('hex'), user.id)
  db.exec(`CREATE TRIGGER IF NOT EXISTS single_user BEFORE INSERT ON users WHEN EXISTS (SELECT 1 FROM users) BEGIN SELECT RAISE(ABORT, 'Already set up'); END`)
}
