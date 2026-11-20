import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayOf, entriesFromRows, episodesToTick, fromWatcharr, watchDays } from './watcharr.js';

// Shaped like entries of Watcharr's export (GET /api/watched)
const film = (extra = {}) => ({
  id: 1,
  createdAt: '2023-05-01T19:00:00Z',
  updatedAt: '2023-05-02T19:00:00Z',
  deletedAt: null,
  status: 'FINISHED',
  rating: 7.5,
  thoughts: '  Toll  ',
  content: { id: 3, tmdbId: 603, title: 'Matrix', type: 'movie', release_date: '1999-03-30T00:00:00Z' },
  activity: [],
  ...extra,
});

test('Watcharr times → days', () => {
  assert.equal(dayOf('2024-03-01T10:15:00Z'), '2024-03-01');
  assert.equal(dayOf('2024-03-01 12:15:00.123+01:00'), '2024-03-01');
  assert.equal(dayOf('0001-01-01T00:00:00Z'), null);
  assert.equal(dayOf(''), null);
  assert.equal(dayOf('kaputt'), null);
});

test('a finished film with its plays', () => {
  const m = fromWatcharr(film({
    activity: [
      { type: 'ADDED_WATCHED', data: '{"rating":0,"status":"FINISHED"}', createdAt: '2023-05-01T19:00:00Z' },
      { type: 'RATING_CHANGED', data: '8', createdAt: '2023-05-01T19:05:00Z' },
      { type: 'STATUS_CHANGED', data: 'FINISHED', createdAt: '2023-05-01T20:00:00Z' }, // same day: one watch
      { type: 'IMPORTED_ADDED_WATCHED', data: '', customDate: '2010-07-01T12:00:00Z', createdAt: '2023-05-01T19:00:00Z' },
      { type: 'STATUS_CHANGED', data: 'PLANNED', createdAt: '2024-01-01T12:00:00Z' },
      { type: 'STATUS_CHANGED', data: 'X', countAsPlay: true, createdAt: '2025-02-02T12:00:00Z' },
    ],
  }));
  assert.equal(m.mode, 'films');
  assert.equal(m.tmdbId, 603);
  assert.equal(m.status, 'watched');
  assert.equal(m.rating, 8); // 7.5 rounds up
  assert.equal(m.notes, 'Toll');
  assert.deepEqual(m.watches, ['2010-07-01', '2023-05-01', '2025-02-02']);
  assert.equal(m.createdAt, '2023-05-01T19:00:00.000Z');
});

test('film statuses', () => {
  assert.deepEqual(fromWatcharr(film({ status: 'FINISHED', rating: 0 })).watches, [null]); // watched, date unknown
  assert.equal(fromWatcharr(film({ status: 'FINISHED', rating: 0 })).rating, null);
  assert.equal(fromWatcharr(film({ status: 'PLANNED' })).status, 'watchlist');
  assert.deepEqual(fromWatcharr(film({ status: 'PLANNED' })).watches, []);
  assert.equal(fromWatcharr(film({ status: 'DROPPED' })).status, 'dropped');
  assert.equal(fromWatcharr(film({ status: 'WATCHING' })).status, 'watchlist');
  assert.equal(fromWatcharr(film({ status: 'HOLD', activity: [{ type: 'IMPORTED_ADDED_WATCHED', customDate: '2020-01-01T00:00:00Z' }] })).status, 'watched');
});

test('what is skipped', () => {
  assert.equal(fromWatcharr({ status: 'PLANNED', game: { igdbId: 5, name: 'Celeste' } }).skip, 'game');
  assert.equal(fromWatcharr(film({ content: { tmdbId: 0, title: 'Kaputt', type: 'movie' } })).skip, 'no_tmdb_id');
  assert.equal(fromWatcharr(film({ deletedAt: '2024-01-01T00:00:00Z' })).skip, 'deleted');
  assert.equal(fromWatcharr(film({ content: { tmdbId: 9, title: 'Folge', type: 'tv_episode' } })).skip, 'other_type');
  assert.equal(fromWatcharr(null).skip, 'invalid');
});

