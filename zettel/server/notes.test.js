import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { openDatabase } from './db.js';
import { cleanPatch } from './notes.js';
import { noteMarkdown, safeName } from './export.js';
import { zip } from './zip.js';

function setup() {
  const { users, notes } = openDatabase(':memory:');
  const me = users.createUser({ username: 'me', displayName: 'Me', passwordHash: 'x' });
  const other = users.createUser({ username: 'other', displayName: 'Other', passwordHash: 'x' });
  return { notes, me, other };
}

const at = '2026-11-21T10:00:00.000Z';
const create = (id, fields = {}) => ({ kind: 'note', id, base_seq: 0, patch: { title: '', body: '', labels: [], created_at: at, updated_at: at, ...fields } });

test('a note written offline arrives, and comes back with its seq', () => {
  const { notes, me } = setup();
  const id = randomUUID();
  const { answer } = notes.sync(me, { since: 0, changes: [create(id, { title: 'Einkauf', body: '- [ ] Milch' })] });
  assert.equal(answer.items.note.length, 1);
  assert.equal(answer.items.note[0].title, 'Einkauf');
  assert.equal(answer.items.note[0].body, '- [ ] Milch');
  assert.equal(answer.items.note[0].seq, answer.seq);
  assert.deepEqual(answer.conflicts, []);
});

test('since only returns what changed after it', () => {
  const { notes, me } = setup();
  const a = randomUUID();
  const b = randomUUID();
  const first = notes.sync(me, { changes: [create(a)] }).answer;
  notes.sync(me, { changes: [create(b)] });
  const later = notes.sync(me, { since: first.seq }).answer;
  assert.deepEqual(later.items.note.map((n) => n.id), [b]);
});

test('two devices change the text: the second one becomes a copy, nothing is lost', () => {
  const { notes, me } = setup();
  const id = randomUUID();
  const base = notes.sync(me, { changes: [create(id, { title: 'Ideen', body: 'eins' })] }).answer.seq;
  // Phone, then laptop, both starting from `base`
  notes.sync(me, { changes: [{ kind: 'note', id, base_seq: base, patch: { body: 'eins, zwei' } }] });
  const { answer } = notes.sync(me, { since: base, changes: [{ kind: 'note', id, base_seq: base, patch: { body: 'eins, drei', pinned: true } }] });
  assert.equal(answer.conflicts.length, 1);
  const original = answer.items.note.find((n) => n.id === id);
  const copy = answer.items.note.find((n) => n.id === answer.conflicts[0].copy);
  assert.equal(original.body, 'eins, zwei');
  assert.equal(original.pinned, true, 'the other fields still take the change');
  assert.equal(copy.body, 'eins, drei');
  assert.equal(copy.title, 'Ideen');
});

test('a device that saw the latest text just overwrites it', () => {
  const { notes, me } = setup();
  const id = randomUUID();
  notes.sync(me, { changes: [create(id, { body: 'a' })] });
  const seen = notes.sync(me, { changes: [{ kind: 'note', id, base_seq: 1, patch: { body: 'b' } }] }).answer.seq;
  const { answer } = notes.sync(me, { changes: [{ kind: 'note', id, base_seq: seen, patch: { body: 'c' } }] });
  assert.deepEqual(answer.conflicts, []);
  assert.equal(answer.items.note.at(-1).body, 'c');
});

test('only the title changed elsewhere: no copy for the text', () => {
  const { notes, me } = setup();
  const id = randomUUID();
  const base = notes.sync(me, { changes: [create(id, { body: 'a' })] }).answer.seq;
  notes.sync(me, { changes: [{ kind: 'note', id, base_seq: base, patch: { title: 'Neu' } }] });
  const { answer } = notes.sync(me, { since: base, changes: [{ kind: 'note', id, base_seq: base, patch: { body: 'b' } }] });
  assert.deepEqual(answer.conflicts, []);
  const note = answer.items.note.find((n) => n.id === id);
  assert.equal(note.title, 'Neu');
  assert.equal(note.body, 'b');
});

test('deleting for good leaves only the id, and its files go', () => {
  const { notes, me } = setup();
  const id = randomUUID();
  const fileId = randomUUID();
  notes.sync(me, { changes: [create(id, { title: 'Weg' })] });
  notes.addFile(me, { id: fileId, note_id: id, name: 'a.jpg', type: 'image/jpeg', size: 3 });
  const { answer, removedFiles } = notes.sync(me, { since: 0, changes: [{ kind: 'note', id, patch: { purge: true } }] });
  assert.deepEqual(removedFiles, [fileId]);
  assert.deepEqual(answer.items.note, [{ id, seq: answer.items.note[0].seq, purged: true }]);
  assert.equal(answer.items.file[0].purged, true);
  // Later changes from a device that hadn't heard yet change nothing
  const again = notes.sync(me, { since: 0, changes: [{ kind: 'note', id, base_seq: 0, patch: { title: 'Zurück?' } }] }).answer;
  assert.equal(again.items.note[0].purged, true);
});

