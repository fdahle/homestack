import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as store from './db.js';
import { checkPassword, ensureAdmin, hashPassword, login, LoginLimitError, logout, requireAdmin, requireLogin, setSessionCookie } from './auth.js';
import {
  downloadCover, fetchImage, importSeries, libraryCoverUrls, loadDetails, removeCoverFiles, requestCovers, saveCoverUpload, searchSeries, startWorker, workerStatus,
} from './catalog.js';
import { GcdBusyError, GcdNotFoundError, usage } from './gcd.js';
import { lookupIsbn, parseCode } from './isbn.js';

const PORT = Number(process.env.PORT || 3067);
const distDir = fileURLToPath(new URL('../dist', import.meta.url));

const app = express();
// One proxy (nginx) in front: req.ip is the address nginx saw, not a client-supplied X-Forwarded-For
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  req.body ??= {}; // Express 5 leaves it undefined for body-less requests
  next();
});

// Async route errors go to the error handler at the bottom
const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const id = (v) => (Number.isInteger(Number(v)) ? Number(v) : NaN);
const LANGS = ['de', 'en'];

// --- login ---

app.post('/api/login', route(async (req, res) => {
  let user;
  try {
    user = await login(req.body.username, req.body.password, req.ip);
  } catch (err) {
    if (err instanceof LoginLimitError) return res.status(429).json({ error: 'too_many_attempts', retryAt: err.retryAt });
    throw err;
  }
  if (!user) return res.status(401).json({ error: 'wrong_login' });
  setSessionCookie(req, res, user);
  res.json({ ok: true });
}));

app.post('/api/logout', (req, res) => {
  logout(req, res);
  res.json({ ok: true });
});

app.use(['/api', '/covers'], requireLogin);

const publicUser = ({ password_hash, session_version, ...u }) => ({ ...u, is_admin: Boolean(u.is_admin) });

app.get('/api/me', (req, res) => res.json(publicUser(req.user)));

app.patch('/api/me', route(async (req, res) => {
  const { lang, displayName, currentPassword, newPassword } = req.body;
  if (lang !== undefined && !LANGS.includes(lang)) return res.status(400).json({ error: 'bad_lang' });
  if (newPassword !== undefined) {
    if (!(await checkPassword(req.user, currentPassword))) return res.status(400).json({ error: 'wrong_password' });
    if (String(newPassword).length < 8) return res.status(400).json({ error: 'password_too_short' });
  }
  store.updateUser(req.user.id, {
    lang,
    displayName: displayName !== undefined ? String(displayName).trim() || req.user.username : undefined,
    passwordHash: newPassword !== undefined ? await hashPassword(String(newPassword)) : undefined,
  });
  const user = store.getUser(req.user.id);
  if (newPassword !== undefined) setSessionCookie(req, res, user); // keep this device logged in
  res.json(publicUser(user));
}));

app.get('/api/users', requireAdmin, (req, res) => res.json(store.listUsers().map(publicUser)));

app.post('/api/users', requireAdmin, route(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!/^[\w.-]{2,40}$/.test(username)) return res.status(400).json({ error: 'bad_username' });
  if (password.length < 8) return res.status(400).json({ error: 'password_too_short' });
  if (store.getUserByName(username)) return res.status(400).json({ error: 'username_taken' });
  store.createUser({
    username,
    displayName: String(req.body.displayName || '').trim() || username,
    passwordHash: await hashPassword(password),
    lang: LANGS.includes(req.body.lang) ? req.body.lang : 'de',
    isAdmin: Boolean(req.body.isAdmin),
  });
  res.json(store.listUsers().map(publicUser));
}));

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  if (id(req.params.id) === req.user.id) return res.status(400).json({ error: 'cannot_delete_self' });
  store.deleteUser(id(req.params.id));
  res.json(store.listUsers().map(publicUser));
});

// --- overview ---

app.get('/api/home', (req, res) => {
  res.json({
    stats: store.homeStats(req.user.id),
    continueReading: store.continueReading(req.user.id),
    recent: store.recentlyAdded(req.user.id),
  });
});

app.get('/api/collection', (req, res) => res.json(store.listCollection(req.user.id)));

app.get('/api/wishlist', (req, res) => {
  res.json({ wanted: store.wantedIssues(req.user.id), missing: store.missingIssues(req.user.id) });
});

// --- GCD search & import ---

app.get('/api/search', route(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.status(400).json({ error: 'query_too_short' });
  const languages = String(req.query.lang || '').split(',').filter((l) => /^[a-z]{2}$/.test(l));
  const found = await searchSeries(q, { year: req.query.year, page: Math.max(1, id(req.query.page) || 1), languages });
  const local = store.localSeriesForGcd(found.results.map((r) => r.gcdId), req.user.id);
  for (const r of found.results) {
    const l = local.get(r.gcdId);
    r.localId = l?.id ?? null;
    r.collected = Boolean(l?.collected);
  }
  res.json(found);
}));

