import express from 'express';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as store from './db.js';
import { createAuth } from './kit/auth.js';
import { createApp, errorHandler, mountAccount, route, serveFrontend, servePrivateFiles, toId as id } from './kit/http.js';
import { BadRequest, cleanBookInput, datesForStatusChange, datesInOrder, STATUSES } from './books.js';
import { bookDetails, CatalogError, fetchImage, GOOGLE_KEY_SET, search, thumbUrl } from './catalog.js';
import { CALIBRE_LIBRARY, CALIBRE_SYNC_HOURS, CALIBRE_WEB_URL, defaultStatus, lastSync, syncCalibre, syncRunning } from './sync.js';

const PORT = Number(process.env.PORT || 3072);
const distDir = fileURLToPath(new URL('../dist', import.meta.url));

const app = createApp();
const auth = createAuth({ users: store.users, cookie: 'regal_session' });

// Login, logout, /api/me; everything under /api and /covers after this needs a login
mountAccount(app, { auth, users: store.users, protect: ['/api', '/covers'] });

// --- settings ---

const readingGoal = () => Number(store.users.getSetting('reading_goal')) || null;
// Calibre books you deleted in Regal: the sync leaves them out from then on
const ignoredUuids = () => store.getJsonSetting('calibre_ignored', []);

function settings() {
  return {
    google: GOOGLE_KEY_SET,
    statuses: STATUSES,
    readingGoal: readingGoal(),
    calibre: {
      configured: Boolean(CALIBRE_LIBRARY),
      webUrl: CALIBRE_WEB_URL || null,
      syncHours: CALIBRE_SYNC_HOURS,
      defaultStatus: defaultStatus(),
      ignored: ignoredUuids().length,
      last: lastSync(),
      running: syncRunning(),
    },
  };
}

app.get('/api/settings', (req, res) => res.json(settings()));

app.patch('/api/settings', (req, res) => {
  const { calibreDefaultStatus, readingGoal: goal, calibreIgnored } = req.body;
  if (calibreDefaultStatus !== undefined) {
    if (!STATUSES.includes(calibreDefaultStatus)) throw new BadRequest('bad_status');
    store.users.setSetting('calibre_default_status', calibreDefaultStatus);
  }
  if (goal !== undefined) {
    const n = goal === null || goal === '' ? 0 : Number(goal);
    if (!Number.isInteger(n) || n < 0 || n > 1000) throw new BadRequest('bad_goal');
    store.users.setSetting('reading_goal', n);
  }
  // Only clearing the list: deleted Calibre books come back with the next sync
  if (calibreIgnored !== undefined) store.setJsonSetting('calibre_ignored', []);
  res.json(settings());
});

app.post('/api/calibre/sync', route(async (req, res) => {
  if (!CALIBRE_LIBRARY) return res.status(400).json({ error: 'calibre_not_configured' });
  await runSync();
  res.json(settings());
}));

const runSync = () => syncCalibre({ ignored: new Set(ignoredUuids()) });

// --- covers ---

async function saveCover(bookId, buffer) {
  const file = `${bookId}-${randomBytes(6).toString('hex')}.jpg`;
  await writeFile(join(store.COVER_DIR, file), buffer);
  return file;
}

async function removeCover(file) {
  if (file) await unlink(join(store.COVER_DIR, file)).catch(() => {});
}

// Downloads the catalog's cover of a book, unless it has your photo or Calibre's cover
async function fetchCatalogCover(bookId) {
  const book = store.getBook(bookId);
  if (!book?.cover_url || book.cover_source === 'photo' || book.cover_source === 'calibre') return;
  try {
    const file = await saveCover(bookId, await fetchImage(book.cover_url));
    store.updateBook(bookId, { cover_file: file, cover_source: 'catalog' }, { touch: false });
    await removeCover(book.cover_file);
  } catch (err) {
    console.warn(`Cover for book ${bookId}: ${err.message}`);
  }
}

// --- catalog search ---

app.get('/api/search', route(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (q.length < 2) return res.json([]);
  const hits = await search(q, req.user.lang);
  const inLibrary = store.libraryIndex();
  res.json(hits.map((h) => ({ ...h, bookId: inLibrary(h) })));
}));

// Small covers for the search results, through the server so the browser only talks to Regal
app.get('/api/thumb/:source/:id', route(async (req, res) => {
  const url = thumbUrl(req.params.source, req.params.id);
  if (!url) return res.status(404).end();
  try {
    const image = await fetchImage(url);
    res.type('image/jpeg').set('Cache-Control', 'private, max-age=604800').send(image);
  } catch {
    res.status(404).end();
  }
}));

// --- books ---

const extras = () => ({ calibreWebUrl: CALIBRE_WEB_URL || null, readingGoal: readingGoal(), today: store.localDate() });

app.get('/api/books', (req, res) => res.json({ books: store.listBooks(), ...extras() }));

app.get('/api/books/:id', (req, res) => {
  const book = store.getBook(id(req.params.id));
  if (!book) return res.status(404).json({ error: 'not_found' });
  res.json({ book, series: store.seriesBooks(book.series), ...extras() });
});

