import express from 'express';
import { fileURLToPath } from 'node:url';
import * as store from './db.js';
import { createAuth } from './kit/auth.js';
import { createApp, errorHandler, mountAccount, route, serveFrontend, servePrivateFiles, toId as id } from './kit/http.js';
import { BadRequest, cleanFilmInput, cleanSeriesInput, FILM_STATUSES, partialDate, SERIES_STATUSES } from './titles.js';
import { autoStatus, isAired, upNext } from './progress.js';
import { fetchImage, IMAGE_SIZES, isImagePath, LANGUAGE, REGION, search, TMDB_ENABLED, TmdbError } from './tmdb.js';
import { addFilm, addSeries, fetchTmdbPoster, refreshFilm, refreshProviders, refreshRunningSeries, refreshSeries, removePoster, savePoster } from './catalog.js';
import { importState, startImport } from './importer.js';

const PORT = Number(process.env.PORT || 3071);
const distDir = fileURLToPath(new URL('../dist', import.meta.url));

const app = createApp();
const auth = createAuth({ users: store.users, cookie: 'flimmer_session' });

// Login, logout, /api/me; everything under /api and /posters after this needs a login
mountAccount(app, { auth, users: store.users, protect: ['/api', '/posters'] });

app.get('/api/settings', (req, res) => res.json({
  tmdb: TMDB_ENABLED, language: LANGUAGE, region: REGION, filmStatuses: FILM_STATUSES, seriesStatuses: SERIES_STATUSES,
}));

const today = () => store.localDate();
const notFound = (res) => res.status(404).json({ error: 'not_found' });

// --- TMDB search, and its pictures through the server so the browser only talks to Flimmer ---

app.get('/api/tmdb/search', route(async (req, res) => {
  const mode = req.query.mode === 'series' ? 'series' : 'films';
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const hits = await search(mode, q);
  const ids = (mode === 'series' ? store.seriesIdsByTmdbId : store.filmIdsByTmdbId)(hits.map((h) => h.tmdbId));
  res.json(hits.map((h) => ({ ...h, id: ids.get(h.tmdbId) ?? null })));
}));

// Search thumbnails and streaming logos: /api/tmdb/image/w92/abc.jpg
app.get('/api/tmdb/image/:size/:file', route(async (req, res) => {
  const path = `/${req.params.file}`;
  if (!IMAGE_SIZES.includes(req.params.size) || !isImagePath(path)) return res.status(404).end();
  try {
    const image = await fetchImage(path, req.params.size);
    res.type(image.type).set('Cache-Control', 'private, max-age=604800').send(image.data);
  } catch {
    res.status(404).end();
  }
}));

// --- what films and series share: delete, refresh, streaming offers, your own poster ---

const MODES = {
  films: {
    get: (itemId) => store.getFilm(itemId),
    update: store.updateFilm,
    remove: store.deleteFilm,
    refresh: refreshFilm,
    key: 'film',
  },
  series: {
    get: (itemId) => store.getSeries(itemId, today()),
    update: store.updateSeries,
    remove: store.deleteSeries,
    refresh: refreshSeries,
    key: 'series',
  },
};

for (const [mode, kind] of Object.entries(MODES)) {
  const load = (req, res) => {
    const item = kind.get(id(req.params.id));
    if (!item) notFound(res);
    return item;
  };
  const answer = (res, itemId) => res.json({ [kind.key]: kind.get(itemId) });

  app.get(`/api/${mode}/:id`, (req, res) => {
    const item = load(req, res);
    if (item) res.json({ [kind.key]: item });
  });

  app.delete(`/api/${mode}/:id`, route(async (req, res) => {
    const item = load(req, res);
    if (!item) return;
    kind.remove(item.id);
    await removePoster(item.poster_file);
    res.json({ ok: true });
  }));

  // Fetches TMDB's data again (new episodes, streaming offers, poster). Your own entries stay.
  app.post(`/api/${mode}/:id/refresh`, route(async (req, res) => {
    const item = load(req, res);
    if (!item) return;
    if (!item.tmdb_id) return res.status(400).json({ error: 'not_from_tmdb' });
    await kind.refresh(item);
    answer(res, item.id);
  }));

  // Only the streaming offers; the page asks for them when they are a few days old
  app.post(`/api/${mode}/:id/providers`, route(async (req, res) => {
    const item = load(req, res);
    if (!item) return;
    if (!item.tmdb_id) return res.status(400).json({ error: 'not_from_tmdb' });
    await refreshProviders(mode, item);
    answer(res, item.id);
  }));

  // Your own poster (a JPEG made small in the browser). It is never replaced by TMDB's.
  app.put(`/api/${mode}/:id/poster`, express.raw({ type: 'image/jpeg', limit: '5mb' }), route(async (req, res) => {
    const item = load(req, res);
    if (!item) return;
    if (!Buffer.isBuffer(req.body) || req.body.length < 100 || req.body[0] !== 0xff || req.body[1] !== 0xd8) return res.status(400).json({ error: 'bad_image' });
    const file = await savePoster(`${mode[0]}${item.id}`, req.body);
    kind.update(item.id, { poster_file: file, poster_source: 'photo' });
    await removePoster(item.poster_file);
    answer(res, item.id);
  }));

  // Removes your photo; a title from TMDB gets TMDB's poster back
  app.delete(`/api/${mode}/:id/poster`, route(async (req, res) => {
    const item = load(req, res);
    if (!item) return;
    kind.update(item.id, { poster_file: null, poster_source: null });
    await removePoster(item.poster_file);
    await fetchTmdbPoster(mode, item.id);
    answer(res, item.id);
  }));
}