app.post('/api/series/import', route(async (req, res) => {
  const gcdId = id(req.body.gcdId);
  if (!gcdId) return res.status(400).json({ error: 'bad_request' });
  const seriesId = await importSeries(gcdId);
  store.setCollected(req.user.id, seriesId, true);
  res.json({ id: seriesId });
}));

// A series entered by hand. issues: "1-20" or "1-5, 7, 9" creates numbered issues.
app.post('/api/series', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name_required' });
  const seriesId = store.upsertSeries({
    name,
    publisher_name: String(req.body.publisher || '').trim() || null,
    year_began: id(req.body.year) || null,
    language: String(req.body.language || '').trim() || null,
  });
  const numbers = expandNumbers(String(req.body.issues || ''));
  if (numbers.length) store.addCustomIssues(seriesId, numbers.map((number) => ({ number })));
  store.setCollected(req.user.id, seriesId, true);
  res.json({ id: seriesId });
});

// "1-5, 7, 9a" → ['1','2','3','4','5','7','9a'] (at most 5000)
function expandNumbers(text) {
  const out = [];
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])].sort((x, y) => x - y);
      for (let n = a; n <= b && out.length < 5000; n++) out.push(String(n));
    } else if (out.length < 5000) out.push(part);
  }
  return out;
}

// --- series ---

const seriesOr404 = (req, res) => {
  const series = store.getSeries(id(req.params.id));
  if (!series) res.status(404).json({ error: 'not_found' });
  return series;
};

app.get('/api/series/:id', (req, res) => {
  const series = seriesOr404(req, res);
  if (!series) return;
  const status = workerStatus();
  res.json({
    series,
    collected: store.isCollected(req.user.id, series.id),
    issues: store.issuesOfSeries(series.id, req.user.id),
    coversRequested: status.requested.includes(series.id) || status.job?.seriesId === series.id,
  });
});

app.patch('/api/series/:id', (req, res) => {
  const series = seriesOr404(req, res);
  if (!series) return;
  const name = String(req.body.name ?? series.name).trim();
  if (!name) return res.status(400).json({ error: 'name_required' });
  store.updateSeriesInfo(series.id, {
    name,
    publisher_name: String(req.body.publisher ?? series.publisher_name ?? '').trim(),
    year_began: id(req.body.year ?? series.year_began) || null,
    language: String(req.body.language ?? series.language ?? '').trim(),
  });
  res.json(store.getSeries(series.id));
});

app.post('/api/series/:id/collect', (req, res) => {
  const series = seriesOr404(req, res);
  if (!series) return;
  store.setCollected(req.user.id, series.id, Boolean(req.body.collected));
  res.json({ ok: true });
});

app.post('/api/series/:id/sync', route(async (req, res) => {
  const series = seriesOr404(req, res);
  if (!series) return;
  if (!series.gcd_id) return res.status(400).json({ error: 'not_from_gcd' });
  await importSeries(series.gcd_id, { maxAgeMs: 0 });
  res.json({ ok: true });
}));

app.post('/api/series/:id/covers', (req, res) => {
  const series = seriesOr404(req, res);
  if (!series) return;
  requestCovers(series.id);
  res.json({ ok: true });
});

app.post('/api/series/:id/issues', (req, res) => {
  const series = seriesOr404(req, res);
  if (!series) return;
  const numbers = expandNumbers(String(req.body.numbers || ''));
  if (!numbers.length) return res.status(400).json({ error: 'numbers_required' });
  const title = numbers.length === 1 ? String(req.body.title || '').trim() : '';
  const ids = store.addCustomIssues(series.id, numbers.map((number) => ({ number, title, variant: String(req.body.variant || '').trim() })));
  res.json({ ids });
});

// Only hand-entered series can be deleted; GCD series are just removed from the collection.
// Deleting takes everyone's statuses with it, so if others use it, only an admin may.
app.delete('/api/series/:id', route(async (req, res) => {
  const series = seriesOr404(req, res);
  if (!series) return;
  if (series.gcd_id) return res.status(400).json({ error: 'not_custom' });
  if (!req.user.is_admin && store.seriesUsedByOthers(series.id, req.user.id)) return res.status(403).json({ error: 'used_by_others' });
  const covers = store.coverFilesOfSeries(series.id);
  store.deleteSeries(series.id);
  await removeCoverFiles(covers);
  res.json({ ok: true });
}));

// --- issues ---

