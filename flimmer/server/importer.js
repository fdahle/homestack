// Brings Watcharr entries into Flimmer (see watcharr.js for how they map). Each title is
// fetched from TMDB. Running it again doesn't add anything twice: titles already in Flimmer
// only get the watches and episodes they don't have yet, and a rating or notes where you
// have none. Statuses you set in Flimmer stay.

import * as store from './db.js';
import { addFilm, addSeries } from './catalog.js';
import { episodesToTick, fromWatcharr } from './watcharr.js';

const emptyCounts = () => ({ added: 0, updated: 0, unchanged: 0 });

function fillIn(item, m) {
  const out = {};
  if (item.rating == null && m.rating) out.rating = m.rating;
  if (!item.notes && m.notes) out.notes = m.notes;
  return out;
}

async function importFilm(m) {
  let id = store.filmByTmdbId(m.tmdbId);
  if (!id) {
    id = await addFilm(m.tmdbId, { status: m.status, rating: m.rating, notes: m.notes }, { createdAt: m.createdAt });
    for (const day of m.watches) store.addWatch(id, day);
    return 'added';
  }
  const film = store.getFilm(id);
  const known = new Set(film.watches.map((w) => w.watched_on));
  let changed = false;
  for (const day of m.watches) {
    // An undated watch only for a film without any
    if (day ? known.has(day) : film.watches.length) continue;
    store.addWatch(id, day);
    changed = true;
  }
  const fill = fillIn(film, m);
  if (Object.keys(fill).length) {
    store.updateFilm(id, fill);
    changed = true;
  }
  return changed ? 'updated' : 'unchanged';
}

async function importSeries(m) {
  let id = store.seriesByTmdbId(m.tmdbId);
  let result = 'unchanged';
  if (!id) {
    id = await addSeries(m.tmdbId, { status: m.status, rating: m.rating, notes: m.notes }, { createdAt: m.createdAt });
    result = 'added';
  } else {
    const fill = fillIn(store.getSeries(id, store.localDate()), m);
    if (Object.keys(fill).length) {
      store.updateSeries(id, fill);
      result = 'updated';
    }
  }
  const ticks = episodesToTick(m, store.episodesOf(id), store.localDate());
  if (ticks.length) {
    store.tickEpisodes(id, ticks);
    if (result === 'unchanged') result = 'updated';
  }
  return result;
}

// entries: Watcharr's export (an array). onProgress({ done, total, current }) after each title.
// → { films: { added, updated, unchanged }, series: {…}, games, skipped: [{ title, reason }], failed: [{ title, error }] }
export async function importWatcharr(entries, { onProgress = () => {} } = {}) {
  if (!Array.isArray(entries)) throw Object.assign(new Error('not a Watcharr export'), { code: 'not_watcharr' });
  const report = { films: emptyCounts(), series: emptyCounts(), games: 0, skipped: [], failed: [] };
  const mapped = entries.map(fromWatcharr);
  const total = mapped.length;
  for (const [i, m] of mapped.entries()) {
    onProgress({ done: i, total, current: m.title || null });
    if (m.skip) {
      if (m.skip === 'game') report.games++;
      else if (m.skip !== 'deleted') report.skipped.push({ title: m.title || null, reason: m.skip });
      continue;
    }
    try {
      const result = m.mode === 'films' ? await importFilm(m) : await importSeries(m);
      report[m.mode][result]++;
    } catch (err) {
      // Without a working TMDB connection nothing else will work either
      if (['tmdb_not_configured', 'tmdb_login_failed'].includes(err.code)) throw err;
      report.failed.push({ title: m.title, error: err.code || err.message });
    }
  }
  onProgress({ done: total, total, current: null });
  return report;
}

// --- one import at a time from the settings page, followed by polling ---

let job = null; // { running, done, total, current, report, error, startedAt }

export const importState = () => job;

export function startImport(entries) {
  if (job?.running) return false;
  job = { running: true, done: 0, total: entries.length, current: null, report: null, error: null, startedAt: store.now() };
  importWatcharr(entries, { onProgress: (p) => Object.assign(job, p) })
    .then((report) => Object.assign(job, { running: false, report }))
    .catch((err) => {
      console.warn(`Watcharr import: ${err.message}`);
      Object.assign(job, { running: false, error: err.code || 'import_failed' });
    });
  return true;
}
