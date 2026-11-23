import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createUserStore } from './kit/users.js';

export const DATA_DIR = process.env.DATA_DIR || './data';
export const COVER_DIR = join(DATA_DIR, 'covers');
mkdirSync(COVER_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'stapel.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    lang TEXT NOT NULL DEFAULT 'de',
    is_admin INTEGER NOT NULL DEFAULT 0,
    session_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS publishers (
    gcd_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  );

  -- The catalog is shared by all users. gcd_id is NULL for series entered by hand.
  CREATE TABLE IF NOT EXISTS series (
    id INTEGER PRIMARY KEY,
    gcd_id INTEGER UNIQUE,
    name TEXT NOT NULL,
    year_began INTEGER,
    year_ended INTEGER,
    publisher_gcd_id INTEGER,
    publisher_name TEXT,
    language TEXT,
    country TEXT,
    format TEXT,
    notes TEXT,
    synced_at TEXT,
    created_at TEXT NOT NULL
  );

  -- One row per issue/volume in GCD order (position). A number that appears again
  -- (reprint, variant cover, 2nd printing) is stored with is_variant = 1.
  CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY,
    series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    gcd_id INTEGER UNIQUE,
    position INTEGER NOT NULL,
    number TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    variant TEXT NOT NULL DEFAULT '',
    is_variant INTEGER NOT NULL DEFAULT 0,
    key_date TEXT,
    price TEXT,
    page_count INTEGER,
    isbn TEXT,
    barcode TEXT,
    credits TEXT,
    cover_url TEXT,
    cover_file TEXT,
    details_at TEXT,
    details_failed INTEGER NOT NULL DEFAULT 0,
    user_fields TEXT NOT NULL DEFAULT '', -- fields set in the app, e.g. "barcode,price,cover"; GCD doesn't overwrite them
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS issues_series ON issues (series_id, position);
  CREATE INDEX IF NOT EXISTS issues_isbn ON issues (isbn);
  CREATE INDEX IF NOT EXISTS issues_barcode ON issues (barcode);

  -- Series a user keeps track of (their collection).
  CREATE TABLE IF NOT EXISTS user_series (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL,
    PRIMARY KEY (user_id, series_id)
  );

  -- A user's status per issue. The timestamps double as flags (NULL = no).
  CREATE TABLE IF NOT EXISTS user_issues (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    owned_at TEXT,
    read_at TEXT,
    wanted_at TEXT,
    rating INTEGER,
    notes TEXT,
    PRIMARY KEY (user_id, issue_id)
  );
  CREATE INDEX IF NOT EXISTS user_issues_issue ON user_issues (issue_id);

  -- GCD API responses, so repeated searches and page views cost no requests
  CREATE TABLE IF NOT EXISTS gcd_cache (
    path TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );

  -- Timestamps of GCD API requests, for staying under its rate limits across restarts
  CREATE TABLE IF NOT EXISTS gcd_requests (at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS gcd_requests_at ON gcd_requests (at);
`);

// Columns added after the first version, for existing databases
function addColumn(table, column, definition) {
  if (!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('users', 'session_version', 'INTEGER NOT NULL DEFAULT 0');
addColumn('issues', 'user_fields', "TEXT NOT NULL DEFAULT ''");
// Covers from Comic Vine: a series is linked to a Comic Vine volume (cv_state: 'auto'
// when matched automatically, 'manual' when picked, 'none' when there is none,
// NULL when not looked for yet). Its issues get the cover URL to download.
addColumn('series', 'cv_volume_id', 'INTEGER');
addColumn('series', 'cv_volume_name', 'TEXT');
addColumn('series', 'cv_state', 'TEXT');
addColumn('series', 'cv_synced_at', 'TEXT');
addColumn('issues', 'cv_cover_url', 'TEXT');
addColumn('issues', 'cover_source', 'TEXT'); // 'cv', 'library', 'photo'

export const now = () => new Date().toISOString();

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

// --- users ---

// Accounts, login sessions and small settings are the design kit's (kit/users.js, the same
// tables as before). Stapel adds is_admin: an admin can add people, who share the catalog
// but keep their own marks.
const kitUsers = createUserStore(db);

const USER_COLUMNS = 'id, username, display_name, lang, is_admin, created_at';

export const listUsers = () => db.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY id`).all();
export const isAdmin = (id) => Boolean(db.prepare('SELECT is_admin FROM users WHERE id = ?').get(id)?.is_admin);
export const setAdmin = (id) => db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(id);
export const hasAdmin = () => Boolean(db.prepare('SELECT 1 FROM users WHERE is_admin = 1').get());

const ADMIN_USER = String(process.env.ADMIN_USER || '').trim().toLowerCase();

// Who is admin is decided when an account is made, never by whoever happens to send a
// request first: while there is no admin, the very first account becomes it (the one from
// ADMIN_USER/ADMIN_PASSWORD, or the first login through Authelia), or the account named
// ADMIN_USER. The kit's login creates accounts through this store, so both ways pass here.
// (node:sqlite is synchronous, so nothing can slip in between counting and inserting.)
export const users = {
  ...kitUsers,
  createUser(fields) {
    const first = kitUsers.countUsers() === 0;
    const id = kitUsers.createUser(fields);
    if (!hasAdmin() && (first || String(fields.username).toLowerCase() === ADMIN_USER)) setAdmin(id);
    return id;
  },
};

// At startup, for a database that has accounts but no admin (from before Stapel kept one):
// the account named ADMIN_USER if there is one, otherwise the oldest account.
export function ensureAdminAccount() {
  if (hasAdmin()) return;
  const named = ADMIN_USER ? kitUsers.getUserByName(ADMIN_USER) : null;
  const oldest = db.prepare('SELECT id, username FROM users ORDER BY id LIMIT 1').get();
  const admin = named || oldest;
  if (!admin) return;
  setAdmin(admin.id);
  console.log(`Made "${admin.username}" the admin.`);
}

export function createUser({ username, displayName, passwordHash, lang = 'de', isAdmin: admin = false }) {
  const id = users.createUser({ username, displayName: displayName || username, passwordHash, lang });
  if (admin) setAdmin(id);
  return id;
}

export const deleteUser = (id) => db.prepare('DELETE FROM users WHERE id = ?').run(id);

// --- publishers ---

export const publisherName = (gcdId) => db.prepare('SELECT name FROM publishers WHERE gcd_id = ?').get(gcdId)?.name ?? null;

export function savePublisher(gcdId, name) {
  db.prepare('INSERT INTO publishers (gcd_id, name, fetched_at) VALUES (?, ?, ?) ON CONFLICT (gcd_id) DO UPDATE SET name = excluded.name')
    .run(gcdId, name, now());
  db.prepare('UPDATE series SET publisher_name = ? WHERE publisher_gcd_id = ?').run(name, gcdId);
}

// --- series ---

export const getSeries = (id) => db.prepare('SELECT * FROM series WHERE id = ?').get(id);
export const seriesByGcd = (gcdId) => db.prepare('SELECT * FROM series WHERE gcd_id = ?').get(gcdId);

export function localSeriesForGcd(gcdIds, userId) {
  if (!gcdIds.length) return new Map();
  const rows = db.prepare(`
    SELECT s.gcd_id, s.id, us.user_id IS NOT NULL AS collected
    FROM series s LEFT JOIN user_series us ON us.series_id = s.id AND us.user_id = ?
    WHERE s.gcd_id IN (${gcdIds.map(() => '?').join(',')})`).all(userId, ...gcdIds);
  return new Map(rows.map((r) => [r.gcd_id, r]));
}

export function upsertSeries(s) {
  const existing = s.gcd_id != null ? seriesByGcd(s.gcd_id) : null;
  if (existing) {
    db.prepare(`UPDATE series SET name = ?, year_began = ?, year_ended = ?, publisher_gcd_id = ?, publisher_name = COALESCE(?, publisher_name),
      language = ?, country = ?, format = ?, notes = ?, synced_at = ? WHERE id = ?`)
      .run(s.name, s.year_began, s.year_ended, s.publisher_gcd_id, s.publisher_name, s.language, s.country, s.format, s.notes, s.synced_at, existing.id);
    return existing.id;
  }
  const { lastInsertRowid } = db.prepare(`INSERT INTO series (gcd_id, name, year_began, year_ended, publisher_gcd_id, publisher_name, language, country, format, notes, synced_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(s.gcd_id ?? null, s.name, s.year_began ?? null, s.year_ended ?? null, s.publisher_gcd_id ?? null, s.publisher_name ?? null,
      s.language ?? null, s.country ?? null, s.format ?? null, s.notes ?? null, s.synced_at ?? null, now());
  return Number(lastInsertRowid);
}

export function updateSeriesInfo(id, { name, publisher_name, year_began, language }) {
  db.prepare('UPDATE series SET name = ?, publisher_name = ?, year_began = ?, language = ? WHERE id = ?')
    .run(name, publisher_name || null, year_began || null, language || null, id);
}

export const deleteSeries = (id) => db.prepare('DELETE FROM series WHERE id = ?').run(id);

export const countIssuesOfSeries = (id) => db.prepare('SELECT COUNT(*) AS n FROM issues WHERE series_id = ?').get(id).n;

export const coverFilesOfSeries = (id) =>
  db.prepare('SELECT cover_file FROM issues WHERE series_id = ? AND cover_file IS NOT NULL').all(id).map((r) => r.cover_file);

// Whether anyone besides userId has the series in their collection or a status on one of its issues
export const seriesUsedByOthers = (seriesId, userId) =>
  Boolean(db.prepare(`SELECT 1 FROM user_series WHERE series_id = :series AND user_id != :user
    UNION ALL SELECT 1 FROM user_issues ui JOIN issues i ON i.id = ui.issue_id WHERE i.series_id = :series AND ui.user_id != :user
    LIMIT 1`).get({ series: seriesId, user: userId }));

export const issueUsedByOthers = (issueId, userId) =>
  Boolean(db.prepare('SELECT 1 FROM user_issues WHERE issue_id = ? AND user_id != ?').get(issueId, userId));

export function setCollected(userId, seriesId, collected) {
  if (collected) db.prepare('INSERT OR IGNORE INTO user_series (user_id, series_id, added_at) VALUES (?, ?, ?)').run(userId, seriesId, now());
  else db.prepare('DELETE FROM user_series WHERE user_id = ? AND series_id = ?').run(userId, seriesId);
}

export const isCollected = (userId, seriesId) =>
  Boolean(db.prepare('SELECT 1 FROM user_series WHERE user_id = ? AND series_id = ?').get(userId, seriesId));

// Per-series counts for one user. Owned/read are counted per number, so owning
// any printing of #5 counts as owning #5.
const SERIES_STATS = `
  WITH per_number AS (
    SELECT i.series_id, i.number,
      MAX(ui.owned_at IS NOT NULL) AS owned,
      MAX(ui.read_at IS NOT NULL) AS read,
      MAX(ui.owned_at IS NOT NULL AND ui.read_at IS NULL) AS unread_owned
    FROM issues i LEFT JOIN user_issues ui ON ui.issue_id = i.id AND ui.user_id = :user
    WHERE i.series_id IN (SELECT series_id FROM user_series WHERE user_id = :user)
    GROUP BY i.series_id, i.number
  ),
  stats AS (
    SELECT series_id, COUNT(*) AS total, SUM(owned) AS owned, SUM(read) AS read, SUM(unread_owned) AS unread_owned
    FROM per_number GROUP BY series_id
  ),
  first_cover AS (
    SELECT series_id, cover_file, cover_url FROM (
      SELECT i.series_id, i.cover_file, i.cover_url,
        ROW_NUMBER() OVER (PARTITION BY i.series_id ORDER BY ui.owned_at IS NULL, i.position) AS rn
      FROM issues i LEFT JOIN user_issues ui ON ui.issue_id = i.id AND ui.user_id = :user
      WHERE (i.cover_file IS NOT NULL OR i.cover_url IS NOT NULL) AND i.series_id IN (SELECT series_id FROM user_series WHERE user_id = :user)
    ) WHERE rn = 1
  )
  SELECT s.*, us.added_at, COALESCE(st.total, 0) AS total, COALESCE(st.owned, 0) AS owned,
    COALESCE(st.read, 0) AS read, COALESCE(st.unread_owned, 0) AS unread_owned, fc.cover_file, fc.cover_url
  FROM user_series us
  JOIN series s ON s.id = us.series_id
  LEFT JOIN stats st ON st.series_id = s.id
  LEFT JOIN first_cover fc ON fc.series_id = s.id
  WHERE us.user_id = :user`;

export const listCollection = (userId) =>
  db.prepare(`${SERIES_STATS} ORDER BY s.name COLLATE NOCASE, s.year_began`).all({ user: userId });

// --- issues ---

const ISSUE_WITH_STATUS = `
  SELECT i.*, ui.owned_at, ui.read_at, ui.wanted_at, ui.rating, ui.notes
  FROM issues i LEFT JOIN user_issues ui ON ui.issue_id = i.id AND ui.user_id = ?`;

export const issuesOfSeries = (seriesId, userId) =>
  db.prepare(`${ISSUE_WITH_STATUS} WHERE i.series_id = ? ORDER BY i.position, i.id`).all(userId, seriesId);

export const getIssue = (id) => db.prepare('SELECT * FROM issues WHERE id = ?').get(id);

export function getIssueForUser(id, userId) {
  return db.prepare(`
    SELECT i.*, ui.owned_at, ui.read_at, ui.wanted_at, ui.rating, ui.notes,
      s.name AS series_name, s.year_began, s.publisher_name, s.gcd_id AS series_gcd_id, s.language
    FROM issues i JOIN series s ON s.id = i.series_id
    LEFT JOIN user_issues ui ON ui.issue_id = i.id AND ui.user_id = ?
    WHERE i.id = ?`).get(userId, id);
}

// Who else owns or has read this issue (e.g. "Papa owns it too")
export const otherOwners = (issueId, userId) =>
  db.prepare(`SELECT u.display_name, ui.owned_at IS NOT NULL AS owned, ui.read_at IS NOT NULL AS read
    FROM user_issues ui JOIN users u ON u.id = ui.user_id
    WHERE ui.issue_id = ? AND ui.user_id != ? AND (ui.owned_at IS NOT NULL OR ui.read_at IS NOT NULL)`).all(issueId, userId);

export const variantsOf = (issue) =>
  db.prepare('SELECT id, number, variant, title, cover_file, is_variant FROM issues WHERE series_id = ? AND number = ? AND id != ? ORDER BY position')
    .all(issue.series_id, issue.number, issue.id);

// Inserts or updates the issue list of a GCD series. Issues that disappeared from
// GCD are removed unless someone has a status on them. Returns the removed cover files.
export function syncIssues(seriesId, list) {
  return transaction(() => {
    const seen = new Set();
    const findByGcd = db.prepare('SELECT id FROM issues WHERE gcd_id = ?');
    const update = db.prepare('UPDATE issues SET series_id = ?, position = ?, number = ?, title = ?, variant = ?, is_variant = ? WHERE id = ?');
    const insert = db.prepare(`INSERT INTO issues (series_id, gcd_id, position, number, title, variant, is_variant, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const it of list) {
      const existing = findByGcd.get(it.gcd_id);
      if (existing) {
        update.run(seriesId, it.position, it.number, it.title, it.variant, it.is_variant ? 1 : 0, existing.id);
        seen.add(existing.id);
      } else {
        seen.add(Number(insert.run(seriesId, it.gcd_id, it.position, it.number, it.title, it.variant, it.is_variant ? 1 : 0, now()).lastInsertRowid));
      }
    }
    const stale = db.prepare('SELECT id, cover_file FROM issues WHERE series_id = ? AND gcd_id IS NOT NULL').all(seriesId).filter((r) => !seen.has(r.id));
    const removedCovers = [];
    for (const { id, cover_file } of stale) {
      const used = db.prepare('SELECT 1 FROM user_issues WHERE issue_id = ?').get(id);
      if (used) continue;
      db.prepare('DELETE FROM issues WHERE id = ?').run(id);
      if (cover_file) removedCovers.push(cover_file);
    }
    return removedCovers;
  });
}