// --- films ---

app.get('/api/films', (req, res) => res.json({ films: store.listFilms(), today: today() }));

// From TMDB: { tmdbId, status, watchedOn }. By hand: { title, status, watchedOn, … } (see cleanFilmInput).
// Added as watched: one watch on watchedOn (today, a date, or null when you don't remember).
app.post('/api/films', route(async (req, res) => {
  const status = FILM_STATUSES.includes(req.body.status) ? req.body.status : 'watchlist';
  const watchedOn = partialDate(req.body.watchedOn) ?? null;
  let filmId;
  if (req.body.tmdbId !== undefined) {
    const existing = store.filmByTmdbId(Number(req.body.tmdbId));
    if (existing) return res.status(409).json({ error: 'already_added', id: existing });
    filmId = await addFilm(req.body.tmdbId, { status });
  } else {
    const fields = cleanFilmInput({ ...req.body, status }, { manual: true });
    if (!fields.title) throw new BadRequest('title_required');
    filmId = store.insertFilm(fields);
  }
  if (status === 'watched') store.addWatch(filmId, watchedOn);
  res.status(201).json({ id: filmId });
}));

// Marking a film as watched notes today, unless it already has a watch
app.patch('/api/films/:id', (req, res) => {
  const film = store.getFilm(id(req.params.id));
  if (!film) return notFound(res);
  const fields = cleanFilmInput(req.body, { manual: !film.tmdb_id });
  store.updateFilm(film.id, fields);
  if (fields.status === 'watched' && film.status !== 'watched' && !film.watches.length) store.addWatch(film.id, today());
  res.json({ film: store.getFilm(film.id) });
});

// Watched (again): { watchedOn } (default today). A film on the watchlist counts as watched then.
app.post('/api/films/:id/watches', (req, res) => {
  const film = store.getFilm(id(req.params.id));
  if (!film) return notFound(res);
  const watchedOn = req.body.watchedOn === undefined ? today() : partialDate(req.body.watchedOn);
  store.addWatch(film.id, watchedOn);
  if (film.status !== 'watched') store.updateFilm(film.id, { status: 'watched' });
  else store.touchFilm(film.id);
  res.status(201).json({ film: store.getFilm(film.id) });
});

app.patch('/api/films/:id/watches/:watchId', (req, res) => {
  const film = store.getFilm(id(req.params.id));
  if (!film || !store.updateWatch(film.id, id(req.params.watchId), partialDate(req.body.watchedOn) ?? null)) return notFound(res);
  store.touchFilm(film.id);
  res.json({ film: store.getFilm(film.id) });
});

app.delete('/api/films/:id/watches/:watchId', (req, res) => {
  const film = store.getFilm(id(req.params.id));
  if (!film || !store.deleteWatch(film.id, id(req.params.watchId))) return notFound(res);
  store.touchFilm(film.id);
  res.json({ film: store.getFilm(film.id) });
});

// --- series ---

app.get('/api/series', (req, res) => res.json({ series: store.listSeries(today()), today: today() }));

app.get('/api/upnext', (req, res) => res.json({ ...upNext(store.seriesWithEpisodes(today()), today()), today: today() }));

// From TMDB: { tmdbId, status }. By hand: { title, status, episodes: n, … } (n numbered episodes as season 1).
// Added as finished: every aired episode counts as seen (when is not known).
app.post('/api/series', route(async (req, res) => {
  const status = SERIES_STATUSES.includes(req.body.status) ? req.body.status : 'watchlist';
  let seriesId;
  if (req.body.tmdbId !== undefined) {
    const existing = store.seriesByTmdbId(Number(req.body.tmdbId));
    if (existing) return res.status(409).json({ error: 'already_added', id: existing });
    seriesId = await addSeries(req.body.tmdbId, { status });
  } else {
    const fields = cleanSeriesInput({ ...req.body, status }, { manual: true });
    if (!fields.title) throw new BadRequest('title_required');
    seriesId = store.insertSeries(fields);
    const count = Number(req.body.episodes);
    if (Number.isInteger(count) && count > 0) store.addSeason(seriesId, Math.min(count, 200));
  }
  if (status === 'finished') {
    const manual = req.body.tmdbId === undefined;
    const aired = store.episodesOf(seriesId).filter((e) => e.season > 0 && isAired(e, today(), manual)).map((e) => e.id);
    store.setWatched(seriesId, aired, true, null);
  }
  res.status(201).json({ id: seriesId });
}));

