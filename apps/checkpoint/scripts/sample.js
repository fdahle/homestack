// Sample data for trying Checkpoint on this computer: `node try.mjs checkpoint --sample` fills a
// separate data folder (data-sample/) with it, never your real data and never on the server.
// Dates are relative to today. Nothing is fetched from IGDB: the "IGDB" games are made up here
// and go through the app's own IGDB mapping, and their covers are little pictures drawn below.
// Some games have a cover, some don't, so both show. Everything goes through the app's checks.
// Only fills an empty database; `node try.mjs checkpoint --sample --fresh` starts it over.

import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as store from '../server/db.js';
import { cleanGameInput, datesInOrder, fromIgdb } from '../server/games.js';
import { createAuth } from '../server/kit/auth.js';

await createAuth({ users: store.users, cookie: 'checkpoint_session' }).ensureAdmin();
if (store.db.prepare('SELECT COUNT(*) AS n FROM games').get().n) {
  console.log('Sample data is there already (--fresh starts it over)');
  process.exit(0);
}

// --- a tiny JPEG writer: one colour per 8×8 block, enough for a recognisable cover ---

// Standard DC table (JPEG Annex K); the AC table only needs "end of block", as every block is flat
const DC_COUNTS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_CODES = [];
for (let len = 1, code = 0, sym = 0; len <= 16; len++, code <<= 1) {
  for (let i = 0; i < DC_COUNTS[len - 1]; i++) DC_CODES[sym++] = [code++, len];
}

// pixel(bx, by) → [r, g, b] for the block in column bx, row by
function jpeg(width, height, pixel) {
  const bytes = [];
  let acc = 0;
  let n = 0;
  const bits = (value, len) => {
    for (let i = len - 1; i >= 0; i--) {
      acc = (acc << 1) | ((value >> i) & 1);
      if (++n === 8) {
        bytes.push(acc);
        if (acc === 0xff) bytes.push(0); // byte stuffing
        acc = 0;
        n = 0;
      }
    }
  };
  const pred = [0, 0, 0];
  for (let by = 0; by < height / 8; by++) {
    for (let bx = 0; bx < width / 8; bx++) {
      const [r, g, b] = pixel(bx, by);
      const ycc = [0.299 * r + 0.587 * g + 0.114 * b, 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, 128 + 0.5 * r - 0.418688 * g - 0.081312 * b];
      ycc.forEach((v, c) => {
        const dc = Math.round(8 * (Math.min(255, Math.max(0, v)) - 128)); // DC of a flat block, quantised by 1
        const diff = dc - pred[c];
        pred[c] = dc;
        const size = diff === 0 ? 0 : Math.floor(Math.log2(Math.abs(diff))) + 1;
        bits(...DC_CODES[size]);
        if (size) bits(diff > 0 ? diff : diff + (1 << size) - 1, size);
        bits(0, 1); // end of block
      });
    }
  }
  if (n) bits(0x7f, 8 - n); // pad with ones
  const seg = (marker, body) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
  return Buffer.from([
    0xff, 0xd8,
    ...seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xdb, [0, ...new Array(64).fill(1)]),
    ...seg(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]),
    ...seg(0xc4, [0x00, ...DC_COUNTS, ...DC_CODES.map((_, i) => i)]),
    ...seg(0xc4, [0x10, 1, ...new Array(15).fill(0), 0]),
    ...seg(0xda, [3, 1, 0, 2, 0, 3, 0, 0, 63, 0]),
    ...bytes,
    0xff, 0xd9,
  ]);
}

function hsl(h, s, l) {
  const f = (k) => {
    const x = (k + h / 30) % 12;
    return Math.round(255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(x - 3, 9 - x, 1))));
  };
  return [f(0), f(8), f(4)];
}

// A cover in the game's own colours: a gradient, a "sun" and a band where a title would be
function drawCover(seed) {
  const hue = seed % 360;
  const top = hsl(hue, 0.55, 0.25);
  const bottom = hsl((hue + 40) % 360, 0.6, 0.55);
  const sun = hsl((hue + 180) % 360, 0.8, 0.7);
  const cx = 3 + (seed % 6);
  const cy = 3 + (seed % 4);
  return jpeg(96, 128, (bx, by) => {
    if (by === 13) return [240, 236, 228];
    if ((bx - cx) ** 2 + (by - cy) ** 2 <= 5) return sun;
    const t = by / 15;
    return top.map((v, i) => Math.round(v + (bottom[i] - v) * t));
  });
}

