import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequest, cleanGameInput, datesForStatusChange, datesInOrder, fromIgdb, igdbLink, isPartialDate, searchHit } from './games.js';

test('partial dates', () => {
  for (const ok of ['2020', '2020-02', '2020-02-29', '1985-12-31']) assert.ok(isPartialDate(ok), ok);
  for (const bad of ['20', '2020-13', '2021-02-29', '2020-1', '2020-01-32', '1800', 'gestern', '']) assert.ok(!isPartialDate(bad), bad);
});

test('dates in order, as far as both go', () => {
  assert.ok(datesInOrder('2020', '2020-05-01'));
  assert.ok(datesInOrder('2020-05-10', '2020-05'));
  assert.ok(datesInOrder('2020-05-10', '2020-05-10'));
  assert.ok(datesInOrder(null, '2019'));
  assert.ok(!datesInOrder('2020-05', '2020-03-01'));
  assert.ok(!datesInOrder('2021', '2020'));
});

test('cleanGameInput keeps what changed and checks it', () => {
  assert.deepEqual(cleanGameInput({ status: 'finished', rating: 8, playedOn: ['Switch', ' PC ', 'Switch', ''], notes: '' }), {
    status: 'finished', rating: 8, played_on: ['Switch', 'PC'], notes: null,
  });
  // One name (older apps, the form for a game entered by hand) is a list of one; empty is none
  assert.deepEqual(cleanGameInput({ playedOn: ' Switch ' }), { played_on: ['Switch'] });
  assert.deepEqual(cleanGameInput({ playedOn: '' }), { played_on: [] });
  assert.throws(() => cleanGameInput({ playedOn: 5 }), BadRequest);
  assert.deepEqual(cleanGameInput({ rating: null, finishedOn: '' }), { rating: null, finished_on: null });
  assert.throws(() => cleanGameInput({ status: 'beaten' }), BadRequest);
  assert.throws(() => cleanGameInput({ rating: 11 }), BadRequest);
  assert.throws(() => cleanGameInput({ rating: 3.5 }), BadRequest);
  assert.throws(() => cleanGameInput({ startedOn: '2020-14' }), BadRequest);
});

test('catalog fields only for games entered by hand', () => {
  assert.deepEqual(cleanGameInput({ name: 'Hacked', platforms: ['X'] }), {});
  assert.deepEqual(cleanGameInput({ name: ' Tetris ', platforms: ['Game Boy', 'Game Boy', ''], releaseDate: '1989' }, { manual: true }), {
    name: 'Tetris', platforms: ['Game Boy'], release_date: '1989',
  });
  assert.throws(() => cleanGameInput({ name: '  ' }, { manual: true }), BadRequest);
});

test('dates filled in when the status changes', () => {
  const today = '2026-11-20';
  assert.deepEqual(datesForStatusChange({ status: 'backlog' }, 'playing', today), { started_on: today });
  assert.deepEqual(datesForStatusChange({ status: 'playing', started_on: '2026-10' }, 'finished', today), { finished_on: today });
  // Not when it was never marked as playing, and never over a date you entered
  assert.deepEqual(datesForStatusChange({ status: 'backlog' }, 'finished', today), {});
  assert.deepEqual(datesForStatusChange({ status: 'playing', finished_on: '2026' }, 'dropped', today), {});
  assert.deepEqual(datesForStatusChange({ status: 'playing', started_on: '2025' }, 'playing', today), {});
});

test('IGDB game → database fields', () => {
  const game = fromIgdb({
    id: 1942,
    name: 'The Witcher 3: Wild Hunt',
    slug: 'the-witcher-3-wild-hunt',
    url: 'https://www.igdb.com/games/the-witcher-3-wild-hunt',
    first_release_date: 1431993600,
    cover: { image_id: 'co1wyy' },
    platforms: [{ name: 'PC (Microsoft Windows)', abbreviation: 'PC' }, { name: 'Nintendo Switch', abbreviation: 'Switch' }, { name: 'Stadia' }],
    genres: [{ name: 'Role-playing (RPG)' }, { name: 'Adventure' }],
    involved_companies: [
      { developer: true, company: { name: 'CD Projekt RED' } },
      { developer: false, company: { name: 'Bandai Namco' } },
    ],
    collections: [{ name: 'The Witcher' }],
  }, { hastily: 120000, normally: 186000, completely: 621000 });
  assert.equal(game.release_date, '2015-05-19');
  assert.deepEqual(game.platforms, ['PC', 'Switch', 'Stadia']);
  assert.deepEqual(game.genres, ['Role-playing (RPG)', 'Adventure']);
  assert.equal(game.developer, 'CD Projekt RED');
  assert.equal(game.franchise, 'The Witcher');
  assert.equal(game.hours_main, 51.5);
  assert.equal(game.hours_complete, 172.5);
  assert.equal(game.igdb_cover_id, 'co1wyy');
  assert.equal(game.igdb_url, 'https://www.igdb.com/games/the-witcher-3-wild-hunt');
});

test('only https links to IGDB are kept', () => {
  assert.equal(fromIgdb({ id: 1, name: 'X', url: 'javascript:alert(1)' }).igdb_url, null);
  assert.equal(igdbLink('https://igdb.com/games/x'), 'https://igdb.com/games/x');
  for (const bad of ['http://www.igdb.com/games/x', 'https://evil.example/', 'https://igdb.com.evil.example/', 'data:text/html,hi', '', null]) {
    assert.equal(igdbLink(bad), null, String(bad));
  }
});

test('IGDB game with almost nothing', () => {
  const game = fromIgdb({ id: 5, name: 'Obscure' });
  assert.equal(game.release_date, null);
  assert.deepEqual(game.platforms, []);
  assert.equal(game.developer, null);
  assert.equal(game.hours_main, null);
});

test('search hit', () => {
  assert.deepEqual(searchHit({ id: 7, name: 'Celeste', first_release_date: 1516665600, platforms: [{ abbreviation: 'Switch' }], game_type: { type: 'Main Game' } }), {
    igdbId: 7, name: 'Celeste', year: 2018, platforms: ['Switch'], coverId: null, type: 'Main Game',
  });
});