test("another user's note can't be read or changed", () => {
  const { notes, me, other } = setup();
  const id = randomUUID();
  notes.sync(me, { changes: [create(id, { title: 'Meins' })] });
  const { answer } = notes.sync(other, { since: 0, changes: [{ kind: 'note', id, patch: { title: 'Deins' } }] });
  assert.deepEqual(answer.items.note, []);
  assert.equal(answer.rejected[0].id, id);
  assert.equal(notes.getNote(id).title, 'Meins');
  assert.throws(() => notes.addFile(other, { id: randomUUID(), note_id: id, name: 'x', type: 'text/plain', size: 1 }), { code: 'bad_note' });
});

test('a bad change is rejected without blocking the others', () => {
  const { notes, me } = setup();
  const good = randomUUID();
  const { answer } = notes.sync(me, { changes: [{ kind: 'note', id: 'nope', patch: {} }, create(good), { kind: 'note', id: randomUUID(), patch: { labels: 'x' } }] });
  assert.deepEqual(answer.items.note.map((n) => n.id), [good]);
  assert.deepEqual(answer.rejected.map((r) => r.error), ['bad_id', 'bad_labels']);
});

test('the trash empties itself after the given days', () => {
  const { notes, me } = setup();
  const old = randomUUID();
  const recent = randomUUID();
  notes.sync(me, { changes: [create(old, { deleted_at: '2026-01-01T00:00:00Z' }), create(recent, { deleted_at: new Date().toISOString() })] });
  notes.emptyOldTrash(30);
  assert.equal(notes.getNote(old).purged, 1);
  assert.equal(notes.getNote(recent).purged, 0);
});

test('patches: labels tidied, future times clamped, unknown fields dropped', () => {
  const p = cleanPatch({ labels: [' Arbeit ', 'arbeit', 'Haus  und Hof', ''], updated_at: '2999-01-01T00:00:00Z', secret: 1 });
  assert.deepEqual(p.labels, ['Arbeit', 'Haus und Hof']);
  assert.ok(Date.parse(p.updated_at) <= Date.now());
  assert.equal('secret' in p, false);
  assert.throws(() => cleanPatch({ body: 'x'.repeat(500_001) }), { code: 'too_large' });
  assert.throws(() => cleanPatch({ archived_at: 'gestern' }), { code: 'bad_archived_at' });
  assert.deepEqual(cleanPatch({ purge: true, title: 'x' }), { purge: true });
});

test('export: Markdown with front matter, names every file system takes', () => {
  const md = noteMarkdown({ title: 'Einkauf', body: '- [ ] Milch', labels: ['Haus'], pinned: false, archived_at: null, created_at: at, updated_at: at }, [{ name: 'a b.jpg', path: 'files/x.jpg', image: true }]);
  assert.match(md, /^---\ntitle: "Einkauf"\nlabels: \["Haus"\]\n/);
  assert.match(md, /# Einkauf\n\n- \[ \] Milch\n/);
  assert.match(md, /!\[a b\.jpg\]\(<files\/x\.jpg>\)/);
  assert.equal(safeName('a/b: c?'), 'a b c');
  assert.equal(safeName('...'), 'Notiz');
});

test('zip: entries can be read back', () => {
  const data = zip([{ name: 'Zettel/ä.md', data: 'hallo '.repeat(100), date: new Date() }, { name: 'Zettel/x', data: Buffer.from([1, 2, 3]) }]);
  assert.equal(data.readUInt32LE(0), 0x04034b50);
  const nameLen = data.readUInt16LE(26);
  assert.equal(data.subarray(30, 30 + nameLen).toString('utf8'), 'Zettel/ä.md');
  const size = data.readUInt32LE(18);
  const body = data.subarray(30 + nameLen, 30 + nameLen + size);
  assert.equal(inflateRawSync(body).toString(), 'hallo '.repeat(100));
  // End of central directory: two entries
  assert.equal(data.readUInt32LE(data.length - 22), 0x06054b50);
  assert.equal(data.readUInt16LE(data.length - 12), 2);
});

test('a file is deleted through a sync, and other devices learn about it', () => {
  const { notes, me, other } = setup();
  const id = randomUUID();
  const fileId = randomUUID();
  const base = notes.sync(me, { changes: [create(id)] }).answer.seq;
  notes.addFile(me, { id: fileId, note_id: id, name: 'a.pdf', type: 'application/pdf', size: 3 });
  // Someone else can't
  const theirs = notes.sync(other, { changes: [{ kind: 'file', id: fileId, patch: { purge: true } }] }).answer;
  assert.equal(theirs.rejected[0].error, 'bad_id');
  const { answer, removedFiles } = notes.sync(me, { since: base, changes: [{ kind: 'file', id: fileId, patch: { purge: true } }] });
  assert.deepEqual(removedFiles, [fileId]);
  assert.equal(answer.items.file.at(-1).purged, true);
  assert.equal(notes.fileFor(me, fileId), null);
});
