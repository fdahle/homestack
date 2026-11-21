// Brings series, issues and covers from GCD into the local catalog, and runs the
// background worker that fills in issue details and covers over time.

import { unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import * as store from './db.js';
import { BACKGROUND_PER_HOUR, BACKGROUND_SPACING_MS, DAY_MS, gcdGet, GcdBusyError, GcdNotFoundError, idFromUrl, nextBackgroundAt, usage } from './gcd.js';
import { parseCode } from './isbn.js';

const USER_AGENT = process.env.USER_AGENT || 'Stapel/1.0 (self-hosted comic collection tracker)';
const RESYNC_DAYS = Number(process.env.RESYNC_DAYS || 7);

// "12 - Der Titel [Nachdruck 2021]" → { number: '12', title: 'Der Titel', variant: 'Nachdruck 2021' }
export function parseDescriptor(descriptor) {
  const m = /^(.*?)\s*(?:\[([^\]]*)\])?$/s.exec(String(descriptor || '').trim());
  const rest = m[1].trim();
  const dash = rest.indexOf(' - ');
  return {
    number: (dash >= 0 ? rest.slice(0, dash) : rest).trim(),
    title: dash >= 0 ? rest.slice(dash + 3).trim() : '',
    variant: (m[2] || '').trim(),
  };
}

function seriesFormat(s) {
  return [s.publishing_format, s.binding].map((v) => String(v || '').trim()).find(Boolean) || null;
}

// --- search ---

const publisherQueue = new Set();

function searchResult(s) {
  const publisherId = idFromUrl(s.publisher);
  const publisher = publisherId ? store.publisherName(publisherId) : null;
  if (publisherId && !publisher) publisherQueue.add(publisherId);
  const main = [];
  const seen = new Set();
  for (const d of s.issue_descriptors || []) {
    const p = parseDescriptor(d);
    if (seen.has(p.number)) continue;
    seen.add(p.number);
    main.push(p);
  }
  return {
    gcdId: idFromUrl(s.api_url),
    name: s.name,
    yearBegan: s.year_began ?? null,
    yearEnded: s.year_ended ?? null,
    language: s.language || null,
    country: s.country || null,
    publisher,
    format: seriesFormat(s),
    issueCount: main.length,
    first: main[0] || null,
    last: main.length > 1 ? main.at(-1) : null,
  };
}

// GCD's name search returns every language, sorted by name, 20 per page, and can't
// filter by language. So with a language filter, keep reading pages until there
// are enough matches (at most 5 pages per call; pages are cached).
export async function searchSeries(query, { year, page = 1, languages = [] } = {}) {
  const base = `/series/name/${encodeURIComponent(query.trim())}/${year ? `year/${Number(year)}/` : ''}`;
  const results = [];
  let count = 0;
  let nextPage = page;
  for (let fetched = 0; nextPage && fetched < 5 && results.length < 12; fetched++) {
    const data = await gcdGet(`${base}?page=${nextPage}`, { maxAgeMs: 3 * DAY_MS });
    count = data.count ?? 0;
    for (const s of data.results || []) if (!languages.length || languages.includes(s.language)) results.push(searchResult(s));
    nextPage = data.next ? nextPage + 1 : null;
    if (!languages.length) break;
  }
  // Exact and prefix matches first, otherwise GCD's order
  const q = query.trim().toLowerCase();
  const rank = (r) => (r.name.toLowerCase() === q ? 0 : r.name.toLowerCase().startsWith(q) ? 1 : 2);
  results.sort((a, b) => rank(a) - rank(b));
  return { count, results, nextPage };
}

// --- series ---

async function ensurePublisher(publisherId, { background = false } = {}) {
  if (!publisherId || store.publisherName(publisherId)) return;
  const p = await gcdGet(`/publisher/${publisherId}/`, { maxAgeMs: 365 * DAY_MS, background });
  if (p?.name) store.savePublisher(publisherId, p.name);
  publisherQueue.delete(publisherId);
}

// Fetches a GCD series with its full issue list and stores it. Returns the local id.
export async function importSeries(gcdId, { background = false, maxAgeMs = DAY_MS } = {}) {
  const s = await gcdGet(`/series/${gcdId}/`, { maxAgeMs, background });
  const publisherId = idFromUrl(s.publisher);
  const seriesId = store.upsertSeries({
    gcd_id: gcdId,
    name: s.name,
    year_began: s.year_began ?? null,
    year_ended: s.year_ended ?? null,
    publisher_gcd_id: publisherId,
    publisher_name: publisherId ? store.publisherName(publisherId) : null,
    language: s.language || null,
    country: s.country || null,
    format: seriesFormat(s),
    notes: s.notes || null,
    synced_at: store.now(),
  });

  // issue_descriptors and active_issues are parallel lists in GCD's order
  const seen = new Set();
  const issues = (s.active_issues || []).map((url, i) => {
    const p = parseDescriptor(s.issue_descriptors?.[i]);
    const isVariant = seen.has(p.number);
    seen.add(p.number);
    return { gcd_id: idFromUrl(url), position: i + 1, ...p, is_variant: isVariant };
  }).filter((it) => it.gcd_id);
  await removeCoverFiles(store.syncIssues(seriesId, issues));
  // New issues need their Comic Vine covers assigned too
  store.db.prepare('UPDATE series SET cv_synced_at = NULL WHERE id = ? AND cv_volume_id IS NOT NULL').run(seriesId);

  try {
    await ensurePublisher(publisherId, { background });
  } catch {
    publisherQueue.add(publisherId); // the worker retries later
  }
  return seriesId;
}

