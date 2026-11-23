// Runs as web/src/kit/startover.test.js in the offline apps (npm test in To-do and Notizbuch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startOver } from './startover.js';

const note = (id, fields = {}) => ({ id, title: '', body: '', labels: [], updated_at: '2026-11-01T10:00:00.000Z', ...fields });
const mapOf = (...items) => new Map(items.map((i) => [i.id, i]));

test('startOver: what only the device has goes back whole', () => {
  const r = startOver({
    kinds: ['note'],
    server: { note: [] },
    local: { note: mapOf(note('a', { title: 'Nach dem Backup', body: 'nur hier', seq: 812 })) },
    outbox: [],
  });
  assert.equal(r.sentBack, 1);
  assert.deepEqual(r.outbox, [{ id: 'note:a', kind: 'note', item: 'a', base_seq: 0, v: 1, patch: { title: 'Nach dem Backup', body: 'nur hier', labels: [], updated_at: '2026-11-01T10:00:00.000Z' } }]);
  assert.equal(r.items.note.get('a').seq, 0, 'not on the server yet');
  assert.equal(r.items.note.get('a').body, 'nur hier');
});

test('startOver: the newer side wins, the device sends only what differs', () => {
  const later = '2026-11-02T10:00:00.000Z';
  const r = startOver({
    kinds: ['note'],
    server: { note: [note('mine', { body: 'alt', seq: 40 }), note('theirs', { body: 'neu', updated_at: later, seq: 41 }), note('same', { body: 'x', seq: 42 })] },
    local: { note: mapOf(note('mine', { body: 'neu', labels: ['L'], updated_at: later, seq: 900 }), note('theirs', { body: 'alt', seq: 901 }), note('same', { body: 'x', seq: 902 })) },
    outbox: [],
  });
  assert.equal(r.sentBack, 1);
  assert.deepEqual(r.outbox[0], { id: 'note:mine', kind: 'note', item: 'mine', base_seq: 40, v: 1, patch: { body: 'neu', labels: ['L'], updated_at: later } });
  assert.equal(r.items.note.get('mine').body, 'neu');
  assert.equal(r.items.note.get('mine').seq, 40);
  assert.equal(r.items.note.get('theirs').body, 'neu', "the server's newer text");
  assert.equal(r.items.note.get('same').seq, 42);
});

test('startOver: waiting changes stay, rebased; what the server deleted for good stays gone', () => {
  const r = startOver({
    kinds: ['note'],
    server: { note: [note('edited', { body: 'server', updated_at: '2026-11-05T00:00:00.000Z', seq: 7 }), { id: 'purged', seq: 8, purged: true }] },
    local: { note: mapOf(note('edited', { title: 'T', body: 'server', updated_at: '2026-11-04T00:00:00.000Z', seq: 500 }), note('purged', { body: 'weg', seq: 501 })) },
    outbox: [
      { id: 'note:edited', kind: 'note', item: 'edited', base_seq: 499, v: 3, patch: { title: 'T' } },
      { id: 'note:gone', kind: 'note', item: 'gone', base_seq: 300, v: 1, patch: { purge: true } },
    ],
  });
  assert.equal(r.sentBack, 0, 'the server changed "edited" later; "purged" is gone for good');
  const byId = Object.fromEntries(r.outbox.map((e) => [e.item, e]));
  assert.deepEqual(byId.edited, { id: 'note:edited', kind: 'note', item: 'edited', base_seq: 0, v: 3, patch: { title: 'T' } });
  assert.equal(byId.gone.base_seq, 0);
  assert.deepEqual([...r.items.note.keys()], ['edited']);
  assert.equal(r.items.note.get('edited').title, 'T', 'the waiting change on top');
});

test('startOver: a waiting change to an item the server lost goes out whole', () => {
  const r = startOver({
    kinds: ['task'],
    server: { task: [] },
    local: { task: mapOf({ id: 't', title: 'Neu', priority: 2, subtasks: [], updated_at: '2026-11-03T00:00:00.000Z', seq: 0 }) },
    outbox: [{ id: 'task:t', kind: 'task', item: 't', base_seq: 0, v: 2, patch: { priority: 2, updated_at: '2026-11-03T00:00:00.000Z' } }],
  });
  assert.equal(r.outbox.length, 1);
  assert.deepEqual(r.outbox[0].patch, { title: 'Neu', priority: 2, subtasks: [], updated_at: '2026-11-03T00:00:00.000Z' });
  assert.equal(r.outbox[0].v, 3, 'a new version, so an answer to the old one leaves it queued');
});

test('startOver: kinds not sent back become what the server has', () => {
  const r = startOver({
    kinds: ['note', 'file'],
    sendBack: ['note'],
    server: { note: [note('n', { seq: 3 })], file: [{ id: 'kept', note_id: 'n', seq: 4 }] },
    local: { note: mapOf(note('n', { seq: 3 })), file: mapOf({ id: 'kept', note_id: 'n', seq: 90 }, { id: 'lost', note_id: 'n', seq: 91 }, { id: 'up', note_id: 'n', pending: true }) },
    outbox: [],
  });
  assert.equal(r.sentBack, 0);
  assert.deepEqual([...r.items.file.keys()], ['kept']);
  assert.equal(r.items.file.get('kept').seq, 4);
});
