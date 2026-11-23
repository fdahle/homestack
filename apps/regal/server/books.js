// Checking what the app sends, and turning Open Library's and Google Books' answers into books.
// No database and no network here, so it can be tested on its own.

import { BadRequest } from './kit/errors.js';
import { isbnList } from './isbn.js';

export { BadRequest };

// want: "Will ich lesen", reading: "Lese ich", read: "Gelesen", dropped: "Abgebrochen"
export const STATUSES = ['want', 'reading', 'read', 'dropped'];
// Statuses that mean you are done with the book, so it gets a finish date
export const DONE_STATUSES = ['read', 'dropped'];

// 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD', as precise as you remember it
export function isPartialDate(v) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(String(v));
  if (!m) return false;
  const [, y, mo, d] = m.map(Number);
  if (y < 1900 || y > 2100) return false;
  if (m[2] && (mo < 1 || mo > 12)) return false;
  if (m[3] && (d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate())) return false;
  return true;
}

// Optional text: trimmed, cut to max, '' → null. undefined stays undefined (= not changed).
const text = (v, max) => (v === undefined ? undefined : String(v ?? '').trim().slice(0, max) || null);

function partialDate(v, code) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (!isPartialDate(v)) throw new BadRequest(code);
  return String(v);
}

// A whole number in [min, max], '' / null → null
function whole(v, min, max, code) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new BadRequest(code);
  return n;
}

// Names as a list, or one text with commas between them ("Terry Pratchett, Neil Gaiman")
function nameList(v, code) {
  if (v === undefined) return undefined;
  const list = typeof v === 'string' ? v.split(/\s*[,;]\s*|\s+&\s+/) : v;
  if (!Array.isArray(list)) throw new BadRequest(code);
  return [...new Set(list.map((s) => String(s ?? '').trim().slice(0, 120)).filter(Boolean))].slice(0, 20);
}

// What you can change about a book: your own entries, and its details (for books
// entered by hand, or where Open Library, Google or Calibre got something wrong).
export function cleanBookInput(body) {
  const out = {};
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) throw new BadRequest('bad_status');
    out.status = body.status;
  }
  out.rating = whole(body.rating, 1, 10, 'bad_rating');
  out.started_on = partialDate(body.startedOn, 'bad_date');
  out.finished_on = partialDate(body.finishedOn, 'bad_date');
  out.current_page = whole(body.currentPage, 0, 100_000, 'bad_page');
  out.notes = text(body.notes, 20_000);

  if (body.title !== undefined) {
    out.title = text(body.title, 300);
    if (!out.title) throw new BadRequest('title_required');
  }
  out.subtitle = text(body.subtitle, 300);
  out.authors = nameList(body.authors, 'bad_authors');
  out.series = text(body.series, 200);
  if (body.seriesIndex !== undefined) {
    const n = body.seriesIndex === null || body.seriesIndex === '' ? null : Number(String(body.seriesIndex).replace(',', '.'));
    if (n !== null && !(Number.isFinite(n) && n >= 0 && n < 10_000)) throw new BadRequest('bad_series_index');
    out.series_index = n;
  }
  out.year = whole(body.year, -3000, 2100, 'bad_year');
  out.publisher = text(body.publisher, 200);
  out.pages = whole(body.pages, 1, 100_000, 'bad_pages');
  if (body.isbns !== undefined) {
    out.isbns = isbnList(body.isbns);
    // Something typed that isn't an ISBN at all
    if (String(body.isbns ?? '').trim() && !Array.isArray(body.isbns) && !out.isbns.length) throw new BadRequest('bad_isbn');
  }
  if (body.language !== undefined) out.language = normLanguage(body.language);
  out.description = text(body.description, 20_000);
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

// Partial dates compared as far as both go: '2020' and '2020-05-03' are in order either way
export function datesInOrder(started, finished) {
  if (!started || !finished) return true;
  const n = Math.min(started.length, finished.length);
  return finished.slice(0, n) >= started.slice(0, n);
}

// Dates filled in for you when the status changes in the app (not when a book is
// added: a book added as "read" may have been read years ago).
export function datesForStatusChange(book, newStatus, today) {
  const out = {};
  if (!newStatus || newStatus === book.status) return out;
  if (newStatus === 'reading' && !book.started_on) out.started_on = today;
  if (DONE_STATUSES.includes(newStatus) && !book.finished_on && book.status === 'reading') out.finished_on = today;
  return out;
}

// --- shared helpers for the catalogs and Calibre ---

