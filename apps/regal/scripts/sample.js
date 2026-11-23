// Sample data for trying Regal on this computer: `node try.mjs regal --sample` fills a separate
// data folder (data-sample/) with it, never your real data and never on the server. About 200
// books: e-books from a small made-up Calibre library (data-sample/calibre/, read by the normal
// Calibre sync, covers included) and printed books entered by hand, in every status, with series,
// books without cover or ISBN, long titles, umlauts and reading dates relative to today.
// Nothing goes over the network: the covers are drawn here.
// Only fills an empty database; `node try.mjs regal --sample --fresh` starts it over.

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

// Run by hand (without try.mjs), it still stays out of your real data
process.env.DATA_DIR ||= 'data-sample';

const store = await import('../server/db.js');
const { createAuth } = await import('../server/kit/auth.js');
const { cleanBookInput, datesInOrder } = await import('../server/books.js');
const { makeCalibreLibrary } = await import('../server/calibre-fixture.js');
const { syncCalibre } = await import('../server/sync.js');

await createAuth({ users: store.users, cookie: 'regal_session' }).ensureAdmin();
if (!store.users.countUsers()) console.log('No account yet (ADMIN_PASSWORD not set?): the books are there, but nobody can log in');
if (store.db.prepare('SELECT COUNT(*) AS n FROM books').get().n) {
  console.log('Sample data is there already (--fresh starts it over)');
  process.exit(0);
}

// --- helpers ---

// The same made-up library every time
let seed = 7;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = (list) => list[Math.floor(random() * list.length)];

const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return store.localDate(d);
};
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();

// A valid ISBN-13 (978-3-…), made up from a number
function isbn(n) {
  const core = `9783${String(40_000_000 + n * 7919).slice(-8)}`;
  const sum = [...core].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
  return core + ((10 - (sum % 10)) % 10);
}