app.patch('/api/series/:id', (req, res) => {
  const series = store.getSeries(id(req.params.id), today());
  if (!series) return notFound(res);
  store.updateSeries(series.id, cleanSeriesInput(req.body, { manual: !series.tmdb_id }));
  res.json({ series: store.getSeries(series.id, today()) });
});

// Ticks ({ episodes: [ids], watched: true }) or unticks episodes. The status may follow
// (see autoStatus); the answer says so, so the page can offer to undo it.
app.post('/api/series/:id/watch', (req, res) => {
  const series = store.getSeries(id(req.params.id), today());
  if (!series) return notFound(res);
  const ids = Array.isArray(req.body.episodes) ? req.body.episodes.map(Number).filter(Number.isInteger).slice(0, 5000) : [];
  if (!ids.length) throw new BadRequest('no_episodes');
  const changed = store.setWatched(series.id, ids, req.body.watched !== false, today());
  let auto = null;
  if (changed) {
    const status = autoStatus(series, store.episodesOf(series.id), today());
    if (status) {
      store.updateSeries(series.id, { status });
      auto = { from: series.status, to: status };
    } else store.touchSeries(series.id);
  }
  res.json({ series: store.getSeries(series.id, today()), changed, auto });
});

// Series entered by hand: another season of n numbered episodes, or the last one removed
app.post('/api/series/:id/seasons', (req, res) => {
  const series = store.getSeries(id(req.params.id), today());
  if (!series) return notFound(res);
  if (series.tmdb_id) return res.status(400).json({ error: 'from_tmdb' });
  const count = Number(req.body.episodes);
  if (!Number.isInteger(count) || count < 1 || count > 200) throw new BadRequest('bad_episode_count');
  store.addSeason(series.id, count);
  store.touchSeries(series.id);
  res.json({ series: store.getSeries(series.id, today()) });
});

app.delete('/api/series/:id/seasons/last', (req, res) => {
  const series = store.getSeries(id(req.params.id), today());
  if (!series) return notFound(res);
  if (series.tmdb_id) return res.status(400).json({ error: 'from_tmdb' });
  store.removeLastSeason(series.id);
  res.json({ series: store.getSeries(series.id, today()) });
});

// --- import and export ---

// Watcharr's JSON export, sent as a file. The import runs on; GET /api/import tells how far it is.
app.post('/api/import/watcharr', express.raw({ type: 'application/octet-stream', limit: '50mb' }), (req, res) => {
  if (!TMDB_ENABLED) throw new BadRequest('tmdb_not_configured');
  let entries;
  try {
    entries = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '');
  } catch {
    throw new BadRequest('not_watcharr');
  }
  if (!Array.isArray(entries) || entries.some((e) => !e || typeof e !== 'object')) throw new BadRequest('not_watcharr');
  if (!startImport(entries)) return res.status(409).json({ error: 'import_running' });
  res.status(202).json({ state: importState() });
});

app.get('/api/import', (req, res) => res.json({ state: importState() }));

app.get('/api/export.json', (req, res) => {
  res.attachment(`flimmer-${today()}.json`)
    .json({ app: 'flimmer', exportedAt: store.now(), ...store.exportAll() });
});

// --- static files ---

servePrivateFiles(app, '/posters', store.POSTER_DIR);
serveFrontend(app, distDir);

app.use(errorHandler((err, req, res) => {
  if (err instanceof TmdbError) {
    if (err.code === 'not_found') res.status(404).json({ error: 'not_found' });
    else {
      console.warn(`TMDB: ${err.message}`);
      res.status(503).json({ error: err.code });
    }
    return true;
  }
  // fetch() failing outright (no network, timeout)
  if (err.name === 'TimeoutError' || err.cause?.code) {
    console.warn(`TMDB unreachable: ${err.message}`);
    res.status(503).json({ error: 'tmdb_failed' });
    return true;
  }
  return false;
}));

await auth.ensureAdmin();
if (TMDB_ENABLED) {
  // Shows that are still running get TMDB's data once a day, so new episodes show up
  const refresh = () => refreshRunningSeries().catch((err) => console.warn(`Daily refresh: ${err.message}`));
  setTimeout(refresh, 60_000);
  setInterval(refresh, 3_600_000);
} else {
  console.warn('TMDB_TOKEN/TMDB_API_KEY not set: no search, only titles entered by hand.');
}
app.listen(PORT, () => console.log(`Flimmer listening on :${PORT}`));
