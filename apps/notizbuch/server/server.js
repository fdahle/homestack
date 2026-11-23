import express from 'express';
import { randomUUID } from 'node:crypto';
import { renameSync, rmSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, FILE_DIR, openDatabase } from './db.js';
import { exportZip } from './export.js';
import { createAuth } from './kit/auth.js';
import { BadRequest, bigJson, createApp, errorHandler, mountAccount, route, serveFrontend } from './kit/http.js';
import { UUID } from './notes.js';

const PORT = Number(process.env.PORT || 3070);
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 25);
// All of one account's files together: a full disk would stop everyone's notes from saving
const MAX_USER_BYTES = Number(process.env.MAX_USER_MB || 2048) * 1024 * 1024;
const TRASH_DAYS = Number(process.env.TRASH_DAYS || 30);
const distDir = fileURLToPath(new URL('../dist', import.meta.url));

const { users, notes } = openDatabase();
// A sync may carry many notes written offline: up to 20 MB, read only after the login check.
// An upload (/api/files/<id>) is read raw by its own route, so the kit's JSON parser must leave
// it alone too: a .json file would arrive parsed, not as the file.
const app = createApp({ bigBodies: ['/api/sync', '/api/files/'] });
const auth = createAuth({ users, cookie: 'notizbuch_session' });

// Login, logout, /api/me; everything under /api and /files after this needs a login
mountAccount(app, { auth, users, protect: ['/api', '/files'] });

const removeFiles = (ids) => Promise.all(ids.map((id) => rm(join(FILE_DIR, id), { force: true }))).catch((err) => console.warn(`Removing files: ${err.message}`));

app.get('/api/settings', (req, res) => res.json({ maxFileMb: MAX_FILE_MB, trashDays: TRASH_DAYS }));

// --- keeping devices in step (see notes.js) ---

app.post('/api/sync', bigJson('20mb'), (req, res) => {
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
  // Checked before anything touches the disk: an id that is taken (another account's file, one
  // deleted for good) is refused, a file sent before comes back as it is
  const sent = notes.checkUpload(req.user.id, meta, MAX_USER_BYTES);
  if (sent) return res.json(sent);
  // Write first, then record it: a row never points at a missing file
  const tmp = join(FILE_DIR, `${id}.${randomUUID()}.part`);
  await writeFile(tmp, req.body).catch(async (err) => {
    await rm(tmp, { force: true }); // a half-written file (disk full) mustn't stay behind
    throw err;
  });
  // Nothing awaits from here until the row is in, so two uploads of the same id can't cross:
  // the check again (the other one may have finished meanwhile), then move it in place
  const path = join(FILE_DIR, id);
  try {
    const meanwhile = notes.checkUpload(req.user.id, meta, MAX_USER_BYTES);
    if (meanwhile) {
      rmSync(tmp, { force: true });
      return res.json(meanwhile);
    }
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  try {
    res.json(notes.addFile(req.user.id, meta, MAX_USER_BYTES));
  } catch (err) {
    rmSync(path, { force: true });
    throw err;
  }
}));

// Pictures show in the page; anything else downloads, so an uploaded HTML or SVG file can't
// run as part of Notizbuch. The id changes with the content, so the browser may keep it for good.
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

// Sent as it is made (see zip.js), one file at a time, so a big export doesn't sit in memory
app.get('/api/export', route(async (req, res) => {
  const day = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'application/zip').attachment(`Notizbuch ${day}.zip`);
  try {
    await pipeline(Readable.from(exportZip(notes.notesForExport(req.user.id), FILE_DIR)), res);
  } catch (err) {
    if (res.destroyed && err.code === 'ERR_STREAM_PREMATURE_CLOSE') return; // the download was cancelled
    throw err;
  }
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
app.listen(PORT, () => console.log(`Notizbuch listening on :${PORT} (data in ${DATA_DIR})`));
if (TRASH_DAYS > 0) {
  emptyTrash();
  setInterval(emptyTrash, 3600_000).unref();
}