// --- helpers ---

const DAY = 86_400_000;
const day = (n) => store.localDate(new Date(Date.now() + n * DAY)); // 'YYYY-MM-DD', n days from today
const month = (n) => day(n).slice(0, 7);
const unix = (date) => Date.parse(date) / 1000;
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.codePointAt(0)) >>> 0, 7);

// A seeded random, so the 200 games come out the same every time
let seed = 42;
const random = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
const pick = (list) => list[Math.floor(random() * list.length)];

let fakeIgdbId = 9_000_000; // far above IGDB's real ids, so no search result is mistaken for one of these
let added = 0;
const covers = { igdb: 0, photo: 0 };

// One game. igdb: what IGDB would answer (it goes through fromIgdb like a real one), or none for a
// game entered by hand. mine: your part (status, rating, dates, notes) as the app sends it.
// cover: 'igdb' or 'photo' for a drawn cover. addedDaysAgo: when it went into the library.
function game({ igdb, manual, mine, cover, addedDaysAgo = 0, touchedDaysAgo }) {
  let fields;
  if (igdb) {
    const id = fakeIgdbId++;
    const slug = igdb.name.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    fields = fromIgdb(
      {
        id,
        name: igdb.name,
        slug,
        url: `https://www.igdb.com/games/${slug}`,
        summary: igdb.summary,
        first_release_date: igdb.released ? unix(igdb.released) : undefined,
        platforms: (igdb.platforms || []).map((abbreviation) => ({ abbreviation })),
        genres: (igdb.genres || []).map((name) => ({ name })),
        involved_companies: igdb.developer ? [{ developer: true, company: { name: igdb.developer } }] : [],
        franchises: igdb.series ? [{ name: igdb.series }] : [],
        cover: cover ? { image_id: `sample${id}` } : undefined,
      },
      igdb.hours ? { normally: igdb.hours[0] * 3600, completely: igdb.hours[1] && igdb.hours[1] * 3600 } : null,
    );
    Object.assign(fields, cleanGameInput(mine));
  } else {
    fields = cleanGameInput({ ...manual, ...mine }, { manual: true });
  }
  if (!datesInOrder(fields.started_on, fields.finished_on)) throw new Error(`${fields.name}: finished before started`);
  const id = store.insertGame(fields);
  if (cover) {
    const file = `${id}-${randomBytes(6).toString('hex')}.jpg`;
    writeFileSync(join(store.COVER_DIR, file), drawCover(hash(fields.name)));
    store.updateGame(id, { cover_file: file, cover_source: cover });
    covers[cover]++;
  }
  // When it was added and last changed (no store function sets these: they are always "now" there)
  const at = (n) => new Date(Date.now() - n * DAY).toISOString();
  store.db.prepare('UPDATE games SET created_at = ?, updated_at = ? WHERE id = ?').run(at(addedDaysAgo), at(touchedDaysAgo ?? addedDaysAgo), id);
  added++;
}

const PC = ['PC'];

// --- playing right now ---

game({
  igdb: {
    name: "Baldur's Gate 3", released: '2023-08-03', platforms: ['PC', 'PS5', 'Series X|S', 'Mac'], developer: 'Larian Studios',
    genres: ['Role-playing (RPG)', 'Strategy', 'Turn-based strategy (TBS)', 'Adventure'], series: "Baldur's Gate", hours: [75, 145],
    summary: 'Sammle deine Gruppe und kehre in die Vergessenen Reiche zurück – in eine Geschichte über Freundschaft, Verrat und die Verlockung der absoluten Macht.',
  },
  mine: { status: 'playing', playedOn: 'PC', startedOn: day(-24), notes: 'Zweiter Durchgang als Barde. Akt 2, kurz vor Mondaufgang.' },
  cover: 'igdb', addedDaysAgo: 400, touchedDaysAgo: 1,
});
game({
  igdb: {
    name: 'Hollow Knight: Silksong', released: '2025-09-04', platforms: ['PC', 'Switch', 'PS5', 'PS4', 'Series X|S'], developer: 'Team Cherry',
    genres: ['Platform', 'Adventure', 'Indie'], series: 'Hollow Knight', hours: [30, 60],
  },
  mine: { status: 'playing', playedOn: 'Switch', startedOn: day(-60) },
  cover: 'igdb', addedDaysAgo: 900, touchedDaysAgo: 5,
});
game({
  igdb: {
    name: 'Stardew Valley', released: '2016-02-26', platforms: ['PC', 'Switch', 'PS4', 'XONE', 'iOS', 'Android'], developer: 'ConcernedApe',
    genres: ['Role-playing (RPG)', 'Simulator', 'Strategy', 'Indie'], hours: [53, 150],
  },
  mine: { status: 'playing', playedOn: 'Steam Deck', startedOn: '2023-04', rating: 9, notes: 'Läuft nebenher, ein Tag pro Abend.' },
  addedDaysAgo: 1000, touchedDaysAgo: 30,
});
game({
  manual: { name: 'Pokémon Smaragd (Nuzlocke)', releaseDate: '2004-09', platforms: ['GBA'], genres: ['Role-playing (RPG)'], developer: 'Game Freak', franchise: 'Pokémon' },
  mine: { status: 'playing', playedOn: 'Game Boy Advance', startedOn: day(-3), notes: 'Regeln: nur das erste Pokémon pro Route, besiegte sind weg. Noch 4 im Team.' },
  addedDaysAgo: 3, touchedDaysAgo: 0,
});

