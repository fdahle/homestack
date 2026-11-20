import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BadRequest, cleanFilmInput, cleanSeriesInput, episodesFromSeason, fromTmdbMovie, fromTmdbTv, isPartialDate, overviewOf, providersFor, searchHit,
} from './titles.js';

test('partial dates', () => {
  for (const ok of ['2020', '2020-02', '2020-02-29', '1985-12-31']) assert.ok(isPartialDate(ok), ok);
  for (const bad of ['20', '2020-13', '2021-02-29', '2020-1', '2020-01-32', '1800', 'gestern', '']) assert.ok(!isPartialDate(bad), bad);
});

test('cleanFilmInput keeps what changed and checks it', () => {
  assert.deepEqual(cleanFilmInput({ status: 'watched', rating: 8, notes: ' ' }), { status: 'watched', rating: 8, notes: null });
  assert.deepEqual(cleanFilmInput({ rating: null }), { rating: null });
  assert.throws(() => cleanFilmInput({ status: 'watching' }), BadRequest); // a series status
  assert.throws(() => cleanFilmInput({ rating: 0 }), BadRequest);
  assert.throws(() => cleanFilmInput({ rating: 7.5 }), BadRequest);
});

test('catalog fields only for titles entered by hand', () => {
  assert.deepEqual(cleanFilmInput({ title: 'Hacked', runtime: 90 }), {});
  assert.deepEqual(cleanFilmInput({ title: ' Alien ', runtime: '117', releaseDate: '1979', genres: ['Horror', 'Horror', ''] }, { manual: true }), {
    title: 'Alien', runtime: 117, release_date: '1979', genres: ['Horror'],
  });
  assert.throws(() => cleanFilmInput({ title: '  ' }, { manual: true }), BadRequest);
  assert.throws(() => cleanFilmInput({ runtime: -5 }, { manual: true }), BadRequest);
  assert.deepEqual(cleanSeriesInput({ status: 'paused', episodeRuntime: 45, firstAirDate: '2019-04' }, { manual: true }), {
    status: 'paused', episode_runtime: 45, first_air_date: '2019-04',
  });
  assert.throws(() => cleanSeriesInput({ status: 'watched' }), BadRequest); // a film status
});

test('the description falls back to English', () => {
  assert.equal(overviewOf({ overview: 'Deutsch' }), 'Deutsch');
  assert.equal(overviewOf({
    overview: '',
    translations: { translations: [{ iso_639_1: 'fr', iso_3166_1: 'FR', data: { overview: 'Français' } }, { iso_639_1: 'en', iso_3166_1: 'US', data: { overview: 'English' } }] },
  }), 'English');
  assert.equal(overviewOf({ overview: '' }), null);
});

const PROVIDERS = {
  results: {
    DE: {
      link: 'https://www.themoviedb.org/movie/603-the-matrix/watch?locale=DE',
      flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.jpg', display_priority: 2 }, { provider_id: 9, provider_name: 'Amazon Prime Video', logo_path: '/a.jpg', display_priority: 1 }],
      rent: [{ provider_id: 2, provider_name: 'Apple TV', logo_path: '/t.jpg', display_priority: 4 }],
      buy: [{ provider_id: 2, provider_name: 'Apple TV', logo_path: '/t.jpg', display_priority: 4 }, { provider_id: 2, provider_name: 'Apple TV', logo_path: '/t.jpg' }],
    },
    US: { flatrate: [{ provider_id: 15, provider_name: 'Hulu' }] },
  },
};

test('streaming offers for one country', () => {
  const p = providersFor(PROVIDERS, 'DE');
  assert.deepEqual(p.flatrate.map((x) => x.name), ['Amazon Prime Video', 'Netflix']);
  assert.deepEqual(p.buy, [{ id: 2, name: 'Apple TV', logo: '/t.jpg' }]);
  assert.deepEqual(p.free, []);
  assert.equal(providersFor(PROVIDERS, 'AT'), null);
  assert.equal(providersFor({ results: { DE: { link: 'x' } } }, 'DE'), null);
});

