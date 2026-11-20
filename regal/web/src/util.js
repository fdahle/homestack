import { ref } from 'vue';
import { compareText, formatNumber } from './kit/util.js';
import { lang } from './i18n.js';

export * from './kit/util.js';

// --- statuses ---

export const STATUSES = ['want', 'reading', 'read', 'dropped'];
export const STATUS_ICONS = { want: 'bookmark', reading: 'book-open', read: 'check', dropped: 'stop' };

// --- covers ---

export const coverUrl = (book) => (book?.cover_file ? `/covers/${book.cover_file}` : null);
// Book covers are 2:3
export const COVER_SIZE = { width: 600, height: 900 };

// --- books ---

export const authorsText = (book) => (book?.authors || []).join(', ');
// "Ursula K. Le Guin" → "le guin", "J. R. R. Tolkien" → "tolkien": good enough to sort by
const PARTICLES = new Set(['von', 'van', 'de', 'der', 'le', 'la', 'du', 'di', 'da']);
export function lastName(name) {
  const parts = String(name || '').trim().split(/\s+/);
  let i = parts.length - 1;
  while (i > 0 && PARTICLES.has(parts[i - 1].toLowerCase())) i--;
  return parts.slice(i).join(' ');
}

export const byTitle = (a, b) => compareText(a.title, b.title);
export const byAuthor = (a, b) => compareText(lastName(a.authors[0]), lastName(b.authors[0]))
  || compareText(a.series, b.series) || (a.series_index ?? 0) - (b.series_index ?? 0) || byTitle(a, b);

// "Scheibenwelt 3", "Narnia 2,5"
export const seriesText = (book) => (book?.series ? [book.series, book.series_index != null ? formatNumber(book.series_index, 2) : ''].filter(Boolean).join(' ') : '');

// 0–100 while you are reading and the book's pages are known, else null
export function progressOf(book) {
  if (!book?.pages || book.current_page == null) return null;
  return Math.max(0, Math.min(100, Math.round((book.current_page / book.pages) * 100)));
}

// 'de' → "Deutsch"
export function languageName(code) {
  if (!code) return '';
  try {
    return new Intl.DisplayNames([lang.value], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}

// '9783551551672' → '978-3551551672' (where the hyphens go inside depends on the publisher)
export const formatIsbn = (s) => (s?.length === 13 ? `${s.slice(0, 3)}-${s.slice(3)}` : s);

// A scanned EAN that is a valid ISBN-13 (books start with 978 or 979), else null
export function scannedIsbn(code) {
  const s = String(code || '').replace(/\D/g, '');
  if (!/^97[89]\d{10}$/.test(s)) return null;
  const sum = [...s].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
  return sum % 10 === 0 ? s : null;
}

// The last change made on a book's page: { id, book } or { id, deleted: true }.
// The library beside it watches this instead of loading everything again.
export const bookChange = ref(null);
