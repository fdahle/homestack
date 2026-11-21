import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localDate, openDatabase } from './db.js';
import { buildCalendar } from './ics.js';
import { createReminders, isValidPushEndpoint } from './reminders.js';
import { cleanRepeat, cleanTaskPatch } from './tasks.js';

function setup() {
  const store = openDatabase(':memory:');
  const me = store.users.createUser({ username: 'me', displayName: 'Me', passwordHash: 'x' });
  const other = store.users.createUser({ username: 'other', displayName: 'Other', passwordHash: 'x' });
  return { store, me, other };
}

const at = '2026-11-21T10:00:00.000Z';
const task = (id, fields = {}) => ({ kind: 'task', id, patch: { title: 'Task', created_at: at, updated_at: at, ...fields } });

test('a task written offline arrives with its subtasks, and comes back', () => {
  const { store, me } = setup();
  const id = randomUUID();
  const r = store.tasks.sync(me, { since: 0, changes: [task(id, { title: 'Umzug', priority: 3, subtasks: [{ id: 'a', title: 'Kartons', done: false }], due_date: '2026-11-22' })] });
  assert.equal(r.items.task.length, 1);
  assert.equal(r.items.task[0].priority, 3);
  assert.deepEqual(r.items.task[0].subtasks, [{ id: 'a', title: 'Kartons', done: false }]);
  assert.equal(r.items.task[0].remind, true);
  assert.deepEqual(r.rejected, []);
});

test('the latest change per field wins, since only returns what changed', () => {
  const { store, me } = setup();
  const id = randomUUID();
  const list = randomUUID();
  const first = store.tasks.sync(me, { changes: [task(id), { kind: 'list', id: list, patch: { name: 'Haushalt', position: 1 } }] });
  assert.equal(first.items.list[0].name, 'Haushalt');
  store.tasks.sync(me, { changes: [{ kind: 'task', id, patch: { title: 'Neu' } }] });
  const later = store.tasks.sync(me, { since: first.seq, changes: [{ kind: 'task', id, patch: { done_at: at, list_id: list } }] });
  assert.deepEqual(later.items.list, []);
  assert.equal(later.items.task[0].title, 'Neu');
  assert.equal(later.items.task[0].done_at, at);
  assert.equal(later.items.task[0].list_id, list);
});

test("another user's task can't be changed or seen", () => {
  const { store, me, other } = setup();
  const id = randomUUID();
  store.tasks.sync(me, { changes: [task(id, { title: 'Meins' })] });
  const r = store.tasks.sync(other, { since: 0, changes: [{ kind: 'task', id, patch: { title: 'Deins' } }] });
  assert.deepEqual(r.items.task, []);
  assert.equal(r.rejected[0].error, 'bad_id');
  assert.equal(store.tasks.sync(me, { since: 0 }).items.task[0].title, 'Meins');
});

test('bad changes are rejected one by one', () => {
  const { store, me } = setup();
  const good = randomUUID();
  const r = store.tasks.sync(me, {
    changes: [task(good), { kind: 'task', id: randomUUID(), patch: { due_date: '2026-13-01' } }, { kind: 'nope', id: randomUUID(), patch: {} }, { kind: 'list', id: randomUUID(), patch: { name: '  ' } }],
  });
  assert.deepEqual(r.items.task.map((t) => t.id), [good]);
  assert.deepEqual(r.rejected.map((x) => x.error), ['bad_due_date', 'bad_kind', 'bad_name']);
});

test('deleted tasks go for good after the trash days', () => {
  const { store, me } = setup();
  const old = randomUUID();
  const recent = randomUUID();
  store.tasks.sync(me, { changes: [task(old, { deleted_at: '2026-01-01T00:00:00Z' }), task(recent, { deleted_at: new Date().toISOString() })] });
  store.tasks.emptyOldTrash(7);
  const all = store.tasks.sync(me, { since: 0 }).items.task;
  assert.equal(all.find((t) => t.id === old).purged, true);
  assert.equal(all.find((t) => t.id === recent).purged, undefined);
});