test('TMDB film → database fields', () => {
  const film = fromTmdbMovie({
    id: 603,
    title: 'Matrix',
    original_title: 'The Matrix',
    tagline: '',
    overview: 'Ein Hacker …',
    release_date: '1999-03-30',
    runtime: 136,
    poster_path: '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg',
    genres: [{ id: 28, name: 'Action' }, { id: 878, name: 'Science Fiction' }],
    credits: {
      cast: [{ name: 'Carrie-Anne Moss', order: 2 }, { name: 'Keanu Reeves', order: 0 }, { name: 'Laurence Fishburne', order: 1 }],
      crew: [{ name: 'Lana Wachowski', job: 'Director' }, { name: 'Lilly Wachowski', job: 'Director' }, { name: 'Bill Pope', job: 'Director of Photography' }],
    },
    'watch/providers': PROVIDERS,
  }, 'DE');
  assert.equal(film.tmdb_id, 603);
  assert.equal(film.title, 'Matrix');
  assert.equal(film.original_title, 'The Matrix');
  assert.equal(film.tagline, null);
  assert.equal(film.runtime, 136);
  assert.deepEqual(film.genres, ['Action', 'Science Fiction']);
  assert.equal(film.director, 'Lana Wachowski, Lilly Wachowski');
  assert.deepEqual(film.cast_names, ['Keanu Reeves', 'Laurence Fishburne', 'Carrie-Anne Moss']);
  assert.equal(film.tmdb_poster, '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg');
  assert.equal(film.providers.flatrate.length, 2);
});

test('TMDB film with almost nothing', () => {
  const film = fromTmdbMovie({ id: 5, title: 'Obscure', original_title: 'Obscure', release_date: '', runtime: 0 });
  assert.equal(film.original_title, null);
  assert.equal(film.release_date, null);
  assert.equal(film.runtime, null);
  assert.deepEqual(film.genres, []);
  assert.equal(film.director, null);
  assert.equal(film.providers, null);
});

test('TMDB series → database fields, without specials', () => {
  const series = fromTmdbTv({
    id: 1396,
    name: 'Breaking Bad',
    original_name: 'Breaking Bad',
    overview: '',
    translations: { translations: [{ iso_639_1: 'en', iso_3166_1: 'US', data: { overview: 'A chemistry teacher …' } }] },
    first_air_date: '2008-01-20',
    last_air_date: '2013-09-29',
    status: 'Ended',
    genres: [{ name: 'Drama' }, { name: 'Krimi' }],
    created_by: [{ name: 'Vince Gilligan' }],
    networks: [{ name: 'AMC' }],
    episode_run_time: [],
    last_episode_to_air: { runtime: 55, air_date: '2013-09-29' },
    next_episode_to_air: null,
    seasons: [
      { season_number: 0, name: 'Specials', episode_count: 9 },
      { season_number: 1, name: 'Staffel 1', air_date: '2008-01-20', episode_count: 7 },
      { season_number: 2, name: 'Staffel 2', air_date: '2009-03-08', episode_count: 13 },
    ],
  });
  assert.equal(series.title, 'Breaking Bad');
  assert.equal(series.original_title, null);
  assert.equal(series.overview, 'A chemistry teacher …');
  assert.equal(series.tmdb_status, 'Ended');
  assert.equal(series.creators, 'Vince Gilligan');
  assert.deepEqual(series.networks, ['AMC']);
  assert.equal(series.episode_runtime, 55);
  assert.deepEqual(series.seasons.map((s) => s.number), [1, 2]);
  assert.equal(series.next_air_date, null);
});

test('typical episode runtime is the middle one', () => {
  assert.equal(fromTmdbTv({ id: 1, name: 'X', episode_run_time: [60, 22, 25] }).episode_runtime, 25);
});

test('episodes of a season', () => {
  assert.deepEqual(episodesFromSeason({
    episodes: [
      { season_number: 1, episode_number: 1, name: 'Pilot', air_date: '2008-01-20', runtime: 58 },
      { season_number: 1, episode_number: 2, name: '', air_date: null, runtime: null },
      { season_number: 0, episode_number: 1, name: 'Special' },
    ],
  }), [
    { season: 1, number: 1, name: 'Pilot', air_date: '2008-01-20', runtime: 58 },
    { season: 1, number: 2, name: null, air_date: null, runtime: null },
  ]);
  assert.deepEqual(episodesFromSeason(undefined), []);
});

test('search hits', () => {
  assert.deepEqual(searchHit({ id: 7, title: 'Die Verurteilten', original_title: 'The Shawshank Redemption', release_date: '1994-09-23', poster_path: '/p.jpg', overview: 'x' }), {
    tmdbId: 7, title: 'Die Verurteilten', originalTitle: 'The Shawshank Redemption', year: 1994, overview: 'x', poster: '/p.jpg',
  });
  assert.equal(searchHit({ id: 8, name: 'Dark', original_name: 'Dark', first_air_date: '2017-12-01' }).year, 2017);
  assert.equal(searchHit({ id: 9, name: 'Neu', first_air_date: '' }).year, null);
});
