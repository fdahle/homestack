// ISBNs as people type, scan and store them: with or without dashes, ISBN-10 or -13.
// Regal keeps every ISBN as ISBN-13, so the same book always looks the same.

const digitsOf = (input) => String(input ?? '').toUpperCase().replace(/[^0-9X]/g, '');

function isbn13Valid(s) {
  const sum = [...s].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
  return sum % 10 === 0;
}

function isbn10Valid(s) {
  const sum = [...s].reduce((acc, d, i) => acc + (d === 'X' ? 10 : Number(d)) * (10 - i), 0);
  return sum % 11 === 0;
}

export function toIsbn13(isbn10) {
  const core = `978${isbn10.slice(0, 9)}`;
  const sum = [...core].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
  return core + ((10 - (sum % 10)) % 10);
}

// Only 978 numbers have an ISBN-10 (979 ones never had one)
export function toIsbn10(isbn13) {
  if (!isbn13.startsWith('978')) return null;
  const core = isbn13.slice(3, 12);
  const sum = [...core].reduce((acc, d, i) => acc + Number(d) * (10 - i), 0);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? 'X' : check);
}

// '3-551-55167-7', '978 3 551 55167 2', a scanned EAN → '9783551551672'; anything else → null
export function isbn13(input) {
  const s = digitsOf(input);
  // The X may only be the last digit of an ISBN-10
  if (/^97[89]\d{10}$/.test(s)) return isbn13Valid(s) ? s : null;
  if (/^\d{9}[\dX]$/.test(s)) return isbn10Valid(s) ? toIsbn13(s) : null;
  return null;
}

// Several ISBNs (a list, or a text with commas or spaces between them) → valid ISBN-13s, each once
export function isbnList(input) {
  const parts = Array.isArray(input) ? input : String(input ?? '').split(/[,;\s]+(?=[0-9])/);
  return [...new Set(parts.map(isbn13).filter(Boolean))];
}

// Does a search look like an ISBN rather than words?
export const looksLikeIsbn = (q) => /^[\d\s-]+[\dXx]$/.test(String(q).trim()) && isbn13(q) !== null;
