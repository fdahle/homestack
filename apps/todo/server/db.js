import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { createUserStore } from './kit/users.js';
import { createTaskStore } from './tasks.js';

export const DATA_DIR = process.env.DATA_DIR || './data';
// Devices per account that get reminders; plenty for phones, laptops and old browsers
export const MAX_DEVICES = 20;

// The database with everything in it: accounts (kit), tasks and lists, push subscriptions.
// `path` ':memory:' gives an empty one for the tests.
export function openDatabase(path = join(DATA_DIR, 'todo.db')) {
  if (path !== ':memory:') mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const users = createUserStore(db);
  const tasks = createTaskStore(db);

  db.exec(`
    -- The devices that get reminders, per account
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    -- Reminders that went out, so each goes once
    CREATE TABLE IF NOT EXISTS sent_reminders (
      key TEXT PRIMARY KEY,
      sent_at TEXT NOT NULL
    );
  `);

  const now = () => new Date().toISOString();

  const push = {
    list: (userId) => db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId),
    count: (userId) => db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(userId).n,
    usersWithDevices: () => db.prepare('SELECT DISTINCT user_id FROM push_subscriptions').all().map((r) => r.user_id),
    // False when the endpoint belongs to another account. It only moves over when the keys match:
    // that's the same browser signing up again after someone else logged in on it. Knowing an
    // endpoint alone doesn't let one account take another's reminders.
    // Each account keeps its MAX_DEVICES most recently signed-up devices; older ones go.
    save: (userId, { endpoint, p256dh, auth }) => {
      const row = db.prepare('SELECT user_id, p256dh, auth FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
      if (row && row.user_id !== userId && (row.p256dh !== p256dh || row.auth !== auth)) return false;
      db.prepare(`INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = excluded.created_at`)
        .run(endpoint, userId, p256dh, auth, now());
      db.prepare(`DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint NOT IN
        (SELECT endpoint FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)`).run(userId, userId, MAX_DEVICES);
      return true;
    },
    remove: (endpoint, userId) =>
      userId === undefined
        ? db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint)
        : db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, userId),
    wasSent: (key) => Boolean(db.prepare('SELECT 1 FROM sent_reminders WHERE key = ?').get(key)),
    markSent: (key) => db.prepare('INSERT OR IGNORE INTO sent_reminders (key, sent_at) VALUES (?, ?)').run(key, now()),
    pruneSent: (beforeIso) => db.prepare('DELETE FROM sent_reminders WHERE sent_at < ?').run(beforeIso),
  };

  // Small per-account settings, in the kit's settings table under "<name>:<user id>"
  const userSetting = (name, userId) => users.getSetting(`${name}:${userId}`);
  const setUserSetting = (name, userId, value) => users.setSetting(`${name}:${userId}`, value);

  // The secret address of an account's calendar feed
  const newToken = () => randomBytes(24).toString('base64url');
  const icsToken = (userId) => userSetting('ics', userId) || (setUserSetting('ics', userId, newToken()), userSetting('ics', userId));
  const resetIcsToken = (userId) => setUserSetting('ics', userId, newToken());
  const userByIcsToken = (token) => {
    const row = db.prepare("SELECT key FROM settings WHERE key LIKE 'ics:%' AND value = ?").get(String(token));
    return row ? Number(row.key.slice(4)) : null;
  };

  return { db, users, tasks, push, userSetting, setUserSetting, icsToken, resetIcsToken, userByIcsToken };
}

// 'YYYY-MM-DD' and 'HH:MM' in the server's time zone (TZ)
const pad = (n) => String(n).padStart(2, '0');
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localTime = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
