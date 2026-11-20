import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoStatus, isAired, nextEpisode, summary, upcomingEpisodes, upNext } from './progress.js';

const TODAY = '2026-11-20';
let nextId = 1;
const ep = (season, number, air_date, watched = false, extra = {}) => ({ id: nextId++, season, number, air_date, watched, watched_on: watched ? '2026-11-01' : null, runtime: 50, ...extra });

// Season 1 aired, season 2 half aired, the rest to come
const show = () => [
  ep(1, 1, '2026-01-01'), ep(1, 2, '2026-01-08'), ep(1, 3, '2026-01-15'),
  ep(2, 1, '2026-11-13'), ep(2, 2, '2026-11-20'), ep(2, 3, '2026-11-27'), ep(2, 4, null),
];

test('aired: by date; without a date only when entered by hand', () => {
  assert.ok(isAired({ air_date: '2026-11-20' }, TODAY));
  assert.ok(!isAired({ air_date: '2026-11-21' }, TODAY));
  assert.ok(!isAired({ air_date: null }, TODAY));
  assert.ok(isAired({ air_date: null }, TODAY, true));
});

test('next episode: the one after the last you saw, if it has aired', () => {
  const eps = show();
  assert.equal(nextEpisode(eps, TODAY).number, 1); // nothing seen: from the start
  eps[0].watched = true;
  eps[1].watched = true;
  assert.deepEqual([nextEpisode(eps, TODAY).season, nextEpisode(eps, TODAY).number], [1, 3]);
  // A skipped episode doesn't come back once you have seen later ones
  eps[3].watched = true;
  assert.deepEqual([nextEpisode(eps, TODAY).season, nextEpisode(eps, TODAY).number], [2, 2]);
  eps[4].watched = true;
  assert.equal(nextEpisode(eps, TODAY), null); // 2x3 airs next week
});

test('specials and order do not matter', () => {
  const eps = [ep(2, 1, '2020-01-01'), ep(0, 1, '2019-01-01'), ep(1, 1, '2019-06-01', true)];
  assert.deepEqual([nextEpisode(eps, TODAY).season, nextEpisode(eps, TODAY).number], [2, 1]);
});

test('upcoming episodes', () => {
  assert.deepEqual(upcomingEpisodes(show(), TODAY).map((e) => `${e.season}x${e.number}`), ['2x3']);
});

test('summary of a series', () => {
  const eps = show();
  eps[0] = { ...eps[0], watched: true, watched_on: '2026-11-01' };
  eps[1] = { ...eps[1], watched: true, watched_on: '2025-12-31', runtime: null };
  const s = summary(eps, TODAY, { runtime: 45 });
  assert.equal(s.aired, 5);
  assert.equal(s.watched, 2);
  assert.equal(s.total, 5);
  assert.equal(s.left, 3);
  assert.equal(s.next.number, 3);
  assert.equal(s.upcoming, '2026-11-27');
  assert.equal(s.last_watched, '2026-11-01');
  assert.equal(s.minutes, 95);
  assert.deepEqual(s.years, { 2026: 1, 2025: 1 });
});

test('automatic status', () => {
  const ended = { tmdb_id: 1, tmdb_status: 'Ended' };
  const running = { tmdb_id: 1, tmdb_status: 'Returning Series' };
  const all = (watched) => [ep(1, 1, '2020-01-01', watched), ep(1, 2, '2020-01-08', watched)];
  const some = [ep(1, 1, '2020-01-01', true), ep(1, 2, '2020-01-08')];
  // Starting a show from the watchlist
  assert.equal(autoStatus({ ...running, status: 'watchlist' }, some, TODAY), 'watching');
  assert.equal(autoStatus({ ...running, status: 'watchlist' }, all(false), TODAY), null);
  // Seen everything of a show that ended, also straight from the watchlist
  assert.equal(autoStatus({ ...ended, status: 'watching' }, all(true), TODAY), 'finished');
  assert.equal(autoStatus({ ...ended, status: 'paused' }, all(true), TODAY), 'finished');
  assert.equal(autoStatus({ ...ended, status: 'watchlist' }, all(true), TODAY), 'finished');
  assert.equal(autoStatus({ ...ended, status: 'dropped' }, all(true), TODAY), null);
  // A running show stays "watching" when you are caught up
  assert.equal(autoStatus({ ...running, status: 'watching' }, all(true), TODAY), null);
  // Unticking an episode of a finished show
  assert.equal(autoStatus({ ...ended, status: 'finished' }, some, TODAY), 'watching');
  assert.equal(autoStatus({ ...ended, status: 'finished' }, all(true), TODAY), null);
  // Entered by hand: never "ended", so never finished by itself
  assert.equal(autoStatus({ tmdb_id: null, status: 'watching' }, [ep(1, 1, null, true)], TODAY), null);
});

test('up next and coming soon', () => {
  const a = { id: 1, tmdb_id: 1, title: 'A', status: 'watching', tmdb_status: 'Returning Series', last_watched: '2026-11-01', episodes: show() };
  a.episodes[0].watched = true;
  const b = { id: 2, tmdb_id: 2, title: 'B', status: 'watching', tmdb_status: 'Ended', last_watched: '2026-11-10', episodes: [ep(1, 1, '2020-01-01', true), ep(1, 2, '2020-01-02')] };
  const c = { id: 3, tmdb_id: 3, title: 'C', status: 'finished', tmdb_status: 'Returning Series', episodes: [ep(1, 1, '2026-01-01', true), ep(2, 1, '2026-11-25')] };
  const d = { id: 4, tmdb_id: 4, title: 'D', status: 'watchlist', tmdb_status: 'Returning Series', episodes: [ep(1, 1, '2026-11-22')] };
  const { next, upcoming } = upNext([a, b, c, d], TODAY);
  // Most recently watched first
  assert.deepEqual(next.map((n) => [n.series.title, n.episode.season, n.episode.number, n.left]), [['B', 1, 2, 1], ['A', 1, 2, 4]]);
  assert.equal(next[0].series.episodes, undefined);
  // Watchlist shows don't count; nearest date first
  assert.deepEqual(upcoming.map((u) => [u.series.title, u.episode.air_date]), [['C', '2026-11-25'], ['A', '2026-11-27']]);
});