// --- finished, 100 %, dropped: spread over the years for the stats ---

game({
  igdb: {
    name: 'The Witcher 3: Wild Hunt', released: '2015-05-19', platforms: ['PC', 'PS4', 'XONE', 'Switch', 'PS5', 'Series X|S'], developer: 'CD Projekt RED',
    genres: ['Role-playing (RPG)', 'Adventure'], series: 'The Witcher', hours: [51.5, 173],
  },
  mine: { status: 'finished', rating: 10, playedOn: 'PS4', startedOn: '2018-11', finishedOn: '2019-03' },
  cover: 'igdb', addedDaysAgo: 1500,
});
game({
  igdb: { name: 'Celeste', released: '2018-01-25', platforms: ['PC', 'Switch', 'PS4', 'XONE'], developer: 'Maddy Makes Games', genres: ['Platform', 'Indie'], hours: [8, 37] },
  mine: { status: 'finished', rating: 9, playedOn: 'Switch', startedOn: '2021-06-30', finishedOn: '2021-07-14', notes: '1.983 Tode. Kapitel 9 fehlt noch.' },
  cover: 'igdb', addedDaysAgo: 1400,
});
game({
  igdb: { name: 'Disco Elysium', released: '2019-10-15', platforms: PC, developer: 'ZA/UM', genres: ['Role-playing (RPG)', 'Adventure', 'Indie'], hours: [22, 45] },
  mine: { status: 'finished', rating: 9, playedOn: 'PC', finishedOn: '2022-01' },
  addedDaysAgo: 1300,
});
game({
  igdb: {
    name: 'Hades', released: '2020-09-17', platforms: ['PC', 'Switch', 'PS4', 'PS5', 'XONE', 'Series X|S'], developer: 'Supergiant Games',
    genres: ['Role-playing (RPG)', "Hack and slash/Beat 'em up", 'Indie'], hours: [22, 95],
  },
  mine: { status: 'completed', rating: 10, playedOn: 'Switch', startedOn: '2021-02', finishedOn: '2021-09-02' },
  cover: 'igdb', addedDaysAgo: 1350,
});
game({
  igdb: {
    name: 'The Legend of Zelda: Breath of the Wild', released: '2017-03-03', platforms: ['Switch', 'WiiU'], developer: 'Nintendo EPD',
    genres: ['Adventure', 'Role-playing (RPG)'], series: 'The Legend of Zelda', hours: [50, 190],
  },
  mine: { status: 'finished', rating: 10, playedOn: 'Switch', finishedOn: '2018' },
  cover: 'igdb', addedDaysAgo: 1600,
});
game({
  igdb: {
    name: 'The Legend of Zelda: Tears of the Kingdom', released: '2023-05-12', platforms: ['Switch'], developer: 'Nintendo EPD',
    genres: ['Adventure', 'Role-playing (RPG)'], series: 'The Legend of Zelda', hours: [59, 210],
  },
  mine: { status: 'finished', rating: 9, playedOn: 'Switch', startedOn: '2023-05-12', finishedOn: '2023-09-03' },
  cover: 'igdb', addedDaysAgo: 1290,
});
game({
  igdb: { name: 'Portal 2', released: '2011-04-18', platforms: ['PC', 'PS3', 'X360', 'Mac', 'Linux'], developer: 'Valve', genres: ['Shooter', 'Puzzle'], series: 'Portal', hours: [8.5, 22] },
  mine: { status: 'finished', rating: 8, playedOn: 'PC', finishedOn: '2012' },
  addedDaysAgo: 1600,
});
game({
  igdb: { name: 'Outer Wilds', released: '2019-05-28', platforms: ['PC', 'PS4', 'XONE', 'Switch'], developer: 'Mobius Digital', genres: ['Adventure', 'Puzzle', 'Indie'], hours: [17, 23] },
  mine: { status: 'finished', rating: 10, playedOn: 'PC', startedOn: day(-75), finishedOn: day(-58), notes: 'Ohne Spoiler: unbedingt spielen. Und dann nie wieder darüber reden.' },
  cover: 'photo', addedDaysAgo: 200, touchedDaysAgo: 58,
});
game({
  igdb: { name: 'Inside', released: '2016-06-29', platforms: ['PC', 'PS4', 'XONE', 'Switch'], developer: 'Playdead', genres: ['Platform', 'Puzzle', 'Adventure', 'Indie'], hours: [3.5, 5] },
  mine: { status: 'finished', rating: 7 }, // finished, but no idea when
  addedDaysAgo: 1100,
});
game({
  igdb: { name: 'Super Mario Odyssey', released: '2017-10-27', platforms: ['Switch'], developer: 'Nintendo EPD', genres: ['Platform', 'Adventure'], series: 'Super Mario', hours: [12.5, 60] },
  mine: { status: 'completed', rating: 8, playedOn: 'Switch', finishedOn: '2020-04' },
  cover: 'igdb', addedDaysAgo: 1500,
});
game({
  igdb: { name: 'Red Dead Redemption 2', released: '2018-10-26', platforms: ['PS4', 'XONE', 'PC'], developer: 'Rockstar Games', genres: ['Shooter', 'Adventure'], series: 'Red Dead', hours: [50, 175] },
  mine: { status: 'finished', rating: 9, playedOn: 'PS4', startedOn: '2020-03', finishedOn: '2020-05' },
  addedDaysAgo: 1450,
});
game({
  igdb: { name: 'Elden Ring', released: '2022-02-25', platforms: ['PC', 'PS5', 'PS4', 'Series X|S', 'XONE'], developer: 'FromSoftware', genres: ['Role-playing (RPG)', 'Adventure'], hours: [58, 133] },
  mine: { status: 'dropped', rating: 6, playedOn: 'PS5', startedOn: '2022-03', finishedOn: '2022-04', notes: 'An Margit gescheitert. Vielleicht später nochmal.' },
  cover: 'igdb', addedDaysAgo: 1000,
});
game({
  igdb: { name: 'Cyberpunk 2077', released: '2020-12-10', platforms: ['PC', 'PS4', 'XONE', 'PS5', 'Series X|S'], developer: 'CD Projekt RED', genres: ['Shooter', 'Role-playing (RPG)', 'Adventure'], hours: [25, 104] },
  mine: { status: 'dropped', playedOn: 'PC', startedOn: '2020-12', finishedOn: '2021-01' }, // dropped, no rating
  addedDaysAgo: 1100,
});
game({
  manual: { name: 'Die Siedler II – Gold Edition (die CD aus dem Keller)', releaseDate: '1997', platforms: ['PC'], genres: ['Strategy', 'Simulator'], developer: 'Blue Byte' },
  mine: { status: 'finished', rating: 8, playedOn: 'PC', finishedOn: '2003' },
  cover: 'photo', addedDaysAgo: 700,
});
game({
  manual: { name: 'Pixel-Labyrinth (unser Uni-Projekt)', releaseDate: '2014-02' },
  mine: { status: 'finished', playedOn: 'PC', finishedOn: '2014-02' }, // no rating
  addedDaysAgo: 650,
});