const show = (extra = {}) => ({
  status: 'WATCHING',
  rating: 9,
  thoughts: '',
  createdAt: '2022-01-01T10:00:00Z',
  content: { tmdbId: 1396, title: 'Breaking Bad', type: 'tv' },
  activity: [{ type: 'STATUS_CHANGED', data: 'FINISHED', createdAt: '2022-06-30T21:00:00Z' }],
  watchedSeasons: [{ seasonNumber: 1, status: 'FINISHED', updatedAt: '2022-02-01T10:00:00Z' }, { seasonNumber: 2, status: 'PLANNED' }],
  watchedEpisodes: [
    { seasonNumber: 2, episodeNumber: 1, status: 'FINISHED', createdAt: '2022-03-01T10:00:00Z', updatedAt: '2022-03-02T10:00:00Z' },
    { seasonNumber: 2, episodeNumber: 2, status: 'WATCHING' },
    { seasonNumber: 0, episodeNumber: 1, status: 'FINISHED' },
  ],
  ...extra,
});

test('series statuses', () => {
  const map = { PLANNED: 'watchlist', WATCHING: 'watching', HOLD: 'paused', FINISHED: 'finished', DROPPED: 'dropped' };
  for (const [from, to] of Object.entries(map)) assert.equal(fromWatcharr(show({ status: from })).status, to, from);
  assert.equal(fromWatcharr(show({ status: '' })).status, 'watching'); // no status, but episodes seen
});

test('a series with seasons and episodes', () => {
  const m = fromWatcharr(show());
  assert.equal(m.mode, 'series');
  assert.deepEqual(m.episodes, [{ season: 2, number: 1, on: '2022-03-02' }]);
  assert.deepEqual(m.seasons, [{ season: 1, on: '2022-02-01' }]);
  assert.equal(m.allWatched, false);
  const done = fromWatcharr(show({ status: 'FINISHED' }));
  assert.equal(done.allWatched, true);
  assert.equal(done.finishedOn, '2022-06-30');
});

test('which episodes get ticked', () => {
  const episodes = [
    { id: 1, season: 1, number: 1, air_date: '2008-01-20', watched: false },
    { id: 2, season: 1, number: 2, air_date: '2008-01-27', watched: true },
    { id: 3, season: 2, number: 1, air_date: '2009-03-08', watched: false },
    { id: 4, season: 2, number: 2, air_date: '2009-03-15', watched: false },
    { id: 5, season: 3, number: 1, air_date: '2030-01-01', watched: false },
  ];
  const m = fromWatcharr(show());
  // Season 1 whole (episode 2 is ticked already), episode 2x1; 9x9 isn't known
  m.episodes.push({ season: 9, number: 9, on: null });
  assert.deepEqual(episodesToTick(m, episodes, '2026-11-20'), [{ id: 3, on: '2022-03-02' }, { id: 1, on: '2022-02-01' }]);
  // Finished: everything aired, the rest with the day it was finished
  const done = fromWatcharr(show({ status: 'FINISHED' }));
  assert.deepEqual(episodesToTick(done, episodes, '2026-11-20'), [{ id: 3, on: '2022-03-02' }, { id: 1, on: '2022-02-01' }, { id: 4, on: '2022-06-30' }]);
  // Once ticked, nothing more to do: importing again changes nothing
  const after = episodes.map((e) => ({ ...e, watched: e.id !== 5 }));
  assert.deepEqual(episodesToTick(done, after, '2026-11-20'), []);
});

test('rows from Watcharr\'s database look like its export', () => {
  const [entry] = entriesFromRows({
    watched: [{ id: 4, status: 'FINISHED', rating: 6, thoughts: 'ok', created_at: '2021-01-01 10:00:00+00:00', updated_at: '2021-01-02 10:00:00+00:00', content_id: 2, game_id: null, tmdb_id: 603, title: 'Matrix', type: 'movie' }],
    activities: [
      { watched_id: 4, type: 'STATUS_CHANGED', data: 'FINISHED', custom_date: null, created_at: '2021-01-01 20:00:00+00:00', count_as_play: 1 },
      { watched_id: 99, type: 'STATUS_CHANGED', data: 'FINISHED', created_at: '2021-01-01 20:00:00+00:00' },
    ],
  });
  const m = fromWatcharr(entry);
  assert.equal(m.mode, 'films');
  assert.equal(m.status, 'watched');
  assert.deepEqual(m.watches, ['2021-01-01']);
  assert.equal(fromWatcharr(entriesFromRows({ watched: [{ id: 5, status: 'PLANNED', content_id: null, game_id: 3 }] })[0]).skip, 'game');
});

test('watch days ignore deleted activity', () => {
  assert.deepEqual(watchDays([{ type: 'STATUS_CHANGED', data: 'FINISHED', createdAt: '2020-01-01T10:00:00Z', deletedAt: '2020-02-01T00:00:00Z' }]), []);
});
