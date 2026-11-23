// Migrations of an existing database (db.js runs them when it opens the database)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('"played on": one platform as text becomes a list, nothing becomes an empty list', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'checkpoint-migrate-'));
  const old = new DatabaseSync(join(dataDir, 'checkpoint.db'));
  old.exec(`
    CREATE TABLE games (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'backlog', played_on TEXT,
      created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
    INSERT INTO games (id, name, played_on) VALUES (1, 'Zelda', 'Switch'), (2, 'Hades', NULL), (3, 'Celeste', '  '), (4, 'Doom', ' PC ');
  `);
  old.close();

  process.env.DATA_DIR = dataDir;
  const store = await import('./db.js');
  t.after(() => {
    store.db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  const played = Object.fromEntries(store.db.prepare('SELECT id, played_on FROM games').all().map((r) => [r.id, JSON.parse(r.played_on)]));
  assert.deepEqual(played, { 1: ['Switch'], 2: [], 3: [], 4: ['PC'] });
  assert.deepEqual(store.usedPlatforms(), ['PC', 'Switch']);
  // And the Steam columns came along
  const columns = store.db.prepare('PRAGMA table_info(games)').all().map((c) => c.name);
  for (const c of ['steam_appid', 'steam_minutes', 'steam_deck_minutes', 'steam_last_played']) assert.ok(columns.includes(c), c);
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 2);
});