// --- the awkward ones ---

game({
  manual: {
    name: 'Die unglaublich lange Reise des kleinen Ölprinzen Größenwahn: Ein Abenteuer über Ümläute, Sonderzeichen (€, ½, „Anführungszeichen“) & die Frage, wie lang ein Titel eigentlich sein darf – Director’s Cut',
    releaseDate: '2009-11-11',
    developer: 'Ein Studio mit einem ebenfalls sehr langen Namen, das sich niemand merken kann GmbH & Co. KG',
    franchise: 'Die unglaublich lange Reise',
    platforms: ['PC', 'Mac', 'Linux', 'Switch', 'PS4', 'PS5', 'XONE', 'Series X|S', 'iOS', 'Android', 'Stadia', 'Ouya'],
    genres: ['Adventure', 'Point-and-click', 'Puzzle', 'Indie', 'Role-playing (RPG)', 'Simulator', 'Strategy'],
    summary: `Ein Spiel mit einer langen Beschreibung. ${'Der kleine Ölprinz reist über Berge, Täler und Flüsse, trifft schräge Gestalten und löst Rätsel mit Gegenständen, die er unterwegs findet. '.repeat(8)}`,
  },
  mine: {
    status: 'backlog',
    notes: `Lange Notizen mit Absätzen.\n\n${'Hab es auf dem Flohmarkt gefunden, für 2 €. Die Hülle ist kaputt, aber die CD läuft. Mal sehen, ob es auf einem aktuellen Rechner startet. '.repeat(6)}\n\n– Patch 1.3 installieren\n– Speicherstände sichern\n– Öl nachfüllen (Insider)`,
  },
  addedDaysAgo: 120,
});
// Only a name, nothing else
game({ manual: { name: 'Kniffel (Familienversion)' }, mine: { status: 'backlog' }, addedDaysAgo: 40 });
game({ manual: { name: 'Ö' }, mine: { status: 'wishlist' }, addedDaysAgo: 10 });

