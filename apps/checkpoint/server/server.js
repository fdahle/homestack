import express from 'express';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as store from './db.js';
import { createAuth } from './kit/auth.js';
import { createApp, errorHandler, mountAccount, route, serveFrontend, servePrivateFiles, toId as id } from './kit/http.js';
import { BadRequest, cleanGameInput, datesForStatusChange, datesInOrder, STATUSES } from './games.js';
import { fetchImage, gameDetails, IGDB_ENABLED, IgdbError, isImageId, search } from './igdb.js';
import { STEAM_ENABLED, STEAM_SYNC_HOURS } from './steam.js';
import { importSteam, lastSteamSync, steamSyncRunning, syncSteam } from './steamsync.js';

const PORT = Number(process.env.PORT || 3069);
const distDir = fileURLToPath(new URL('../dist', import.meta.url));

const app = createApp();
const auth = createAuth({ users: store.users, cookie: 'checkpoint_session' });

// Login, logout, /api/me; everything under /api and /covers after this needs a login
mountAccount(app, { auth, users: store.users, protect: ['/api', '/covers'] });

const steamSummary = () => ({ configured: STEAM_ENABLED, igdb: IGDB_ENABLED, syncHours: STEAM_SYNC_HOURS, last: lastSteamSync(), running: steamSyncRunning(), waiting: store.steamWaitingCount() });

app.get('/api/settings', (req, res) => res.json({ igdb: IGDB_ENABLED, statuses: STATUSES, steam: steamSummary() }));

// --- covers ---

async function saveCover(gameId, buffer) {
  const file = `${gameId}-${randomBytes(6).toString('hex')}.jpg`;
  await writeFile(join(store.COVER_DIR, file), buffer);
  return file;
}

async function removeCover(file) {
  if (file) await unlink(join(store.COVER_DIR, file)).catch(() => {});
}

// Downloads the IGDB cover of a game, unless it has your own photo
async function fetchIgdbCover(gameId) {
  const game = store.getGame(gameId);
  if (!game?.igdb_cover_id || game.cover_source === 'photo') return;
  try {
    const file = await saveCover(gameId, await fetchImage(game.igdb_cover_id));
    store.updateGame(gameId, { cover_file: file, cover_source: 'igdb' });
    await removeCover(game.cover_file);
  } catch (err) {
    console.warn(`Cover for game ${gameId}: ${err.message}`);
  }
}

// --- IGDB search ---

app.get('/api/igdb/search', route(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const hits = await search(q);
  const ids = store.idsByIgdbId(hits.map((h) => h.igdbId));
  res.json(hits.map((h) => ({ ...h, gameId: ids.get(h.igdbId) ?? null })));
}));

// Small covers for the search results, through the server so the browser only talks to Checkpoint
app.get('/api/igdb/thumb/:imageId', route(async (req, res) => {
  if (!isImageId(req.params.imageId)) return res.status(404).end();
  try {
    const image = await fetchImage(req.params.imageId, 'cover_small_2x');
    res.type('image/jpeg').set('Cache-Control', 'private, max-age=604800').send(image);
  } catch {
    res.status(404).end();
  }
}));

// --- games ---

app.get('/api/games', (req, res) => res.json({ games: store.listGames(), platforms: store.usedPlatforms(), today: store.localDate() }));

app.get('/api/games/:id', (req, res) => {
  const game = store.getGame(id(req.params.id));
  if (!game) return res.status(404).json({ error: 'not_found' });
  res.json({ game, platforms: store.usedPlatforms() });
});

// From IGDB: { igdbId, status }. By hand: { name, status, … } (see cleanGameInput).
app.post('/api/games', route(async (req, res) => {
  const status = STATUSES.includes(req.body.status) ? req.body.status : 'backlog';
  if (req.body.igdbId !== undefined) {
    const existing = store.gameByIgdbId(Number(req.body.igdbId));
    if (existing) return res.status(409).json({ error: 'already_added', id: existing });
    const details = await gameDetails(req.body.igdbId);
    const gameId = store.insertGame({ ...details, status });
    await fetchIgdbCover(gameId);
    return res.status(201).json({ id: gameId });
  }
  const fields = cleanGameInput({ ...req.body, status }, { manual: true });
  if (!fields.name) throw new BadRequest('name_required');
  if (!datesInOrder(fields.started_on, fields.finished_on)) throw new BadRequest('finished_before_started');
  res.status(201).json({ id: store.insertGame(fields) });
}));

app.patch('/api/games/:id', (req, res) => {
  const game = store.getGame(id(req.params.id));
  if (!game) return res.status(404).json({ error: 'not_found' });
  const fields = cleanGameInput(req.body, { manual: !game.igdb_id });
  const changes = { ...datesForStatusChange(game, fields.status, store.localDate()), ...fields };
  const started = changes.started_on !== undefined ? changes.started_on : game.started_on;
  const finished = changes.finished_on !== undefined ? changes.finished_on : game.finished_on;
  if (!datesInOrder(started, finished)) throw new BadRequest('finished_before_started');
  store.updateGame(game.id, changes);
  res.json({ game: store.getGame(game.id) });
});

