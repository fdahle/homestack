import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BadRequest, cleanBookInput, datesForStatusChange, datesInOrder, fillGaps, fromGoogle, fromOpenLibrary, googleHit,
  htmlToText, isPartialDate, mergeHits, normLanguage, olSearchHit, parseSeries,
} from './books.js';

test('partial dates', () => {
  for (const ok of ['2020', '2020-02', '2020-02-29', '1985-12-31']) assert.ok(isPartialDate(ok), ok);
  for (const bad of ['20', '2020-13', '2021-02-29', '2020-1', '2020-01-32', '1800', 'gestern', '']) assert.ok(!isPartialDate(bad), bad);
});

test('dates in order, as far as both go', () => {
  assert.ok(datesInOrder('2020', '2020-05-01'));
  assert.ok(datesInOrder('2020-05-10', '2020-05'));
  assert.ok(datesInOrder(null, '2019'));
  assert.ok(!datesInOrder('2020-05', '2020-03-01'));
  assert.ok(!datesInOrder('2021', '2020'));
});

test('cleanBookInput keeps what changed and checks it', () => {
  assert.deepEqual(cleanBookInput({ status: 'read', rating: 8, currentPage: '120', notes: '' }), {
    status: 'read', rating: 8, current_page: 120, notes: null,
  });
  assert.deepEqual(cleanBookInput({ rating: null, finishedOn: '', currentPage: '' }), { rating: null, finished_on: null, current_page: null });
  assert.throws(() => cleanBookInput({ status: 'finished' }), BadRequest);
  assert.throws(() => cleanBookInput({ rating: 11 }), BadRequest);
  assert.throws(() => cleanBookInput({ rating: 3.5 }), BadRequest);
  assert.throws(() => cleanBookInput({ startedOn: '2020-14' }), BadRequest);
  assert.throws(() => cleanBookInput({ currentPage: -1 }), BadRequest);
});

test("cleanBookInput: a book's details", () => {
  assert.deepEqual(cleanBookInput({
    title: ' Der Schwarm ', authors: 'Frank Schätzing, , Frank Schätzing', seriesIndex: '2,5', year: '2004', pages: '992',
    isbns: '3-462-03374-3', language: 'ger', publisher: '',
  }), {
    title: 'Der Schwarm', authors: ['Frank Schätzing'], series_index: 2.5, year: 2004, pages: 992,
    isbns: ['9783462033748'], language: 'de', publisher: null,
  });
  assert.deepEqual(cleanBookInput({ authors: ['Terry Pratchett', 'Neil Gaiman'] }).authors, ['Terry Pratchett', 'Neil Gaiman']);
  assert.deepEqual(cleanBookInput({ isbns: '' }).isbns, []);
  assert.throws(() => cleanBookInput({ title: '  ' }), BadRequest);
  assert.throws(() => cleanBookInput({ isbns: '12345' }), BadRequest);
  assert.throws(() => cleanBookInput({ pages: 0 }), BadRequest);
  assert.throws(() => cleanBookInput({ year: 'neunzehnhundert' }), BadRequest);
});

test('dates filled in when the status changes', () => {
  const today = '2026-11-20';
  assert.deepEqual(datesForStatusChange({ status: 'want' }, 'reading', today), { started_on: today });
  assert.deepEqual(datesForStatusChange({ status: 'reading', started_on: '2026-10' }, 'read', today), { finished_on: today });
  assert.deepEqual(datesForStatusChange({ status: 'reading' }, 'dropped', today), { finished_on: today });
  // Not when it was never marked as reading, and never over a date you entered
  assert.deepEqual(datesForStatusChange({ status: 'want' }, 'read', today), {});
  assert.deepEqual(datesForStatusChange({ status: 'reading', finished_on: '2026' }, 'read', today), {});
  assert.deepEqual(datesForStatusChange({ status: 'reading', started_on: '2025' }, 'reading', today), {});
});

test('series lines', () => {
  assert.deepEqual(parseSeries('Harry Potter #1'), { series: 'Harry Potter', index: 1 });
  assert.deepEqual(parseSeries('Harry Potter (Deutsch) (1)'), { series: 'Harry Potter', index: 1 });
  assert.deepEqual(parseSeries('Discworld -- 3'), { series: 'Discworld', index: 3 });
  assert.deepEqual(parseSeries('Die Tribute von Panem ; 2'), { series: 'Die Tribute von Panem', index: 2 });
  assert.deepEqual(parseSeries('The Expanse, Book 4'), { series: 'The Expanse', index: 4 });
  assert.deepEqual(parseSeries('Die Chroniken von Narnia, Band 2,5'), { series: 'Die Chroniken von Narnia', index: 2.5 });
  assert.deepEqual(parseSeries('Penguin Classics'), { series: 'Penguin Classics', index: null });
  assert.deepEqual(parseSeries(''), { series: null, index: null });
});