// --- the wishlist and the backlog ---

game({
  igdb: { name: 'The Elder Scrolls VI', platforms: ['PC', 'Series X|S'], developer: 'Bethesda Game Studios', genres: ['Role-playing (RPG)'], series: 'The Elder Scrolls' },
  mine: { status: 'wishlist', notes: 'Kommt wohl nie.' }, addedDaysAgo: 1200,
});
game({
  igdb: { name: 'Hades II', released: '2025-09-25', platforms: ['PC', 'Switch', 'Mac'], developer: 'Supergiant Games', genres: ['Role-playing (RPG)', "Hack and slash/Beat 'em up", 'Indie'], hours: [30, 70] },
  mine: { status: 'wishlist' }, cover: 'igdb', addedDaysAgo: 300,
});
game({
  igdb: { name: 'Kingdom Come: Deliverance II', released: '2025-02-04', platforms: ['PC', 'PS5', 'Series X|S'], developer: 'Warhorse Studios', genres: ['Role-playing (RPG)', 'Adventure'], hours: [55, 125] },
  mine: { status: 'wishlist' }, addedDaysAgo: 250,
});
const BACKLOG = [
  ['Persona 5 Royal', '2019-10-31', ['PS4', 'PC', 'Switch', 'PS5'], 'Atlus', ['Role-playing (RPG)', 'Turn-based strategy (TBS)'], 'Persona', [98, 140], 'igdb'],
  ['Hollow Knight', '2017-02-24', ['PC', 'Switch', 'PS4', 'XONE'], 'Team Cherry', ['Platform', 'Adventure', 'Indie'], 'Hollow Knight', [27, 63], 'igdb'],
  ['Sekiro: Shadows Die Twice', '2019-03-22', ['PC', 'PS4', 'XONE'], 'FromSoftware', ['Adventure', "Hack and slash/Beat 'em up"], null, [30, 72]],
  ['Divinity: Original Sin II', '2017-09-14', ['PC', 'PS4', 'XONE', 'Switch'], 'Larian Studios', ['Role-playing (RPG)', 'Strategy', 'Turn-based strategy (TBS)'], 'Divinity', [60, 130], 'igdb'],
  ['Return of the Obra Dinn', '2018-10-18', ['PC', 'Mac', 'Switch', 'PS4'], 'Lucas Pope', ['Puzzle', 'Adventure', 'Indie'], null, [9, 10]],
  ['Pentiment', '2022-11-15', ['PC', 'XONE', 'Series X|S', 'Switch', 'PS5'], 'Obsidian Entertainment', ['Adventure', 'Role-playing (RPG)'], null, [17, 22], 'igdb'],
  ['Final Fantasy VII Remake', '2020-04-10', ['PS4', 'PC', 'PS5'], 'Square Enix', ['Role-playing (RPG)', 'Adventure'], 'Final Fantasy', [34, 90]],
  ['Tunic', '2022-03-16', ['PC', 'Mac', 'XONE', 'Series X|S', 'Switch', 'PS4', 'PS5'], 'Isometricorp Games', ['Adventure', 'Puzzle', 'Indie'], null, [12, 25], 'igdb'],
  ['Chrono Trigger', '1995-03-11', ['SNES', 'PC', 'NDS'], 'Square', ['Role-playing (RPG)'], null, [23, 40]],
  ['Metroid Dread', '2021-10-08', ['Switch'], 'MercurySteam', ['Platform', 'Shooter', 'Adventure'], 'Metroid', [9, 13], 'igdb'],
  ['Into the Breach', '2018-02-27', ['PC', 'Switch', 'Mac'], 'Subset Games', ['Strategy', 'Turn-based strategy (TBS)', 'Indie'], null, [10, 40]],
  ['Slay the Spire', '2019-01-23', ['PC', 'Switch', 'PS4'], 'Mega Crit', ['Card & Board Game', 'Strategy', 'Indie'], null, null],
];
BACKLOG.forEach(([name, released, platforms, developer, genres, series, hours, cover], i) => {
  game({ igdb: { name, released, platforms, developer, genres, series, hours }, mine: { status: 'backlog' }, cover, addedDaysAgo: 30 + i * 47 });
});