// From a catalog: { source: 'openlibrary', work, edition, status } or { source: 'google', volume, status }.
// By hand: { title, authors, status, … } (see cleanBookInput).
app.post('/api/books', route(async (req, res) => {
  const status = STATUSES.includes(req.body.status) ? req.body.status : 'want';
  const inLibrary = store.libraryIndex();
  if (req.body.source === 'openlibrary' || req.body.source === 'google') {
    const known = inLibrary(req.body);
    if (known) return res.status(409).json({ error: 'already_added', id: known });
    const details = await bookDetails(req.body);
    const existing = inLibrary(details);
    if (existing) return res.status(409).json({ error: 'already_added', id: existing });
    const bookId = store.insertBook({ ...details, status });
    await fetchCatalogCover(bookId);
    return res.status(201).json({ id: bookId });
  }
  const fields = cleanBookInput({ ...req.body, status });
  if (!fields.title) throw new BadRequest('title_required');
  if (!datesInOrder(fields.started_on, fields.finished_on)) throw new BadRequest('finished_before_started');
  const existing = fields.isbns?.length && inLibrary(fields);
  if (existing) return res.status(409).json({ error: 'already_added', id: existing });
  // With an ISBN, Open Library may have the cover
  const coverUrl = fields.isbns?.[0] ? `https://covers.openlibrary.org/b/isbn/${fields.isbns[0]}-L.jpg?default=false` : null;
  const bookId = store.insertBook({ ...fields, source: 'manual', cover_url: coverUrl });
  if (coverUrl) await fetchCatalogCover(bookId);
  res.status(201).json({ id: bookId });
}));

app.patch('/api/books/:id', (req, res) => {
  const book = store.getBook(id(req.params.id));
  if (!book) return res.status(404).json({ error: 'not_found' });
  const fields = cleanBookInput(req.body);
  const changes = { ...datesForStatusChange(book, fields.status, store.localDate()), ...fields };
  const started = changes.started_on !== undefined ? changes.started_on : book.started_on;
  const finished = changes.finished_on !== undefined ? changes.finished_on : book.finished_on;
  if (!datesInOrder(started, finished)) throw new BadRequest('finished_before_started');
  store.updateBook(book.id, changes);
  res.json({ book: store.getBook(book.id) });
});

app.delete('/api/books/:id', route(async (req, res) => {
  const book = store.getBook(id(req.params.id));
  if (!book) return res.status(404).json({ error: 'not_found' });
  // Still in Calibre: without this, the next sync would bring it back
  if (book.calibre_uuid && book.in_calibre) store.setJsonSetting('calibre_ignored', [...new Set([...ignoredUuids(), book.calibre_uuid])]);
  store.deleteBook(book.id);
  await removeCover(book.cover_file);
  res.json({ ok: true });
}));

// Fetches the book's catalog data again. Your own entries stay; books in Calibre get theirs from there.
app.post('/api/books/:id/refresh', route(async (req, res) => {
  const book = store.getBook(id(req.params.id));
  if (!book) return res.status(404).json({ error: 'not_found' });
  if (book.in_calibre || !(book.ol_work || book.ol_edition || book.google_id)) return res.status(400).json({ error: 'not_from_catalog' });
  const ref = book.ol_work || book.ol_edition
    ? { source: 'openlibrary', work: book.ol_work, edition: book.ol_edition }
    : { source: 'google', volume: book.google_id };
  const { source, ...details } = await bookDetails(ref);
  const coverChanged = details.cover_url !== book.cover_url || !book.cover_file;
  store.updateBook(book.id, details, { touch: false });
  if (coverChanged) await fetchCatalogCover(book.id);
  res.json({ book: store.getBook(book.id) });
}));

// Your own cover photo (a JPEG made small in the browser). It is never replaced by a catalog's or Calibre's.
app.put('/api/books/:id/cover', express.raw({ type: 'image/jpeg', limit: '5mb' }), route(async (req, res) => {
  const book = store.getBook(id(req.params.id));
  if (!book) return res.status(404).json({ error: 'not_found' });
  if (!Buffer.isBuffer(req.body) || req.body.length < 100 || req.body[0] !== 0xff || req.body[1] !== 0xd8) return res.status(400).json({ error: 'bad_image' });
  const file = await saveCover(book.id, req.body);
  store.updateBook(book.id, { cover_file: file, cover_source: 'photo', calibre_cover: null });
  await removeCover(book.cover_file);
  res.json({ book: store.getBook(book.id) });
}));

// Removes your photo; the catalog's cover comes back now, Calibre's with the next sync
app.delete('/api/books/:id/cover', route(async (req, res) => {
  const book = store.getBook(id(req.params.id));
  if (!book) return res.status(404).json({ error: 'not_found' });
  store.updateBook(book.id, { cover_file: null, cover_source: null, calibre_cover: null });
  await removeCover(book.cover_file);
  if (book.in_calibre && CALIBRE_LIBRARY) await runSync();
  else await fetchCatalogCover(book.id);
  res.json({ book: store.getBook(book.id) });
}));

app.get('/api/export.json', (req, res) => {
  res.attachment(`regal-${store.localDate()}.json`)
    .json({ app: 'regal', exportedAt: store.now(), ...store.exportAll() });
});

// --- static files ---

servePrivateFiles(app, '/covers', store.COVER_DIR);
serveFrontend(app, distDir);

app.use(errorHandler((err, req, res) => {
  if (err instanceof CatalogError) {
    if (err.code === 'not_found') res.status(404).json({ error: 'not_found' });
    else {
      console.warn(`Catalog: ${err.message}`);
      res.status(503).json({ error: err.code });
    }
    return true;
  }
  // fetch() failing outright (no network, timeout)
  if (err.name === 'TimeoutError' || err.cause?.code) {
    console.warn(`Catalog unreachable: ${err.message}`);
    res.status(503).json({ error: 'catalog_failed' });
    return true;
  }
  return false;
}));

await auth.ensureAdmin();
app.listen(PORT, () => console.log(`Regal listening on :${PORT}`));

if (CALIBRE_LIBRARY) {
  runSync();
  if (CALIBRE_SYNC_HOURS > 0) setInterval(runSync, CALIBRE_SYNC_HOURS * 3600_000).unref();
} else {
  console.log('CALIBRE_LIBRARY not set: no Calibre sync.');
}
