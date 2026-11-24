import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaOut, cleanAreaPatch } from './areas.js';

const label = (v) => {
  if (typeof v !== 'string') throw new Error('bad');
  return v.trim();
};

test('an area patch keeps a clean name and its members once each', () => {
  const out = cleanAreaPatch({ name: '  Arbeit ', members: ['Arbeit', ' arbeit', '', 'Ideen'], position: 2 }, label);
  assert.deepEqual(out, { name: 'Arbeit', members: ['Arbeit', 'Ideen'], position: 2 });
});

test('an area needs a name, and members a list', () => {
  assert.throws(() => cleanAreaPatch({ name: '   ' }, label), { code: 'bad_name' });
  assert.throws(() => cleanAreaPatch({ members: 'Arbeit' }, label), { code: 'bad_members' });
  assert.throws(() => cleanAreaPatch({ position: 'first' }, label), { code: 'bad_position' });
});

test('an area goes out with its members as a list', () => {
  const row = { id: 'a', name: 'Zuhause', position: 1, members: '["Privat"]', created_at: 'x', updated_at: 'y', deleted_at: null, purged: 0, seq: 3 };
  assert.deepEqual(areaOut(row).members, ['Privat']);
});
