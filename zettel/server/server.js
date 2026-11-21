import express from 'express';
import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, FILE_DIR, openDatabase } from './db.js';
import { exportZip } from './export.js';
import { createAuth } from './kit/auth.js';
import { BadRequest, createApp, errorHandler, mountAccount, route, serveFrontend } from './kit/http.js';
import { UUID } from './notes.js';

const PORT = Number(process.env.PORT || 3070);
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 25);
const TRASH_DAYS = Number(process.env.TRASH_DAYS || 30);
const distDir = fileURLToPath(new URL('../dist', import.meta.url));

const { users, notes } = openDatabase();
// A sync may carry many notes written offline
const app = createApp({ jsonLimit: '20mb' });
const auth = createAuth({ users, cookie: 'zettel_session' });

// Login, logout, /api/me; everything under /api and /files after this needs a login
mountAccount(app, { auth, users, protect: ['/api', '/files'] });

const removeFiles = (ids) => Promise.all(ids.map((id) => rm(join(FILE_DIR, id), { force: true }))).catch((err) => console.warn(`Removing files: ${err.message}`));

app.get('/api/settings', (req, res) => res.json({ maxFileMb: MAX_FILE_MB, trashDays: TRASH_DAYS }));

// --- keeping devices in step (see notes.js) ---

app.post('/api/sync', (req, res) => {
  const { answer, removedFiles } = notes.sync(req.user.id, req.body);
  removeFiles(removedFiles);
  res.json(answer);
});

// --- files attached to notes ---

// The device makes the id, so a file picked offline keeps it once it's uploaded.
// PUT /api/files/<id>?note=<note id>&name=<file name>&width=…&height=…, the file as the body.
const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|avif)$/;
const cleanType = (type) => (/^[\w.+-]+\/[\w.+-]+$/.test(type || '') ? type.toLowerCase() : 'application/octet-stream');
const dimension = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) < 100_000 ? Number(v) : null);

app.put('/api/files/:id', express.raw({ type: () => true, limit: `${MAX_FILE_MB}mb` }), route(async (req, res) => {
  const { id } = req.params;
  if (!UUID.test(id) || !UUID.test(String(req.query.note || ''))) throw new BadRequest('bad_id');
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new BadRequest('bad_file');
  const name = String(req.query.name || '').replace(/[\u0000-\u001f/\\]+/g, ' ').trim().slice(0, 200) || 'Datei';
  const meta = {
    id,
    note_id: String(req.query.note),
    name,
    type: cleanType(req.get('content-type')),
    size: req.body.length,
    width: dimension(req.query.width),
    height: dimension(req.query.height),
  };
  // Write first, then record it: a row never points at a missing file
  const already = notes.fileFor(req.user.id, id);
  if (!already) {
    const tmp = join(FILE_DIR, `${id}.part`);
    await writeFile(tmp, req.body);
    await rename(tmp, join(FILE_DIR, id));
  }
  try {
    res.json(notes.addFile(req.user.id, meta));
  } catch (err) {
    if (!already) await rm(join(FILE_DIR, id), { force: true });
    throw err;
  }
}));

// Pictures show in the page; anything else downloads, so an uploaded HTML or SVG file can't
// run as part of Zettel. The id changes with the content, so the browser may keep it for good.
app.get('/files/:id', (req, res) => {
  const file = notes.fileFor(req.user.id, req.params.id);
  if (!file) return res.status(404).type('text').send('Not found');
  const inline = IMAGE_TYPES.test(file.type) || file.type === 'application/pdf';
  res.set({
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    'X-Content-Type-Options': 'nosniff',
  });
  res.attachment(file.name);
  if (inline) res.set('Content-Disposition', res.get('Content-Disposition').replace(/^attachment/, 'inline'));
  res.sendFile(file.id, { root: FILE_DIR, headers: { 'Content-Type': file.type } }, (err) => {
    if (err && !res.headersSent) res.status(404).type('text').send('Not found');
  });
});

// --- export ---

app.get('/api/export', route(async (req, res) => {
  const data = await exportZip(notes.notesForExport(req.user.id), FILE_DIR);
  const day = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'application/zip').attachment(`Zettel ${day}.zip`).send(data);
}));

serveFrontend(app, distDir);
app.use(errorHandler());

// --- the trash empties itself ---

async function emptyTrash() {
  try {
    await removeFiles(notes.emptyOldTrash(TRASH_DAYS));
  } catch (err) {
    console.error('Emptying the trash:', err);
  }
}

await auth.ensureAdmin();
app.listen(PORT, () => console.log(`Zettel listening on :${PORT} (data in ${DATA_DIR})`));
if (TRASH_DAYS > 0) {
  emptyTrash();
  setInterval(emptyTrash, 3600_000).unref();
}