// --- issue details & covers ---

const cleanNames = (value) =>
  String(value || '')
    .split(';')
    .map((n) => n.replace(/\([^)]*\)|\[[^\]]*\]|\?/g, '').trim())
    .filter((n) => n && !/^(none|typeset|various)$/i.test(n));

function creditsOf(stories = []) {
  const script = new Set();
  const art = new Set();
  for (const st of stories) {
    if (!/comic story/i.test(st.type || '')) continue;
    for (const n of cleanNames(st.script)) script.add(n);
    for (const n of [...cleanNames(st.pencils), ...cleanNames(st.inks)]) art.add(n);
  }
  return script.size || art.size ? JSON.stringify({ script: [...script].slice(0, 8), art: [...art].slice(0, 8) }) : null;
}

const firstCode = (value, pattern) => String(value || '').split(/[;,]/).map((v) => v.replace(pattern, '')).find((v) => v.length >= 8) || null;

// Covers are downloaded only from these hosts (Open Library redirects to archive.org),
// checked again on every redirect.
const COVER_HOSTS = /(^|\.)(dnb\.de|openlibrary\.org|archive\.org)$|^comicvine\.gamespot\.com$/;
const MAX_COVER_BYTES = 10 * 1024 * 1024;

function allowedCoverUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.port && !u.username && !u.password && COVER_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

export const libraryCoverUrls = (isbn13) => [`https://portal.dnb.de/opac/mvb/cover?isbn=${isbn13}`, `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg?default=false`];

// Downloads an image from a library cover host: { type, buffer }
export async function fetchImage(url) {
  for (let hop = 0; hop < 5; hop++) {
    if (!allowedCoverUrl(url)) throw new Error(`Cover URL not allowed: ${url}`);
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      url = new URL(location, url).href;
      continue;
    }
    const type = res.headers.get('content-type') || '';
    // Comic Vine serves its images as application/octet-stream; the bytes tell the format
    if (!res.ok || !/^(image\/(jpeg|png|webp|gif)|application\/octet-stream)\b/.test(type)) {
      await res.body?.cancel();
      throw new Error(`Cover download failed (${res.status} ${type})`);
    }
    const buffer = await readCapped(res, MAX_COVER_BYTES);
    const sniffed = imageType(buffer);
    if (!sniffed) throw new Error('Cover download failed (not an image)');
    return { type: sniffed, buffer };
  }
  throw new Error('Cover download failed (too many redirects)');
}