// --- many games, to see the library's speed and scrolling (made-up names) ---

const WORDS_A = ['Sternen', 'Nebel', 'Eisen', 'Schatten', 'Kristall', 'Moor', 'Glut', 'Wolken', 'Asche', 'Silber', 'Dornen', 'Funken', 'Wind', 'Rost'];
const WORDS_B = ['fall', 'reich', 'wald', 'hafen', 'feste', 'tal', 'krone', 'pfad', 'schmiede', 'turm', 'see', 'garten'];
const SUBTITLES = ['', '', '', ': Die Rückkehr', ' II', ' III', ': Remastered', ': Chroniken', ' – Definitive Edition', ': Origins', ' 2'];
const GENRES = ['Role-playing (RPG)', 'Adventure', 'Platform', 'Puzzle', 'Shooter', 'Indie', 'Strategy', 'Simulator', 'Racing', 'Sport', 'Tactical', 'Point-and-click'];
const PLATFORMS = ['PC', 'Switch', 'PS5', 'PS4', 'Series X|S', 'XONE', 'Mac', 'Linux'];
const STUDIOS = ['Nordlicht Studios', 'Kleine Fische Games', 'Hafenkran Interactive', 'Pixelmühle', 'Studio Wetterleuchten', 'Eichhorn Entertainment'];
const MANY_STATUSES = ['backlog', 'backlog', 'backlog', 'backlog', 'backlog', 'backlog', 'wishlist', 'wishlist', 'finished', 'finished', 'completed', 'dropped'];
const PLAYED_ON = ['PC', 'PC', 'Switch', 'PS5', 'Steam Deck'];

const names = new Set();
while (names.size < 170) names.add(`${pick(WORDS_A)}${pick(WORDS_B)}${pick(SUBTITLES)}`);
for (const name of names) {
  const status = pick(MANY_STATUSES);
  const released = `${1998 + Math.floor(random() * 28)}-${String(1 + Math.floor(random() * 12)).padStart(2, '0')}-${String(1 + Math.floor(random() * 28)).padStart(2, '0')}`;
  const main = random() < 0.8 ? Math.round(2 + random() * 80) : null;
  const mine = { status };
  if (['finished', 'completed', 'dropped'].includes(status)) {
    mine.playedOn = pick(PLAYED_ON);
    if (random() < 0.85) mine.finishedOn = day(-Math.floor(random() * 365 * 6)).slice(0, random() < 0.5 ? 7 : 10);
    if (random() < 0.8) mine.rating = 1 + Math.floor(random() * 10);
  }
  const genres = [...new Set([pick(GENRES), pick(GENRES)])];
  const platforms = [...new Set([pick(PLATFORMS), pick(PLATFORMS), pick(PLATFORMS)])];
  const developer = pick(STUDIOS);
  const addedDaysAgo = Math.floor(random() * 1500);
  // Most "from IGDB", some entered by hand
  if (random() < 0.8) {
    game({ igdb: { name, released, platforms, developer, genres, hours: main && [main, Math.round(main * 2.2)] }, mine, cover: random() < 0.5 ? 'igdb' : undefined, addedDaysAgo });
  } else {
    game({ manual: { name, releaseDate: released.slice(0, 4), platforms, genres, developer }, mine, addedDaysAgo });
  }
}

// --- done ---

const counts = store.db.prepare('SELECT status, COUNT(*) AS n FROM games GROUP BY status ORDER BY n DESC').all().map((r) => `${r.n} ${r.status}`).join(', ');
console.log(`Sample data: ${added} games (${counts}), ${covers.igdb + covers.photo} covers drawn (${covers.photo} as your own photo)`);
store.db.close();
