// Sample data for trying Notizbuch on this computer: `node try.mjs notizbuch --sample` fills a
// separate data folder (data-sample/) with it, never your real data and never on the server.
// Notes go in through the same sync the devices use, so they're checked like everything else;
// the attached pictures and files are drawn here in code and stored the way an upload is.
// Only fills an empty database; `node try.mjs notizbuch --sample --fresh` starts it over.

import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { FILE_DIR, openDatabase } from '../server/db.js';
import { createAuth } from '../server/kit/auth.js';

const store = openDatabase();
await createAuth({ users: store.users, cookie: 'notizbuch_session' }).ensureAdmin();
const user = store.users.getUserByName(process.env.ADMIN_USER || 'admin');
if (!user) {
  console.log('No account to fill (ADMIN_PASSWORD not set?): no sample data');
  process.exit(0);
}
if (store.db.prepare('SELECT COUNT(*) AS n FROM notes').get().n) {
  console.log('Sample data is there already (--fresh starts it over)');
  process.exit(0);
}

// --- helpers ---

const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);

const changes = [];
let age = 400 * 24; // hours ago: older first, so the newest note here is the newest on screen

// note('Title', 'Markdown', { labels, pinned, archived_at, deleted_at }) → id
function note(title, body = '', fields = {}) {
  const id = randomUUID();
  const at = hoursAgo((age -= 7));
  changes.push({ kind: 'note', id, base_seq: 0, patch: { title, body, created_at: at, updated_at: at, ...fields } });
  return id;
}

// A PNG without any image library: pixel(x, y) → [r, g, b]
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0, o = 0; y < height; y++) {
    raw[o++] = 0; // no filter
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
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));

// A landscape: sky, sun, two hills
const landscape = (x, y) => {
  if (Math.hypot(x - 0.72, y - 0.3) < 0.09) return [255, 214, 120];
  if (y > 0.62 + 0.08 * Math.sin(x * 7)) return mix([92, 150, 80], [40, 90, 50], (y - 0.6) * 2.5);
  if (y > 0.5 + 0.1 * Math.sin(x * 4 + 1)) return mix([120, 140, 170], [80, 100, 130], (y - 0.45) * 3);
  return mix([250, 170, 120], [90, 140, 220], 1 - y * 1.6);
};
// Something round on a table, seen from above (for the recipe)
const cake = (x, y) => {
  const r = Math.hypot(x - 0.5, (y - 0.5) * 0.75);
  if (r < 0.3) return (Math.floor(Math.atan2(y - 0.5, x - 0.5) * 4) % 2 ? [214, 160, 90] : [196, 140, 72]);
  if (r < 0.36) return [245, 245, 240];
  return (Math.floor(x * 12) + Math.floor(y * 9)) % 2 ? [182, 120, 80] : [170, 110, 72];
};
// A whiteboard with lines on it
const whiteboard = (x, y) => {
  if (x < 0.04 || x > 0.96 || y < 0.05 || y > 0.95) return [120, 120, 125];
  for (const [ly, len, c] of [[0.2, 0.6, [40, 80, 200]], [0.35, 0.45, [30, 30, 30]], [0.5, 0.7, [30, 30, 30]], [0.65, 0.3, [200, 50, 50]]]) {
    if (Math.abs(y - ly) < 0.012 && x > 0.1 && x < 0.1 + len) return c;
  }
  return [248, 248, 246];
};

