// Copied from design/server/users.js by design/sync.mjs. Change it there, not here.
// Accounts and small settings in the app's SQLite database (node:sqlite).
// createUserStore(db) adds the `users` and `settings` tables if they are missing.

import { randomBytes } from 'node:crypto';

export function createUserStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      lang TEXT NOT NULL DEFAULT 'de',
      session_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const COLUMNS = 'id, username, display_name, lang, created_at, password_hash, session_version';

  function getSetting(key, init) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (row) return row.value;
    if (!init) return null;
    const value = init();
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
    return value;
  }

  return {
    getSetting,
    setSetting: (key, value) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, String(value)),
    sessionSecret: () => getSetting('session_secret', () => randomBytes(32).toString('hex')),

    countUsers: () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    getUser: (id) => db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).get(id),
    getUserByName: (username) => db.prepare(`SELECT ${COLUMNS} FROM users WHERE username = ?`).get(username),
    bumpSessionVersion: (id) => db.prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?').run(id),

    createUser({ username, displayName, passwordHash, lang = 'de' }) {
      const { lastInsertRowid } = db.prepare('INSERT INTO users (username, display_name, password_hash, lang, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(username, displayName, passwordHash, lang, new Date().toISOString());
      return Number(lastInsertRowid);
    },

    updateUser(id, { displayName, lang, passwordHash }) {
      if (displayName !== undefined) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, id);
      if (lang !== undefined) db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(lang, id);
      if (passwordHash !== undefined) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
    },
  };
}
