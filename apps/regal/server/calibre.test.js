import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calibreAuthor, calibreChanges, calibreYear, planSync, readLibrary } from './calibre.js';
import { fakeJpeg, makeCalibreLibrary } from './calibre-fixture.js';

test('Calibre dates', () => {
  assert.equal(calibreYear('2005-03-15 00:00:00+00:00'), 2005);
  // 1 January 2005 in Germany, stored in UTC
  assert.equal(calibreYear('2004-12-31 23:00:00+00:00'), 2005);
  assert.equal(calibreYear('0101-01-01 00:00:00+00:00'), null);
  assert.equal(calibreYear(null), null);
  assert.equal(calibreYear('kaputt'), null);
});

test('reads a Calibre library from a copy of metadata.db', async (t) => {
  const lib = mkdtempSync(join(tmpdir(), 'regal-calibre-'));
  const work = mkdtempSync(join(tmpdir(), 'regal-work-'));
  t.after(() => {
    rmSync(lib, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  });
  makeCalibreLibrary(lib, [
    {
      id: 1, title: 'Die Farben der Magie', authors: ['Terry Pratchett'], series: 'Scheibenwelt', seriesIndex: 1, pubdate: '1991-12-31 23:00:00+00:00',
      isbn: '3-442-41541-1', google: 'abcDEF123', comments: '<p>Rincewind &amp; Zweiblum.</p>', publisher: 'Goldmann', lang: 'deu',
      tags: ['Fantasy', 'Humor'], formats: ['EPUB', 'PDF'], pages: 288, read: true, cover: fakeJpeg(1), uuid: 'u-1',
    },
    { id: 2, title: 'Good Omens', authors: ['Terry Pratchett', 'Neil Gaiman'], uuid: 'u-2', seriesIndex: 1 },
  ]);

  const [a, b] = await readLibrary(lib, work);
  assert.deepEqual({ ...a, cover: undefined }, {
    calibre_id: 1,
    calibre_uuid: 'u-1',
    title: 'Die Farben der Magie',
    authors: ['Terry Pratchett'],
    series: 'Scheibenwelt',
    series_index: 1,
    year: 1992,
    publisher: 'Goldmann',
    pages: 288,
    isbns: ['9783442415410'],
    language: 'de',
    description: 'Rincewind & Zweiblum.',
    tags: ['Fantasy', 'Humor'],
    formats: ['EPUB', 'PDF'],
    google_id: 'abcDEF123',
    cover: undefined,
    read: true,
  });
  assert.equal(a.cover, join(lib, 'Terry Pratchett', 'Die Farben der Magie (1)', 'cover.jpg'));
  // Authors in Calibre's order; no series means no series number either
  assert.deepEqual(b.authors, ['Terry Pratchett', 'Neil Gaiman']);
  assert.equal(b.series, null);
  assert.equal(b.series_index, null);
  assert.equal(b.year, null);
  assert.equal(b.cover, null);
  // Not marked in Calibre's read column
  assert.equal(b.read, false);
  assert.deepEqual(b.isbns, []);
  // The copy is gone again; the library itself is untouched
  assert.deepEqual(readdirSync(work), []);
});

test('no library, no books', async () => {
  await assert.rejects(readLibrary(join(tmpdir(), 'regal-no-such-library'), tmpdir()), { code: 'calibre_not_found' });
});

// --- the sync rules, without a database ---

const calibreBook = (over = {}) => ({
  calibre_id: 1, calibre_uuid: 'u-1', title: 'Die Farben der Magie', authors: ['Terry Pratchett'], series: 'Scheibenwelt', series_index: 1,
  year: 1992, publisher: 'Goldmann', pages: null, isbns: ['9783442415410'], language: 'de', description: 'Rincewind.', tags: [], formats: ['EPUB'],
  google_id: null, cover: null, ...over,
});

test("author names: Calibre's '|' for a comma, last name first turned round", () => {
  assert.equal(calibreAuthor('Camilleri| Andrea'), 'Andrea Camilleri');
  assert.equal(calibreAuthor('Tolkien| J. R. R.'), 'J. R. R. Tolkien');
  assert.equal(calibreAuthor('Terry Pratchett'), 'Terry Pratchett');
  assert.equal(calibreAuthor('Martin Luther King| Jr.'), 'Martin Luther King, Jr.');
  assert.equal(calibreAuthor('Henry VIII| III'), 'Henry VIII, III');
  // More than one comma: no way to tell what is what, so it stays
  assert.equal(calibreAuthor('King| Jr.| Martin Luther'), 'King, Jr., Martin Luther');
  assert.equal(calibreAuthor('  Camilleri |  Andrea '), 'Andrea Camilleri');
});

test("without a setting, new Calibre books are ones you have and haven't read", () => {
  assert.equal(planSync([calibreBook()], []).add[0].status, 'unread');
});

test('new Calibre books are added with the default status', () => {
  const plan = planSync([calibreBook()], [], { defaultStatus: 'read' });
  assert.equal(plan.add.length, 1);
  assert.equal(plan.add[0].status, 'read');
  assert.equal(plan.add[0].in_calibre, 1);
  assert.equal(plan.add[0].source, 'calibre');
  assert.equal(plan.add[0].cover, undefined);
});

test('a later sync updates the details but never your entries', () => {
  const regal = {
    id: 7, calibre_uuid: 'u-1', calibre_id: 1, in_calibre: 1, title: 'Die Farben der Magie', authors: ['Terry Pratchett'], series: 'Scheibenwelt', series_index: 1,
    year: 1992, publisher: 'Goldmann', pages: 300, isbns: ['9783442415410'], language: 'de', description: 'Your own better text', tags: [], formats: ['EPUB'],
    status: 'reading', rating: 9, notes: 'Mine', current_page: 120,
  };
  // Unchanged: nothing to write
  assert.deepEqual(planSync([calibreBook({ description: null })], [regal]), { add: [], update: [], gone: [], unchanged: 1 });

  const plan = planSync([calibreBook({ title: 'Die Farben der Magie (Neuausgabe)', description: null, formats: ['EPUB', 'MOBI'], status: 'want' })], [regal]);
  assert.equal(plan.update.length, 1);
  assert.deepEqual(plan.update[0], { id: 7, linked: false, fields: { title: 'Die Farben der Magie (Neuausgabe)', formats: ['EPUB', 'MOBI'] } });
  // Calibre has no page count: yours stays (pages is not in the changes)
  assert.ok(!('pages' in calibreChanges(regal, calibreBook({ pages: null }))));
});

test('a book you added yourself is linked by ISBN instead of added twice', () => {
  const mine = { id: 3, calibre_uuid: null, in_calibre: 0, title: 'The Colour of Magic', authors: ['Terry Pratchett'], isbns: ['9780552124751', '9783442415410'], tags: [], formats: [] };
  const plan = planSync([calibreBook()], [mine]);
  assert.equal(plan.add.length, 0);
  assert.equal(plan.update[0].id, 3);
  assert.equal(plan.update[0].linked, true);
  assert.equal(plan.update[0].fields.calibre_uuid, 'u-1');
  assert.equal(plan.update[0].fields.in_calibre, 1);
  assert.equal(plan.update[0].fields.title, 'Die Farben der Magie');
});

test('or by title and author when neither has an ISBN', () => {
  const mine = { id: 4, calibre_uuid: null, title: 'Die Farben der Magie!', authors: ['T. Pratchett'], isbns: [] };
  assert.equal(planSync([calibreBook({ isbns: [] })], [mine]).update[0]?.id, 4);
  // Both have ISBNs and none match: another edition, so a book of its own
  const other = { ...mine, isbns: ['9780552124751'] };
  assert.equal(planSync([calibreBook()], [other]).add.length, 1);
});

test('books gone from Calibre stay, marked as gone, and come back', () => {
  const regal = [
    { id: 1, calibre_uuid: 'u-1', in_calibre: 1, title: 'Die Farben der Magie', authors: ['Terry Pratchett'], isbns: ['9783442415410'] },
    { id: 2, calibre_uuid: 'u-gone', in_calibre: 1, title: 'Weg', authors: [], isbns: [] },
    { id: 3, calibre_uuid: 'u-long-gone', in_calibre: 0, title: 'Längst weg', authors: [], isbns: [] },
  ];
  const plan = planSync([calibreBook()], regal);
  assert.deepEqual(plan.gone, [2]);
  const back = planSync([calibreBook({ calibre_uuid: 'u-long-gone', calibre_id: 9, title: 'Längst weg', authors: [], isbns: [], series: null, year: null, publisher: null, language: null, description: null })], regal);
  assert.deepEqual(back.update.find((u) => u.id === 3).fields, { calibre_id: 9, in_calibre: 1, formats: ['EPUB'] });
});

test('a book deleted and added again in Calibre (new uuid) finds its old entry by ISBN', () => {
  const regal = [{ id: 5, calibre_uuid: 'u-old', in_calibre: 1, title: 'Die Farben der Magie', authors: ['Terry Pratchett'], isbns: ['9783442415410'], tags: [], formats: ['EPUB'] }];
  const plan = planSync([calibreBook({ calibre_uuid: 'u-new', calibre_id: 12 })], regal);
  assert.equal(plan.add.length, 0);
  assert.deepEqual(plan.gone, []);
  assert.equal(plan.update[0].fields.calibre_uuid, 'u-new');
});

test("Calibre's read mark: new books come in as read, and a book you only wanted to read becomes read", () => {
  const added = planSync([calibreBook({ read: true })], [], { defaultStatus: 'want' });
  assert.equal(added.add[0].status, 'read');
  assert.ok(!('read' in added.add[0]));
  assert.equal(planSync([calibreBook({ read: false })], [], { defaultStatus: 'want' }).add[0].status, 'want');

  const mine = (status) => ({ ...calibreBook(), id: 7, in_calibre: 1, status });
  assert.deepEqual(planSync([calibreBook({ read: true })], [mine('want')]).update[0].fields, { status: 'read' });
  assert.deepEqual(planSync([calibreBook({ read: true })], [mine('unread')]).update[0].fields, { status: 'read' });
  // Reading, dropped or read already: Calibre doesn't change it, and an unread mark never takes "read" away
  for (const status of ['reading', 'dropped', 'read']) assert.equal(planSync([calibreBook({ read: true })], [mine(status)]).unchanged, 1);
  assert.equal(planSync([calibreBook({ read: false })], [mine('read')]).unchanged, 1);
});

test('the test library: folder names as Calibre makes them, ids that stay when a book is left out', async (t) => {
  const lib = mkdtempSync(join(tmpdir(), 'regal-calibre-'));
  const work = mkdtempSync(join(tmpdir(), 'regal-work-'));
  t.after(() => {
    rmSync(lib, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  });
  const odd = { title: 'Was ist was? Band 1: Sterne <und> Planeten', authors: ['Rainer Köthe'], cover: fakeJpeg(3), uuid: 'u-odd' };
  const other = { title: 'Good Omens', authors: ['Terry Pratchett'], uuid: 'u-omens' };
  makeCalibreLibrary(lib, [other, odd]);
  const before = await readLibrary(lib, work);
  const book = before.find((b) => b.calibre_uuid === 'u-odd');
  assert.equal(book.title, odd.title);
  assert.ok(readdirSync(join(book.cover, '..')).includes('cover.jpg'));

  makeCalibreLibrary(lib, [odd]);
  const [after] = await readLibrary(lib, work);
  assert.equal(after.calibre_id, book.calibre_id);
});