// The smallest PDF a viewer opens: one page with one line of text
function pdf(text) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 18 Tf 72 760 Td (${text}) Tj ET`;
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const files = []; // attached after the notes are in: [noteId, name, type, buffer, width?, height?]
const attach = (noteId, name, type, buffer, width, height) => files.push({ noteId, name, type, buffer, width, height });

// --- pinned ---

note('Einkaufsliste', '- [ ] Milch\n- [ ] Brot (Vollkorn)\n- [x] Äpfel\n- [ ] Kaffee\n- [x] Spülmittel\n- [ ] Käse für Raclette\n- [ ] Geschenkpapier', {
  labels: ['Einkauf'],
  pinned: true,
});
// A line break inside a paragraph is a \ at the end of the line, as the editor writes it
note('WLAN für Gäste', 'Netz: **Zuhause-Gast**\\\nPasswort: `Sonnenblume-2026!`', { pinned: true, labels: ['Privat'] });
const plan = note(
  'Projekt Nordlicht – Besprechung',
  [
    '## Teilnehmer',
    '',
    'Jana, Mehmet, Sören, ich',
    '',
    '## Ergebnisse',
    '',
    '1. Der Termin für den Start bleibt der **15. Januar**.',
    '2. Das Budget wird um 12 % erhöht – _vorbehaltlich_ der Freigabe.',
    '3. Mehmet klärt die Lizenzen.',
    '',
    '## Offen',
    '',
    '- [ ] Angebot von der Druckerei einholen',
    '- [ ] Raum für den Workshop buchen',
    '- [x] Protokoll verschicken',
    '',
    '> „Lieber einen Monat später, dafür richtig.“ – Jana',
    '',
    'Fotos vom Whiteboard hängen an der Notiz.',
  ].join('\n'),
  { pinned: true, labels: ['Arbeit'] },
);
attach(plan, 'Whiteboard.png', 'image/png', png(960, 540, whiteboard), 960, 540);

// --- the usual ---

const cakeNote = note(
  'Omas Apfelkuchen',
  [
    '# Omas Apfelkuchen',
    '',
    'Für eine Springform (26 cm). Gelingt **immer**.',
    '',
    '## Zutaten',
    '',
    '- 200 g Butter',
    '- 200 g Zucker',
    '- 4 Eier',
    '- 300 g Mehl',
    '- ½ Päckchen Backpulver',
    '- 1 kg Äpfel (Boskop)',
    '- Zimt nach Geschmack',
    '',
    '## Zubereitung',
    '',
    '1. Butter und Zucker schaumig rühren, Eier einzeln dazu.',
    '2. Mehl und Backpulver unterheben.',
    '3. Äpfel schälen, vierteln, einritzen und auf den Teig setzen.',
    '4. Bei 180 °C Umluft etwa *50 Minuten* backen.',
    '',
    '> Tipp: Am nächsten Tag schmeckt er noch besser.',
    '',
    'Quelle: [Omas Rezeptheft](https://example.org/rezepte/apfelkuchen)',
  ].join('\n'),
  { labels: ['Rezepte', 'Privat'] },
);
attach(cakeNote, 'Apfelkuchen.png', 'image/png', png(600, 600, cake), 600, 600);

note('Shell-Befehle, die ich immer vergesse', [
  'Speicherplatz pro Ordner:',
  '',
  '```sh',
  'du -sh * | sort -h',
  '```',
  '',
  'Ein Backup der Datenbank:',
  '',
  '```sh',
  'sqlite3 notizbuch.db ".backup backup-$(date +%F).db"',
  '```',
  '',
  'Und `git log --oneline --graph --all` für den Überblick.',
].join('\n'), { labels: ['Arbeit', 'Ideen'] });

const trip = note(
  'Ostsee im Sommer',
  [
    'Unterkunft: Ferienwohnung in Zingst, 3. bis 17. August.',
    '',
    '- [x] Zug gebucht',
    '- [x] Ferienwohnung angezahlt',
    '- [ ] Fahrräder vor Ort leihen?',
    '- [ ] Sonnencreme',
    '',
    'Packliste und Rechnung hängen an.',
  ].join('\n'),
  { labels: ['Reisen'] },
);
attach(trip, 'Sonnenuntergang am Strand.png', 'image/png', png(800, 500, landscape), 800, 500);
attach(trip, 'Packliste.txt', 'text/plain', Buffer.from('Packliste Ostsee\n\n- Badesachen\n- Regenjacke\n- Ladekabel\n- Bücher (2–3)\n- Kartenspiel\n'), null, null);
attach(trip, 'Rechnung Ferienwohnung.pdf', 'application/pdf', pdf('Rechnung Ferienwohnung - 1.240,00 EUR'), null, null);

const photos = note('Ausflug zum Kaiserstuhl', '', { labels: ['Reisen'] });
for (let i = 0; i < 4; i++) {
  const shift = i * 0.15;
  attach(photos, `IMG_20${26_04_12 + i}.png`, 'image/png', png(i % 2 ? 400 : 700, i % 2 ? 600 : 420, (x, y) => landscape((x + shift) % 1, y)), i % 2 ? 400 : 700, i % 2 ? 600 : 420);
}

note('', 'Eine Notiz ohne Titel: manchmal steht alles gleich im Text, und der Titel bleibt leer.', { labels: ['Ideen'] });
note('Nur ein Titel, kein Text');
note('Geschenkideen', '- Kopfhörer für Paul\n- Kochkurs für Mama & Papa\n- Ein gutes Notizbuch (aus Papier 😉)\n- Konzertkarten', { labels: ['Ideen', 'Privat'] });
note('Links zum Lesen', [
  '- <https://example.org/artikel/warum-offline-first-wichtig-ist>',
  '- [Ein Artikel über Markdown](https://example.org/markdown)',
  '- https://example.org/ein/sehr/langer/pfad/der/nicht/umbrechen/will/und/trotzdem/in/die/karte/passen/muss?mit=parametern&und=noch=mehr',
].join('\n'), { labels: ['Ideen'] });
note(
  'Eine Notiz mit einem sehr langen Titel, um zu sehen, wie er umbricht, wenn jemand alles in die erste Zeile schreibt – mit Ümläuten (äöü ÄÖÜ ß), Sonderzeichen (€, ½, „Anführungszeichen“, <spitze Klammern> & Kaufmanns-Und) und noch ein bisschen mehr',
  'Kurzer Text.',
);
note('Viele Labels', 'Diese Notiz hat so viele Labels, dass sie umbrechen müssen.', {
  labels: ['Arbeit', 'Privat', 'Rezepte', 'Reisen', 'Ideen', 'Einkauf', 'Wichtig', 'Später', 'Ein ziemlich langes Label mit Ümläuten'],
});