test('patches: repeats, subtasks, times checked', () => {
  assert.deepEqual(cleanRepeat({ unit: 'week', every: 1, weekdays: [5, 1, 1] }), { unit: 'week', every: 1, from: 'due', weekdays: [1, 5] });
  assert.deepEqual(cleanRepeat({ unit: 'month', day: 31, from: 'done' }), { unit: 'month', every: 1, from: 'done', day: 31 });
  assert.throws(() => cleanRepeat({ unit: 'hour' }), { code: 'bad_repeat' });
  assert.throws(() => cleanTaskPatch({ due_time: '25:00' }), { code: 'bad_due_time' });
  assert.throws(() => cleanTaskPatch({ priority: 4 }), { code: 'bad_priority' });
  assert.throws(() => cleanTaskPatch({ subtasks: [{ title: 'no id' }] }), { code: 'bad_subtasks' });
  assert.ok(Date.parse(cleanTaskPatch({ updated_at: '2999-01-01T00:00:00Z' }).updated_at) <= Date.now());
});

test('reminders: due tasks of accounts with a device, once a day the summary', () => {
  const { store, me, other } = setup();
  const reminders = createReminders(store);
  const now = new Date(2026, 10, 21, 9, 0);
  const today = localDate(now);
  const due = randomUUID();
  const later = randomUUID();
  const noRemind = randomUUID();
  store.tasks.sync(me, {
    changes: [
      task(due, { title: 'Zahnarzt', due_date: today, due_time: '08:45' }),
      task(later, { title: 'Später', due_date: today, due_time: '17:00' }),
      task(noRemind, { title: 'Still', due_date: today, due_time: '08:30', remind: false }),
    ],
  });
  store.tasks.sync(other, { changes: [task(randomUUID(), { due_date: today, due_time: '08:50' })] });
  store.push.save(me, { endpoint: 'https://fcm.googleapis.com/x', p256dh: 'k', auth: 'a' });

  const out = reminders.due(now);
  assert.deepEqual(out.map((r) => r.key).sort(), [`digest:${me}:${today}`, `task:${due}:${today}T08:45`]);
  const digest = out.find((r) => r.key.startsWith('digest'));
  assert.equal(digest.message.title, 'Heute: 3 Aufgaben');
  for (const r of out) store.push.markSent(r.key);
  assert.deepEqual(reminders.due(now), []);

  store.setUserSetting('digest', me, 'off');
  assert.equal(reminders.digestHour(me), null);
});

test('push endpoints: only the browsers’ push services', () => {
  assert.ok(isValidPushEndpoint('https://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(isValidPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
  assert.ok(!isValidPushEndpoint('https://evil.example/fcm.googleapis.com'));
  assert.ok(!isValidPushEndpoint('http://fcm.googleapis.com/x'));
});

test('calendar feed: whole days, timed tasks, folded lines', () => {
  const ics = buildCalendar({
    tasks: [
      { id: 'a', title: 'Müll', due_date: '2026-11-23', due_time: null, priority: 0, subtasks: [], note: '', list_id: 'l' },
      { id: 'b', title: 'Zahnarzt, Kontrolle', due_date: '2026-11-27', due_time: '14:30', priority: 3, subtasks: [{ title: 'Karte', done: false }], note: '', list_id: null },
    ],
    lists: new Map([['l', 'Haushalt']]),
    origin: 'https://tasks.example',
  });
  assert.match(ics, /DTSTART;VALUE=DATE:20261123\r\nDTEND;VALUE=DATE:20261124/);
  assert.match(ics, /DTSTART:20261127T143000\r\nDTEND:20261127T150000/);
  assert.match(ics, /SUMMARY:Zahnarzt\\, Kontrolle/);
  assert.match(ics, /PRIORITY:1/);
  assert.match(ics, /DESCRIPTION:Haushalt/);
  assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
});

test('calendar feed: each account has its own secret address', () => {
  const { store, me, other } = setup();
  const mine = store.icsToken(me);
  assert.equal(store.icsToken(me), mine);
  assert.equal(store.userByIcsToken(mine), me);
  assert.notEqual(store.icsToken(other), mine);
  store.resetIcsToken(me);
  assert.equal(store.userByIcsToken(mine), null);
});
