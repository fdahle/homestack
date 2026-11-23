// Sample data for trying To-do on this computer: `node try.mjs todo --sample` fills a separate
// data folder (data-sample/) with it, never your real data and never on the server. Dates are
// relative to today, so there is always something overdue, due today, this week and later.
// It goes in through the same sync the devices use, so it's checked like everything else.
// Only fills an empty database; `node try.mjs todo --sample --fresh` starts it over.

import { randomUUID } from 'node:crypto';
import { localDate, openDatabase } from '../server/db.js';
import { createAuth } from '../server/kit/auth.js';

const store = openDatabase();
await createAuth({ users: store.users, cookie: 'todo_session' }).ensureAdmin();
const user = store.users.getUserByName(process.env.ADMIN_USER || 'admin');
if (!user) {
  console.log('No account to fill (ADMIN_PASSWORD not set?): no sample data');
  process.exit(0);
}
if (store.db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n) {
  console.log('Sample data is there already (--fresh starts it over)');
  process.exit(0);
}

// --- helpers ---

const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDate(d);
};
// The next date (today included) that is this ISO weekday (1 Monday … 7 Sunday)
const nextWeekday = (wd) => day((wd - (new Date().getDay() || 7) + 7) % 7);
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const subtasks = (...items) => items.map(([title, done = false]) => ({ id: randomUUID().slice(0, 8), title, done }));

const changes = [];
let created = 30 * 24; // hours ago: older first, so the order on screen is the order here

function list(name, color, position) {
  const id = randomUUID();
  changes.push({ kind: 'list', id, base_seq: 0, patch: { name, color, position } });
  return id;
}

function task(title, fields = {}) {
  const at = hoursAgo((created -= 1));
  changes.push({ kind: 'task', id: randomUUID(), base_seq: 0, patch: { title, created_at: at, updated_at: at, ...fields } });
}

// --- lists ---

const home = list('Haushalt', 'green', 1);
const work = list('Arbeit', 'blue', 2);
const shopping = list('Einkaufen', 'orange', 3);
const long = list('Ein Projekt mit einem ziemlich langen Listennamen, der kaum passt', 'purple', 4);
list('Leer', 'gray', 5); // what an empty list looks like
const many = list('200 Aufgaben', 'pink', 6);

// --- inbox: the cases the views sort by ---

task('Steuererklärung abgeben', { due_date: day(-12), priority: 3, note: 'Belege liegen im Ordner „2025“.' });
task('Rückruf Versicherung', { due_date: day(-2), due_time: '14:00', priority: 2 });
task('Zahnarzt anrufen', { due_date: day(0), due_time: '09:30' });
task('Paket zur Post bringen', { due_date: day(0) });
task('Geburtstagsgeschenk für Oma besorgen', {
  due_date: day(2),
  priority: 2,
  subtasks: subtasks(['Ideen sammeln', true], ['Bestellen'], ['Einpacken'], ['Karte schreiben']),
});
task('Fahrrad zur Inspektion', { due_date: day(1), due_time: '17:15', remind: false });
task('Konzertkarten kaufen, bevor sie ausverkauft sind', { due_date: day(9), priority: 1 });
task('Urlaub planen', { due_date: day(40), note: 'Ostsee oder Alpen?\n\n- Zug buchen\n- Unterkunft\n- Urlaubsantrag' });
task('Buch zurückgeben');
task('Idee: ein Wochenende ohne Handy');
task(
  'Eine sehr lange Aufgabe, um zu sehen, wie der Titel umbricht, wenn jemand wirklich alles in die erste Zeile schreibt, inklusive Ümläuten, Sonderzeichen (€, ½, „Anführungszeichen“) und einer URL https://example.org/ein/sehr/langer/pfad?mit=parametern',
  { due_date: day(3) },
);
task('', { note: 'Eine Aufgabe ohne Titel: manchmal steht alles in der Notiz.' });
task('Längst erledigt', { due_date: day(-5), done_at: hoursAgo(100) });
task('Gestern erledigt', { done_at: hoursAgo(20), priority: 3 });
task('Im Papierkorb', { deleted_at: hoursAgo(30) });

// --- repeating ---

task('Müll rausbringen', { list_id: home, due_date: nextWeekday(2), due_time: '07:00', repeat: { unit: 'week', every: 1, weekdays: [2], from: 'due' } });
task('Pflanzen gießen', { list_id: home, due_date: day(1), repeat: { unit: 'day', every: 3, from: 'done' } });
task('Miete überweisen', { list_id: home, due_date: day(-1), priority: 3, repeat: { unit: 'month', every: 1, day: 1, from: 'due' } });
task('Rauchmelder testen', { list_id: home, due_date: day(60), repeat: { unit: 'year', every: 1, from: 'due' } });
task('Sport', { list_id: home, due_date: nextWeekday(1), due_time: '18:30', repeat: { unit: 'week', every: 1, weekdays: [1, 3, 5], from: 'due' } });
task('Fenster putzen', { list_id: home, priority: 1 });

// --- lists with things in them ---

task('Präsentation fertig machen', {
  list_id: work,
  due_date: day(1),
  due_time: '10:00',
  priority: 3,
  subtasks: subtasks(['Folien', true], ['Zahlen prüfen', true], ['Probelauf'], ['An Team schicken']),
});
task('Wochenbericht', { list_id: work, due_date: nextWeekday(5), repeat: { unit: 'week', every: 1, weekdays: [5], from: 'due' } });
task('Urlaubsantrag stellen', { list_id: work, due_date: day(-1), priority: 2 });
task('Ablage aufräumen', { list_id: work });
task('Teammeeting vorbereiten', { list_id: work, done_at: hoursAgo(3) });

for (const [title, done] of [['Milch'], ['Brot'], ['Äpfel', true], ['Kaffee'], ['Spülmittel'], ['Haferflocken', true], ['Tomaten'], ['Käse']]) {
  task(title, { list_id: shopping, ...(done ? { done_at: hoursAgo(2) } : {}) });
}

task('Erste Aufgabe', { list_id: long });
task('Zweite Aufgabe mit Datum', { list_id: long, due_date: day(5) });

// Many tasks, to see scrolling and speed: spread over two months, some done
for (let i = 1; i <= 200; i++) {
  const fields = { list_id: many, priority: i % 4 };
  if (i % 3) fields.due_date = day((i % 60) - 10);
  if (i % 5 === 0) fields.done_at = hoursAgo(i);
  task(`Aufgabe ${i}`, fields);
}

// --- in ---

let rejected = 0;
for (let i = 0; i < changes.length; i += 400) {
  const answer = store.tasks.sync(user.id, { since: 0, changes: changes.slice(i, i + 400) });
  for (const r of answer.rejected) console.warn(`  not taken: ${r.kind} ${r.id} (${r.error})`);
  rejected += answer.rejected.length;
}
console.log(`Sample data: ${changes.length - rejected} lists and tasks for ${user.username}`);
store.db.close();