test('HTML descriptions become text', () => {
  assert.equal(htmlToText('<div><p>Ein <b>Roman</b> &amp; mehr.</p><p>Zweiter&nbsp;Absatz</p></div>'), 'Ein Roman & mehr.\n\nZweiter Absatz');
  assert.equal(htmlToText('Zeile<br>Zeile &#8211; &#x263A;'), 'Zeile\nZeile – ☺');
  assert.equal(htmlToText('<p></p>'), null);
  assert.equal(htmlToText(null), null);
  assert.equal(htmlToText('<ul><li class="x">Eins</li><li>Zwei</li></ul>'), '• Eins\n\n• Zwei');
  // A lone '<' is text, not the start of a tag that swallows what follows
  assert.equal(htmlToText('a < b <i>kursiv</i>'), 'a < b kursiv');
  // An entity that names no character stays as written instead of throwing
  assert.equal(htmlToText('&#99999999; &#x110000;'), '&#99999999; &#x110000;');
});

test('HTML descriptions: hostile input stays fast and bounded', () => {
  const started = Date.now();
  htmlToText('<'.repeat(100_000));
  htmlToText('<li'.repeat(50_000));
  htmlToText(`<${' '.repeat(100_000)}`);
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
  assert.equal(htmlToText('x'.repeat(300_000)).length, 200_000);
});

test('language codes', () => {
  assert.equal(normLanguage('/languages/ger'), 'de');
  assert.equal(normLanguage('deu'), 'de');
  assert.equal(normLanguage('en'), 'en');
  assert.equal(normLanguage('tlh'), 'tlh');
  assert.equal(normLanguage('und'), null);
  assert.equal(normLanguage(''), null);
});

// --- Open Library (shapes as search.json, /books/… and /works/… answer) ---

const OL_SEARCH_DOC = {
  key: '/works/OL82563W',
  title: "Harry Potter and the Philosopher's Stone",
  author_name: ['J. K. Rowling'],
  first_publish_year: 1997,
  cover_i: 10521270,
  number_of_pages_median: 326,
  editions: {
    numFound: 2,
    docs: [{ key: '/books/OL9064555M', title: 'Harry Potter und der Stein der Weisen', cover_i: 12630802, language: ['ger'], publish_date: ['2007'], isbn: ['3551551677', '9783551551672'] }],
  },
};

test('Open Library search hit: the edition in your language', () => {
  assert.deepEqual(olSearchHit(OL_SEARCH_DOC), {
    source: 'openlibrary',
    work: 'OL82563W',
    edition: 'OL9064555M',
    title: 'Harry Potter und der Stein der Weisen',
    subtitle: null,
    authors: ['J. K. Rowling'],
    year: 2007,
    isbn: '9783551551672',
    language: 'de',
    pages: 326,
    thumb: '/api/thumb/ol/12630802',
  });
  const bare = olSearchHit({ key: '/works/OL1W', title: 'Obscure', author_name: [] });
  assert.equal(bare.edition, null);
  assert.equal(bare.thumb, null);
  assert.equal(bare.year, null);
});

test('Open Library edition and work → database fields', () => {
  const book = fromOpenLibrary({
    edition: {
      key: '/books/OL9064555M', title: 'Harry Potter und der Stein der Weisen', publishers: ['Carlsen'], number_of_pages: 335,
      series: ['Harry Potter (Deutsch) (1)'], covers: [12630802], languages: [{ key: '/languages/ger' }], publish_date: '2007',
      works: [{ key: '/works/OL82563W' }], isbn_10: ['3551551677'], isbn_13: ['9783551551672'],
    },
    work: { key: '/works/OL82563W', title: "Harry Potter and the Philosopher's Stone", description: { type: '/type/text', value: 'Harry erfährt, dass er ein Zauberer ist.' }, covers: [10521270] },
    authors: ['J. K. Rowling', null],
  });
  assert.deepEqual(book, {
    source: 'openlibrary',
    ol_work: 'OL82563W',
    ol_edition: 'OL9064555M',
    title: 'Harry Potter und der Stein der Weisen',
    subtitle: null,
    authors: ['J. K. Rowling'],
    series: 'Harry Potter',
    series_index: 1,
    year: 2007,
    publisher: 'Carlsen',
    pages: 335,
    isbns: ['9783551551672'],
    language: 'de',
    description: 'Harry erfährt, dass er ein Zauberer ist.',
    cover_url: 'https://covers.openlibrary.org/b/id/12630802-L.jpg',
  });
});

