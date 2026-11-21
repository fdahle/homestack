// Quick add: one line of text becomes a task. Words for a date, a time, a priority, a list or
// a repeat are picked out of it and shown as chips (tap one to keep the words as text).
// German and English both work, whatever the interface language:
//
//   "Milch kaufen morgen"         → due tomorrow
//   "Zahnarzt Fr 14:30 !!"        → Friday 14:30, medium priority (! low, !! medium, !!! high)
//   "Müll rausbringen jeden Montag #Haushalt" → repeats weekly on Monday, in the list Haushalt
//   "Report 24.12. um 9"          → 24 December 09:00
//
// Everything else is the title.

import { addDays, addMonths, nextWeekday, weekday } from './dates.js';

const L = '\\p{L}\\p{N}';
const B = `(?<![${L}])`; // a word starts here
const E = `(?![${L}])`; // a word ends here

const DAYS = [
  ['montag', 'monday', 'mo'],
  ['dienstag', 'tuesday', 'di', 'tue'],
  ['mittwoch', 'wednesday', 'mi', 'wed'],
  ['donnerstag', 'thursday', 'do', 'thu'],
  ['freitag', 'friday', 'fr', 'fri'],
  ['samstag', 'saturday', 'sa', 'sat'],
  ['sonntag', 'sunday', 'so', 'sun'],
];
// Short forms only with a dot or a time after them ("Fr 14:30", "Mo."): "so" and "do" are words too
const FULL_DAY = DAYS.map((d) => d.slice(0, 2).join('|')).join('|');
const dayIndex = (word) => DAYS.findIndex((names) => names.includes(word.toLowerCase().replace('.', ''))) + 1;

const UNITS = {
  tag: 'day', tage: 'day', tagen: 'day', day: 'day', days: 'day',
  woche: 'week', wochen: 'week', week: 'week', weeks: 'week',
  monat: 'month', monate: 'month', monaten: 'month', month: 'month', months: 'month',
  jahr: 'year', jahre: 'year', jahren: 'year', year: 'year', years: 'year',
};
const UNIT_WORDS = Object.keys(UNITS).sort((a, b) => b.length - a.length).join('|');

const re = (source) => new RegExp(source, 'iu');

