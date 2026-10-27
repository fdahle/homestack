// Brings series, issues and covers from GCD into the local catalog, and runs the
// background worker that fills in issue details and covers over time.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as store from './db.js';
import { canRunBackground, DAY_MS, gcdGet, GcdBusyError, GcdNotFoundError, idFromUrl } from './gcd.js';
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
  store.syncIssues(seriesId, issues);

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

let lastCoverDownload = 0;

export async function downloadCover(issueId, url) {
  const wait = lastCoverDownload + 700 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCoverDownload = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.startsWith('image/')) throw new Error(`Cover download failed (${res.status} ${type})`);
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const file = `${issueId}-${Date.now().toString(36)}.${ext}`;
  await writeFile(join(store.COVER_DIR, file), Buffer.from(await res.arrayBuffer()));
  store.updateIssueInfo(issueId, { cover_file: file });
  return file;
}

export async function saveCoverUpload(issueId, buffer, type) {
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const file = `${issueId}-${Date.now().toString(36)}.${ext}`;
  await writeFile(join(store.COVER_DIR, file), buffer);
  store.updateIssueInfo(issueId, { cover_file: file });
  return file;
}

// Loads number-independent details (date, price, ISBN, barcode, credits, cover) for one issue.
export async function loadDetails(issue, { background = false } = {}) {
  if (!issue.gcd_id) return;
  let d;
  try {
    d = await gcdGet(`/issue/${issue.gcd_id}/`, { cache: false, background });
  } catch (err) {
    if (err instanceof GcdNotFoundError) store.updateIssueInfo(issue.id, { details_failed: 1 });
    throw err;
  }
  // GCD doesn't allow servers to download its cover scans, so only the link is kept
  // and the browser shows it. Issues with an ISBN get a stored cover from the DNB.
  const coverUrl = d.cover && !/no_?cover/i.test(d.cover) ? d.cover : null;
  const isbn = issue.isbn || firstCode(d.isbn, /[^0-9X]/gi);
  store.updateIssueInfo(issue.id, {
    title: issue.title || d.title || '',
    key_date: d.key_date || d.on_sale_date || d.publication_date || null,
    price: String(d.price || '').split(';')[0].trim() || null,
    page_count: Math.round(Number(d.page_count)) || null,
    isbn,
    barcode: firstCode(d.barcode, /\D/g),
    credits: creditsOf(d.story_set),
    cover_url: coverUrl,
    details_at: store.now(),
  });
  if (isbn && !issue.cover_file) await libraryCover(issue.id, isbn);
}

// Stores the DNB's (German books) or Open Library's cover for an ISBN, if either has one.
export async function libraryCover(issueId, isbn) {
  const { isbn13 } = parseCode(isbn);
  if (!isbn13) return;
  for (const url of [`https://portal.dnb.de/opac/mvb/cover?isbn=${isbn13}`, `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg?default=false`]) {
    try {
      return await downloadCover(issueId, url);
    } catch {
      // try the next library
    }
  }
}

// --- background worker ---

// Series whose covers the user asked for explicitly; served before the general backlog.
const requestedSeries = new Set();
let activeJob = null;

export function requestCovers(seriesId) {
  requestedSeries.add(seriesId);
  wake();
}

export const workerStatus = () => ({ job: activeJob, requested: [...requestedSeries], pending: store.countIssuesNeedingDetails() });

function nextRequested() {
  for (const seriesId of requestedSeries) {
    const issue = store.db.prepare(`SELECT * FROM issues WHERE series_id = ? AND gcd_id IS NOT NULL AND details_at IS NULL AND details_failed = 0
      ORDER BY is_variant, position LIMIT 1`).get(seriesId);
    if (issue) return issue;
    requestedSeries.delete(seriesId);
  }
  return null;
}

async function runOnce() {
  const requested = nextRequested();
  if (requested) {
    activeJob = { type: 'details', seriesId: requested.series_id };
    await loadDetails(requested, { background: false });
    return 6000; // leaves room in the per-minute budget for searches
  }
  if (!canRunBackground()) return 30_000;

  const publisherId = [...publisherQueue][0] ?? store.seriesMissingPublisher();
  if (publisherId) {
    activeJob = { type: 'publisher' };
    try {
      await ensurePublisher(publisherId, { background: true });
    } catch (err) {
      if (err instanceof GcdNotFoundError) publisherQueue.delete(publisherId);
      else throw err;
    }
    return 10_000;
  }

  const stale = store.seriesNeedingSync(new Date(Date.now() - RESYNC_DAYS * DAY_MS).toISOString());
  if (stale) {
    activeJob = { type: 'sync', seriesId: stale.id };
    await importSeries(stale.gcd_id, { background: true, maxAgeMs: 0 });
    return 10_000;
  }

  const issue = store.nextIssueNeedingDetails();
  if (issue) {
    activeJob = { type: 'details', seriesId: issue.series_id };
    await loadDetails(issue, { background: true });
    return 10_000;
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
