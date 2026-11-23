// Migrations of an existing database (db.js runs them when it opens the database)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('"unread" next to "want": Calibre books you have move over, books you only want stay', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'regal-migrate-'));
  // A database from before: user_version 0, books from Calibre and added by hand, the old default
  const old = new DatabaseSync(join(dataDir, 'regal.db'));
  old.exec(`
    CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT NOT NULL, calibre_id INTEGER, status TEXT NOT NULL DEFAULT 'want',
      created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO books (id, title, calibre_id, status) VALUES (1, 'Aus Calibre', 11, 'want'), (2, 'Wunsch', NULL, 'want'),
      (3, 'Aus Calibre, gelesen', 12, 'read'), (4, 'Aus Calibre, gerade', 13, 'reading');
    INSERT INTO settings (key, value) VALUES ('calibre_default_status', 'want');
  `);
  old.close();

  process.env.DATA_DIR = dataDir;
  const store = await import('./db.js');
  t.after(() => {
    store.db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  const status = Object.fromEntries(store.db.prepare('SELECT id, status FROM books').all().map((r) => [r.id, r.status]));
  assert.deepEqual(status, { 1: 'unread', 2: 'want', 3: 'read', 4: 'reading' });
  assert.equal(store.users.getSetting('calibre_default_status'), 'unread');
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 1);
});
