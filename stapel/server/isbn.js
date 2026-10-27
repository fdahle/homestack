// Looks up scanned ISBNs in the German National Library (DNB) and Open Library.
// GCD has no ISBN search, so this gives the title and volume number to find the
// series with.

const USER_AGENT = process.env.USER_AGENT || 'Stapel/1.0 (self-hosted comic collection tracker)';

// Returns { code, isbn13, isbn10 } for a scanned or typed code; isbn13 is null for non-ISBN barcodes.
export function parseCode(input) {
  const code = String(input || '').toUpperCase().replace(/[^0-9X]/g, '');
  if (/^97[89]\d{10}$/.test(code) && isbn13Valid(code)) return { code, isbn13: code, isbn10: code.startsWith('978') ? toIsbn10(code) : null };
  if (/^\d{9}[\dX]$/.test(code) && isbn10Valid(code)) return { code, isbn13: toIsbn13(code), isbn10: code };
  return { code: code.replace(/X/g, ''), isbn13: null, isbn10: null };
}

function isbn13Valid(s) {
  const sum = [...s].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
  return sum % 10 === 0;
}

function isbn10Valid(s) {
  const sum = [...s].reduce((acc, d, i) => acc + (d === 'X' ? 10 : Number(d)) * (10 - i), 0);
  return sum % 11 === 0;
}

function toIsbn13(isbn10) {
  const core = `978${isbn10.slice(0, 9)}`;
  const sum = [...core].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
  return core + ((10 - (sum % 10)) % 10);
}

function toIsbn10(isbn13) {
  const core = isbn13.slice(3, 12);
  const sum = [...core].reduce((acc, d, i) => acc + Number(d) * (10 - i), 0);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? 'X' : check);
}

const decodeXml = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Minimal MARC21-XML reader: { '245': [{ a: [...], n: [...] }], ... }
function marcFields(xml) {
  const fields = {};
  for (const [, tag, body] of xml.matchAll(/<datafield tag="(\d{3})"[^>]*>([\s\S]*?)<\/datafield>/g)) {
    const sub = {};
    for (const [, code, value] of body.matchAll(/<subfield code="(\w)">([\s\S]*?)<\/subfield>/g)) (sub[code] ??= []).push(decodeXml(value).trim());
    (fields[tag] ??= []).push(sub);
  }
  return fields;
}

// MARC titles carry ISBD punctuation (" : ", " / ", trailing "."); strip it for display
const tidy = (s) => (s ? s.replace(/\s*[:;/,.=]\s*$/, '').replace(/^¬|¬/g, '').trim() : null);

async function lookupDnb(isbn13) {
  const url = `https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&query=${encodeURIComponent(`isbn=${isbn13}`)}&recordSchema=MARC21-xml&maximumRecords=1`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`DNB answered ${res.status}`);
  const xml = await res.text();
  if (!/<numberOfRecords>[1-9]/.test(xml)) return null;
  const f = marcFields(xml);
  const title = f['245']?.[0] || {};
  const series = f['490']?.[0] || f['830']?.[0] || f['800']?.[0] || {};
  const imprint = f['264']?.[0] || f['260']?.[0] || {};
  const volume = tidy(series.v?.[0]) || tidy(title.n?.[0]);
  return {
    source: 'DNB',
    title: tidy(title.p?.[0]) || tidy(title.a?.[0]),
    mainTitle: tidy(title.a?.[0]),
    subtitle: tidy(title.b?.[0]),
    series: tidy(series.a?.[0]),
    volume: volume ? volume.replace(/^(Bd|Band|Vol|Nr|No)\.?\s*/i, '').replace(/\.$/, '') : null,
    publisher: tidy(imprint.b?.[0]),
    year: tidy(imprint.c?.[0])?.replace(/\D/g, '').slice(0, 4) || null,
    cover: `https://portal.dnb.de/opac/mvb/cover?isbn=${isbn13}`,
  };
}

async function lookupOpenLibrary(isbn13) {
  const res = await fetch(`https://openlibrary.org/isbn/${isbn13}.json`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Open Library answered ${res.status}`);
  const b = await res.json();
  const seriesLine = b.series?.[0] || null;
  const volume = /(?:#|vol\.?|volume|no\.?|band|bd\.?)\s*(\d+)/i.exec(seriesLine || b.title || '')?.[1] || null;
  return {
    source: 'Open Library',
    title: b.title || null,
    mainTitle: b.title || null,
    subtitle: b.subtitle || null,
    series: seriesLine ? seriesLine.replace(/[,;]?\s*(?:#|vol\.?|volume|no\.?|band|bd\.?)\s*\d+.*$/i, '').trim() : null,
    volume,
    publisher: b.publishers?.[0] || null,
    year: /\d{4}/.exec(b.publish_date || '')?.[0] || null,
    cover: b.covers?.length ? `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg?default=false` : null,
  };
}

// Returns book info for an ISBN, or null if neither library knows it.
export async function lookupIsbn(isbn13) {
  for (const lookup of [lookupDnb, lookupOpenLibrary]) {
    try {
      const found = await lookup(isbn13);
      if (found) return found;
    } catch (err) {
      console.warn(`ISBN lookup ${isbn13}: ${err.message}`);
    }
  }
  return null;
}
