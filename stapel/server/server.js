import express from 'express';
import { fileURLToPath } from 'node:url';
import * as store from './db.js';
import { createAuth, hashPassword } from './kit/auth.js';
import { createApp, errorHandler, mountAccount, route, serveFrontend, servePrivateFiles, toId as id } from './kit/http.js';
import {
  downloadCover, fetchImage, importSeries, libraryCoverUrls, loadDetails, removeCoverFiles, requestCovers, saveCoverUpload, searchSeries, seriesCoverStatus, startWorker,
  workerStatus,
} from './catalog.js';
import { GcdBusyError, GcdNotFoundError, usage } from './gcd.js';
import { ComicVineBusyError, comicVineUsage, getVolume } from './comicvine.js';
import { linkVolume, seriesCvStatus, startCoverWorker, volumeCandidates, wakeCovers } from './covers.js';
import { lookupIsbn, parseCode } from './isbn.js';

const PORT = Number(process.env.PORT || 3067);
const distDir = fileURLToPath(new URL('../dist', import.meta.url));

const app = createApp({ jsonLimit: '2mb' });
// The same cookie as before Stapel used the kit, so nobody has to log in again
const auth = createAuth({ users: store.users, cookie: 'stapel_session' });
const LANGS = ['de', 'en'];

// --- login (kit): POST /api/login, /api/logout, GET/PATCH /api/me; everything after needs a login ---

mountAccount(app, { auth, users: store.users, protect: ['/api', '/covers'], me: (user) => ({ is_admin: store.isAdmin(user.id) }) });

// The first account is the admin (also the first one Authelia brings, behind a login proxy).
// req.user.is_admin: admins may also delete what others have marked.
app.use('/api', (req, res, next) => {
  if (!store.hasAdmin()) store.setAdmin(req.user.id);
  req.user.is_admin = store.isAdmin(req.user.id);
  next();
});

function requireAdmin(req, res, next) {
  if (!req.user.is_admin) return res.status(403).json({ error: 'forbidden' });
  next();
}

// --- people who share the catalog (admins only) ---

const publicUser = ({ password_hash, session_version, ...u }) => ({ ...u, is_admin: Boolean(u.is_admin) });

app.get('/api/users', requireAdmin, (req, res) => res.json(store.listUsers().map(publicUser)));

app.post('/api/users', requireAdmin, route(async (req, res) => {
  // Behind a login proxy, people get their account by logging in there
  if (auth.viaProxy) return res.status(400).json({ error: 'login_via_proxy' });
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!/^[\w.-]{2,40}$/.test(username)) return res.status(400).json({ error: 'bad_username' });
  if (password.length < 8) return res.status(400).json({ error: 'password_too_short' });
  if (store.users.getUserByName(username)) return res.status(400).json({ error: 'username_taken' });
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
  wakeCovers();
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
  wakeCovers();
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
  res.json({
    series,
    collected: store.isCollected(req.user.id, series.id),
    issues: store.issuesOfSeries(series.id, req.user.id),
    covers: seriesCoverStatus(series.id),
    comicvine: seriesCvStatus(series.id),
  });
});

// Comic Vine volumes that could supply this series' covers, best fits first
app.get('/api/series/:id/comicvine', route(async (req, res) => {
  const series = seriesOr404(req, res);
  if (!series) return;
  res.json(await volumeCandidates(series, String(req.query.q || '').trim()));
}));

// Links the series to a Comic Vine volume ({ volumeId }), or to none ({ volumeId: null })
app.post('/api/series/:id/comicvine', route(async (req, res) => {
  const series = seriesOr404(req, res);
  if (!series) return;
  const volumeId = req.body.volumeId == null ? null : id(req.body.volumeId);
  if (Number.isNaN(volumeId)) return res.status(400).json({ error: 'bad_request' });
  await linkVolume(series.id, volumeId ? await getVolume(volumeId) : null);
  res.json(seriesCvStatus(series.id));
}));

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
  wakeCovers();
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
  res.json(seriesCoverStatus(series.id));
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
  res.json({
    gcd: usage(),
    worker: workerStatus(),
    covers: store.coverCount(),
    comicvine: { ...comicVineUsage(), waiting: store.countCvCoversWaiting() },
  });
});

// What's going on in the background, per series of the collection: covers coming
// from Comic Vine, series that need their Comic Vine series picked, GCD details.
app.get('/api/activity', (req, res) => {
  const gcd = usage();
  const cv = comicVineUsage();
  const series = [];
  for (const p of store.collectionProgress(req.user.id)) {
    const cvStatus = cv.enabled ? seriesCvStatus(p.id) : null;
    const needsPick = cv.enabled && (p.cv_state === 'unmatched' || p.cv_state === null);
    if (!p.covers_waiting && !p.details_waiting && !needsPick && !(cvStatus?.volume && !cvStatus.synced)) continue;
    const details = p.details_waiting ? seriesCoverStatus(p.id) : null;
    series.push({
      id: p.id,
      name: p.name,
      cv: cvStatus && {
        state: cvStatus.state,
        volumeName: cvStatus.volume?.name ?? null,
        synced: cvStatus.synced,
        done: p.covers_done,
        waiting: p.covers_waiting,
        doneAt: cvStatus.doneAt,
      },
      details: { done: p.details_done, waiting: p.details_waiting, doneAt: details?.doneAt ?? null, requested: details?.requested ?? false },
    });
  }
  const cvSeries = series.filter((s) => s.cv?.waiting);
  res.json({
    comicvine: { enabled: cv.enabled, cooldownUntil: cv.cooldownUntil, waiting: cvSeries.reduce((n, s) => n + s.cv.waiting, 0), doneAt: cvSeries.map((s) => s.cv.doneAt).sort().at(-1) ?? null },
    gcd: { perHour: gcd.backgroundPerHour, pausedUntil: gcd.cooldownUntil, account: gcd.account },
    series,
  });
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

// Covers are behind the login, so shared caches (Cloudflare) must not keep them
servePrivateFiles(app, '/covers', store.COVER_DIR);
serveFrontend(app, distDir);

app.use(errorHandler((err, req, res) => {
  if (err instanceof GcdBusyError) res.status(503).json({ error: 'gcd_busy', retryAt: err.retryAt });
  else if (err instanceof GcdNotFoundError) res.status(404).json({ error: 'gcd_not_found' });
  else if (err instanceof ComicVineBusyError) res.status(503).json({ error: 'comicvine_busy', retryAt: err.retryAt });
  else return false;
  return true;
}));

await auth.ensureAdmin();
app.listen(PORT, () => {
  console.log(`Stapel listening on :${PORT}`);
  startWorker();
  startCoverWorker();
});
