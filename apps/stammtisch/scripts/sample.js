// Sample data for trying Stammtisch on this computer: `node try.mjs stammtisch --sample` fills a
// separate data folder (data-sample/) with it, never your real data and never on the server.
// Dates are relative to today: a birthday today and next week, someone overdue for getting in
// touch, plans today, tomorrow and later, plans that have passed, ideas, and four years of
// weekly Stammtisch evenings (200-odd entries) to scroll through. A few friends get a small
// generated picture, the rest show their initial. Nothing goes over the network.
// It goes in through the app's own store functions, with the checks the server makes.
// Only fills an empty database; `node try.mjs stammtisch --sample --fresh` starts it over.

import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import * as store from '../server/db.js';
import { addDays } from '../server/friends.js';
import { createAuth } from '../server/kit/auth.js';

await createAuth({ users: store.users, cookie: 'stammtisch_session' }).ensureAdmin();
if (!store.users.countUsers()) {
  console.log('No account to fill (ADMIN_PASSWORD not set?): no sample data');
  process.exit(0);
}
if (store.db.prepare('SELECT COUNT(*) AS n FROM friends').get().n) {
  console.log('Sample data is there already (--fresh starts it over)');
  process.exit(0);
}

// --- helpers ---

const today = store.localDate();
const day = (n) => addDays(today, n);
const thisYear = Number(today.slice(0, 4));
// A birthday in n days, for someone turning `age` then (age null: year unknown)
const birthday = (inDays, age = null) => {
  const on = day(inDays);
  return age === null ? `--${on.slice(5)}` : `${Number(on.slice(0, 4)) - age}${on.slice(4)}`;
};
// Today's date n years ago (for "on this day")
const yearsAgo = (n) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return store.localDate(d);
};

// A small square picture: a head and shoulders on a coloured background, as a PNG (one of the
// types the server takes for photos), saved the way the server saves an upload
function hsl(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))));
}

function png(size, colorAt) {
  const row = size * 3 + 1;
  const raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) raw.set(colorAt(x, y), y * row + 1 + x * 3);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function photo(friendId, hue) {
  const bg = hsl(hue, 45, 78);
  const fg = hsl(hue, 35, 38);
  const image = png(96, (x, y) => {
    const head = (x - 48) ** 2 + (y - 38) ** 2 <= 18 ** 2;
    const shoulders = ((x - 48) / 34) ** 2 + ((y - 100) / 34) ** 2 <= 1;
    return head || shoulders ? fg : bg;
  });
  const file = `${friendId}-${randomBytes(6).toString('base64url')}.png`;
  writeFileSync(join(store.PHOTO_DIR, file), image);
  store.setFriendPhoto(friendId, file);
}

const ids = {};
let photos = 0;

// key: a short name to refer to them below
function friend(key, fields, { circles = [], facts = [], gifts = [], hue = null } = {}) {
  const id = store.createFriend({ archived: 0, ...fields });
  if (circles.length) store.setFriendCircles(id, circles);
  for (const [label, value, category = 'other'] of facts) store.addFact(id, { label, value, category });
  for (const [title, occasion = null, given_on = null] of gifts) store.addGift(id, { title, occasion, given_on });
  if (hue !== null) {
    photo(id, hue);
    photos++;
  }
  ids[key] = id;
}

let events = 0;
// The server's rules: ideas have no date, everything else needs one, end_date after date
function event(title, fields, friendKeys = []) {
  const f = { kind: 'meet', status: 'done', ...fields, title };
  if (f.status === 'idea') Object.assign(f, { date: null, time: null, end_date: null });
  else if (!f.date) throw new Error(`"${title}" needs a date`);
  store.createEvent(f, friendKeys.map((k) => ids[k]));
  events++;
}

// --- friends ---

const STAMMTISCH = 'Stammtisch';
const DOKO = 'Doppelkopf-Runde donnerstags im Hinterzimmer vom „Goldenen Hirsch“';

