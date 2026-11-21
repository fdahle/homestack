// The whole Calibre sync against a fixture library and a fresh Regal database in a temp folder
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeJpeg, makeCalibreLibrary } from './calibre-fixture.js';

const dataDir = mkdtempSync(join(tmpdir(), 'regal-data-'));
const lib = mkdtempSync(join(tmpdir(), 'regal-library-'));
process.env.DATA_DIR = dataDir;
const store = await import('./db.js');
const { syncCalibre } = await import('./sync.js');

test.after(() => {
  store.db.close();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(lib, { recursive: true, force: true });
});

const COLOUR = { title: 'Die Farben der Magie', authors: ['Terry Pratchett'], isbn: '3442415411', uuid: 'u-1', series: 'Scheibenwelt', seriesIndex: 1, cover: fakeJpeg(1), formats: ['EPUB'] };
const OMENS = { title: 'Good Omens', authors: ['Terry Pratchett', 'Neil Gaiman'], uuid: 'u-2', comments: '<p>Das Ende naht.</p>' };
const SWARM = { title: 'Der Schwarm', authors: ['Frank Schätzing'], isbn: '9783462033748', uuid: 'u-3', pages: 992, cover: fakeJpeg(3) };
const byUuid = (uuid) => store.allBooks().find((b) => b.calibre_uuid === uuid);

test('a missing library is an error in the result, not a crash', async () => {
  const result = await syncCalibre({ library: join(lib, 'nope') });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'calibre_not_found');
});

test('first sync: new books, linked ones, covers', async () => {
  // You added "Der Schwarm" yourself before, with the ISBN
  const mine = store.insertBook({ source: 'manual', title: 'Schwarm', authors: ['F. Schätzing'], isbns: ['9783462033748'], status: 'read', rating: 8 });
  store.users.setSetting('calibre_default_status', 'want');
  makeCalibreLibrary(lib, [COLOUR, OMENS, SWARM]);

  const result = await syncCalibre({ library: lib });
  assert.equal(result.ok, true, result.message);
  assert.deepEqual({ total: result.total, added: result.added, linked: result.linked, gone: result.gone, covers: result.covers }, { total: 3, added: 2, linked: 1, gone: 0, covers: 2 });

  const colour = byUuid('u-1');
  assert.equal(colour.status, 'want');
  assert.equal(colour.in_calibre, 1);
  assert.equal(colour.series, 'Scheibenwelt');
  assert.deepEqual(colour.formats, ['EPUB']);
  assert.equal(colour.cover_source, 'calibre');
  assert.deepEqual(readFileSync(join(store.COVER_DIR, colour.cover_file)), fakeJpeg(1));
  assert.equal(byUuid('u-2').description, 'Das Ende naht.');

  const swarm = store.getBook(mine);
  assert.equal(swarm.calibre_uuid, 'u-3');
  assert.equal(swarm.title, 'Der Schwarm');
  assert.equal(swarm.pages, 992);
  assert.equal(swarm.status, 'read');
  assert.equal(swarm.rating, 8);
  assert.equal(store.allBooks().length, 3);
});

test('later syncs: Calibre details change, your entries and your photo stay', async () => {
  const colour = byUuid('u-1');
  store.updateBook(colour.id, { status: 'reading', rating: 7, current_page: 50, notes: 'Rincewind!', started_on: '2026-11', pages: 288 });
  const swarm = byUuid('u-3');
  store.updateBook(swarm.id, { cover_file: 'my-photo.jpg', cover_source: 'photo' });
  const changedAt = store.getBook(colour.id).updated_at;

  makeCalibreLibrary(lib, [
    { ...COLOUR, title: 'Die Farben der Magie (Neuausgabe)', formats: ['EPUB', 'PDF'], cover: fakeJpeg(9) },
    OMENS,
    { ...SWARM, cover: fakeJpeg(4) },
  ]);
  const result = await syncCalibre({ library: lib });
  assert.equal(result.ok, true);
  assert.equal(result.updated, 1);
  assert.equal(result.added, 0);

  const after = store.getBook(colour.id);
  assert.equal(after.title, 'Die Farben der Magie (Neuausgabe)');
  assert.deepEqual(after.formats, ['EPUB', 'PDF']);
  assert.deepEqual({ status: after.status, rating: after.rating, current_page: after.current_page, notes: after.notes, started_on: after.started_on, pages: after.pages },
    { status: 'reading', rating: 7, current_page: 50, notes: 'Rincewind!', started_on: '2026-11', pages: 288 });
  // A sync isn't your change
  assert.equal(after.updated_at, changedAt);
  // The new cover.jpg replaced the old copy
  assert.notEqual(after.cover_file, colour.cover_file);
  assert.ok(!existsSync(join(store.COVER_DIR, colour.cover_file)));
  assert.deepEqual(readFileSync(join(store.COVER_DIR, after.cover_file)), fakeJpeg(9));
  // Your photo is never replaced
  assert.equal(store.getBook(swarm.id).cover_file, 'my-photo.jpg');
});

test('books gone from Calibre stay in Regal, marked, and deleted ones can be left out', async () => {
  makeCalibreLibrary(lib, [COLOUR, SWARM]);
  let result = await syncCalibre({ library: lib });
  assert.equal(result.gone, 1);
  const omens = byUuid('u-2');
  assert.equal(omens.in_calibre, 0);
  assert.equal(store.allBooks().length, 3);

  // Back again
  makeCalibreLibrary(lib, [COLOUR, OMENS, SWARM]);
  result = await syncCalibre({ library: lib });
  assert.equal(byUuid('u-2').in_calibre, 1);

  // Deleted in Regal: left out of later syncs
  store.deleteBook(omens.id);
  result = await syncCalibre({ library: lib, ignored: new Set(['u-2']) });
  assert.equal(result.added, 0);
  assert.equal(byUuid('u-2'), undefined);
});
