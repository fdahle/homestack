// Client for the two book catalogs. Open Library (https://openlibrary.org/developers/api)
// needs no key and comes first. Google Books (https://developers.google.com/books) fills in
// what Open Library lacks, often German editions, covers and descriptions. It works without
// a key, but the keyless quota is shared by everyone and often used up, so its failures
// never stop a search or an add.

import { fillGaps, fromGoogle, fromOpenLibrary, googleCoverUrl, googleHit, isGoogleId, mergeHits, olSearchHit } from './books.js';
import { isbn13, looksLikeIsbn } from './isbn.js';

const USER_AGENT = 'Regal/1.0 (self-hosted book list)';
const GOOGLE_KEY = process.env.GOOGLE_BOOKS_API_KEY || '';
export const GOOGLE_KEY_SET = Boolean(GOOGLE_KEY);

export class CatalogError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

// null for a 404, the parsed JSON otherwise
async function getJson(url, what) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new CatalogError(res.status === 429 ? 'catalog_busy' : 'catalog_failed', `${what} answered ${res.status}`);
  }
  return res.json();
}

// --- Open Library ---

const OL = 'https://openlibrary.org';
// editions.*: the one edition per work that fits the search (and the language, with lang=)
const OL_FIELDS = 'key,title,subtitle,author_name,first_publish_year,cover_i,number_of_pages_median,'
  + 'editions,editions.key,editions.title,editions.subtitle,editions.cover_i,editions.isbn,editions.language,editions.publish_date';
const OL_ID = /^OL\d+[WM]$/;

async function searchOpenLibrary(q, lang) {
  const url = new URL(`${OL}/search.json`);
  const isbn = looksLikeIsbn(q) ? isbn13(q) : null;
  if (isbn) url.searchParams.set('isbn', isbn);
  else url.searchParams.set('q', q);
  url.searchParams.set('fields', OL_FIELDS);
  url.searchParams.set('limit', '20');
  url.searchParams.set('lang', lang);
  const data = await getJson(url, 'Open Library search');
  return (data?.docs || []).map(olSearchHit);
}

async function openLibraryBook(workId, editionId) {
  const edition = editionId ? await getJson(`${OL}/books/${editionId}.json`, 'Open Library edition') : null;
  // workId is checked in bookDetails; the edition's work key comes from Open Library's answer
  // and is glued to the host, so it must look like one too ('@other.host/…' would change the host)
  const workKey = workId ? `/works/${workId}` : edition?.works?.[0]?.key;
  const work = /^\/works\/OL\d+W$/.test(workKey || '') ? await getJson(`${OL}${workKey}.json`, 'Open Library work') : null;
  if (!edition && !work) throw new CatalogError('not_found');
  // The edition's authors if it names them, else the work's; their names need one request each
  const keys = (edition?.authors?.length ? edition.authors.map((a) => a.key) : (work?.authors || []).map((a) => a.author?.key))
    .filter((k) => /^\/authors\/OL\d+A$/.test(k || '')).slice(0, 5);
  const authors = await Promise.all(keys.map(async (k) => {
    try {
      return (await getJson(`${OL}${k}.json`, 'Open Library author'))?.name;
    } catch {
      return null;
    }
  }));
  return fromOpenLibrary({ edition, work, authors });
}

// --- Google Books ---

const GB = 'https://www.googleapis.com/books/v1/volumes';
const withKey = (url) => {
  if (GOOGLE_KEY) url.searchParams.set('key', GOOGLE_KEY);
  return url;
};

// Without a key, Google's shared quota is often used up for the day. After a 429 Regal
// leaves Google alone for an hour, instead of asking (and logging) on every search.
let googlePausedUntil = 0;
async function googleJson(url, what) {
  if (Date.now() < googlePausedUntil) throw Object.assign(new CatalogError('catalog_busy', 'Google Books is paused'), { quiet: true });
  try {
    return await getJson(withKey(url), what);
  } catch (err) {
    if (err.code === 'catalog_busy') {
      googlePausedUntil = Date.now() + 3600_000;
      console.warn(`${err.message}: leaving Google Books alone for an hour`);
      err.quiet = true;
    }
    throw err;
  }
}

async function searchGoogle(q) {
  const url = new URL(GB);
  const isbn = looksLikeIsbn(q) ? isbn13(q) : null;
  url.searchParams.set('q', isbn ? `isbn:${isbn}` : q);
  url.searchParams.set('maxResults', '20');
  url.searchParams.set('printType', 'books');
  const data = await googleJson(url, 'Google Books search');
  return (data?.items || []).map(googleHit);
}

async function googleBook(volumeId) {
  if (!isGoogleId(volumeId)) throw new CatalogError('not_found');
  const volume = await googleJson(new URL(`${GB}/${volumeId}`), 'Google Books volume');
  if (!volume) throw new CatalogError('not_found');
  return fromGoogle(volume);
}