friend('anna', {
  name: 'Anna Schmidt',
  nickname: 'Anni',
  birthday: birthday(0, 34), // today
  met_on: '2011-10',
  met_story: 'Erste Woche an der Uni, Mathe-Vorkurs. Sie hat mir ihren Taschenrechner geliehen und nie zurückverlangt.',
  city: 'Berlin',
  address: 'Kastanienallee 12\n10435 Berlin',
  phone: '+49 170 1234567',
  email: 'anna.schmidt@example.org',
  contact_weeks: 4,
  notes: 'Mag keine Überraschungspartys. Wirklich nicht.',
}, {
  circles: ['Uni', STAMMTISCH, 'Klettern'],
  facts: [
    ['Partner', 'Jakob', 'family'],
    ['Arbeit', 'Ärztin an der Charité (Innere)', 'work'],
    ['', 'Lakritz, alles mit Lakritz', 'likes'],
    ['', 'vegetarisch', 'food'],
    ['Schuhgröße', '39'],
  ],
  gifts: [
    ['Kochbuch „Vegetarisch für Faule“'],
    ['Seilsack fürs Klettern', 'Geburtstag'],
    ['Konzertkarten Element of Crime', 'Geburtstag', day(-365)],
  ],
  hue: 340,
});

friend('jonas', {
  name: 'Jonas Becker',
  city: 'Hamburg',
  address: 'Schanzenstraße 3, 20357 Hamburg',
  phone: '+49 151 7654321',
  contact_weeks: 2, // last seen six weeks ago: overdue
  met_on: '2012',
}, { circles: ['Uni'], facts: [['Kinder', 'Mila (4) und Ole (1)', 'family']], hue: 200 });

friend('mehmet', {
  name: 'Mehmet Yılmaz',
  birthday: birthday(3), // in three days, year unknown
  city: 'Köln',
  phone: '+49 160 5550123',
  email: 'mehmet@example.com',
  met_on: '2019-04-01',
  met_story: 'Am ersten Arbeitstag in der Kaffeeküche.',
}, {
  circles: ['Arbeit', STAMMTISCH],
  facts: [['Partnerin', 'Elif', 'family'], ['Sohn', 'Emir, geboren vor zweieinhalb Monaten', 'family'], ['', 'Fenerbahçe-Fan', 'likes']],
  gifts: [['Babybody „Kleiner Stammtischbruder“', 'Geburt', day(-70)]],
  hue: 30,
});

friend('sophie', {
  name: 'Sophie Müller',
  birthday: birthday(7, 30), // in a week: the reminder with gift ideas
  city: 'München',
  address: 'Türkenstraße 88\n80799 München',
  email: 'sophie.mueller@example.org',
  met_on: '2005-09',
  met_story: 'Saßen in der 5b nebeneinander.',
}, {
  circles: ['Schule'],
  facts: [['Mann', 'Tobias', 'family'], ['', 'Zimmerpflanzen, je mehr desto besser', 'likes'], ['', 'keine Nüsse (Allergie!)', 'food']],
  gifts: [['Pflanze für den Balkon (Olivenbaum?)', 'Geburtstag'], ['Gutschein für den Plattenladen']],
});

friend('lukas', {
  name: 'Lukas Weber',
  city: 'Leipzig',
  contact_weeks: 8, // never in touch since he was added
}, { circles: ['Klettern'] });

friend('max', {
  name: 'Maximilian Alexander Freiherr von und zu Gröbenhausen-Überlingen',
  nickname: 'Max',
  birthday: birthday(-40, 41),
  met_on: '2015-06-13',
  met_story: 'Beim Doppelkopf im „Goldenen Hirsch“: Er hat drei Runden hintereinander ein Solo angesagt und alle verloren. '
    + 'Danach hat er eine Runde Schnaps ausgegeben, und seitdem sitzt er jeden Donnerstag mit am Tisch.',
  city: 'Frankfurt am Main',
  address: 'c/o Gröbenhausen-Überlingen Vermögensverwaltung GmbH & Co. KG\nGroße Bockenheimer Straße 52, Hinterhaus, 3. OG links\n60313 Frankfurt am Main',
  phone: '+49 (0) 69 / 123 456 - 789',
  email: 'maximilian.alexander.von-und-zu.groebenhausen-ueberlingen@sehr-lange-domain.example.org',
  contact_weeks: 6,
  notes: 'Sagt immer, er sei „nur ein ganz normaler Freiherr“.\n\nWichtig:\n- Nie über Erbschaftssteuer reden\n- Hund heißt Bismarck (Dackel, 14 Jahre)\n- Trinkt Apfelwein nur aus dem Bembel\n\n'
    + 'Sonderzeichen-Test: € ½ ° ß Œ ø å ł ç ğ ş — „deutsch“ »französisch« “englisch” <b>kein HTML</b> & so weiter.',
}, {
  circles: [DOKO, 'Arbeit', STAMMTISCH],
  facts: [
    ['Hund', 'Bismarck, ein rauhaariger Dackel mit sehr eigenem Kopf, der nur auf Kommandos auf Hessisch hört', 'family'],
    ['Beruf', 'Irgendwas mit Vermögensverwaltung, so genau weiß das keiner', 'work'],
    ['', 'Apfelwein', 'food'],
    ['Lieblingsspiel', 'Doppelkopf mit Füchsen, Karlchen und Schweinchen', 'likes'],
  ],
  gifts: [['Ein Bembel mit Wappen', 'Geburtstag', day(-40)]],
  hue: 140,
});