const issueOr404 = (req, res) => {
  const issue = store.getIssueForUser(id(req.params.id), req.user.id);
  if (!issue) res.status(404).json({ error: 'not_found' });
  return issue;
};

app.get('/api/issues/:id', route(async (req, res) => {
  let issue = issueOr404(req, res);
  if (!issue) return;
  let detailsError = null;
  if (issue.gcd_id && !issue.details_at && !issue.details_failed) {
    try {
      await loadDetails(issue);
      issue = store.getIssueForUser(issue.id, req.user.id);
    } catch (err) {
      detailsError = err instanceof GcdBusyError ? 'gcd_busy' : err instanceof GcdNotFoundError ? 'gcd_not_found' : 'gcd_failed';
    }
  }
  res.json({ issue, variants: store.variantsOf(issue), others: store.otherOwners(issue.id, req.user.id), detailsError });
}));

const EDITABLE = ['number', 'title', 'variant', 'isbn', 'key_date', 'price'];

app.patch('/api/issues/:id', (req, res) => {
  const issue = issueOr404(req, res);
  if (!issue) return;
  const fields = {};
  for (const key of EDITABLE) if (req.body[key] !== undefined) fields[key] = String(req.body[key]).trim() || null;
  if (fields.number === null) fields.number = '';
  if (fields.title === null) fields.title = '';
  if (fields.variant === null) fields.variant = '';
  if (fields.isbn) fields.isbn = parseCode(fields.isbn).isbn13 || fields.isbn.replace(/[^0-9X]/gi, '');
  store.updateIssueInfo(issue.id, fields);
  // Remember what was changed by hand, so loading details from GCD keeps it
  const changed = Object.keys(fields).filter((k) => fields[k] !== (issue[k] ?? (['number', 'title', 'variant'].includes(k) ? '' : null)));
  if (changed.length) store.markUserFields(issue.id, changed);
  res.json(store.getIssueForUser(issue.id, req.user.id));
});

// Deleting takes everyone's statuses with it, so if others use the issue, only an admin may.
app.delete('/api/issues/:id', route(async (req, res) => {
  const issue = issueOr404(req, res);
  if (!issue) return;
  if (issue.gcd_id) return res.status(400).json({ error: 'not_custom' });
  if (!req.user.is_admin && store.issueUsedByOthers(issue.id, req.user.id)) return res.status(403).json({ error: 'used_by_others' });
  store.deleteIssue(issue.id);
  await removeCoverFiles([issue.cover_file]);
  res.json({ ok: true });
}));

app.post('/api/issues/:id/refresh', route(async (req, res) => {
  const issue = issueOr404(req, res);
  if (!issue) return;
  if (!issue.gcd_id) return res.status(400).json({ error: 'not_from_gcd' });
  store.updateIssueInfo(issue.id, { details_failed: 0 });
  await loadDetails(issue, { refresh: true });
  res.json(store.getIssueForUser(issue.id, req.user.id));
}));

app.put('/api/issues/:id/cover', express.raw({ type: 'image/*', limit: '15mb' }), route(async (req, res) => {
  const issue = issueOr404(req, res);
  if (!issue) return;
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'image_required' });
  await saveCoverUpload(issue.id, req.body, req.get('content-type') || '');
  res.json(store.getIssueForUser(issue.id, req.user.id));
}));

app.patch('/api/issues/:id/mine', (req, res) => {
  const issue = issueOr404(req, res);
  if (!issue) return;
  const rating = req.body.rating === undefined ? undefined : Math.max(0, Math.min(5, id(req.body.rating) || 0));
  const notes = req.body.notes === undefined ? undefined : String(req.body.notes).slice(0, 5000);
  store.setPersonal(req.user.id, issue.id, { rating, notes });
  res.json(store.getIssueForUser(issue.id, req.user.id));
});

// Sets owned/read/wanted on many issues at once: { ids: [...], owned: true, read: false }
app.post('/api/status', (req, res) => {
  const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).map(id).filter(Number.isInteger))].slice(0, 10_000);
  const flags = {};
  for (const flag of ['owned', 'read', 'wanted']) if (typeof req.body[flag] === 'boolean') flags[flag] = req.body[flag];
  if (!ids.length || !Object.keys(flags).length) return res.status(400).json({ error: 'bad_request' });
  if (store.existingIssueIds(ids).length !== ids.length) return res.status(400).json({ error: 'not_found' });
  store.setStatus(req.user.id, ids, flags);
  // Marking something owned in a series you don't track yet adds the series to your collection
  if (flags.owned || flags.read || flags.wanted) {
    const seriesIds = new Set(ids.map((i) => store.getIssue(i)?.series_id).filter(Boolean));
    for (const s of seriesIds) store.setCollected(req.user.id, s, true);
  }
  res.json({ ok: true });
});