export function addCustomIssues(seriesId, items) {
  return transaction(() => {
    let position = db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM issues WHERE series_id = ?').get(seriesId).p;
    const numbers = new Set(db.prepare('SELECT number FROM issues WHERE series_id = ?').all(seriesId).map((r) => r.number));
    const insert = db.prepare('INSERT INTO issues (series_id, position, number, title, variant, is_variant, isbn, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const ids = [];
    for (const it of items) {
      const isVariant = numbers.has(it.number);
      numbers.add(it.number);
      ids.push(Number(insert.run(seriesId, ++position, it.number, it.title || '', it.variant || '', isVariant ? 1 : 0, it.isbn || null, now()).lastInsertRowid));
    }
    return ids;
  });
}

export function updateIssueInfo(id, fields) {
  const allowed = ['number', 'title', 'variant', 'isbn', 'barcode', 'key_date', 'price', 'page_count', 'credits', 'cover_url', 'cover_file', 'cover_source', 'cv_cover_url', 'details_at', 'details_failed', 'user_fields'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (!keys.length) return;
  db.prepare(`UPDATE issues SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k] ?? null), id);
}

// Fields of an issue that were set in the app (edited, scanned, own cover photo)
export const userFields = (issue) => new Set(String(issue?.user_fields || '').split(',').filter(Boolean));

export function markUserFields(id, names) {
  const fields = userFields(getIssue(id));
  for (const name of names) fields.add(name);
  db.prepare('UPDATE issues SET user_fields = ? WHERE id = ?').run([...fields].join(','), id);
}

// The ids among issueIds that exist
export const existingIssueIds = (issueIds) =>
  db.prepare('SELECT id FROM issues WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(issueIds)).map((r) => r.id);

export const deleteIssue = (id) => db.prepare('DELETE FROM issues WHERE id = ?').run(id);

// Issues matching a scanned code. GCD stores barcodes with their 2/5-digit add-on
// (e.g. EAN-13 + issue number), so a scanned EAN/UPC matches by prefix.
export function findByCode(code, isbn13, isbn10, userId) {
  const conditions = ['i.barcode = :code', 'i.barcode LIKE :prefix'];
  if (isbn13) conditions.push('i.isbn = :isbn13');
  if (isbn10) conditions.push('i.isbn = :isbn10');
  return db.prepare(`
    SELECT i.*, ui.owned_at, ui.read_at, ui.wanted_at, s.name AS series_name, s.year_began, s.publisher_name
    FROM issues i JOIN series s ON s.id = i.series_id
    LEFT JOIN user_issues ui ON ui.issue_id = i.id AND ui.user_id = :user
    WHERE ${conditions.join(' OR ')}
    ORDER BY i.is_variant, i.position LIMIT 30`)
    .all({ code, prefix: `${code}%`, isbn13: isbn13 ?? '', isbn10: isbn10 ?? '', user: userId });
}

// --- user status ---

const STATUS_COLUMNS = { owned: 'owned_at', read: 'read_at', wanted: 'wanted_at' };

// flags: { owned?: bool, read?: bool, wanted?: bool }. Owning something takes it off the wishlist.
export function setStatus(userId, issueIds, flags) {
  const stamp = now();
  transaction(() => {
    const ensure = db.prepare('INSERT OR IGNORE INTO user_issues (user_id, issue_id) VALUES (?, ?)');
    for (const id of issueIds) {
      ensure.run(userId, id);
      for (const [flag, column] of Object.entries(STATUS_COLUMNS)) {
        if (flags[flag] === undefined) continue;
        db.prepare(`UPDATE user_issues SET ${column} = ${flags[flag] ? `COALESCE(${column}, ?)` : 'NULL'} WHERE user_id = ? AND issue_id = ?`)
          .run(...(flags[flag] ? [stamp] : []), userId, id);
      }
      if (flags.owned) db.prepare('UPDATE user_issues SET wanted_at = NULL WHERE user_id = ? AND issue_id = ?').run(userId, id);
    }
    db.prepare(`DELETE FROM user_issues WHERE user_id = ? AND owned_at IS NULL AND read_at IS NULL AND wanted_at IS NULL
      AND rating IS NULL AND (notes IS NULL OR notes = '')`).run(userId);
  });
}

export function setPersonal(userId, issueId, { rating, notes }) {
  db.prepare('INSERT OR IGNORE INTO user_issues (user_id, issue_id) VALUES (?, ?)').run(userId, issueId);
  if (rating !== undefined) db.prepare('UPDATE user_issues SET rating = ? WHERE user_id = ? AND issue_id = ?').run(rating || null, userId, issueId);
  if (notes !== undefined) db.prepare('UPDATE user_issues SET notes = ? WHERE user_id = ? AND issue_id = ?').run(notes || null, userId, issueId);
}

// --- overview pages ---

export function homeStats(userId) {
  return db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM user_series WHERE user_id = :user) AS series,
      (SELECT COUNT(*) FROM user_issues WHERE user_id = :user AND owned_at IS NOT NULL) AS owned,
      (SELECT COUNT(*) FROM user_issues WHERE user_id = :user AND read_at IS NOT NULL) AS read,
      (SELECT COUNT(*) FROM user_issues WHERE user_id = :user AND owned_at IS NOT NULL AND read_at IS NULL) AS unread_owned,
      (SELECT COUNT(*) FROM user_issues WHERE user_id = :user AND wanted_at IS NOT NULL) AS wanted`).get({ user: userId });
}

// The first owned-but-unread issue in each collected series that has been started
// (or, failing that, any series with unread owned issues), most recently active first.
export function continueReading(userId, limit = 12) {
  return db.prepare(`
    WITH candidates AS (
      SELECT i.*, s.name AS series_name,
        ROW_NUMBER() OVER (PARTITION BY i.series_id ORDER BY i.position) AS rn
      FROM issues i
      JOIN user_series us ON us.series_id = i.series_id AND us.user_id = :user
      JOIN series s ON s.id = i.series_id
      JOIN user_issues ui ON ui.issue_id = i.id AND ui.user_id = :user
      WHERE ui.owned_at IS NOT NULL AND ui.read_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM issues j JOIN user_issues uj ON uj.issue_id = j.id AND uj.user_id = :user
                        WHERE j.series_id = i.series_id AND j.number = i.number AND uj.read_at IS NOT NULL)
    ),
    activity AS (
      SELECT i.series_id, MAX(ui.read_at) AS last_read
      FROM user_issues ui JOIN issues i ON i.id = ui.issue_id
      WHERE ui.user_id = :user GROUP BY i.series_id
    )
    SELECT c.* FROM candidates c LEFT JOIN activity a ON a.series_id = c.series_id
    WHERE c.rn = 1
    ORDER BY a.last_read IS NULL, a.last_read DESC, c.series_name COLLATE NOCASE
    LIMIT :limit`).all({ user: userId, limit });
}

export function recentlyAdded(userId, limit = 12) {
  return db.prepare(`
    SELECT i.*, s.name AS series_name, ui.owned_at, ui.read_at
    FROM user_issues ui JOIN issues i ON i.id = ui.issue_id JOIN series s ON s.id = i.series_id
    WHERE ui.user_id = ? AND ui.owned_at IS NOT NULL
    ORDER BY ui.owned_at DESC, i.position DESC LIMIT ?`).all(userId, limit);
}

export function wantedIssues(userId) {
  return db.prepare(`
    SELECT i.*, s.name AS series_name, s.year_began, ui.wanted_at
    FROM user_issues ui JOIN issues i ON i.id = ui.issue_id JOIN series s ON s.id = i.series_id
    WHERE ui.user_id = ? AND ui.wanted_at IS NOT NULL AND ui.owned_at IS NULL
    ORDER BY s.name COLLATE NOCASE, i.position`).all(userId);
}

// Numbers not owned in the user's collected series, but only for series where they
// own at least one issue (a series you just started tracking isn't "missing" 300 issues).
export function missingIssues(userId) {
  return db.prepare(`
    WITH per_number AS (
      SELECT i.series_id, i.number, MIN(i.position) AS position, MAX(ui.owned_at IS NOT NULL) AS owned
      FROM issues i LEFT JOIN user_issues ui ON ui.issue_id = i.id AND ui.user_id = :user
      WHERE i.series_id IN (SELECT series_id FROM user_series WHERE user_id = :user)
      GROUP BY i.series_id, i.number
    )
    SELECT p.series_id, s.name AS series_name, s.year_began, p.number, p.position
    FROM per_number p JOIN series s ON s.id = p.series_id
    WHERE p.owned = 0 AND p.series_id IN (SELECT series_id FROM per_number WHERE owned = 1)
    ORDER BY s.name COLLATE NOCASE, s.id, p.position`).all({ user: userId });
}

// --- background work ---

// The waiting list of issues that still need details/cover from GCD, most useful
// first: series asked for with "Cover laden", then issues owned by anyone, then
// wanted ones, then the rest of collected series; reprints and variants last.
// :requested is a JSON array of series ids.
const DETAILS_QUEUE = `
  WITH req AS (SELECT value AS series_id FROM json_each(:requested)),
  prio AS (SELECT issue_id, MAX(owned_at IS NOT NULL) * 2 + MAX(wanted_at IS NOT NULL) AS prio FROM user_issues GROUP BY issue_id),
  queue AS (
    SELECT i.*, ROW_NUMBER() OVER (
      ORDER BY i.series_id IN (SELECT series_id FROM req) DESC, COALESCE(p.prio, 0) DESC, i.is_variant, i.series_id, i.position
    ) AS rn
    FROM issues i LEFT JOIN prio p ON p.issue_id = i.id
    WHERE i.gcd_id IS NOT NULL AND i.details_at IS NULL AND i.details_failed = 0
      AND (p.prio > 0 OR i.series_id IN (SELECT series_id FROM user_series) OR i.series_id IN (SELECT series_id FROM req))
  )`;

export const nextIssueNeedingDetails = (requested = []) =>
  db.prepare(`${DETAILS_QUEUE} SELECT * FROM queue ORDER BY rn LIMIT 1`).get({ requested: JSON.stringify(requested) });

export const countIssuesNeedingDetails = (requested = []) =>
  db.prepare(`${DETAILS_QUEUE} SELECT COUNT(*) AS n FROM queue`).get({ requested: JSON.stringify(requested) }).n;

// Where a series stands in the waiting list: how many of its issues wait, and the
// place in the list of its last one (for "done in about …").
export const seriesQueue = (seriesId, requested = []) =>
  db.prepare(`${DETAILS_QUEUE}
    SELECT COUNT(*) AS waiting, COALESCE(SUM(is_variant = 0), 0) AS waitingMain,
      MIN(rn) AS first, MAX(CASE WHEN is_variant = 0 THEN rn END) AS lastMain, MAX(rn) AS last
    FROM queue WHERE series_id = :series`).get({ requested: JSON.stringify(requested), series: seriesId });

export const seriesHasWaitingDetails = (seriesId) =>
  Boolean(db.prepare('SELECT 1 FROM issues WHERE series_id = ? AND gcd_id IS NOT NULL AND details_at IS NULL AND details_failed = 0 LIMIT 1').get(seriesId));

export const coverCount = () => db.prepare('SELECT COUNT(*) AS n FROM issues WHERE cover_file IS NOT NULL').get().n;

export const seriesNeedingSync = (olderThanIso) =>
  db.prepare(`SELECT * FROM series WHERE gcd_id IS NOT NULL AND id IN (SELECT series_id FROM user_series)
    AND (synced_at IS NULL OR synced_at < ?) ORDER BY synced_at LIMIT 1`).get(olderThanIso);

export const seriesMissingPublisher = (skip = []) =>
  db.prepare(`SELECT DISTINCT publisher_gcd_id AS id FROM series WHERE publisher_gcd_id IS NOT NULL AND publisher_name IS NULL
    AND publisher_gcd_id NOT IN (SELECT value FROM json_each(?)) LIMIT 1`).get(JSON.stringify(skip))?.id;

// --- Comic Vine covers ---

// A collected series that hasn't been looked up on Comic Vine yet
export const seriesNeedingCvMatch = () =>
  db.prepare(`SELECT s.*, (SELECT COUNT(DISTINCT number) FROM issues WHERE series_id = s.id) AS issue_count
    FROM series s WHERE s.cv_state IS NULL AND s.id IN (SELECT series_id FROM user_series) ORDER BY s.id LIMIT 1`).get();

// A linked series whose Comic Vine issue list is missing or older than olderThanIso
export const seriesNeedingCvSync = (olderThanIso) =>
  db.prepare(`SELECT * FROM series WHERE cv_volume_id IS NOT NULL AND cv_state IN ('auto', 'manual')
    AND (cv_synced_at IS NULL OR cv_synced_at < ?) ORDER BY cv_synced_at IS NOT NULL, cv_synced_at LIMIT 1`).get(olderThanIso);

export function setCvVolume(seriesId, { volumeId = null, name = null, state }) {
  db.prepare('UPDATE series SET cv_volume_id = ?, cv_volume_name = ?, cv_state = ?, cv_synced_at = NULL WHERE id = ?').run(volumeId, name, state, seriesId);
}

// Covers that came from Comic Vine for a series (to remove when the link changes)
export function clearCvCovers(seriesId) {
  return transaction(() => {
    const files = db.prepare("SELECT cover_file FROM issues WHERE series_id = ? AND cover_source = 'cv' AND cover_file IS NOT NULL").all(seriesId).map((r) => r.cover_file);
    db.prepare("UPDATE issues SET cover_file = NULL, cover_source = NULL WHERE series_id = ? AND cover_source = 'cv'").run(seriesId);
    db.prepare('UPDATE issues SET cv_cover_url = NULL WHERE series_id = ?').run(seriesId);
    return files;
  });
}

// Gives each issue of the series the Comic Vine cover of its number. The first
// printing of a number gets the cover; reprints and variants keep their own.
export function assignCvCovers(seriesId, cvIssues) {
  const norm = (n) => String(n || '').trim().replace(/^#/, '').replace(/^0+(?=\d)/, '').toLowerCase();
  const byNumber = new Map();
  for (const i of cvIssues) if (i.coverUrl && !byNumber.has(norm(i.number))) byNumber.set(norm(i.number), i.coverUrl);
  transaction(() => {
    const update = db.prepare('UPDATE issues SET cv_cover_url = ? WHERE id = ?');
    for (const issue of db.prepare('SELECT id, number, is_variant FROM issues WHERE series_id = ?').all(seriesId)) {
      update.run(issue.is_variant ? null : byNumber.get(norm(issue.number)) ?? null, issue.id);
    }
    db.prepare('UPDATE series SET cv_synced_at = ? WHERE id = ?').run(now(), seriesId);
  });
}

// Next cover to download: issues without a cover that have a Comic Vine URL;
// requested series first, then issues owned by anyone, then wanted, then the rest.
const CV_COVER_QUEUE = `
  WITH req AS (SELECT value AS series_id FROM json_each(:requested)),
  prio AS (SELECT issue_id, MAX(owned_at IS NOT NULL) * 2 + MAX(wanted_at IS NOT NULL) AS prio FROM user_issues GROUP BY issue_id),
  queue AS (
    SELECT i.*, ROW_NUMBER() OVER (
      ORDER BY i.series_id IN (SELECT series_id FROM req) DESC, COALESCE(p.prio, 0) DESC, i.series_id, i.position
    ) AS rn
    FROM issues i LEFT JOIN prio p ON p.issue_id = i.id
    WHERE i.cv_cover_url IS NOT NULL AND i.cover_file IS NULL
  )`;

export const nextCvCover = (requested = []) =>
  db.prepare(`${CV_COVER_QUEUE} SELECT * FROM queue ORDER BY rn LIMIT 1`).get({ requested: JSON.stringify(requested) });

export const seriesCvQueue = (seriesId, requested = []) =>
  db.prepare(`${CV_COVER_QUEUE} SELECT COUNT(*) AS waiting, MAX(rn) AS last FROM queue WHERE series_id = :series`)
    .get({ requested: JSON.stringify(requested), series: seriesId });

// Per series of a user's collection: covers and GCD details done and still to come
export const collectionProgress = (userId) =>
  db.prepare(`
    SELECT s.id, s.name, s.cv_state, s.cv_volume_name, s.cv_synced_at,
      COALESCE(SUM(i.cover_file IS NOT NULL), 0) AS covers_done,
      COALESCE(SUM(i.cv_cover_url IS NOT NULL AND i.cover_file IS NULL), 0) AS covers_waiting,
      COALESCE(SUM(i.gcd_id IS NOT NULL AND (i.details_at IS NOT NULL OR i.details_failed = 1)), 0) AS details_done,
      COALESCE(SUM(i.gcd_id IS NOT NULL AND i.details_at IS NULL AND i.details_failed = 0), 0) AS details_waiting
    FROM user_series us JOIN series s ON s.id = us.series_id LEFT JOIN issues i ON i.series_id = s.id
    WHERE us.user_id = ?
    GROUP BY s.id ORDER BY s.name COLLATE NOCASE`).all(userId);

export const countCvCoversWaiting = () =>
  db.prepare('SELECT COUNT(*) AS n FROM issues WHERE cv_cover_url IS NOT NULL AND cover_file IS NULL').get().n;

// --- export ---

export function exportRows(userId) {
  return db.prepare(`
    SELECT s.name AS series, s.year_began AS series_year, s.publisher_name AS publisher, s.language,
      i.number, i.variant, i.title, i.isbn, i.key_date,
      ui.owned_at, ui.read_at, ui.wanted_at, ui.rating, ui.notes,
      s.gcd_id AS gcd_series_id, i.gcd_id AS gcd_issue_id
    FROM user_issues ui JOIN issues i ON i.id = ui.issue_id JOIN series s ON s.id = i.series_id
    WHERE ui.user_id = ?
    ORDER BY s.name COLLATE NOCASE, s.year_began, i.position`).all(userId);
}