friend('kim', { name: 'Kim' }); // nothing but a name

friend('zoe', {
  name: 'Zoë O’Connor-Łukasiewicz',
  nickname: 'Zo',
  birthday: '2000-02-29', // a leap day
  city: 'Dublin',
  phone: '+353 85 123 4567',
  met_on: '2021-05',
}, { circles: ['Uni'], facts: [['Sprachen', 'Englisch, Polnisch, Irisch, ein bisschen Deutsch']], hue: 270 });

friend('oma', {
  name: 'Hildegard Krause',
  nickname: 'Oma',
  birthday: birthday(45, 85),
  city: 'Leipzig',
  address: 'Am Rosental 7\n04105 Leipzig',
  phone: '0341 1234567',
  contact_weeks: 1, // called twelve days ago: overdue
}, { circles: ['Familie'], facts: [['', 'Eierlikör (selbstgemacht)', 'food'], ['', 'Kreuzworträtsel', 'likes']], hue: 50 });

friend('paul', {
  name: 'Paul Neumann',
  city: 'Berlin',
  contact_weeks: 3, // not seen for six weeks, but there is a plan: not overdue
}, { circles: [STAMMTISCH, DOKO] });

friend('thomas', {
  name: 'Thomas Krüger',
  birthday: birthday(1, 38), // tomorrow, but archived: no reminder
  city: 'Melbourne',
  notes: 'Nach Australien ausgewandert, kein Kontakt mehr.',
  archived: 1,
}, { circles: ['Schule'] });

friend('petra', { name: 'Petra Lang', notes: 'Ehemalige Kollegin.', contact_weeks: 4, archived: 1 }, { circles: ['Arbeit'] });

friend('lea', {
  name: 'Lea Hoffmann',
  birthday: birthday(20, 33),
  city: 'Berlin',
  address: 'Weserstraße 40, 12045 Berlin',
  phone: '+49 176 22233344',
}, { circles: [STAMMTISCH, 'Uni'], hue: 10 });

friend('ben', { name: 'Ben Schulz', phone: '+49 157 99988877' }, { circles: ['Klettern'] }); // phone, no city
friend('clara', { name: 'Clara Fischer', city: 'Dresden' }, { circles: ['Chor'] }); // only a city
friend('david', { name: 'David Wagner', address: 'Kastanienallee 14, 10435 Berlin' }, { circles: ['Nachbarn'] }); // address, no city
friend('emma', { name: 'Emma Richter', email: 'emma.richter@example.net' }, { circles: ['Schule'] });
friend('finn', { name: 'Finn Wolf', city: 'Potsdam', birthday: birthday(120, 29) }, { circles: ['Klettern', STAMMTISCH], hue: 100 });
friend('hannah', { name: 'Hannah Schäfer', city: 'Göttingen', birthday: birthday(25, 35) }, { circles: ['Uni'] });
friend('jan', { name: 'Jan Bauer', city: 'Berlin' }, { circles: [STAMMTISCH] });
friend('julia', { name: 'Julia Koch', city: 'Stuttgart', contact_weeks: 26 }, { circles: ['Arbeit'] }); // due in a few months
friend('marie', { name: 'Marie Klein', address: 'Kastanienallee 12, 10435 Berlin', city: 'Berlin' }, { circles: ['Chor', 'Nachbarn'] });
friend('niklas', { name: 'Niklas Schröder', city: 'Bremen' }, { circles: ['Uni'] });
friend('sarah', { name: 'Sarah Zimmermann', birthday: birthday(30, 34) }, { circles: ['Schule'] });
friend('tim', { name: 'Tim Braun', phone: '+49 171 3456789', email: 'tim@example.com' }, { circles: ['Arbeit'] });
friend('laura', { name: 'Laura Hartmann', nickname: 'Lolli', city: 'Kassel' }, { circles: ['Familie'], facts: [['', 'Cousine', 'family']] });
friend('can', { name: 'Can Öztürk', city: 'Berlin', birthday: birthday(200, 31) }, { circles: [STAMMTISCH, 'Arbeit'] });
friend('ngozi', { name: 'Ngozi Adeyemi', city: 'Berlin' }, { circles: ['Klettern'], hue: 160 });

