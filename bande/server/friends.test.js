import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextBirthday, overdueFriends, upcomingBirthdays } from './friends.js';

test('next birthday, with and without a year', () => {
  assert.deepEqual(nextBirthday('1990-11-20', '2026-11-13'), { date: '2026-11-20', days: 7, age: 36 });
  assert.deepEqual(nextBirthday('--11-13', '2026-11-13'), { date: '2026-11-13', days: 0, age: null });
  assert.deepEqual(nextBirthday('1990-01-05', '2026-11-13'), { date: '2027-01-05', days: 53, age: 37 });
  assert.equal(nextBirthday('', '2026-11-13'), null);
});

test('29 February is celebrated on the 28th in other years', () => {
  assert.equal(nextBirthday('2000-02-29', '2026-11-13').date, '2027-02-28');
  assert.equal(nextBirthday('2000-02-29', '2027-11-13').date, '2028-02-29');
});

test('upcoming birthdays skip archived friends', () => {
  const friends = [
    { id: 1, birthday: '1990-11-20', archived: false },
    { id: 2, birthday: '1990-11-14', archived: true },
    { id: 3, birthday: '1990-03-01', archived: false },
  ];
  assert.deepEqual(upcomingBirthdays(friends, '2026-11-13').map((b) => b.friend.id), [1]);
});

test('overdue friends', () => {
  const base = { archived: false, created_at: '2026-01-01T10:00:00Z', next_plan: null };
  const friends = [
    { ...base, id: 1, contact_weeks: 4, last_contact: '2026-10-01' },
    { ...base, id: 2, contact_weeks: 4, last_contact: '2026-11-01' },
    { ...base, id: 3, contact_weeks: 2, last_contact: null },
    { ...base, id: 4, contact_weeks: 4, last_contact: '2026-09-01', next_plan: '2026-11-20' },
    { ...base, id: 5, contact_weeks: null, last_contact: '2020-01-01' },
  ];
  const overdue = overdueFriends(friends, '2026-11-13');
  assert.deepEqual(overdue.map((o) => o.friend.id), [3, 1]);
  assert.equal(overdue[1].days, 43);
  assert.equal(overdue[0].days, null);
});