app.delete('/api/games/:id', route(async (req, res) => {
  const game = store.getGame(id(req.params.id));
  if (!game) return res.status(404).json({ error: 'not_found' });
  store.deleteGame(game.id);
  // A Steam game you deleted here doesn't wait to be brought in again (the Steam page can show it)
  if (game.steam_appid) store.setSteamHidden(game.steam_appid, true);
  await removeCover(game.cover_file);
  res.json({ ok: true });
}));

// --- Steam ---

// The library's games that aren't in Checkpoint, hidden ones included (the page can show them)
app.get('/api/steam', (req, res) => res.json({ ...steamSummary(), games: store.steamWaiting() }));

app.post('/api/steam/sync', route(async (req, res) => {
  if (!STEAM_ENABLED) return res.status(400).json({ error: 'steam_not_configured' });
  await syncSteam();
  res.json({ ...steamSummary(), games: store.steamWaiting() });
}));

// { appids: [...] } → brought into Checkpoint; their covers follow in the background
app.post('/api/steam/import', route(async (req, res) => {
  const appids = Array.isArray(req.body.appids) ? [...new Set(req.body.appids.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
  if (!appids.length || appids.length > 5000) throw new BadRequest('bad_appids');
  const { added, linked } = await importSteam(appids);
  res.json({ added: added.length, linked, ...steamSummary(), games: store.steamWaiting() });
  (async () => {
    for (const gameId of added) await fetchIgdbCover(gameId);
  })().catch((err) => console.warn(`Steam covers: ${err.message}`));
}));

// { hidden: true/false }: a Steam game you don't want in Checkpoint, or back on the list
app.patch('/api/steam/:appid', (req, res) => {
  if (!store.setSteamHidden(id(req.params.appid), req.body.hidden === true)) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// Fetches the game's IGDB data again (new platforms, time to beat, cover). Your own entries stay.
app.post('/api/games/:id/refresh', route(async (req, res) => {
  const game = store.getGame(id(req.params.id));
  if (!game) return res.status(404).json({ error: 'not_found' });
  if (!game.igdb_id) return res.status(400).json({ error: 'not_from_igdb' });
  const details = await gameDetails(game.igdb_id);
  const coverChanged = details.igdb_cover_id !== game.igdb_cover_id || !game.cover_file;
  store.updateGame(game.id, details);
  if (coverChanged) await fetchIgdbCover(game.id);
  res.json({ game: store.getGame(game.id) });
}));

// Your own cover photo (a JPEG made small in the browser). It is never replaced by IGDB's.
app.put('/api/games/:id/cover', express.raw({ type: 'image/jpeg', limit: '5mb' }), route(async (req, res) => {
  const game = store.getGame(id(req.params.id));
  if (!game) return res.status(404).json({ error: 'not_found' });
  if (!Buffer.isBuffer(req.body) || req.body.length < 100 || req.body[0] !== 0xff || req.body[1] !== 0xd8) return res.status(400).json({ error: 'bad_image' });
  const file = await saveCover(game.id, req.body);
  store.updateGame(game.id, { cover_file: file, cover_source: 'photo' });
  await removeCover(game.cover_file);
  res.json({ game: store.getGame(game.id) });
}));

// Removes your photo; a game from IGDB gets IGDB's cover back
app.delete('/api/games/:id/cover', route(async (req, res) => {
  const game = store.getGame(id(req.params.id));
  if (!game) return res.status(404).json({ error: 'not_found' });
  store.updateGame(game.id, { cover_file: null, cover_source: null });
  await removeCover(game.cover_file);
  await fetchIgdbCover(game.id);
  res.json({ game: store.getGame(game.id) });
}));

app.get('/api/export.json', (req, res) => {
  res.attachment(`checkpoint-${store.localDate()}.json`)
    .json({ app: 'checkpoint', exportedAt: store.now(), ...store.exportAll() });
});

// --- static files ---

servePrivateFiles(app, '/covers', store.COVER_DIR);
serveFrontend(app, distDir);

app.use(errorHandler((err, req, res) => {
  if (err instanceof IgdbError) {
    if (err.code === 'not_found') res.status(404).json({ error: 'not_found' });
    else {
      console.warn(`IGDB: ${err.message}`);
      res.status(503).json({ error: err.code });
    }
    return true;
  }
  // fetch() failing outright (no network, timeout)
  if (err.name === 'TimeoutError' || err.cause?.code) {
    console.warn(`IGDB unreachable: ${err.message}`);
    res.status(503).json({ error: 'igdb_failed' });
    return true;
  }
  return false;
}));

await auth.ensureAdmin();
if (!IGDB_ENABLED) console.warn('IGDB_CLIENT_ID/IGDB_CLIENT_SECRET not set: no game search, only games entered by hand.');
app.listen(PORT, () => console.log(`Checkpoint listening on :${PORT}`));

// Steam: at the start, then every STEAM_SYNC_HOURS (0: only from the Steam page)
if (STEAM_ENABLED) {
  syncSteam();
  if (STEAM_SYNC_HOURS > 0) setInterval(syncSteam, STEAM_SYNC_HOURS * 3_600_000).unref();
}