// Everyone was added a while ago (createFriend stamps today), so "never in touch" counts from then.
// There is no store function for this: the one raw update.
store.db.prepare('UPDATE friends SET created_at = ?').run(new Date(`${day(-400)}T12:00:00`).toISOString());

// --- plans ---

event('Geburtstagsessen für Anna', { kind: 'party', status: 'planned', date: day(0), time: '19:30', place: 'Trattoria da Michele, Oranienstraße' }, ['anna', 'lea', 'finn', 'jan', 'mehmet']);
event('Bouldern', { status: 'planned', date: day(1), time: '18:00', place: 'Boulderhalle Ostbloc' }, ['ben', 'finn', 'ngozi']);
event('Telefonat mit Zoë', { kind: 'call', status: 'planned', date: day(2), time: '20:00' }, ['zoe']);
event('Doppelkopf', { status: 'planned', date: day(5), time: '20:00', place: 'Zum Goldenen Hirsch' }, ['max', 'paul', 'can']);
event('Weihnachtsmarkt', { status: 'planned', date: day(12), place: 'Gendarmenmarkt' }, ['anna', 'lea', 'jan', 'finn', 'can', 'marie', 'david', 'ngozi']);
event('Party bei Lea', { kind: 'party', status: 'planned', date: day(38), time: '21:00', place: 'Weserstraße 40' }, ['lea', 'anna', 'jan', 'finn']);
event('Kletterurlaub Frankenjura', {
  kind: 'trip', status: 'planned', date: day(60), end_date: day(67), place: 'Pottenstein',
  notes: 'Ferienwohnung ist gebucht. Wer fährt? Ben hat den Bus.',
}, ['ben', 'finn', 'ngozi', 'anna']);

// Plans whose day has passed: did they happen?
event('Spieleabend', { status: 'planned', date: day(-2), time: '19:00' }, ['jan', 'finn']);
event('Joggen im Park', { status: 'planned', date: day(-9), time: '08:00', place: 'Tempelhofer Feld' }, ['clara']);

// Cancelled, one past and one still ahead
event('Kino: Dune Teil 3', { status: 'cancelled', date: day(-5), time: '20:15', place: 'Kino International' }, ['jonas', 'niklas']);
event('Konzert im Lido', { status: 'cancelled', date: day(20), time: '20:00', place: 'Lido', notes: 'Abgesagt wegen Krankheit der Band.' }, ['lea']);

// Ideas, without a date
event('Mal wieder zusammen kochen', { status: 'idea' }, ['anna', 'lea']);
event('Wanderung in der Sächsischen Schweiz', { kind: 'trip', status: 'idea', notes: 'Malerweg, vielleicht im Frühling.' });
event('Jonas in Hamburg besuchen', { kind: 'trip', status: 'idea' }, ['jonas']);
event('Eine wirklich sehr lange Idee für irgendwann einmal: mit allen zusammen ein Wochenende in einer Hütte in den Alpen verbringen, ohne Handy, mit Brettspielen und Käsefondue', { status: 'idea' }, ['max', 'paul', 'can', 'anna', 'lea', 'finn', 'jan', 'mehmet']);

// --- what happened ---