function imageType(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 4).toString('hex') === '89504e47') return 'image/png';
  if (b.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

async function readCapped(res, max) {
  if (Number(res.headers.get('content-length')) > max) {
    await res.body?.cancel();
    throw new Error('Cover download failed (too large)');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body ?? []) {
    size += chunk.length;
    if (size > max) throw new Error('Cover download failed (too large)'); // leaving the loop cancels the stream
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function removeCoverFiles(files) {
  for (const file of files) if (file) await unlink(join(store.COVER_DIR, basename(file))).catch(() => {});
}

// Stores an image as the issue's cover and removes the one it replaces.
// source: 'cv' (Comic Vine), 'library' (DNB/Open Library) or 'photo' (uploaded)
async function storeCover(issueId, buffer, type, source) {
  const previous = store.getIssue(issueId)?.cover_file;
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : type.includes('gif') ? 'gif' : 'jpg';
  const file = `${issueId}-${Date.now().toString(36)}.${ext}`;
  await writeFile(join(store.COVER_DIR, file), buffer);
  store.updateIssueInfo(issueId, { cover_file: file, cover_source: source });
  if (previous && previous !== file) await removeCoverFiles([previous]);
  return file;
}

let lastCoverDownload = 0;

export async function downloadCover(issueId, url, source = 'library') {
  const wait = lastCoverDownload + 700 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCoverDownload = Date.now();
  const { type, buffer } = await fetchImage(url);
  return storeCover(issueId, buffer, type, source);
}

export async function saveCoverUpload(issueId, buffer, type) {
  const file = await storeCover(issueId, buffer, type, 'photo');
  store.markUserFields(issueId, ['cover']);
  return file;
}

// Loads number-independent details (date, price, ISBN, barcode, credits, cover) for one issue.
// Fields set in the app (user_fields) are kept. refresh: also replace a library cover.
export async function loadDetails(issue, { background = false, refresh = false } = {}) {
  if (!issue.gcd_id) return;
  let d;
  try {
    d = await gcdGet(`/issue/${issue.gcd_id}/`, { cache: false, background });
  } catch (err) {
    if (err instanceof GcdNotFoundError) store.updateIssueInfo(issue.id, { details_failed: 1 });
    throw err;
  }
  // Read again: the issue may have been edited while the request waited for GCD
  const current = store.getIssue(issue.id);
  if (!current) return;
  const own = store.userFields(current);
  const pick = (field, value) => (own.has(field) ? current[field] : value || current[field] || null);
  // GCD doesn't allow servers to download its cover scans, so only the link is kept
  // and the browser shows it. Issues with an ISBN get a stored cover from the DNB.
  const coverUrl = d.cover && !/no_?cover/i.test(d.cover) ? d.cover : null;
  const isbn = current.isbn || firstCode(d.isbn, /[^0-9X]/gi);
  store.updateIssueInfo(issue.id, {
    title: current.title || d.title || '',
    key_date: pick('key_date', d.key_date || d.on_sale_date || d.publication_date),
    price: pick('price', String(d.price || '').split(';')[0].trim()),
    page_count: Math.round(Number(d.page_count)) || null,
    isbn,
    barcode: pick('barcode', firstCode(d.barcode, /\D/g)),
    credits: creditsOf(d.story_set),
    cover_url: coverUrl,
    details_at: store.now(),
  });
  if (isbn && (!current.cover_file || (refresh && !own.has('cover')))) await libraryCover(issue.id, isbn);
}

// Stores the DNB's (German books) or Open Library's cover for an ISBN, if either has one.
export async function libraryCover(issueId, isbn) {
  const { isbn13 } = parseCode(isbn);
  if (!isbn13) return;
  for (const url of libraryCoverUrls(isbn13)) {
    try {
      return await downloadCover(issueId, url);
    } catch {
      // try the next library
    }
  }
}

// --- background worker ---
//
// Works through a waiting list slowly, within the background budget of gcd.js
// (by default 25 requests an hour without a GCD account): publishers, weekly
// refreshes, then issue details with their covers.

// Series moved to the front of the list with "Cover laden"
const requestedSeries = new Set();
const unknownPublishers = new Set();
let activeJob = null;

export function requestCovers(seriesId) {
  requestedSeries.add(seriesId);
  wake();
}

const requestedList = () => {
  for (const id of requestedSeries) if (!store.seriesHasWaitingDetails(id)) requestedSeries.delete(id);
  return [...requestedSeries];
};

export function workerStatus() {
  return {
    job: activeJob,
    requested: requestedList(),
    pending: store.countIssuesNeedingDetails(requestedList()),
    nextAt: new Date(nextBackgroundAt()).toISOString(),
    perHour: BACKGROUND_PER_HOUR,
  };
}

// Covers of one series still waiting, and when the last of them should be there.
// Estimates assume nothing else jumps the queue and no searches use up the budget.
export function seriesCoverStatus(seriesId) {
  const requested = requestedList();
  const q = store.seriesQueue(seriesId, requested);
  const at = (place) => (place ? new Date(nextBackgroundAt() + (place - 1) * BACKGROUND_SPACING_MS).toISOString() : null);
  return {
    waiting: q.waiting,
    waitingMain: q.waitingMain,
    requested: requested.includes(seriesId),
    nextAt: at(q.first),
    doneMainAt: at(q.lastMain),
    doneAt: at(q.last),
    perHour: BACKGROUND_PER_HOUR,
    pausedUntil: usage().cooldownUntil,
  };
}

async function runOnce() {
  // Waits for the next background slot; wake() cuts the wait short when something changes
  const wait = nextBackgroundAt() - Date.now();
  if (wait > 0) return Math.min(wait + 50, 15 * 60_000);

  const publisherId = [...publisherQueue][0] ?? store.seriesMissingPublisher([...unknownPublishers]);
  if (publisherId) {
    activeJob = { type: 'publisher' };
    try {
      await ensurePublisher(publisherId, { background: true });
    } catch (err) {
      if (!(err instanceof GcdNotFoundError)) throw err;
      publisherQueue.delete(publisherId);
      unknownPublishers.add(publisherId); // don't ask again until the next start
    }
    return 0;
  }

  const stale = store.seriesNeedingSync(new Date(Date.now() - RESYNC_DAYS * DAY_MS).toISOString());
  if (stale) {
    activeJob = { type: 'sync', seriesId: stale.id };
    await importSeries(stale.gcd_id, { background: true, maxAgeMs: 0 });
    return 0;
  }

  const issue = store.nextIssueNeedingDetails(requestedList());
  if (issue) {
    activeJob = { type: 'details', seriesId: issue.series_id };
    await loadDetails(issue, { background: true });
    return 0;
  }
  return 60_000;
}

let wakeUp = null;
const wake = () => wakeUp?.();

export async function startWorker() {
  for (;;) {
    let delay;
    try {
      delay = await runOnce();
    } catch (err) {
      if (err instanceof GcdBusyError) delay = Math.max(10_000, Date.parse(err.retryAt) - Date.now());
      else if (err instanceof GcdNotFoundError) delay = 1000;
      else {
        console.warn(`Background job failed: ${err.message}`);
        delay = 60_000;
      }
    }
    activeJob = null;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, delay);
      wakeUp = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    wakeUp = null;
  }
}
