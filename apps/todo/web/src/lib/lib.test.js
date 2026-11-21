import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, nextWeekday, weekday } from './dates.js';
import { anchored, firstDue, nextDue, presetOf, PRESETS } from './repeat.js';
import { parseQuick } from './quick.js';

// 2026-11-21 is a Saturday
const today = '2026-11-21';

test('dates: weekdays and months', () => {
  assert.equal(weekday(today), 6);
  assert.equal(nextWeekday(today, 1), '2026-11-23');
  assert.equal(nextWeekday(today, 6), '2026-11-28');
  assert.equal(nextWeekday(today, 6, true), today);
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-02-28', 1, 31), '2026-03-31');
  assert.equal(addMonths('2026-11-15', 2), '2027-01-15');
});

test('repeat: daily, weekly, from the due date', () => {
  assert.equal(nextDue({ unit: 'day', every: 1 }, today, today), '2026-11-22');
  assert.equal(nextDue({ unit: 'week', every: 1 }, today, today), '2026-11-28');
  assert.equal(nextDue({ unit: 'week', every: 2 }, today, today), '2026-12-05');
});

test('repeat: overdue tasks skip to the first date after today', () => {
  // A daily task last due a week ago
  assert.equal(nextDue({ unit: 'day', every: 1 }, '2026-11-14', today), '2026-11-22');
  // Every Monday, due two Mondays ago
  assert.equal(nextDue({ unit: 'week', every: 1, weekdays: [1] }, '2026-11-09', today), '2026-11-23');
});

test('repeat: from the day it was done', () => {
  assert.equal(nextDue({ unit: 'day', every: 3, from: 'done' }, '2026-11-10', today), '2026-11-24');
});

test('repeat: weekdays', () => {
  const workdays = PRESETS.weekdays;
  assert.equal(nextDue(workdays, '2026-11-20', '2026-11-20'), '2026-11-23'); // Friday → Monday
  assert.equal(nextDue(workdays, '2026-11-23', '2026-11-23'), '2026-11-24');
  // Monday and Thursday, every second week
  const rule = { unit: 'week', every: 2, weekdays: [1, 4] };
  assert.equal(nextDue(rule, '2026-11-23', '2026-11-23'), '2026-11-26');
  assert.equal(nextDue(rule, '2026-11-26', '2026-11-26'), '2026-12-07');
});

test('repeat: monthly keeps its day through short months', () => {
  const rule = anchored({ unit: 'month', every: 1 }, '2026-01-31');
  assert.equal(rule.day, 31);
  assert.equal(nextDue(rule, '2026-01-31', '2026-01-31'), '2026-02-28');
  assert.equal(nextDue(rule, '2026-02-28', '2026-02-28'), '2026-03-31');
  const leap = anchored({ unit: 'year', every: 1 }, '2028-02-29');
  assert.equal(nextDue(leap, '2028-02-29', '2028-02-29'), '2029-02-28');
});

test('repeat: presets and the first date', () => {
  assert.equal(presetOf(null), 'none');
  assert.equal(presetOf({ unit: 'week', every: 1, weekdays: [1, 2, 3, 4, 5] }), 'weekdays');
  assert.equal(presetOf({ unit: 'day', every: 3 }), 'custom');
  assert.equal(firstDue(PRESETS.weekdays, today), '2026-11-23'); // Saturday → Monday
  assert.equal(firstDue(PRESETS.daily, today), today);
});

const lists = [{ id: 'l1', name: 'Haushalt' }, { id: 'l2', name: 'Arbeit' }, { id: 'l3', name: 'Arbeit privat' }];
const quick = (text, skip) => parseQuick(text, { today, lists, skip });

test('quick add: plain text stays plain', () => {
  assert.deepEqual(quick('Milch kaufen'), { title: 'Milch kaufen', fields: {}, chips: [] });
  assert.equal(quick('Mach das so').title, 'Mach das so');
  assert.deepEqual(quick('Wichtig!').fields, {});
});

test('quick add: dates', () => {
  assert.equal(quick('Milch kaufen morgen').fields.due_date, '2026-11-22');
  assert.equal(quick('Milch kaufen morgen').title, 'Milch kaufen');
  assert.equal(quick('Steuer übermorgen').fields.due_date, '2026-11-23');
  assert.equal(quick('Anrufen am Freitag').fields.due_date, '2026-11-27');
  assert.equal(quick('Anrufen am Freitag').title, 'Anrufen');
  assert.equal(quick('call mom next friday').fields.due_date, '2026-11-27');
  assert.equal(quick('Geschenke 24.12.').fields.due_date, '2026-12-24');
  assert.equal(quick('Steuer 31.5.').fields.due_date, '2027-05-31'); // passed this year: next year
  assert.equal(quick('Urlaub 3.1.2027').fields.due_date, '2027-01-03');
  assert.equal(quick('Reifen in 2 Wochen').fields.due_date, '2026-12-05');
  assert.equal(quick('Aufräumen am Wochenende').fields.due_date, today);
  assert.equal(quick('Plan nächste Woche').fields.due_date, '2026-11-23');
  assert.equal(quick('Nichts 31.2.').fields.due_date, undefined);
});

test('quick add: times, with and without a date', () => {
  const z = quick('Zahnarzt Fr 14:30 !!');
  assert.deepEqual(z.fields, { due_date: '2026-11-27', due_time: '14:30', priority: 2 });
  assert.equal(z.title, 'Zahnarzt');
  assert.deepEqual(quick('Report 24.12. um 9').fields, { due_date: '2026-12-24', due_time: '09:00' });
  assert.deepEqual(quick('Call at 3pm').fields, { due_date: today, due_time: '15:00' });
  assert.equal(quick('Treffen 18 Uhr').fields.due_time, '18:00');
});

test('quick add: priority, list, repeat', () => {
  const m = quick('Müll rausbringen jeden Montag #haus !!!');
  assert.equal(m.title, 'Müll rausbringen');
  assert.deepEqual(m.fields.repeat, { unit: 'week', every: 1, weekdays: [1] });
  assert.equal(m.fields.due_date, '2026-11-23');
  assert.equal(m.fields.list_id, 'l1');
  assert.equal(m.fields.priority, 3);
  assert.equal(quick('Plan #arbeit').fields.list_id, 'l2');
  assert.equal(quick('Plan #nirgends').title, 'Plan #nirgends');
  assert.deepEqual(quick('Pflanzen gießen alle 3 Tage').fields, { repeat: { unit: 'day', every: 3 }, due_date: today });
  assert.deepEqual(quick('Vitamine täglich').fields.repeat, { unit: 'day', every: 1 });
});

test('quick add: a tapped-away chip keeps its words', () => {
  const r = quick('Guten Morgen sagen', ['date']);
  assert.equal(r.title, 'Guten Morgen sagen');
  assert.deepEqual(r.fields, {});
});