// The Google volume for an ISBN, or null (also when Google can't be asked right now)
async function googleByIsbn(isbn) {
  try {
    const url = new URL(GB);
    url.searchParams.set('q', `isbn:${isbn}`);
    url.searchParams.set('maxResults', '1');
    const item = (await googleJson(url, 'Google Books ISBN'))?.items?.[0];
    return item ? fromGoogle(item) : null;
  } catch (err) {
    if (!err.quiet) console.warn(`Google Books for ISBN ${isbn}: ${err.message}`);
    return null;
  }
}

// --- what server.js uses ---

// Both catalogs at once; one of them failing is fine, both failing is an error
export async function search(q, lang = 'de') {
  const [ol, gb] = await Promise.allSettled([searchOpenLibrary(q, lang === 'en' ? 'en' : 'de'), searchGoogle(q)]);
  if (gb.status === 'rejected' && !gb.reason.quiet) console.warn(`Google Books: ${gb.reason.message}`);
  if (ol.status === 'rejected') {
    console.warn(`Open Library: ${ol.reason.message}`);
    if (gb.status === 'rejected') throw ol.reason;
  }
  return mergeHits(ol.value || [], gb.value || []);
}

// Everything Regal keeps about a book, ready for the database.
// ref: { source: 'openlibrary', work, edition } or { source: 'google', volume }
export async function bookDetails(ref) {
  if (ref.source === 'google') return googleBook(String(ref.volume || ''));
  const work = OL_ID.test(ref.work || '') && ref.work.endsWith('W') ? ref.work : null;
  const edition = OL_ID.test(ref.edition || '') && ref.edition.endsWith('M') ? ref.edition : null;
  if (!work && !edition) throw new CatalogError('not_found');
  const book = await openLibraryBook(work, edition);
  // Open Library often lacks the cover, description or page count of a German edition
  if (book.isbns[0] && (!book.cover_url || !book.description || !book.pages)) return fillGaps(book, await googleByIsbn(book.isbns[0]));
  return book;
}

// --- pictures ---

const IMAGE_HOSTS = /^https:\/\/(covers\.openlibrary\.org|books\.google\.com)\//;
// Where those may send a cover on: Open Library keeps its covers at the Internet Archive
// (archive.org, then one of its ia….us.archive.org servers), Google on googleusercontent.com.
const REDIRECT_HOSTS = /^(covers\.openlibrary\.org|books\.google\.com|(.+\.)?archive\.org|.+\.googleusercontent\.com)$/;
const MAX_REDIRECTS = 3;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const allowedHop = (url) => url.protocol === 'https:' && !url.port && !url.username && REDIRECT_HOSTS.test(url.hostname);

// The body, but no more than MAX_IMAGE_BYTES of it
async function readImage(res) {
  if (Number(res.headers.get('content-length')) > MAX_IMAGE_BYTES) {
    await res.body?.cancel();
    throw new CatalogError('catalog_failed', 'Cover too large');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body ?? []) {
    size += chunk.length;
    // Leaving the loop cancels the download
    if (size > MAX_IMAGE_BYTES) throw new CatalogError('catalog_failed', 'Cover too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// A cover as a JPEG buffer. Google answers a PNG "no picture" image for books without
// a cover, which counts as no cover here.
export async function fetchImage(url) {
  if (!IMAGE_HOSTS.test(url)) throw new CatalogError('not_found');
  // Redirects are followed by hand, so every hop's host is checked, not only the first
  const signal = AbortSignal.timeout(20_000);
  let current = new URL(url);
  let res;
  for (let hop = 0; ; hop++) {
    res = await fetch(current, { headers: { 'User-Agent': USER_AGENT }, redirect: 'manual', signal });
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) break;
    await res.body?.cancel();
    if (hop >= MAX_REDIRECTS) throw new CatalogError('catalog_failed', 'Cover: too many redirects');
    current = new URL(location, current);
    if (!allowedHop(current)) throw new CatalogError('catalog_failed', `Cover redirected to ${current.hostname}`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new CatalogError(res.status === 404 ? 'not_found' : 'catalog_failed', `Cover answered ${res.status}`);
  }
  const buffer = await readImage(res);
  // Open Library's "no cover" is a 1×1 GIF, Google's a PNG
  if (buffer.length < 1000 || buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new CatalogError('not_found', 'No cover picture');
  return buffer;
}

// Small covers for the search results (see the thumb paths in books.js)
export function thumbUrl(source, id) {
  if (source === 'ol' && /^\d{1,12}$/.test(id)) return `https://covers.openlibrary.org/b/id/${id}-M.jpg`;
  if (source === 'gb' && isGoogleId(id)) return googleCoverUrl(id, 200);
  return null;
}