// A small cover picture: a coloured book with a light title plate. It's a PNG under Calibre's
// name cover.jpg; browsers go by the content, and Regal only copies covers, it never reads them.
function cover(n) {
  const hue = (n * 47) % 360;
  const rgb = (l) => {
    const s = 0.45;
    const f = (k) => {
      const a = s * Math.min(l, 1 - l);
      const x = (k + hue / 30) % 12;
      return Math.round(255 * (l - a * Math.max(-1, Math.min(x - 3, 9 - x, 1))));
    };
    return [f(0), f(8), f(4)];
  };
  const [base, dark, light] = [rgb(0.42), rgb(0.25), rgb(0.9)];
  const w = 120;
  const h = 180;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const plate = x >= 18 && x < 112 && y >= 36 && y < 84;
      const line = x >= 30 && x < 100 && y >= 140 && y < 146;
      for (const c of x < 8 ? dark : plate ? light : line ? dark : base) raw[o++] = c;
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bits per channel
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const calibre = []; // books in the made-up Calibre library
const printed = []; // books entered by hand
const mine = new Map(); // title → your own entries (status, rating, dates, page, notes)
let n = 0;

// An e-book in Calibre. x: series, i (number in it), tags, pub, lang, formats, desc (HTML),
// noCover, noIsbn, read (Calibre's read mark), gone (taken out of Calibre later), my (your entries).
function ebook(title, authors, year, pages, x = {}) {
  n++;
  calibre.push({
    id: n, // Calibre's book id: stays when other books leave the library
    title,
    authors: [authors].flat(),
    series: x.series,
    seriesIndex: x.i,
    pubdate: `${year}-06-15 00:00:00+00:00`,
    isbn: x.isbn ?? (x.noIsbn ? undefined : isbn(n)),
    uuid: randomUUID(),
    comments: x.desc,
    publisher: x.pub,
    lang: x.lang || 'deu',
    tags: x.tags || [],
    formats: x.formats || ['EPUB'],
    pages,
    read: x.read ?? false,
    cover: x.noCover ? undefined : cover(n),
    gone: x.gone,
  });
  if (x.my) mine.set(title, x.my);
}

// A printed book, entered by hand (as on the add page, without a catalog)
function paper(title, authors, year, pages, x = {}) {
  n++;
  printed.push({
    title,
    subtitle: x.subtitle,
    authors: [authors].flat(),
    series: x.series,
    seriesIndex: x.i,
    year,
    publisher: x.pub,
    pages,
    isbns: x.isbn ?? (x.noIsbn ? undefined : isbn(n)),
    language: x.lang || 'de',
    description: x.desc,
  });
  if (x.my) mine.set(title, x.my);
}

// --- e-books in Calibre ---

ebook('Die Farben der Magie', 'Terry Pratchett', 1985, 288, { series: 'Scheibenwelt', i: 1, tags: ['Fantasy'], pub: 'Piper', read: true, my: { rating: 8, finishedOn: '2019' } });
ebook('Das Licht der Phantasie', 'Terry Pratchett', 1986, 288, { series: 'Scheibenwelt', i: 2, tags: ['Fantasy'], pub: 'Piper', read: true, my: { rating: 7, finishedOn: '2019' } });
ebook('Das Erbe des Zauberers', 'Terry Pratchett', 1987, 272, { series: 'Scheibenwelt', i: 3, tags: ['Fantasy'], pub: 'Piper', read: true, my: { rating: 9, finishedOn: '2020-02' } });
ebook('Gevatter Tod', 'Terry Pratchett', 1987, 304, { series: 'Scheibenwelt', i: 4, tags: ['Fantasy'], pub: 'Piper', read: true, my: { rating: 10, finishedOn: '2020-03' } });
ebook('Der Zauberhut', 'Terry Pratchett', 1988, 288, { series: 'Scheibenwelt', i: 5, tags: ['Fantasy'], pub: 'Piper', read: true });
ebook('MacBest', 'Terry Pratchett', 1988, 320, { series: 'Scheibenwelt', i: 6, tags: ['Fantasy'], pub: 'Piper', noCover: true, my: { status: 'read', rating: 7 } });
ebook('Pyramiden', 'Terry Pratchett', 1989, 352, { series: 'Scheibenwelt', i: 7, tags: ['Fantasy'], pub: 'Piper' });
ebook('Wachen! Wachen!', 'Terry Pratchett', 1989, 384, { series: 'Scheibenwelt', i: 8, tags: ['Fantasy'], pub: 'Piper', formats: ['EPUB', 'MOBI'], read: true, my: { rating: 10, finishedOn: day(-40), notes: 'Mumm! Endlich die Stadtwache. Unbedingt weiterlesen mit „Helle Barden“.' } });
ebook('Total verhext', 'Terry Pratchett', 1991, 320, { series: 'Scheibenwelt', i: 12, tags: ['Fantasy'], pub: 'Piper' });
ebook('Good Omens', ['Terry Pratchett', 'Neil Gaiman'], 1990, 412, { tags: ['Fantasy', 'Humor'], lang: 'eng', pub: 'Gollancz', read: true, my: { rating: 9, finishedOn: '2021-08-14' } });

for (const [i, title, pages] of [[1, 'Harry Potter und der Stein der Weisen', 336], [2, 'Harry Potter und die Kammer des Schreckens', 352], [3, 'Harry Potter und der Gefangene von Askaban', 448],
  [4, 'Harry Potter und der Feuerkelch', 768], [5, 'Harry Potter und der Orden des Phönix', 1024], [6, 'Harry Potter und der Halbblutprinz', 656], [7, 'Harry Potter und die Heiligtümer des Todes', 768]]) {
  ebook(title, 'J. K. Rowling', 1997 + i, pages, { series: 'Harry Potter', i, tags: ['Fantasy', 'Jugendbuch'], pub: 'Carlsen', read: true, my: { rating: 8 + (i % 3), finishedOn: String(2000 + i) } });
}

ebook('Tödliche Spiele', 'Suzanne Collins', 2009, 416, { series: 'Die Tribute von Panem', i: 1, tags: ['Jugendbuch', 'Dystopie'], pub: 'Oetinger', read: true, my: { rating: 8, finishedOn: '2013-04' } });
ebook('Gefährliche Liebe', 'Suzanne Collins', 2010, 432, { series: 'Die Tribute von Panem', i: 2, tags: ['Jugendbuch', 'Dystopie'], pub: 'Oetinger', read: true, my: { rating: 7, finishedOn: '2013-05' } });
ebook('Flammender Zorn', 'Suzanne Collins', 2011, 432, { series: 'Die Tribute von Panem', i: 3, tags: ['Jugendbuch', 'Dystopie'], pub: 'Oetinger', noCover: true, my: { status: 'dropped', currentPage: 120, notes: 'Hat mich nicht mehr gepackt.' } });

ebook('Leviathan Wakes', 'James S. A. Corey', 2011, 592, { series: 'The Expanse', i: 1, tags: ['Science-Fiction'], lang: 'eng', pub: 'Orbit', read: true, my: { rating: 9, finishedOn: day(-200) } });
ebook("Caliban's War", 'James S. A. Corey', 2012, 608, { series: 'The Expanse', i: 2, tags: ['Science-Fiction'], lang: 'eng', pub: 'Orbit', read: true, my: { rating: 8, startedOn: day(-190), finishedOn: day(-160) } });
ebook('Gods of Risk', 'James S. A. Corey', 2012, 80, { series: 'The Expanse', i: 2.5, tags: ['Science-Fiction'], lang: 'eng', pub: 'Orbit', noIsbn: true, my: { status: 'read', finishedOn: day(-150) } });
ebook("Abaddon's Gate", 'James S. A. Corey', 2013, 560, { series: 'The Expanse', i: 3, tags: ['Science-Fiction'], lang: 'eng', pub: 'Orbit', my: { status: 'read', rating: 7, startedOn: day(-140), finishedOn: day(-95) } });
ebook('Cibola Burn', 'James S. A. Corey', 2014, 592, { series: 'The Expanse', i: 4, tags: ['Science-Fiction'], lang: 'eng', pub: 'Orbit' });

for (const [i, title, year] of [[1, 'Milchgeld', 2003], [2, 'Erntedank', 2004], [3, 'Seegrund', 2006], [4, 'Laienspiel', 2008], [5, 'Rauhnacht', 2009]]) {
  ebook(title, ['Volker Klüpfel', 'Michael Kobr'], year, 320 + i * 24, { series: 'Kommissar Kluftinger', i, tags: ['Krimi', 'Allgäu'], pub: 'Piper', read: i < 4, ...(i === 1 ? { my: { rating: 6, finishedOn: '2017-07' } } : {}) });
}
for (const [i, title, year] of [[1, 'Die Känguru-Chroniken', 2009], [2, 'Das Känguru-Manifest', 2011], [3, 'Die Känguru-Offenbarung', 2014], [4, 'Die Känguru-Apokryphen', 2018]]) {
  ebook(title, 'Marc-Uwe Kling', year, 270 + i * 20, { series: 'Känguru', i, tags: ['Humor'], pub: 'Ullstein', read: true, formats: ['EPUB', 'PDF'], my: { rating: 9 - (i % 2), finishedOn: String(year + 1) } });
}
for (const [i, title, year] of [[1, 'Verblendung', 2006], [2, 'Verdammnis', 2007], [3, 'Vergebung', 2008]]) {
  ebook(title, 'Stieg Larsson', year, 700 + i * 30, { series: 'Millennium', i, tags: ['Krimi', 'Skandinavien'], pub: 'Heyne', read: i < 3 });
}
for (const [i, title] of ['Bretonische Verhältnisse', 'Bretonische Brandung', 'Bretonisches Gold', 'Bretonischer Stolz', 'Bretonische Flut', 'Bretonisches Leuchten',
  'Bretonische Geheimnisse', 'Bretonische Spezialitäten', 'Bretonische Nächte', 'Bretonischer Ruhm', 'Bretonische Sehnsucht'].entries()) {
  ebook(title, 'Jean-Luc Bannalec', 2012 + i, 300 + ((i * 37) % 90), { series: 'Kommissar Dupin', i: i + 1, tags: ['Krimi', 'Frankreich'], pub: 'Kiepenheuer & Witsch', read: i < 6, noCover: i === 8 });
}
for (const [i, title] of ['Winterkartoffelknödel', 'Dampfnudelblues', 'Schweinskopf al dente', 'Grießnockerlaffäre', 'Sauerkrautkoma', 'Zwetschgendatschikomplott',
  'Leberkäsjunkie', 'Weißwurstconnection', 'Kaiserschmarrndrama', 'Kutteln de luxe', 'Rehragout-Rendezvous', 'Steckerlfischfiasko'].entries()) {
  ebook(title, 'Rita Falk', 2010 + i, 280 + ((i * 29) % 70), { series: 'Franz Eberhofer', i: i + 1, tags: ['Krimi', 'Bayern'], pub: 'dtv', read: i < 9, formats: i % 4 ? ['EPUB'] : ['EPUB', 'AZW3'] });
}

// The ones whose cases the views show: reading now, dropped, this year, notes, long texts
ebook('Tyll', 'Daniel Kehlmann', 2017, 480, { tags: ['Roman', 'Historisch'], pub: 'Rowohlt', my: { status: 'reading', startedOn: day(-12), currentPage: 212 } });
ebook('Project Hail Mary', 'Andy Weir', 2021, 496, { tags: ['Science-Fiction'], lang: 'eng', pub: 'Ballantine', my: { status: 'reading', startedOn: day(-3), currentPage: 41 } });
ebook('Herkunft', 'Saša Stanišić', 2019, null, { tags: ['Roman'], pub: 'Luchterhand', noCover: true, my: { status: 'reading', startedOn: day(-30), currentPage: 87 } });
ebook('Der Turm', 'Uwe Tellkamp', 2008, 976, { tags: ['Roman', 'DDR'], pub: 'Suhrkamp', my: { status: 'dropped', rating: 4, startedOn: '2024-01', finishedOn: '2024-03', currentPage: 311, notes: 'Sprachlich beeindruckend, aber zu zäh für den Winter. Vielleicht später noch mal.' } });
ebook('A Little Life', 'Hanya Yanagihara', 2015, 720, { tags: ['Roman'], lang: 'eng', pub: 'Doubleday', my: { status: 'dropped', currentPage: 260 } });
ebook('Die Vermessung der Welt', 'Daniel Kehlmann', 2005, 304, { tags: ['Roman', 'Historisch'], pub: 'Rowohlt', read: true, my: { rating: 8, finishedOn: '2008' } });
ebook('Unterleuten', 'Juli Zeh', 2016, 640, { tags: ['Roman'], pub: 'Luchterhand', read: true, my: { rating: 9, startedOn: day(-75), finishedOn: day(-52) } });
ebook('Über Menschen', 'Juli Zeh', 2021, 416, { tags: ['Roman'], pub: 'Luchterhand', my: { status: 'read', rating: 7, finishedOn: day(-21) } });
ebook('Corpus Delicti', 'Juli Zeh', 2009, 272, { tags: ['Roman', 'Dystopie'], pub: 'Schöffling', read: true });
ebook('Kairos', 'Jenny Erpenbeck', 2021, 384, { tags: ['Roman', 'DDR'], pub: 'Penguin', my: { status: 'read', rating: 8, startedOn: day(-14), finishedOn: day(-2) } });
ebook('Das Parfum', 'Patrick Süskind', 1985, 320, { tags: ['Roman', 'Klassiker'], pub: 'Diogenes', read: true, my: { rating: 9, finishedOn: '2006-05-20' } });
ebook('Der Vorleser', 'Bernhard Schlink', 1995, 208, { tags: ['Roman'], pub: 'Diogenes', read: true });
ebook('Tschick', 'Wolfgang Herrndorf', 2010, 256, { tags: ['Roman', 'Jugendbuch'], pub: 'Rowohlt', read: true, my: { rating: 10, finishedOn: '2012-08' } });
ebook('Im Westen nichts Neues', 'Erich Maria Remarque', 1929, 288, { tags: ['Roman', 'Klassiker'], pub: 'Kiepenheuer & Witsch', read: true });
ebook('Emil und die Detektive', 'Erich Kästner', 1929, 176, { tags: ['Kinderbuch', 'Klassiker'], pub: 'Atrium', read: true, my: { rating: 8, finishedOn: '1995' } });
ebook('Das doppelte Lottchen', 'Erich Kästner', 1949, 176, { tags: ['Kinderbuch', 'Klassiker'], pub: 'Atrium', read: true });
ebook('Jugend ohne Gott', 'Ödön von Horváth', 1937, 160, { tags: ['Roman', 'Klassiker', 'Schullektüre'], pub: 'Suhrkamp', read: true, my: { rating: 6, finishedOn: '2009-11' } });
ebook('Der Steppenwolf', 'Hermann Hesse', 1927, 288, { tags: ['Roman', 'Klassiker'], pub: 'Suhrkamp', read: true });
ebook('Siddhartha', 'Hermann Hesse', 1922, 128, { tags: ['Roman', 'Klassiker'], pub: 'Suhrkamp', noCover: true });
ebook('Die Verwandlung', 'Franz Kafka', 1915, 96, { tags: ['Erzählung', 'Klassiker', 'Schullektüre'], pub: 'Reclam', read: true, formats: ['EPUB', 'PDF'] });
ebook('Der Process', 'Franz Kafka', 1925, 288, { tags: ['Roman', 'Klassiker'], pub: 'Fischer', noIsbn: true });
ebook('Effi Briest', 'Theodor Fontane', 1895, 336, { tags: ['Roman', 'Klassiker', 'Schullektüre'], pub: 'Reclam', read: true, my: { rating: 5, finishedOn: '2010' } });
ebook('Die Leiden des jungen Werthers', 'Johann Wolfgang von Goethe', 1774, 160, { tags: ['Roman', 'Klassiker', 'Schullektüre'], pub: 'Reclam', read: true, noCover: true, noIsbn: true });
ebook('Momo', 'Michael Ende', 1973, 304, { tags: ['Kinderbuch', 'Fantasy'], pub: 'Thienemann', read: true, my: { rating: 10, finishedOn: '1996' } });
ebook('Die unendliche Geschichte', 'Michael Ende', 1979, 480, { tags: ['Kinderbuch', 'Fantasy'], pub: 'Thienemann', read: true });
ebook('Krabat', 'Otfried Preußler', 1971, 320, { tags: ['Jugendbuch', 'Fantasy'], pub: 'Thienemann', read: true, my: { rating: 9 } });
ebook('Altes Land', 'Dörte Hansen', 2015, 288, { tags: ['Roman'], pub: 'Knaus', read: true, my: { rating: 8, finishedOn: day(-280) } });
ebook('Mittagsstunde', 'Dörte Hansen', 2018, 320, { tags: ['Roman'], pub: 'Penguin', my: { status: 'read', rating: 9, finishedOn: day(-110) } });
ebook('Ein ganzes Leben', 'Robert Seethaler', 2014, 192, { tags: ['Roman'], pub: 'Hanser Berlin', read: true, my: { rating: 9, finishedOn: '2016-02' } });
ebook('Der Trafikant', 'Robert Seethaler', 2012, 256, { tags: ['Roman'], pub: 'Kein & Aber', read: true });
ebook('Kruso', 'Lutz Seiler', 2014, 480, { tags: ['Roman', 'DDR'], pub: 'Suhrkamp' });
ebook('Stern 111', 'Lutz Seiler', 2020, 528, { tags: ['Roman', 'DDR'], pub: 'Suhrkamp' });
ebook('Die Wand', 'Marlen Haushofer', 1963, 288, { tags: ['Roman'], pub: 'List', read: true, my: { rating: 8, finishedOn: day(-310) } });
ebook('Schachnovelle', 'Stefan Zweig', 1942, 112, { tags: ['Erzählung', 'Klassiker'], pub: 'Fischer', read: true, my: { rating: 9, finishedOn: '2011' } });
ebook('Die Welt von Gestern', 'Stefan Zweig', 1942, 512, { tags: ['Autobiografie'], pub: 'Fischer' });
ebook('Der kleine Prinz', 'Antoine de Saint-Exupéry', 1943, 112, { tags: ['Klassiker'], pub: 'Karl Rauch', read: true, my: { rating: 7 } });
ebook('1984', 'George Orwell', 1949, 384, { tags: ['Roman', 'Dystopie', 'Klassiker'], pub: 'Ullstein', read: true, my: { rating: 9, finishedOn: '2014-01' } });
ebook('Farm der Tiere', 'George Orwell', 1945, 144, { tags: ['Roman', 'Klassiker'], pub: 'Diogenes', read: true });
ebook('Schöne neue Welt', 'Aldous Huxley', 1932, 368, { tags: ['Roman', 'Dystopie'], pub: 'Fischer' });
ebook('Fahrenheit 451', 'Ray Bradbury', 1953, 208, { tags: ['Roman', 'Dystopie'], pub: 'Diogenes', read: true });
ebook('Der Name der Rose', 'Umberto Eco', 1980, 656, {
  tags: ['Roman', 'Historisch', 'Krimi'],
  pub: 'Hanser',
  read: true,
  my: { rating: 10, startedOn: '2018-12', finishedOn: '2019-02' },
  desc: [
    '<p>Im Jahr 1327 kommt der Franziskaner William von Baskerville mit seinem jungen Novizen Adson von Melk in eine reiche Benediktinerabtei im Apennin. Dort soll ein heikles Treffen zwischen Gesandten des Papstes und Vertretern des Kaisers stattfinden. Doch kaum angekommen, wird William gebeten, einen rätselhaften Todesfall aufzuklären.</p>',
    '<p>Es bleibt nicht bei einem Toten. An sieben Tagen und Nächten sterben Mönche auf immer seltsamere Weise, und alle Spuren führen in die Bibliothek der Abtei: ein Labyrinth, das niemand außer dem Bibliothekar und seinem Gehilfen betreten darf, und in dem ein Buch verborgen ist, das um keinen Preis gelesen werden soll.</p>',
    '<p>William, ein Schüler Roger Bacons und ehemaliger Inquisitor, vertraut auf Beobachtung und Logik, wo die anderen den Teufel am Werk sehen. Adson, der als alter Mann die Geschichte aufschreibt, erzählt von Ketzern und Bettelorden, vom Streit um die Armut Christi, von Visionen, Giften und einer verbotenen Liebe, und davon, wie wenig sich das Wissen einsperren lässt.</p>',
    '<p>Umberto Ecos erster Roman verbindet einen klassischen Kriminalfall mit einem Panorama des Mittelalters. Er ist gelehrt und spannend zugleich, voller Zitate, Anspielungen und lateinischer Sätze, die man getrost überlesen darf, und er wurde zu einem der erfolgreichsten Bücher des zwanzigsten Jahrhunderts.</p>',
    '<p>„Stat rosa pristina nomine, nomina nuda tenemus.“</p>',
  ].join(''),
});
ebook('Hundert Jahre Einsamkeit', 'Gabriel García Márquez', 1967, 464, { tags: ['Roman', 'Klassiker'], pub: 'Fischer', read: true, my: { rating: 6, finishedOn: '2015-09' } });
ebook('Der Schatten des Windes', 'Carlos Ruiz Zafón', 2001, 576, { tags: ['Roman'], pub: 'Suhrkamp', read: true, my: { rating: 8 } });
ebook('Die Säulen der Erde', 'Ken Follett', 1989, 1296, { tags: ['Roman', 'Historisch'], pub: 'Lübbe', read: true, formats: ['EPUB', 'PDF', 'MOBI'] });
ebook('Der Medicus', 'Noah Gordon', 1986, 864, { tags: ['Roman', 'Historisch'], pub: 'Heyne' });
ebook('Der Hundertjährige, der aus dem Fenster stieg und verschwand', 'Jonas Jonasson', 2009, 416, { tags: ['Roman', 'Humor'], pub: 'carl’s books', read: true, my: { rating: 7, finishedOn: '2013' } });
ebook('Warum Männer nicht zuhören und Frauen schlecht einparken', ['Allan Pease', 'Barbara Pease'], 1999, 384, { tags: ['Sachbuch'], pub: 'Ullstein', noCover: true });
ebook('Die Wahrheit über den Fall Harry Quebert', 'Joël Dicker', 2012, 736, { tags: ['Roman', 'Krimi'], pub: 'Piper', read: true });
ebook('Der Gesang der Flusskrebse', 'Delia Owens', 2018, 464, { tags: ['Roman'], pub: 'hanserblau', my: { status: 'read', rating: 7, finishedOn: day(-65) } });
ebook('Die Mitternachtsbibliothek', 'Matt Haig', 2020, 320, { tags: ['Roman'], pub: 'Droemer' });
ebook('Der Alchimist', 'Paulo Coelho', 1988, 192, { tags: ['Roman'], pub: 'Diogenes', read: true, gone: true });
ebook('Das Café am Rande der Welt', 'John Strelecky', 2003, 128, { tags: ['Ratgeber'], pub: 'dtv', gone: true, my: { status: 'dropped', notes: 'Geschenk. Nicht meins.' } });
ebook('Der Schwarm', 'Frank Schätzing', 2004, 992, { isbn: '9783462033748', tags: ['Roman', 'Science-Fiction'], pub: 'Kiepenheuer & Witsch' });

ebook('Eine kurze Geschichte der Menschheit', 'Yuval Noah Harari', 2011, 528, { tags: ['Sachbuch', 'Geschichte'], pub: 'DVA', read: true, my: { rating: 8, finishedOn: '2017-10' } });
ebook('Schnelles Denken, langsames Denken', 'Daniel Kahneman', 2011, 624, { tags: ['Sachbuch', 'Psychologie'], pub: 'Siedler', my: { status: 'dropped', currentPage: 190, rating: 6 } });
ebook('Das geheime Leben der Bäume', 'Peter Wohlleben', 2015, 224, { tags: ['Sachbuch', 'Natur'], pub: 'Ludwig', read: true });
ebook('Darm mit Charme', 'Giulia Enders', 2014, 288, { tags: ['Sachbuch', 'Medizin'], pub: 'Ullstein', read: true, my: { rating: 7, finishedOn: '2015' } });
ebook('Factfulness', ['Hans Rosling', 'Ola Rosling', 'Anna Rosling Rönnlund'], 2018, 400, { tags: ['Sachbuch'], pub: 'Ullstein', my: { status: 'read', rating: 9, finishedOn: day(-180) } });
ebook('Die Kunst des klaren Denkens', 'Rolf Dobelli', 2011, 256, { tags: ['Sachbuch', 'Psychologie'], pub: 'Hanser', noCover: true });
ebook('Atomic Habits', 'James Clear', 2018, 320, { tags: ['Ratgeber'], lang: 'eng', pub: 'Avery', formats: ['EPUB', 'AZW3'] });
ebook('The Martian', 'Andy Weir', 2011, 384, { tags: ['Science-Fiction'], lang: 'eng', pub: 'Crown', read: true, my: { rating: 9, finishedOn: '2016-03-12' } });
ebook('Klara and the Sun', 'Kazuo Ishiguro', 2021, 320, { tags: ['Roman'], lang: 'eng', pub: 'Faber & Faber', my: { status: 'read', rating: 8, finishedOn: day(-8) } });
ebook('Never Let Me Go', 'Kazuo Ishiguro', 2005, 288, { tags: ['Roman'], lang: 'eng', pub: 'Faber & Faber', read: true });
ebook('Normal People', 'Sally Rooney', 2018, 288, { tags: ['Roman'], lang: 'eng', pub: 'Faber & Faber' });
ebook("The Hitchhiker's Guide to the Galaxy", 'Douglas Adams', 1979, 208, { tags: ['Science-Fiction', 'Humor'], lang: 'eng', pub: 'Pan', read: true, my: { rating: 10, finishedOn: '2005' } });
ebook('Dune', 'Frank Herbert', 1965, 688, { tags: ['Science-Fiction', 'Klassiker'], lang: 'eng', pub: 'Ace', read: true, my: { rating: 8, finishedOn: day(-240) } });
ebook('The Left Hand of Darkness', 'Ursula K. Le Guin', 1969, 304, { tags: ['Science-Fiction', 'Klassiker'], lang: 'eng', pub: 'Ace' });
ebook('Pride and Prejudice', 'Jane Austen', 1813, 432, { tags: ['Roman', 'Klassiker'], lang: 'eng', pub: 'Penguin Classics', noIsbn: true, noCover: true });
ebook('Station Eleven', 'Emily St. John Mandel', 2014, 352, { tags: ['Roman', 'Dystopie'], lang: 'eng', pub: 'Knopf', read: true, my: { rating: 8, finishedOn: day(-130) } });
ebook('Children of Time', 'Adrian Tchaikovsky', 2015, 600, { tags: ['Science-Fiction'], lang: 'eng', pub: 'Tor' });
ebook('Americanah', 'Chimamanda Ngozi Adichie', 2013, 608, { tags: ['Roman'], lang: 'eng', pub: 'Knopf' });

// --- printed books, entered by hand ---

paper('Der Schwarm', 'F. Schätzing', 2004, 992, { isbn: '9783462033748', my: { status: 'read', rating: 8, finishedOn: '2005-08' } }); // the same book is in Calibre: the sync links the two
paper('Der Hobbit', 'J. R. R. Tolkien', 1937, 384, { pub: 'Klett-Cotta', my: { status: 'read', rating: 9, finishedOn: '2002' } });
for (const [i, title, pages] of [[1, 'Die Gefährten', 608], [2, 'Die zwei Türme', 480], [3, 'Die Rückkehr des Königs', 544]]) {
  paper(title, 'J. R. R. Tolkien', 1953 + i, pages, { series: 'Der Herr der Ringe', i, pub: 'Klett-Cotta', my: { status: 'read', rating: 10, finishedOn: `2003-0${i + 1}` } });
}
for (const [i, title] of [[1, 'Asterix der Gallier'], [2, 'Die goldene Sichel'], [3, 'Asterix und die Goten']]) {
  paper(title, ['René Goscinny', 'Albert Uderzo'], 1960 + i, 48, { series: 'Asterix', i, pub: 'Egmont Ehapa', my: { status: 'read', finishedOn: '1994' } });
}
paper('Die Blechtrommel', 'Günter Grass', 1959, 784, { pub: 'Steidl', my: { status: 'want' } });
paper('Buddenbrooks', 'Thomas Mann', 1901, 768, { subtitle: 'Verfall einer Familie', pub: 'Fischer', my: { status: 'read', rating: 7, finishedOn: '2012' } });
paper('Der Zauberberg', 'Thomas Mann', 1924, 1008, {
  pub: 'Fischer',
  my: {
    status: 'reading',
    startedOn: '2026-08',
    currentPage: 610,
    notes: 'Lese ich abends, immer ein Kapitel.\n\nSettembrini gegen Naphta: großartig, aber man muss wach sein. Das Kapitel „Schnee“ unbedingt noch einmal lesen.\n\nWer hat mir das eigentlich geschenkt? Tante Hilde, Weihnachten 2023.',
  },
});
paper('Faust', 'Johann Wolfgang von Goethe', 1808, 160, { subtitle: 'Der Tragödie erster Teil', pub: 'Reclam', noIsbn: true, my: { status: 'read', rating: 6 } });
paper('Omas Rezepte', ['Hildegard Müller', 'Käthe Schäfer-Dürrbeck'], 1987, 120, { subtitle: 'Abgeschrieben und ergänzt von der ganzen Familie', noIsbn: true, lang: 'de', desc: 'Ringbuch mit Kopien der handgeschriebenen Rezepte, von Mama 1987 gebunden.' });
paper('Eine Geschichte, deren Titel so lang ist, dass er auf keinen Buchrücken passt, und die trotzdem gelesen werden will: Über Äpfel, Öfen, Übermut und die ganz großen Fragen', 'Hanns-Josef Ortheil-Großkreutz von Überlingen', 2024, 237, { my: { status: 'want' } });
paper('Ohne Autor', [], 2020, null, { noIsbn: true, my: { status: 'want', notes: 'Flohmarktfund, kein Autor angegeben.' } });

// The "Was ist was" books from childhood, a long series in the shelf at home
const topics = ['Unsere Erde', 'Der Mensch', 'Dinosaurier', 'Vulkane', 'Das Wetter', 'Pferde', 'Hunde', 'Katzen', 'Wale und Delfine', 'Der Wald', 'Bienen und Wespen',
  'Sterne und Weltraum', 'Planeten', 'Die Ritter', 'Burgen', 'Das alte Ägypten', 'Das alte Rom', 'Die Wikinger', 'Indianer', 'Piraten', 'Erfindungen', 'Computer',
  'Elektrizität', 'Eisenbahn', 'Flugzeuge', 'Schiffe', 'Autos', 'Der Mond', 'Die Sonne', 'Gesteine und Mineralien', 'Meeresforschung', 'Haie und Rochen',
  'Insekten', 'Vögel', 'Reptilien', 'Raubkatzen', 'Polargebiete', 'Wüsten', 'Regenwald', 'Das Mittelalter', 'Mathematik', 'Musikinstrumente', 'Fußball',
  'Olympische Spiele', 'Die Zeit', 'Licht und Farbe', 'Das Wasser', 'Höhlen', 'Brücken', 'Spinnen', 'Ameisen', 'Gold', 'Pilze', 'Die Steinzeit', 'Die Bibel'];
const wiwAuthors = ['Rainer Crummenerl', 'Manfred Baur', 'Bernd Flessner', 'Karin Finan', 'Sabine Schuck', 'Martin Kliche'];
topics.forEach((topic, k) => {
  const i = k + 1;
  const read = i <= 30;
  paper(topic, pick(wiwAuthors), 1985 + Math.floor(k / 4), 48, {
    series: 'Was ist was',
    i,
    pub: 'Tessloff',
    noIsbn: i % 5 === 0,
    my: read ? { status: 'read', finishedOn: String(1992 + Math.floor(k / 6)), ...(i % 7 === 0 ? { rating: 6 + (i % 5) } : {}) } : { status: 'want' },
  });
});

// --- in: the printed books, then the e-books through the Calibre sync ---

for (const b of printed) {
  const { status = 'want', ...rest } = mine.get(b.title) || {};
  const fields = cleanBookInput({ ...b, isbns: b.isbns, status });
  store.insertBook({ ...fields, source: 'manual' });
}

const library = join(store.DATA_DIR, 'calibre'); // always its own folder, never a real library
const sync = async (books) => {
  makeCalibreLibrary(library, books);
  const result = await syncCalibre({ library });
  if (!result.ok) throw new Error(`Calibre sync failed: ${result.message}`);
  return result;
};
// The bulk: about half of the rest already marked as read in Calibre
for (const c of calibre) if (!mine.has(c.title) && !c.read && random() < 0.35) c.read = true;
const first = await sync(calibre);
// Two books taken out of Calibre afterwards: they stay, as "no longer in Calibre"
const second = await sync(calibre.filter((c) => !c.gone));

// --- your own entries, as the book page saves them ---

const byTitle = new Map(store.allBooks().map((b) => [b.title, b]));
let rejected = 0;
for (const [title, entries] of mine) {
  const book = byTitle.get(title);
  try {
    if (!book) throw new Error('not there');
    const fields = cleanBookInput(entries);
    const started = fields.started_on !== undefined ? fields.started_on : book.started_on;
    const finished = fields.finished_on !== undefined ? fields.finished_on : book.finished_on;
    if (!datesInOrder(started, finished)) throw new Error('finished_before_started');
    if (Object.keys(fields).length) store.updateBook(book.id, fields);
  } catch (err) {
    console.warn(`  not taken: ${title} (${err.code || err.message})`);
    rejected++;
  }
}
// Some of the books Calibre has as read got a rating and a rough date too
for (const book of store.allBooks()) {
  if (mine.has(book.title) || book.status !== 'read' || random() < 0.4) continue;
  store.updateBook(book.id, cleanBookInput({ rating: 4 + Math.floor(random() * 7), finishedOn: random() < 0.5 ? String(2010 + Math.floor(random() * 15)) : null }));
}

store.users.setSetting('reading_goal', 24);

// When each was added and last changed: spread over the last three years instead of all just
// now, so "recently added" and "recently changed" have an order (no function for that: raw SQL)
const stamp = store.db.prepare('UPDATE books SET created_at = ?, updated_at = ? WHERE id = ?');
for (const book of store.allBooks()) {
  const added = 24 + Math.floor(random() * 3 * 365 * 24);
  const changed = book.status === 'reading' ? Math.floor(random() * 48) : book.finished_on?.length === 10 ? Math.max(1, Math.round((Date.now() - new Date(book.finished_on)) / 3_600_000)) : added;
  stamp.run(hoursAgo(added), hoursAgo(Math.min(added, changed)), book.id);
}

const counts = Object.fromEntries(store.db.prepare('SELECT status, COUNT(*) AS n FROM books GROUP BY status').all().map((r) => [r.status, r.n]));
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`Sample data: ${total} books (${Object.entries(counts).map(([s, k]) => `${k} ${s}`).join(', ')}); `
  + `Calibre: ${first.total} e-books, ${first.covers} covers, ${first.linked} linked, ${second.gone} gone${rejected ? `; ${rejected} entries not taken` : ''}`);
store.db.close();
