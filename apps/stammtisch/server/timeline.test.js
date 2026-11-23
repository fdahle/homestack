import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'stammtisch-timeline-'));
const { createEvent, timeline } = await import('./db.js');

test('the timeline holds what happened; a plan cancelled ahead of time joins it on its day', () => {
  const today = '2026-11-13';
  const add = (title, status, date) => createEvent({ title, kind: 'meet', status, date }, []);
  add('done', 'done', '2026-11-01');
  add('passed plan', 'planned', '2026-11-10');
  add('cancelled before', 'cancelled', '2026-11-05');
  add('cancelled today', 'cancelled', today);
  add('cancelled ahead', 'cancelled', '2026-12-24');
  add('coming up', 'planned', '2026-11-20');
  add('idea', 'idea', null);

  assert.deepEqual(timeline({ today }).map((e) => e.title), ['cancelled today', 'passed plan', 'cancelled before', 'done']);
  assert.ok(timeline({ today: '2026-12-24' }).some((e) => e.title === 'cancelled ahead'));
});
