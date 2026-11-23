// Copied from kit/server/sync.test.js by kit/sync.mjs. Change it there, not here.
// Runs in each app as server/kit/sync.test.js (npm test). How the server tells a device to
// start over (sync.js, at the top).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createSync } from './sync.js';

function start(db = new DatabaseSync(':memory:')) {
  db.exec(`CREATE TABLE IF NOT EXISTS things (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, purged INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL)`);
  const clean = (patch) => ('name' in patch ? { name: String(patch.name) } : {});
  const out = (row) => ({ id: row.id, name: row.name, seq: row.seq });
  return createSync(db, { kinds: { thing: { table: 'things', clean, out } } });
}

const add = (name) => ({ kind: 'thing', id: randomUUID(), patch: { name } });

test('sync: the database keeps its name, and every answer carries it', () => {
  const db = new DatabaseSync(':memory:');
  const engine = start(db);
  const { answer } = engine.sync(1, { changes: [add('a')] });
  assert.equal(answer.database, engine.database);
  assert.equal(start(db).database, engine.database, 'the same database after a restart');
  assert.notEqual(start().database, engine.database, 'another database has another name');
});

test('sync: another database: start over, the changes are left alone', () => {
  const engine = start();
  const { answer } = engine.sync(1, { database: randomUUID(), since: 0, changes: [add('a')] });
  assert.equal(answer.start_over, true);
  assert.equal(answer.database, engine.database);
  assert.equal(engine.sync(1, { since: 0 }).answer.items.thing.length, 0, 'nothing written');
});

test('sync: a device past the counter (a backup put back): start over', () => {
  const engine = start();
  const { answer } = engine.sync(1, { changes: [add('a'), add('b')] });
  const restored = engine.sync(1, { database: engine.database, since: answer.seq + 5, changes: [add('c')] }).answer;
  assert.equal(restored.start_over, true);
  assert.equal(restored.seq, answer.seq);
  const all = engine.sync(1, { database: engine.database, since: 0 }).answer;
  assert.equal(all.start_over, undefined);
  assert.deepEqual(all.items.thing.map((t) => t.name), ['a', 'b']);
});

test('sync: a device that never named a database (first sync, older copy) goes on', () => {
  const engine = start();
  engine.sync(1, { changes: [add('a')] });
  const { answer } = engine.sync(1, { since: 1, changes: [add('b')] });
  assert.equal(answer.start_over, undefined);
  assert.deepEqual(answer.items.thing.map((t) => t.name), ['b']);
});
