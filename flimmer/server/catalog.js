// Adding and refreshing titles from TMDB, posters included. Used by the routes,
// the daily refresh and the Watcharr import.

import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as store from './db.js';
import { fetchImage, movieDetails, tvDetails, watchProviders } from './tmdb.js';

// --- posters ---

export async function savePoster(prefix, buffer) {
  const file = `${prefix}-${randomBytes(6).toString('hex')}.jpg`;
  await writeFile(join(store.POSTER_DIR, file), buffer);
  return file;
}

export async function removePoster(file) {
  if (file) await unlink(join(store.POSTER_DIR, file)).catch(() => {});
}

const KINDS = {
  films: { get: (id) => store.getFilm(id), update: store.updateFilm, prefix: 'f' },
  series: { get: (id) => store.getSeries(id, store.localDate()), update: store.updateSeries, prefix: 's' },
};

// Downloads TMDB's poster of a title, unless it has your own photo
export async function fetchTmdbPoster(mode, id) {
  const kind = KINDS[mode];
  const item = kind.get(id);
  if (!item?.tmdb_poster || item.poster_source === 'photo') return;
  try {
    const { data } = await fetchImage(item.tmdb_poster, 'w500');
    const file = await savePoster(`${kind.prefix}${id}`, data);
    kind.update(id, { poster_file: file, poster_source: 'tmdb' }, { touch: false });
    await removePoster(item.poster_file);
  } catch (err) {
    console.warn(`Poster for ${mode} ${id}: ${err.message}`);
  }
}

// --- films ---

// fields: your entries (status, rating, notes); createdAt: keep an imported date
export async function addFilm(tmdbId, fields = {}, { createdAt = null } = {}) {
  const details = await movieDetails(tmdbId);
  const id = store.insertFilm({ ...details, providers_at: store.now(), ...fields }, createdAt);
  await fetchTmdbPoster('films', id);
  return id;
}

// Fetches the film's TMDB data again. Your own entries stay.
export async function refreshFilm(film) {
  const details = await movieDetails(film.tmdb_id);
  store.updateFilm(film.id, { ...details, providers_at: store.now() }, { touch: false });
  if (details.tmdb_poster !== film.tmdb_poster || !film.poster_file) await fetchTmdbPoster('films', film.id);
}

// --- series ---

export async function addSeries(tmdbId, fields = {}, { createdAt = null } = {}) {
  const { series, episodes } = await tvDetails(tmdbId);
  const t = store.now();
  const id = store.insertSeries({ ...series, providers_at: t, refreshed_at: t, ...fields }, createdAt);
  store.saveEpisodes(id, episodes);
  await fetchTmdbPoster('series', id);
  return id;
}

export async function refreshSeries(s) {
  const { series, episodes } = await tvDetails(s.tmdb_id);
  const t = store.now();
  store.updateSeries(s.id, { ...series, providers_at: t, refreshed_at: t }, { touch: false });
  store.saveEpisodes(s.id, episodes);
  if (series.tmdb_poster !== s.tmdb_poster || !s.poster_file) await fetchTmdbPoster('series', s.id);
}

// Just the streaming offers
export async function refreshProviders(mode, item) {
  const providers = await watchProviders(mode, item.tmdb_id);
  KINDS[mode].update(item.id, { providers, providers_at: store.now() }, { touch: false });
}

// --- the daily refresh of shows that may still get episodes ---

const DAY = 86_400_000;
let refreshing = false;

export async function refreshRunningSeries() {
  if (refreshing) return;
  refreshing = true;
  try {
    // A little less than a day, so the hourly check doesn't drift past a whole day
    const due = store.seriesToRefresh(new Date(Date.now() - DAY + 3_600_000).toISOString());
    for (const s of due) {
      try {
        await refreshSeries(store.getSeries(s.id, store.localDate()));
      } catch (err) {
        console.warn(`Refreshing "${s.title}": ${err.message}`);
        // Gone from TMDB: try again tomorrow. Anything else (no network, wrong token): stop, next hour tries again.
        if (err.code === 'not_found') store.updateSeries(s.id, { refreshed_at: store.now() }, { touch: false });
        else break;
      }
    }
    if (due.length) console.log(`Refreshed ${due.length} running series from TMDB`);
  } finally {
    refreshing = false;
  }
}
