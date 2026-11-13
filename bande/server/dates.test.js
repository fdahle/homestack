import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDateTime, looksLikePlan } from './dates.js';

// Friday, 13 November 2026, 17:00
const ref = new Date(2026, 10, 13, 17, 0);
const found = (text, r = ref) => findDateTime(text, r);

test('weekdays are the next one coming', () => {
  assert.deepEqual(found('Samstag 19 Uhr?'), { date: '2026-11-14', time: '19:00' });
  assert.deepEqual(found('Kino am Mittwoch?'), { date: '2026-11-18', time: null });
  assert.deepEqual(found('nächsten Freitag um halb 8'), { date: '2026-11-20', time: '19:30' });
  assert.deepEqual(found('übernächsten Samstag'), { date: '2026-11-21', time: null });
  assert.deepEqual(found('Sa 20:30'), { date: '2026-11-14', time: '20:30' });
  assert.equal(found('Samstagabend grillen').date, '2026-11-14');
});

test('short weekday forms only count before a time', () => {
  assert.equal(found('So ein Quatsch').date, null);
  assert.equal(found('Do you want to come?').date, null);
  assert.equal(found('Do 19 Uhr').date, '2026-11-19');
});

test('numeric and written dates', () => {
  assert.equal(found('am 24.11.').date, '2026-11-24');
  assert.equal(found('24.11.2027 passt').date, '2027-11-24');
  assert.equal(found('am 24.11.27').date, '2027-11-24');
  assert.equal(found('2026-12-31').date, '2026-12-31');
  assert.equal(found('24. Dezember bei Oma').date, '2026-12-24');
  assert.equal(found('Nov 24th?').date, '2026-11-24');
  assert.equal(found('on the 3rd of March').date, '2027-03-03');
  assert.equal(found('24/11').date, '2026-11-24');
});

test('a date without a year is the next one, unless it was just recently', () => {
  assert.equal(found('am 2.1.').date, '2027-01-02');
  assert.equal(found('am 1.10. war schön').date, '2026-10-01');
});

test('relative days', () => {
  assert.equal(found('morgen?').date, '2026-11-14');
  assert.equal(found('übermorgen').date, '2026-11-15');
  assert.equal(found('heute Abend um 8').date, '2026-11-13');
  assert.equal(found('tomorrow at 7pm').time, '19:00');
  assert.equal(found('in zwei Wochen').date, '2026-11-27');
  assert.equal(found('in 3 days').date, '2026-11-16');
  assert.equal(found('am Wochenende grillen?').date, '2026-11-14');
  assert.equal(found('Guten Morgen! Lust auf Kino?').date, null);
});

test('weekends', () => {
  const saturday = new Date(2026, 10, 14, 12);
  const sunday = new Date(2026, 10, 15, 12);
  assert.equal(found('am Wochenende', saturday).date, '2026-11-14');
  assert.equal(found('nächstes Wochenende', saturday).date, '2026-11-21');
  assert.equal(found('am Wochenende', sunday).date, '2026-11-21');
});

test('times', () => {
  assert.equal(found('19.30 Uhr').time, '19:30');
  assert.equal(found('um 7').time, '19:00');
  assert.equal(found('heute Abend um 8').time, '20:00');
  assert.equal(found('morgen früh um 8').time, '08:00');
  assert.equal(found('um 10').time, '10:00');
  assert.equal(found('viertel nach 7').time, '19:15');
  assert.equal(found('7:30 am').time, '07:30');
  assert.equal(found('12 pm').time, '12:00');
  assert.equal(found('nur so').time, null);
});

test('plans need a day and a reason', () => {
  assert.ok(looksLikePlan('Wollen wir Samstag grillen?', ref));
  assert.ok(looksLikePlan('Hast du morgen Zeit?', ref));
  assert.ok(looksLikePlan('Freitag 20 Uhr?', ref));
  assert.ok(!looksLikePlan('Ich war Samstag beim Arzt', ref));
  assert.ok(!looksLikePlan('Lust auf Kino?', ref));
});