event('Abendessen bei Jonas', { date: day(-45), time: '19:00', place: 'Hamburg', notes: 'Die Kinder sind riesig geworden.' }, ['jonas']);
event('Telefonat mit Oma', { kind: 'call', date: day(-12) }, ['oma']);
event('Feierabendbier', { date: day(-40), place: 'Prater Garten' }, ['paul']);
event('Mittagessen', { date: day(-100), place: 'Kantine' }, ['julia']);
event('Anna hat eine neue Stelle an der Charité', { kind: 'note', date: day(-20) }, ['anna']);
event('Mehmet ist Vater geworden 👶', { kind: 'note', date: day(-75), notes: 'Emir, 3480 g, 52 cm. Mutter und Kind wohlauf.' }, ['mehmet']);
event('Roadtrip Südfrankreich', {
  kind: 'trip', date: day(-150), end_date: day(-138), place: 'Marseille – Cassis – Gorges du Verdon',
  notes: 'Zwölf Tage, ein Platten, viel zu viel Käse.\n\nTag 1: Anreise über Lyon\nTag 3: Calanques\nTag 7: Verdon-Schlucht, Kajak\nTag 12: Rückfahrt, 14 Stunden Stau',
}, ['finn', 'ben', 'ngozi']);
event('Hochzeit von Sophie & Tobias', { kind: 'party', date: day(-200), time: '14:00', place: 'Schloss Nymphenburg, München' }, ['sophie', 'emma', 'sarah', 'thomas']);
event('Grillen am See', {
  date: day(-30), time: '15:00', place: 'Schlachtensee', source: 'whatsapp',
  notes: '[' + day(-32).split('-').reverse().join('.') + ', 17:05] Lea: Grillen am Samstag am Schlachtensee?\n'
    + '[' + day(-32).split('-').reverse().join('.') + ', 17:12] Jan: Bin dabei, bringe Würstchen mit\n'
    + '[' + day(-32).split('-').reverse().join('.') + ', 17:20] Anna: Ich bring Halloumi 🧀',
}, ['lea', 'jan', 'anna']);
event('Lesung im Literaturhaus', { date: day(-60), time: '19:30', place: 'Literaturhaus Fasanenstraße' }); // nobody else
event('Kaffee', { date: day(-14) }, ['marie']); // nothing but a date
event('Chorprobe mit anschließendem Umtrunk', { date: day(-16), time: '19:00', place: 'Gemeindehaus' }, ['clara', 'marie']);
event('Uni-Treffen, zehn Jahre nach dem Abschluss', {
  kind: 'party', date: day(-90), place: 'Mensa Nord',
  notes: 'Erstaunlich, wer alles gekommen ist. Hannah hat die alten Fotos mitgebracht.',
}, ['anna', 'jonas', 'hannah', 'niklas', 'zoe', 'lea']);
event('Abschiedsessen für Thomas', { date: day(-3 * 365), place: 'Zur Letzten Instanz' }, ['thomas', 'sophie', 'emma']);
event('Letztes Projekttreffen mit Petra', { date: day(-500) }, ['petra', 'tim']);
// On this day, earlier years
event('Erster Stammtisch-Geburtstag von Anna', { kind: 'party', date: yearsAgo(1), place: 'Zum Goldenen Hirsch' }, ['anna', 'jan', 'lea']);
event('Silberhochzeit der Eltern', { kind: 'party', date: yearsAgo(3), place: 'Kassel' }, ['laura', 'oma']);

// Four years of Thursdays at the Stammtisch: 200 evenings to scroll through
const regulars = ['anna', 'mehmet', 'max', 'lea', 'finn', 'jan', 'can'];
const thursday = (() => {
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() - (((d.getDay() + 3) % 7) || 7)); // the last Thursday before today
  return store.localDate(d);
})();
const places = ['Zum Goldenen Hirsch', 'Zum Goldenen Hirsch', 'Zum Goldenen Hirsch', 'Biergarten am Wasserturm', 'Kneipe Ä'];
for (let week = 0; week < 200; week++) {
  const date = addDays(thursday, -7 * week);
  const there = regulars.filter((_, i) => (week + i * 3) % 5 !== 0);
  const fields = { date, time: '20:00', place: places[week % places.length] };
  if (week % 13 === 7) fields.status = 'cancelled';
  if (week % 9 === 4) fields.notes = `Runde ${200 - week}. ${['Quiz gewonnen!', 'Max hat wieder ein Solo verloren.', 'Neuer Wirt, gleiche Preise.', 'Bis Mitternacht über Fußball gestritten.'][week % 4]}`;
  event('Stammtisch', fields, there);
}

console.log(`Sample data: ${Object.keys(ids).length} friends (${photos} with a picture), ${events} events, ${store.listCircles().length} circles`);
store.db.close();