// A long text, to see scrolling in the editor and the cut-off in the list
const diary = [];
for (let day = 1; day <= 14; day++) {
  diary.push(`## Tag ${day}`, '');
  diary.push(
    `Heute war es ${day % 3 ? 'sonnig' : 'regnerisch'}. Wir sind früh aufgestanden, haben am Hafen Brötchen geholt und sind dann ${day % 2 ? 'mit dem Rad an der Küste entlang' : 'zu Fuß durch den Wald'} gefahren bzw. gelaufen. ` +
      'Unterwegs gab es Fischbrötchen, später Kaffee und Kuchen in einem kleinen Café, in dem die Bedienung jeden Gast persönlich zu kennen schien. ' +
      'Abends haben wir Karten gespielt und über die Pläne für morgen geredet – wie immer ohne Ergebnis.',
    '',
  );
  if (day % 4 === 0) diary.push('- [x] Postkarten geschrieben', '- [ ] Fotos sortieren', '');
}
note('Reisetagebuch Dänemark', diary.join('\n').trim(), { labels: ['Reisen', 'Privat'] });

// --- archived, trashed, gone for good ---

note('Umzug 2025', '- [x] Kartons\n- [x] Ummelden\n- [x] Nachsendeauftrag', { labels: ['Privat'], archived_at: daysAgo(120) });
note('Alte Zugangsdaten Router', 'Längst geändert.', { archived_at: daysAgo(40), pinned: true });
note('Notizen zur Konferenz 2025', 'Vorträge, die sich gelohnt haben:\n\n1. Offline zuerst\n2. SQLite überall', { labels: ['Arbeit'], archived_at: daysAgo(2) });
note('Im Papierkorb seit gestern', 'Wird in 29 Tagen endgültig gelöscht.', { deleted_at: daysAgo(1), labels: ['Ideen'] });
const almostGone = note('Fast endgültig weg', 'Liegt seit 28 Tagen im Papierkorb.', { deleted_at: daysAgo(28) });
attach(almostGone, 'altes Foto.png', 'image/png', png(300, 200, landscape), 300, 200);
note('Archiviert und dann gelöscht', '', { archived_at: daysAgo(60), deleted_at: daysAgo(5) });
const purged = note('Schon endgültig gelöscht', 'Davon bleibt nur die Id, damit andere Geräte es erfahren.');

// --- many notes, for scrolling and search speed ---

const words = ['Termin', 'Idee', 'Anruf', 'Liste', 'Gedanke', 'Zitat', 'Erinnerung', 'Frage', 'Entwurf', 'Plan'];
for (let i = 1; i <= 200; i++) {
  const body =
    i % 4 === 0
      ? `- [${i % 8 === 0 ? 'x' : ' '}] Erster Punkt\n- [ ] Zweiter Punkt\n- [ ] Dritter Punkt`
      : i % 4 === 1
        ? `Notiz Nummer ${i}. ${'Ein bisschen Text, damit die Karte nicht leer ist. '.repeat((i % 5) + 1)}`
        : i % 4 === 2
          ? `### Abschnitt ${i}\n\nMit **fett**, _kursiv_ und \`Code\`.`
          : '';
  note(`${words[i % words.length]} ${i}`, body, {
    labels: i % 7 === 0 ? ['Sammlung', 'Wichtig'] : ['Sammlung'],
    ...(i % 25 === 0 ? { archived_at: daysAgo(i / 10) } : {}),
  });
}

// Two areas: home and work (Sammlung, Wichtig, Später stay in neither)
const area = (name, position, members) => changes.push({ kind: 'area', id: randomUUID(), base_seq: 0, patch: { name, position, members, created_at: daysAgo(30), updated_at: daysAgo(30) } });
area('Zuhause', 1, ['Privat', 'Einkauf', 'Rezepte', 'Reisen']);
area('Arbeit', 2, ['Arbeit', 'Ideen']);

// --- in ---

let rejected = 0;
for (let i = 0; i < changes.length; i += 400) {
  const { answer } = store.notes.sync(user.id, { since: 0, changes: changes.slice(i, i + 400) });
  for (const r of answer.rejected) console.warn(`  not taken: ${r.kind} ${r.id} (${r.error})`);
  rejected += answer.rejected.length;
}
// Deleted for good, the way the trash does it
store.notes.sync(user.id, { since: 0, changes: [{ kind: 'note', id: purged, base_seq: 0, patch: { purge: true } }] });

// The files: written first, then recorded, like PUT /api/files/:id
for (const f of files) {
  const id = randomUUID();
  writeFileSync(join(FILE_DIR, id), f.buffer);
  store.notes.addFile(user.id, { id, note_id: f.noteId, name: f.name, type: f.type, size: f.buffer.length, width: f.width, height: f.height });
}

console.log(`Sample data: ${changes.length - rejected - 2} notes (one of them deleted for good), 2 areas and ${files.length} files for ${user.username}`);
store.db.close();
