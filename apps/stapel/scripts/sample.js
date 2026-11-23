// Sample data for trying Stapel on this computer: `node try.mjs stapel --sample` fills a separate
// data folder (data-sample/) with it, never your real data and never on the server. Three people
// share the catalog: you (the admin), Anna with her own marks on some of the same comics, and
// Tom, who has nothing yet (English interface). All series are entered by hand and kept away
// from Comic Vine, so nothing goes out to GCD or Comic Vine; the covers are drawn here in code.
// Only fills an empty database; `node try.mjs stapel --sample --fresh` starts it over.

import { crc32, deflateSync } from 'node:zlib';
import * as store from '../server/db.js';
import { saveCoverUpload } from '../server/catalog.js';
import { createAuth, hashPassword } from '../server/kit/auth.js';

const { db } = store;
await createAuth({ users: store.users, cookie: 'stapel_session' }).ensureAdmin();
const me = store.users.getUserByName(process.env.ADMIN_USER || 'admin');
if (!me) {
  console.log('No account to fill (ADMIN_PASSWORD not set?): no sample data');
  process.exit(0);
}
if (db.prepare('SELECT COUNT(*) AS n FROM series').get().n) {
  console.log('Sample data is there already (--fresh starts it over)');
  process.exit(0);
}

// The first account is the admin (the server does this on the first request)
if (!store.hasAdmin()) store.setAdmin(me.id);

// The others, with simple passwords for trying it out
const people = [
  { username: 'anna', displayName: 'Anna', password: 'local-anna', lang: 'de' },
  { username: 'tom', displayName: 'Tom', password: 'local-tom', lang: 'en' },
];
const ids = {};
for (const p of people) {
  ids[p.username] = store.users.getUserByName(p.username)?.id
    ?? store.createUser({ username: p.username, displayName: p.displayName, passwordHash: await hashPassword(p.password), lang: p.lang });
}
const anna = ids.anna;

// --- helpers ---

const daysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();

// "1-5, 7" → ['1', '2', '3', '4', '5', '7']
function numbers(text) {
  return text.split(/,\s*/).flatMap((part) => {
    const [a, b] = part.split('-').map(Number);
    return b ? Array.from({ length: b - a + 1 }, (_, i) => String(a + i)) : [part];
  });
}

// A hand-entered series, as "Selbst anlegen" makes it, with no Comic Vine lookup
function series({ name, publisher, year, language = 'de', issues = [] }) {
  const id = store.upsertSeries({ name, publisher_name: publisher ?? null, year_began: year ?? null, language: language ?? null });
  store.setCvVolume(id, { state: 'none' });
  const issueIds = store.addCustomIssues(id, issues.map((i) => (typeof i === 'string' ? { number: i } : i)));
  const byNumber = new Map();
  for (const issue of store.issuesOfSeries(id, me.id)) if (!issue.is_variant) byNumber.set(issue.number, issue.id);
  return { id, issueIds, byNumber, pick: (text) => numbers(text).map((n) => byNumber.get(n)).filter(Boolean) };
}

// Marks issues owned/read/wanted the way the app does, then dates the marks back so "recently
// added" and "continue reading" have an order (the app stamps them with the time of the tap)
function mark(userId, s, list, flags, ago) {
  const issueIds = typeof list === 'string' ? s.pick(list) : list;
  if (!issueIds.length) return;
  store.setStatus(userId, issueIds, flags);
  store.setCollected(userId, s.id, true);
  for (const [flag, column] of [['owned', 'owned_at'], ['read', 'read_at'], ['wanted', 'wanted_at']]) {
    if (!flags[flag]) continue;
    const set = db.prepare(`UPDATE user_issues SET ${column} = ? WHERE user_id = ? AND issue_id = ?`);
    issueIds.forEach((id, i) => set.run(daysAgo(ago + (issueIds.length - i) * 0.5), userId, id));
  }
}