test("a publisher's numbered line is not a series", () => {
  const book = fromOpenLibrary({ edition: { key: '/books/OL1M', title: 'Der Name der Rose', series: ['dtv ; 10551'] } });
  assert.equal(book.series, null);
  assert.equal(book.series_index, null);
});

test('Open Library work without an edition', () => {
  const book = fromOpenLibrary({ work: { key: '/works/OL1W', title: 'Werk', subtitle: 'Untertitel', description: 'Text', first_publish_date: 'March 1952', covers: [-1] } });
  assert.equal(book.title, 'Werk');
  assert.equal(book.subtitle, 'Untertitel');
  assert.equal(book.year, 1952);
  assert.equal(book.cover_url, null);
  assert.equal(book.ol_edition, null);
  assert.deepEqual(book.isbns, []);
});

// --- Google Books ---

const GOOGLE_VOLUME = {
  id: 'zyTCAlFPjgYC',
  volumeInfo: {
    title: 'Der Schwarm',
    subtitle: 'Roman',
    authors: ['Frank Schätzing'],
    publisher: 'Kiepenheuer & Witsch',
    publishedDate: '2004-03',
    description: '<p>Ein Roman über das Meer.</p>',
    industryIdentifiers: [{ type: 'ISBN_10', identifier: '3462033743' }, { type: 'ISBN_13', identifier: '9783462033748' }, { type: 'OTHER', identifier: 'UOM:39015' }],
    pageCount: 992,
    language: 'de',
    imageLinks: { smallThumbnail: 'http://books.google.com/…&zoom=5', thumbnail: 'http://books.google.com/…&zoom=1&edge=curl' },
  },
};

test('Google Books volume → database fields and hit', () => {
  const book = fromGoogle(GOOGLE_VOLUME);
  assert.equal(book.google_id, 'zyTCAlFPjgYC');
  assert.equal(book.subtitle, 'Roman');
  assert.equal(book.year, 2004);
  assert.equal(book.pages, 992);
  assert.deepEqual(book.isbns, ['9783462033748']);
  assert.equal(book.language, 'de');
  assert.equal(book.description, 'Ein Roman über das Meer.');
  assert.match(book.cover_url, /^https:\/\/books\.google\.com\/books\/content\?id=zyTCAlFPjgYC&/);
  const hit = googleHit(GOOGLE_VOLUME);
  assert.equal(hit.source, 'google');
  assert.equal(hit.volume, 'zyTCAlFPjgYC');
  assert.equal(hit.isbn, '9783462033748');
  assert.equal(hit.thumb, '/api/thumb/gb/zyTCAlFPjgYC');
  assert.equal(googleHit({ id: 'abcdefgh', volumeInfo: { title: 'Ohne Bild' } }).thumb, null);
});

test('gaps filled from the other catalog, nothing overwritten', () => {
  const ol = { title: 'Der Schwarm', authors: ['Frank Schätzing'], pages: 990, description: null, cover_url: null, isbns: ['9783462033748'], ol_work: 'OL276211W' };
  const merged = fillGaps(ol, { ...fromGoogle(GOOGLE_VOLUME), isbns: ['9783462033748', '9783596164530'] });
  assert.equal(merged.pages, 990);
  assert.equal(merged.title, 'Der Schwarm');
  assert.equal(merged.description, 'Ein Roman über das Meer.');
  assert.equal(merged.google_id, 'zyTCAlFPjgYC');
  assert.match(merged.cover_url, /books\.google\.com/);
  assert.deepEqual(merged.isbns, ['9783462033748', '9783596164530']);
  assert.equal(fillGaps(ol, null), ol);
});

test('search hits from both catalogs, each book once', () => {
  const ol = [olSearchHit(OL_SEARCH_DOC)];
  const google = [
    { ...googleHit(GOOGLE_VOLUME) },
    { source: 'google', volume: 'x1', title: 'Harry Potter und der Stein der Weisen', authors: ['Joanne K. Rowling'], isbn: null },
    { source: 'google', volume: 'x2', title: 'Anderes Buch', authors: ['Wer'], isbn: '9783551551672' },
  ];
  assert.deepEqual(mergeHits(ol, google).map((h) => h.volume || h.work), ['OL82563W', 'zyTCAlFPjgYC']);
});