// Three-letter codes (Open Library, Calibre) and two-letter ones (Google) → two letters where there are
const LANGUAGES = {
  ger: 'de', deu: 'de', eng: 'en', fre: 'fr', fra: 'fr', spa: 'es', ita: 'it', dut: 'nl', nld: 'nl', swe: 'sv',
  dan: 'da', nor: 'no', nob: 'no', nno: 'no', pol: 'pl', rus: 'ru', jpn: 'ja', por: 'pt', fin: 'fi', cze: 'cs',
  ces: 'cs', tur: 'tr', chi: 'zh', zho: 'zh', lat: 'la', gre: 'el', ell: 'el', hun: 'hu', ice: 'is', isl: 'is',
  heb: 'he', ara: 'ar', kor: 'ko', ukr: 'uk', rum: 'ro', ron: 'ro', cat: 'ca', gsw: 'de',
};
export function normLanguage(code) {
  const c = String(code || '').toLowerCase().replace(/^\/languages\//, '').trim();
  if (!c || c === 'und' || c === 'mul') return null;
  return LANGUAGES[c] || (/^[a-z]{2}$/.test(c) ? c : /^[a-z]{3}$/.test(c) ? c : null);
}

// Far more than any blurb; it runs on every Calibre comment at each sync
const MAX_HTML = 200_000;

// A numeric entity's character, or the entity as written when it names no character
const codePoint = (m, n) => (n <= 0x10ffff ? String.fromCodePoint(n) : m);

// Calibre's comments and Google's descriptions are HTML; Regal shows plain text with paragraphs.
// A tag never spans a '<' ([^<>], not [^>]): with [^>] a text full of '<' takes quadratic time.
export function htmlToText(html) {
  if (!html) return null;
  const s = String(html).slice(0, MAX_HTML)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6]|blockquote)\s*>/gi, '\n\n')
    .replace(/<li\b[^<>]*>/gi, '• ')
    .replace(/<[^<>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d{1,7});/g, (m, n) => codePoint(m, Number(n)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, n) => codePoint(m, parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s || null;
}

const yearIn = (s) => {
  const m = /\b(1[0-9]{3}|20[0-9]{2})\b/.exec(String(s || ''));
  return m ? Number(m[1]) : null;
};

// 'Harry Potter #1', 'Discworld -- 3', 'Die Tribute von Panem ; 2', 'The Expanse, book 4' → { series, index }
export function parseSeries(line) {
  // Capped: the patterns below backtrack a lot on long lines, and no series name is this long
  const s = String(line || '').slice(0, 300).trim();
  if (!s) return { series: null, index: null };
  // A trailing note in brackets says nothing about the series: 'Harry Potter (Deutsch)'
  const clean = (name) => name.trim().replace(/[,;:(]+$/, '').replace(/\s*\([^)]*\)$/, '').trim() || name.trim();
  const m = /^(.*?)[\s,;:(]*(?:#|--|;|\bno\.?|\bnr\.?|\bvol\.?|\bvolume|\bband|\bbd\.?|\bbook|\bteil|,)\s*(\d+(?:[.,]\d+)?)\)?\s*$/i.exec(s)
    || /^(.*?)\s*\((\d+(?:[.,]\d+)?)\)\s*$/.exec(s);
  if (m && m[1].trim()) return { series: clean(m[1]), index: Number(m[2].replace(',', '.')) };
  return { series: clean(s), index: null };
}

const names = (list) => [...new Set((list || []).map((s) => String(s || '').trim()).filter(Boolean))];
const firstText = (...values) => values.map((v) => (typeof v === 'string' ? v.trim() : '')).find(Boolean) || null;
const olId = (key) => (String(key || '').match(/OL\d+[WMA]$/) || [null])[0];
const positive = (n) => (Number.isInteger(n) && n > 0 ? n : null);

// For telling search hits apart: lower case, no accents, no punctuation
export const normText = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const lastName = (name) => normText(name).split(' ').pop() || '';
export const titleKey = (title, authors) => `${normText(title)}|${lastName(authors?.[0])}`;

// --- Open Library ---

// A work from search.json (with the fields catalog.js asks for), with the edition Open Library picked
// for the search language, → a hit for the list on the add page
export function olSearchHit(doc) {
  const edition = doc.editions?.docs?.[0] || null;
  const cover = edition?.cover_i || doc.cover_i || null;
  return {
    source: 'openlibrary',
    work: olId(doc.key),
    edition: olId(edition?.key),
    title: firstText(edition?.title, doc.title) || '?',
    subtitle: firstText(edition?.subtitle, doc.subtitle),
    authors: names(doc.author_name).slice(0, 4),
    year: yearIn([edition?.publish_date].flat()[0]) || doc.first_publish_year || null,
    isbn: isbnList(edition?.isbn || [])[0] || null,
    language: normLanguage([edition?.language].flat()[0]),
    pages: doc.number_of_pages_median || null,
    thumb: cover ? `/api/thumb/ol/${cover}` : null,
  };
}

// An Open Library edition and its work (the JSON of /books/…, /works/…) and the authors' names → database fields
export function fromOpenLibrary({ edition = null, work = null, authors = [] }) {
  const e = edition || {};
  const w = work || {};
  const desc = (d) => (typeof d === 'string' ? d : d?.value) || null;
  // Publishers' numbered lines ('dtv ; 10551') aren't series; a real series rarely passes 999
  const parsed = parseSeries([e.series].flat()[0]);
  const { series, index } = parsed.index > 999 ? { series: null, index: null } : parsed;
  const cover = [...(e.covers || []), ...(w.covers || [])].find((c) => c > 0);
  return {
    source: 'openlibrary',
    ol_work: olId(w.key) || olId(e.works?.[0]?.key),
    ol_edition: olId(e.key),
    title: firstText(e.title, w.title) || '?',
    subtitle: firstText(e.subtitle, e.title ? null : w.subtitle),
    authors: names(authors).slice(0, 10),
    series,
    series_index: index,
    year: yearIn(e.publish_date) || yearIn(w.first_publish_date),
    publisher: firstText(e.publishers?.[0]),
    pages: positive(e.number_of_pages),
    isbns: isbnList([...(e.isbn_13 || []), ...(e.isbn_10 || [])]),
    language: normLanguage(e.languages?.[0]?.key),
    description: htmlToText(desc(e.description) || desc(w.description)),
    cover_url: cover ? `https://covers.openlibrary.org/b/id/${cover}-L.jpg` : null,
  };
}

// --- Google Books ---

// Google's cover links are http, curled at the corner and small; this asks for a clean, bigger one
export const googleCoverUrl = (id, width = 600) => `https://books.google.com/books/content?id=${encodeURIComponent(id)}&printsec=frontcover&img=1&zoom=1&fife=w${width}`;
export const isGoogleId = (id) => /^[\w-]{6,20}$/.test(String(id || ''));

function googleIsbns(info) {
  const ids = info.industryIdentifiers || [];
  return isbnList(ids.filter((i) => i.type === 'ISBN_13' || i.type === 'ISBN_10').map((i) => i.identifier));
}

export function googleHit(volume) {
  const v = volume.volumeInfo || {};
  return {
    source: 'google',
    volume: volume.id,
    title: v.title || '?',
    subtitle: v.subtitle || null,
    authors: names(v.authors).slice(0, 4),
    year: yearIn(v.publishedDate),
    isbn: googleIsbns(v)[0] || null,
    language: normLanguage(v.language),
    pages: positive(v.pageCount),
    thumb: v.imageLinks && isGoogleId(volume.id) ? `/api/thumb/gb/${volume.id}` : null,
  };
}

// A volume from /volumes/{id} → database fields
export function fromGoogle(volume) {
  const v = volume.volumeInfo || {};
  return {
    source: 'google',
    google_id: volume.id,
    title: String(v.title || '').trim() || '?',
    subtitle: v.subtitle?.trim() || null,
    authors: names(v.authors).slice(0, 10),
    year: yearIn(v.publishedDate),
    publisher: v.publisher?.trim() || null,
    pages: positive(v.pageCount) || positive(v.printedPageCount),
    isbns: googleIsbns(v),
    language: normLanguage(v.language),
    description: htmlToText(v.description),
    cover_url: v.imageLinks ? googleCoverUrl(volume.id) : null,
  };
}

// Fields one source has and the other lacks (an Open Library edition without a cover or
// description, filled from Google Books). What the book already has stays.
const GAP_FIELDS = ['subtitle', 'series', 'series_index', 'year', 'publisher', 'pages', 'language', 'description', 'cover_url', 'google_id', 'ol_work', 'ol_edition'];
export function fillGaps(book, extra) {
  if (!extra) return book;
  const out = { ...book };
  for (const k of GAP_FIELDS) if ((out[k] == null || out[k] === '') && extra[k] != null && extra[k] !== '') out[k] = extra[k];
  if (!out.authors?.length && extra.authors?.length) out.authors = extra.authors;
  out.isbns = [...new Set([...(book.isbns || []), ...(extra.isbns || [])])];
  return out;
}

// Search hits from both catalogs as one list: Open Library's first, then Google's that
// aren't the same book again (same ISBN, or same title by the same author)
export function mergeHits(olHits, googleHits) {
  const seen = new Set();
  const out = [];
  for (const hit of [...olHits, ...googleHits]) {
    const keys = [titleKey(hit.title, hit.authors), hit.isbn && `isbn:${hit.isbn}`].filter(Boolean);
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push(hit);
  }
  return out;
}

