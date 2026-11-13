// Finds a date and a time in free German or English text, as people write them in chats:
// "Samstag 19 Uhr", "am 24.11.", "nächsten Freitag um halb 8", "tomorrow at 7pm", "Nov 24th".
// Relative words count from ref, the moment the text was written.

const MONTHS = {
  jan: 1, januar: 1, january: 1, jaen: 1, jaenner: 1,
  feb: 2, februar: 2, february: 2,
  maer: 3, maerz: 3, mar: 3, march: 3,
  apr: 4, april: 4,
  mai: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10,
  nov: 11, november: 11,
  dez: 12, dezember: 12, dec: 12, december: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

// 0 = Sunday, as Date.getDay()
const WEEKDAYS = {
  sonntag: 0, sunday: 0, montag: 1, monday: 1, dienstag: 2, tuesday: 2, mittwoch: 3, wednesday: 3,
  donnerstag: 4, thursday: 4, freitag: 5, friday: 5, samstag: 6, sonnabend: 6, saturday: 6,
};
// Short forms only count before a time or date ("Sa 19 Uhr", "Fr. 24.11."): "so", "do", "mi" are ordinary words too
const WEEKDAY_SHORT = { so: 0, sun: 0, mo: 1, mon: 1, di: 2, tue: 2, mi: 3, wed: 3, do: 4, thu: 4, fr: 5, fri: 5, sa: 6, sat: 6 };
const DAY_PART = '(?:abend|nachmittag|vormittag|mittag|morgen|frueh)?';

const NUMBER_WORDS = { ein: 1, eine: 1, einem: 1, einer: 1, one: 1, a: 1, an: 1, zwei: 2, two: 2, drei: 3, three: 3, vier: 4, four: 4 };

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function validDate(y, m, d) {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

// A date without a year is the next one from ref, unless it was less than two months ago
function withYear(m, d, ref) {
  const today = startOfDay(ref);
  let date = validDate(today.getFullYear(), m, d);
  if (!date && m === 2 && d === 29) {
    for (let y = today.getFullYear() + 1; !date; y++) date = validDate(y, m, d);
  }
  if (date && date < addDays(today, -60)) date = validDate(date.getFullYear() + 1, m, d) ?? date;
  return date;
}

const fullYear = (y) => (y < 100 ? 2000 + y : y);

// The next given weekday after ref (a week later when ref is that day)
function nextWeekday(ref, day, { allowToday = false } = {}) {
  let diff = (day - ref.getDay() + 7) % 7;
  if (diff === 0 && !allowToday) diff = 7;
  return addDays(startOfDay(ref), diff);
}

function findDate(text, ref) {
  let m;
  // 2026-11-24
  if ((m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(text))) {
    const date = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (date) return date;
  }
  // 24.11.2026, 24.11.26, 24.11. (the dot after the month tells it apart from 19.30 Uhr)
  for (const match of text.matchAll(/(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2}(?!\d))?/g)) {
    const [, d, mo, y] = match.map((v) => (v === undefined ? v : Number(v)));
    const date = y ? validDate(fullYear(y), mo, d) : withYear(mo, d, ref);
    if (date) return date;
  }
  // 24/11, 24/11/2026; day first unless that can't be a date
  for (const match of text.matchAll(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/g)) {
    const [, a, b, y] = match.map((v) => (v === undefined ? v : Number(v)));
    for (const [d, mo] of [[a, b], [b, a]]) {
      const date = y ? validDate(fullYear(y), mo, d) : withYear(mo, d, ref);
      if (date) return date;
    }
  }
  // 24. November 2026, 24 nov, 24th of November
  if ((m = new RegExp(`\\b(\\d{1,2})(?:\\.|st|nd|rd|th)?\\s*(?:of\\s+)?(${MONTH_RE})\\.?(?![a-z])(?:\\s+(\\d{4}))?`).exec(text))) {
    const date = m[3] ? validDate(Number(m[3]), MONTHS[m[2]], Number(m[1])) : withYear(MONTHS[m[2]], Number(m[1]), ref);
    if (date) return date;
  }
  // November 24th, 2026
  if ((m = new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)(?:,?\\s+(\\d{4}))?`).exec(text))) {
    const date = m[3] ? validDate(Number(m[3]), MONTHS[m[1]], Number(m[2])) : withYear(MONTHS[m[1]], Number(m[2]), ref);
    if (date) return date;
  }

  const today = startOfDay(ref);
  if (/\b(uebermorgen|day after tomorrow)\b/.test(text)) return addDays(today, 2);
  // "morgen", but not "guten Morgen" or "morgens"
  if (/(?<!guten\s)\bmorgen\b(?!s)|\btomorrow\b/.test(text)) return addDays(today, 1);
  if (/\b(heute|today|tonight|heut)\b/.test(text)) return today;

  // in 3 Tagen, in zwei Wochen, in a week
  if ((m = /\bin\s+(\d{1,2}|ein|eine|einem|einer|one|a|an|zwei|two|drei|three|vier|four)\s+(tag|tagen|day|days|woche|wochen|week|weeks)\b/.exec(text))) {
    const n = NUMBER_WORDS[m[1]] ?? Number(m[1]);
    return addDays(today, /^(woche|week)/.test(m[2]) ? n * 7 : n);
  }

  // (nächsten / übernächsten / this / next) Samstag(abend)
  const weekday = new RegExp(`\\b(?:(uebernaechste[nr]?)\\s+)?(${Object.keys(WEEKDAYS).join('|')})${DAY_PART}\\b`).exec(text);
  if (weekday) return addDays(nextWeekday(ref, WEEKDAYS[weekday[2]]), weekday[1] ? 7 : 0);
  const short = new RegExp(`\\b(${Object.keys(WEEKDAY_SHORT).join('|')})\\.?(?=\\s*,?\\s*(?:\\d|um\\b|at\\b|ab\\b))`).exec(text);
  if (short) return nextWeekday(ref, WEEKDAY_SHORT[short[1]]);

  // (am / nächstes / this / next) Wochenende: the Saturday of it
  if ((m = /\b(naechste[sn]?\s+|next\s+)?(wochenende|weekend)\b/.exec(text))) {
    if (ref.getDay() === 0) return addDays(today, 6); // on a Sunday it's the coming one
    const saturday = nextWeekday(ref, 6, { allowToday: true });
    return m[1] && ref.getDay() === 6 ? addDays(saturday, 7) : saturday;
  }
  return null;
}

// Social plans mean the evening: "um 7" is 19:00, unless it says morning
function evening(h, text) {
  if (/\b(morgens|frueh|vormittags|morning)\b/.test(text)) return h;
  if (/\b(abends?|nachmittags?|evening|tonight|pm)\b/.test(text) || h <= 7) return h < 12 ? h + 12 : h;
  return h;
}

function findTime(text) {
  let m;
  const ok = (h, min = 0) => (h >= 0 && h <= 23 && min >= 0 && min <= 59 ? `${pad(h)}:${pad(min)}` : null);
  // 7pm, 7:30 pm, 7 a.m.
  if ((m = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\b\.?/.exec(text))) {
    let h = Number(m[1]) % 12;
    if (m[3] === 'p') h += 12;
    const time = ok(h, Number(m[2] || 0));
    if (time) return time;
  }
  // 19:30, 19:30 Uhr, 19.30 Uhr
  if ((m = /(?<![\d:.])(\d{1,2}):(\d{2})(?![\d:])/.exec(text)) || (m = /(?<![\d.])(\d{1,2})\.(\d{2})\s*(?:uhr|h)\b/.exec(text))) {
    const time = ok(Number(m[1]), Number(m[2]));
    if (time) return time;
  }
  // 19 Uhr, 19h
  if ((m = /(?<![\d.:])(\d{1,2})(?:\s*uhr|h)\b/.exec(text))) {
    const time = ok(evening(Number(m[1]), text));
    if (time) return time;
  }
  // halb 8 = 7:30, viertel nach 7, viertel vor 8
  if ((m = /\bhalb\s+(\d{1,2})\b/.exec(text))) return ok(evening(Number(m[1]) - 1, text), 30);
  if ((m = /\bviertel\s+nach\s+(\d{1,2})\b/.exec(text))) return ok(evening(Number(m[1]), text), 15);
  if ((m = /\bviertel\s+vor\s+(\d{1,2})\b/.exec(text))) return ok(evening(Number(m[1]) - 1, text), 45);
  // um 7, ab 8, at 7
  if ((m = /\b(?:um|ab|gegen|at|around)\s+(\d{1,2})(?![\d.:/])/.exec(text))) return ok(evening(Number(m[1]), text));
  return null;
}

// Lower case without umlauts, so the patterns can use \b (which only knows ASCII letters)
const normalize = (text) =>
  String(text || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

export function findDateTime(text, ref = new Date()) {
  const lower = normalize(text);
  const date = findDate(lower, ref);
  return { date: date ? iso(date) : null, time: findTime(lower) };
}

// Words that make a message with a date look like a plan, not just small talk
const PLAN_WORDS = /\b(treffen|treff|essen|kochen|grillen|kino|konzert|party|feier|feiern|geburtstag|bier|kaffee|fruehstueck|brunch|abendessen|mittagessen|ausflug|urlaub|reise|wandern|laufen|klettern|bouldern|spieleabend|zocken|besuch|besuchen|vorbeikommen|vorbei|zeit|lust|dabei|wollen wir|sollen wir|lass uns|lasst uns|kommst du|kommt ihr|treffpunkt|dinner|lunch|breakfast|coffee|drinks?|beer|meet|movie|cinema|concert|birthday|trip|visit|hike|free|up for|let's|lets|wanna|join|hang out)\b/;

export function looksLikePlan(text, ref = new Date()) {
  const lower = normalize(text);
  if (!findDate(lower, ref)) return false;
  return PLAN_WORDS.test(lower) || (lower.includes('?') && Boolean(findTime(lower)));
}