// A PNG without any image library: pixel(x, y) → [r, g, b]
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0, o = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++, o += 3) raw.set(pixel(x / width, y / height), o);
  }
  const chunk = (type, data) => {
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, data.length + 8)), data.length + 8);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// A comic cover: a title band in one colour, a picture area with a few shapes, a price corner
function cover(hue, seed) {
  const hsl = (h, s, l) => {
    const f = (n) => {
      const k = (n + h / 30) % 12;
      return Math.round(255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [f(0), f(8), f(4)];
  };
  const band = hsl(hue, 0.7, 0.45);
  const sky = hsl((hue + 180) % 360, 0.5, 0.75);
  const ground = hsl((hue + 90) % 360, 0.4, 0.4);
  return png(200, 300, (x, y) => {
    if (y < 0.18) return x > 0.1 && x < 0.9 && y > 0.06 && y < 0.12 ? [255, 255, 255] : band;
    if (x > 0.78 && y > 0.88) return [250, 230, 60];
    if (Math.hypot(x - 0.3 - (seed % 5) * 0.08, (y - 0.45) * 1.5) < 0.1) return [250, 220, 140];
    if (y > 0.72 + 0.05 * Math.sin(x * 9 + seed)) return ground;
    return sky;
  });
}

// --- the catalog ---

const asterixTitles = [
  'Asterix der Gallier', 'Die goldene Sichel', 'Asterix und die Goten', 'Asterix als Gladiator', 'Tour de France',
  'Asterix und Kleopatra', 'Der Kampf der Häuptlinge', 'Asterix bei den Briten', 'Asterix und die Normannen', 'Asterix als Legionär',
  'Der Arvernerschild', 'Asterix bei den Olympischen Spielen', 'Asterix und der Kupferkessel', 'Asterix in Spanien', 'Streit um Asterix',
  'Asterix bei den Schweizern', 'Die Trabantenstadt', 'Die Lorbeeren des Cäsar', 'Der Seher', 'Asterix auf Korsika',
  'Das Geschenk des Cäsar', 'Die große Überfahrt', 'Obelix GmbH & Co. KG', 'Asterix bei den Belgiern', 'Der große Graben',
  'Die Odyssee', 'Der Sohn des Asterix', 'Asterix im Morgenland', 'Asterix und Maestria', 'Obelix auf Kreuzfahrt',
  'Asterix und Latraviata', 'Asterix plaudert aus der Schule', 'Gallien in Gefahr', 'Asterix und Obelix feiern Geburtstag', 'Asterix bei den Pikten',
  'Der Papyrus des Cäsar', 'Asterix in Italien', 'Die Tochter des Vercingetorix', 'Asterix und der Greif', 'Die weiße Iris',
];
const asterix = series({
  name: 'Asterix',
  publisher: 'Egmont Ehapa',
  year: 1968,
  issues: asterixTitles.map((title, i) => ({ number: String(i + 1), title })),
});
// A second printing of #1: counts as #1, shows with "Varianten"
const [reprint] = store.addCustomIssues(asterix.id, [{ number: '1', title: 'Asterix der Gallier', variant: 'Nachdruck 2013' }]);

// Details as they come from GCD: date, price, pages, ISBN, credits
const isbn13 = (twelve) => twelve + ((10 - ([...twelve].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0) % 10)) % 10);
asterix.issueIds.forEach((id, i) => {
  const year = [1968, 1969, 1970, 1971, 1971, 1972, 1972, 1973, 1973, 1974][i] ?? 1974 + Math.floor((i - 10) * 1.3);
  store.updateIssueInfo(id, {
    key_date: i % 3 ? `${year}-${String((i % 12) + 1).padStart(2, '0')}` : String(year),
    price: i < 24 ? `${(4.8 + i * 0.1).toFixed(2).replace('.', ',')} DM` : `${(6.5 + (i - 24) * 0.15).toFixed(2).replace('.', ',')} €`,
    page_count: 48,
    isbn: i % 4 === 3 ? null : isbn13(`978377040${String(i + 100).padStart(3, '0')}`),
    credits: JSON.stringify(i < 24 ? { script: ['René Goscinny'], art: ['Albert Uderzo'] } : { script: [i < 34 ? 'Albert Uderzo' : 'Jean-Yves Ferri'], art: [i < 34 ? 'Albert Uderzo' : 'Didier Conrad'] }),
  });
});

const ltb = series({ name: 'Lustiges Taschenbuch', publisher: 'Egmont Ehapa', year: 1967, issues: numbers('1-250') });

const spirou = series({
  name: 'Spirou und Fantasio',
  publisher: 'Carlsen',
  year: 1981,
  issues: ['Die Zauberer', 'Das Nest im Urwald', 'Der Plan des Zyklotrop', 'Das Abenteuer der Kristallkugel', 'Der Schatz der Schmuggler', 'Die Rückkehr des Marsupilami'].map((title, i) => ({ number: String(i + 1), title })),
});

const long = series({
  name: 'Die unglaublich lange Geschichte der außergewöhnlichen Abenteuer von Ünal & Özdemir – Sonderausgabe „Jubiläum“ (überarbeitete Neuauflage, Band 1–12)',
  publisher: null, // optional fields left out: no publisher, no year, no language
  year: null,
  language: null,
  issues: [
    '1', '2', '2½', '3a', '3b',
    { number: '4', title: 'Ein Band mit einem sehr langen Titel, der auf dem Platzhalter-Cover und in der Liste umbrechen muss, mit Ümläuten (äöüß) & Sonderzeichen' },
    { number: 'Sonderheft', title: 'Zum 25. Jubiläum' },
    { number: '0', title: '' },
  ],
});

const empty = series({ name: 'Leere Serie', publisher: 'Eigenverlag', year: 2026 }).id; // a series without issues (collected below)

const saga = series({ name: 'Saga', publisher: 'Cross Cult', year: 2013, issues: numbers('1-11') });
const calvin = series({ name: 'Calvin and Hobbes', publisher: 'Andrews McMeel', year: 1987, language: 'en', issues: numbers('1-11') });

// --- your marks ---

mark(me.id, asterix, '1-6, 8-14, 16-21, 23-28', { owned: true }, 300);
mark(me.id, asterix, '1-6, 8-14, 16-20', { read: true }, 200);
mark(me.id, asterix, '33, 38, 40', { wanted: true }, 10);
mark(me.id, asterix, [reprint], { owned: true }, 3);
store.setPersonal(me.id, asterix.byNumber.get('1'), { rating: 5, notes: 'Mein erstes Asterix-Heft, von Opa geschenkt. Rücken etwas eingerissen.' });
store.setPersonal(me.id, asterix.byNumber.get('4'), { rating: 4 });
store.setPersonal(me.id, asterix.byNumber.get('12'), { rating: 2, notes: 'Doppelt gekauft – eins kann weg.' });

// Many issues: owned in long runs with gaps, about half read
mark(me.id, ltb, '1-40, 42-75, 80-120, 122-150, 160-175, 180', { owned: true }, 120);
mark(me.id, ltb, '1-60, 62-90', { read: true }, 60);
mark(me.id, ltb, '200-205', { wanted: true }, 20);
store.setPersonal(me.id, ltb.byNumber.get('100'), { rating: 5, notes: 'Jubiläumsband' });

store.setCollected(me.id, spirou.id, true); // tracked, but nothing owned yet: no gaps shown
mark(me.id, spirou, '1, 2', { wanted: true }, 5);

mark(me.id, long, '1, 2, 3a, Sonderheft', { owned: true }, 30);
mark(me.id, long, '1', { read: true }, 25);
store.setPersonal(me.id, long.byNumber.get('2'), { notes: 'Eine sehr lange Notiz: '.concat('Gekauft auf dem Flohmarkt in Köln-Ehrenfeld, Zustand gut, mit Widmung des Zeichners auf der ersten Seite. '.repeat(6)) });

store.setCollected(me.id, empty, true);

// The last ones you got, a few days ago, still unread: they show under "Weiterlesen"
mark(me.id, ltb, '176-179', { owned: true }, 1);

// --- Anna's marks: some of the same comics ("Anna besitzt es auch") and her own ---

mark(anna, asterix, '1-10, 29-40', { owned: true }, 400);
mark(anna, asterix, '1-10, 29-35', { read: true }, 300);
mark(anna, ltb, '1-30', { owned: true, read: true }, 500);
mark(anna, saga, '1-9', { owned: true }, 90);
mark(anna, saga, '1-6', { read: true }, 40);
mark(anna, saga, '10, 11', { wanted: true }, 2);
mark(anna, calvin, '1-11', { owned: true, read: true }, 700);
store.setPersonal(anna, saga.byNumber.get('1'), { rating: 5, notes: 'Unbedingt Band 2 hinterher!' });

// --- covers: for some issues, drawn here and stored like a photo taken in the app ---

const covered = [
  ...asterix.pick('1-12').map((id, i) => [id, (i * 37) % 360, i]),
  ...ltb.pick('1-8, 176-179').map((id, i) => [id, 200 + i * 9, i]),
  ...long.pick('1, 4').map((id, i) => [id, 300, i]),
  ...saga.pick('1-3').map((id, i) => [id, 20, i]),
];
for (const [id, hue, seed] of covered) await saveCoverUpload(id, cover(hue, seed), 'image/png');

const count = (sql, ...args) => db.prepare(sql).get(...args).n;
console.log(
  `Sample data: ${count('SELECT COUNT(*) AS n FROM series')} series with ${count('SELECT COUNT(*) AS n FROM issues')} issues, ` +
    `${count('SELECT COUNT(*) AS n FROM user_issues')} marks and ${covered.length} covers; ` +
    `${me.username} (admin), ${people.map((p) => `${p.username} / ${p.password}`).join(', ')}`,
);
db.close();
