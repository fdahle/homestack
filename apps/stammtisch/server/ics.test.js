import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendar, escape } from './ics.js';

// Folded lines joined again, so a test can look for a whole property
const unfold = (ics) => ics.replace(/\r\n /g, '');

const anna = { id: 1, name: 'Anna Schmidt', nickname: 'Anni', birthday: '1990-11-20', archived: false };
const ben = { id: 2, name: 'Ben Meyer', nickname: null, birthday: '--02-29', archived: false };

test('an event says who is coming, but leaves its notes out', () => {
  const events = [{
    id: 7, title: 'Kochen', date: '2026-12-01', time: '19:30', place: 'Bei Anna',
    status: 'planned', notes: '[01.12.26, 10:00] Anna: secret chat\nline two', friends: [anna, ben],
  }];
  const ics = unfold(buildCalendar({ events, friends: [], lang: 'en' }));
  assert.match(ics, /SUMMARY:Kochen \(Anni\\, Ben\)/);
  assert.match(ics, /DESCRIPTION:with Anna Schmidt\\, Ben Meyer\r\n/);
  assert.doesNotMatch(ics, /secret chat/);
  assert.match(ics, /LOCATION:Bei Anna/);
});

test('an event without friends has no description, even with notes', () => {
  const events = [{ id: 8, title: 'Alone', date: '2026-12-02', status: 'done', notes: 'private', friends: [] }];
  const ics = buildCalendar({ events, friends: [] });
  assert.doesNotMatch(ics, /DESCRIPTION/);
  assert.doesNotMatch(ics, /private/);
});

test('birthdays keep the date but not the birth year', () => {
  const ics = unfold(buildCalendar({ events: [], friends: [anna, ben, { id: 3, name: 'Old', birthday: '1950-01-01', archived: true }] }));
  assert.match(ics, /SUMMARY:🎂 Anna Schmidt/);
  assert.match(ics, /DTSTART;VALUE=DATE:20001120/);
  assert.match(ics, /DTSTART;VALUE=DATE:20000229/);
  assert.match(ics, /DESCRIPTION:Geburtstag\r\n/);
  assert.doesNotMatch(ics, /1990/);
  assert.doesNotMatch(ics, /Old/);
});

test('escape turns every line break into \\n and drops other control characters', () => {
  assert.equal(escape('a\r\nb\nc\rd'), 'a\\nb\\nc\\nd');
  assert.equal(escape('x\u0000y\u0007z\u001b\u007f'), 'xyz');
  assert.equal(escape('a;b,c\\d\te'), 'a\\;b\\,c\\\\d\te');
});

test('a lone carriage return in a title cannot start a property of its own', () => {
  const events = [{ id: 9, title: 'Party\rATTENDEE:mailto:x@example.org', date: '2026-12-03', status: 'planned', friends: [] }];
  const ics = buildCalendar({ events, friends: [] });
  assert.ok(ics.split('\r\n').every((line) => !line.startsWith('ATTENDEE')));
  assert.doesNotMatch(ics.replace(/\r\n/g, ''), /\r/);
});