// Each rule: kind, pattern, and what it means. The first match per kind counts.
const RULES = [
  // --- repeats (before dates, so "jeden Montag" isn't just "Montag") ---
  { kind: 'repeat', re: re(`${B}(?:täglich|jeden tag|daily|every day)${E}`), value: () => ({ repeat: { unit: 'day', every: 1 } }) },
  { kind: 'repeat', re: re(`${B}(?:werktags|wochentags|jeden werktag|weekdays|every weekday)${E}`), value: () => ({ repeat: { unit: 'week', every: 1, weekdays: [1, 2, 3, 4, 5] } }) },
  { kind: 'repeat', re: re(`${B}(?:wöchentlich|jede woche|weekly|every week)${E}`), value: () => ({ repeat: { unit: 'week', every: 1 } }) },
  { kind: 'repeat', re: re(`${B}(?:monatlich|jeden monat|monthly|every month)${E}`), value: () => ({ repeat: { unit: 'month', every: 1 } }) },
  { kind: 'repeat', re: re(`${B}(?:jährlich|jedes jahr|yearly|every year)${E}`), value: () => ({ repeat: { unit: 'year', every: 1 } }) },
  {
    kind: 'repeat',
    re: re(`${B}(?:alle|every) (\\d{1,3}) (${UNIT_WORDS})${E}`),
    value: (m) => ({ repeat: { unit: UNITS[m[2].toLowerCase()], every: Number(m[1]) } }),
  },
  {
    kind: 'repeat',
    re: re(`${B}(?:jeden|every) (${FULL_DAY})${E}`),
    value: (m, ctx) => {
      const wd = dayIndex(m[1]);
      return { repeat: { unit: 'week', every: 1, weekdays: [wd] }, firstDate: nextWeekday(ctx.today, wd, true) };
    },
  },

  // --- dates ---
  { kind: 'date', re: re(`${B}(?:übermorgen|day after tomorrow)${E}`), value: (m, ctx) => ({ due_date: addDays(ctx.today, 2) }) },
  { kind: 'date', re: re(`${B}(?:heute abend|heute|today|tonight)${E}`), value: (m, ctx) => ({ due_date: ctx.today }) },
  { kind: 'date', re: re(`${B}(?:morgen|tomorrow)${E}`), value: (m, ctx) => ({ due_date: addDays(ctx.today, 1) }) },
  { kind: 'date', re: re(`${B}(?:nächste woche|naechste woche|next week)${E}`), value: (m, ctx) => ({ due_date: nextWeekday(ctx.today, 1) }) },
  { kind: 'date', re: re(`${B}(?:am |this |the )?(?:wochenende|weekend)${E}`), value: (m, ctx) => ({ due_date: nextWeekday(ctx.today, 6, true) }) },
  {
    kind: 'date',
    re: re(`${B}in (\\d{1,3}) (${UNIT_WORDS})${E}`),
    value: (m, ctx) => {
      const n = Number(m[1]);
      const unit = UNITS[m[2].toLowerCase()];
      if (unit === 'day') return { due_date: addDays(ctx.today, n) };
      if (unit === 'week') return { due_date: addDays(ctx.today, 7 * n) };
      if (unit === 'month') return { due_date: addMonths(ctx.today, n) };
      return { due_date: addMonths(ctx.today, 12 * n) };
    },
  },
  {
    // 24.12. / 24.12 / 24.12.2026 / 24.12.26
    kind: 'date',
    re: re(`${B}(?:am |on )?(\\d{1,2})\\.(\\d{1,2})\\.(?:(\\d{4}|\\d{2})${E})?`),
    value: (m, ctx) => {
      const d = Number(m[1]);
      const mo = Number(m[2]);
      if (!d || d > 31 || !mo || mo > 12) return null;
      let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : Number(ctx.today.slice(0, 4));
      const iso = (yy) => `${yy}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (!m[3] && iso(y) < ctx.today) y++;
      const date = iso(y);
      return Number.isNaN(Date.parse(date)) || new Date(date).getUTCDate() !== d ? null : { due_date: date };
    },
  },
  { kind: 'date', re: re(`${B}(\\d{4}-\\d{2}-\\d{2})${E}`), value: (m) => (Number.isNaN(Date.parse(m[1])) ? null : { due_date: m[1] }) },
  {
    // Weekdays: "Freitag", "am Freitag", "next friday", or short "Fr" with a dot or a time after it
    kind: 'date',
    re: re(`${B}(?:am |on |next |nächsten |kommenden )?(?:(${FULL_DAY})${E}|(mo|di|mi|do|fr|sa|so|mon|tue|wed|thu|fri|sat|sun)(?:\\.|(?= \\d{1,2}(?::\\d{2}| ?uhr))))`),
    value: (m, ctx) => ({ due_date: nextWeekday(ctx.today, dayIndex(m[1] || m[2]), true) }),
  },

  // --- times ---
  {
    kind: 'time',
    re: re(`${B}(?:um |at |@ ?)?(\\d{1,2}):(\\d{2})(?: ?uhr)?${E}`),
    value: (m) => time(m[1], m[2]),
  },
  {
    kind: 'time',
    re: re(`${B}(?:um |at |@ ?)?(\\d{1,2}) ?(am|pm)${E}`),
    value: (m) => {
      let h = Number(m[1]) % 12;
      if (m[2].toLowerCase() === 'pm') h += 12;
      return time(h, 0);
    },
  },
  { kind: 'time', re: re(`${B}(?:um )?(\\d{1,2}) ?uhr${E}`), value: (m) => time(m[1], 0) },
  { kind: 'time', re: re(`${B}(?:um|at) (\\d{1,2})${E}`), value: (m) => time(m[1], 0) },

  // --- priority: ! low, !! medium, !!! high (standing alone) ---
  { kind: 'priority', re: re('(?<!\\S)(!{1,3})(?!\\S)'), value: (m) => ({ priority: m[1].length }) },

  // --- list: #name, matched against your lists ---
  {
    kind: 'list',
    re: re(`(?<!\\S)#([${L}_-]+)`),
    value: (m, ctx) => {
      const want = m[1].toLowerCase();
      const key = (l) => l.name.toLowerCase().replace(/\s+/g, '');
      const list = ctx.lists.find((l) => key(l) === want) || ctx.lists.filter((l) => key(l).startsWith(want)).sort((a, b) => a.name.length - b.name.length)[0];
      return list ? { list_id: list.id, listName: list.name } : null;
    },
  },
];

function time(h, min) {
  const hours = Number(h);
  const minutes = Number(min);
  if (hours > 23 || minutes > 59) return null;
  return { due_time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}` };
}

// text → { title, fields: { due_date?, due_time?, priority?, list_id?, repeat? }, chips: [{ kind, text, ...value }] }
// skip: kinds to leave as text (chips the person tapped away)
export function parseQuick(text, { today, lists = [], skip = [] } = {}) {
  const ctx = { today, lists };
  const taken = []; // [start, end] of the words used
  const chips = [];
  const fields = {};
  const overlaps = (s, e) => taken.some(([a, b]) => s < b && e > a);

  for (const rule of RULES) {
    if (skip.includes(rule.kind) || chips.some((c) => c.kind === rule.kind)) continue;
    const m = rule.re.exec(text);
    if (!m || overlaps(m.index, m.index + m[0].length)) continue;
    const value = rule.value(m, ctx);
    if (!value) continue;
    taken.push([m.index, m.index + m[0].length]);
    chips.push({ kind: rule.kind, text: m[0].trim(), ...value });
    const { firstDate, listName, ...rest } = value;
    Object.assign(fields, rest);
    if (firstDate && !fields.due_date) fields.due_date = firstDate;
  }

  // A repeat on a weekday without a date: its next one. A time without a date: today.
  if (fields.repeat?.weekdays && !fields.due_date) fields.due_date = nextWeekday(today, fields.repeat.weekdays.find((d) => d >= weekday(today)) ?? fields.repeat.weekdays[0], true);
  if (fields.repeat && !fields.due_date) fields.due_date = today;
  if (fields.due_time && !fields.due_date) fields.due_date = today;

  let title = '';
  let pos = 0;
  for (const [s, e] of taken.sort((a, b) => a[0] - b[0])) {
    title += `${text.slice(pos, s)} `;
    pos = e;
  }
  title += text.slice(pos);
  title = title.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
  return { title, fields, chips };
}