// --- barcode / ISBN ---

app.get('/api/lookup/:code', route(async (req, res) => {
  const parsed = parseCode(req.params.code);
  if (parsed.code.length < 8) return res.status(400).json({ error: 'bad_code' });
  const matches = store.findByCode(parsed.code, parsed.isbn13, parsed.isbn10, req.user.id);
  const book = !matches.length && parsed.isbn13 ? await lookupIsbn(parsed.isbn13) : null;
  res.json({ ...parsed, matches, book });
}));

// The DNB/Open Library cover for an ISBN, passed through so the scan result can show it
app.get('/api/library-cover/:isbn', route(async (req, res) => {
  const { isbn13 } = parseCode(req.params.isbn);
  if (!isbn13) return res.status(400).end();
  for (const url of libraryCoverUrls(isbn13)) {
    const image = await fetchImage(url).catch(() => null);
    if (image) return res.type(image.type).set('Cache-Control', 'private, max-age=86400').send(image.buffer);
  }
  res.status(404).end();
}));

// Remembers a scanned code on an issue so the next scan finds it directly.
// Also takes the library's cover if the issue has none.
app.post('/api/issues/:id/code', route(async (req, res) => {
  const issue = issueOr404(req, res);
  if (!issue) return;
  const parsed = parseCode(req.body.code);
  if (parsed.isbn13 && !issue.isbn) {
    store.updateIssueInfo(issue.id, { isbn: parsed.isbn13 });
    store.markUserFields(issue.id, ['isbn']);
  } else if (!parsed.isbn13 && parsed.code.length >= 8 && !issue.barcode) {
    store.updateIssueInfo(issue.id, { barcode: parsed.code });
    store.markUserFields(issue.id, ['barcode']);
  }
  const cover = String(req.body.cover || '');
  if (!issue.cover_file && /^https:\/\/(portal\.dnb\.de|covers\.openlibrary\.org)\//.test(cover)) {
    try {
      await downloadCover(issue.id, cover);
    } catch (err) {
      console.warn(`Library cover for issue ${issue.id}: ${err.message}`);
    }
  }
  res.json(store.getIssueForUser(issue.id, req.user.id));
}));

// --- settings & export ---

app.get('/api/system', (req, res) => {
  res.json({ gcd: usage(), worker: workerStatus(), covers: store.coverCount() });
});

app.get('/api/export.json', (req, res) => {
  res.attachment(`stapel-${req.user.username}-${new Date().toISOString().slice(0, 10)}.json`)
    .json({ app: 'stapel', exportedAt: store.now(), user: req.user.username, items: store.exportRows(req.user.id) });
});

app.get('/api/export.csv', (req, res) => {
  const rows = store.exportRows(req.user.id);
  const columns = rows.length ? Object.keys(rows[0]) : ['series'];
  // Text starting with = + - @ would run as a formula in a spreadsheet; a leading ' keeps it text
  const text = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : String(v));
  const cell = (v) => (v == null ? '' : /[",;\r\n]/.test(text(v)) ? `"${text(v).replace(/"/g, '""')}"` : text(v));
  const csv = [columns.join(';'), ...rows.map((r) => columns.map((c) => cell(r[c])).join(';'))].join('\r\n');
  res.attachment(`stapel-${req.user.username}-${new Date().toISOString().slice(0, 10)}.csv`).type('text/csv').send(`﻿${csv}`);
});

// --- static files ---

// private: covers are behind the login, so shared caches (Cloudflare) must not keep them
app.use('/covers', express.static(store.COVER_DIR, {
  cacheControl: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'private, max-age=31536000, immutable'),
}));
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

if (existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: '1h', setHeaders: (res, path) => {
    if (/[\\/]assets[\\/]/.test(path)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } }));
  // Everything else is a page of the single-page app
  app.get('/{*path}', (req, res) => res.sendFile('index.html', { root: distDir, headers: { 'Cache-Control': 'no-cache' } }));
}

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof GcdBusyError) return res.status(503).json({ error: 'gcd_busy', retryAt: err.retryAt });
  if (err instanceof GcdNotFoundError) return res.status(404).json({ error: 'gcd_not_found' });
  // Body parser errors (bad JSON, too large) carry their own 4xx status
  const status = err.status ?? err.statusCode;
  if (status >= 400 && status < 500) return res.status(status).json({ error: err.type === 'entity.too.large' ? 'too_large' : 'bad_request' });
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

await ensureAdmin();
app.listen(PORT, () => {
  console.log(`Stapel listening on :${PORT}`);
  startWorker();
});
