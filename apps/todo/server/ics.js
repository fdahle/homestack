// The calendar feed: your open tasks with a due date as an iCalendar file that a phone
// calendar subscribes to, next to Stammtisch's plans and birthdays. A task with a time is a
// 30-minute appointment, one without a whole-day entry. Repeating tasks show their next
// date. Times are "floating", so they show as written in any time zone.

// Every kind of line break becomes \n (a bare one would end the line early), other control
// characters go: they have no place in a calendar entry and some calendar apps choke on them
const escape = (s) =>
  String(s ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');

// Lines may be at most 75 bytes; longer ones continue on the next line after a space
function fold(line) {
  const bytes = Buffer.from(line);
  if (bytes.length <= 75) return line;
  const parts = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (start ? 74 : 75), bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--; // don't split a UTF-8 character
    parts.push(bytes.subarray(start, end).toString());
    start = end;
  }
  return parts.join('\r\n ');
}

const day = (date) => date.replaceAll('-', '');
const nextDay = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10).replaceAll('-', '');
};
const plus30 = (date, time) => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, min + 30)).toISOString().slice(0, 16).replace(/[-:]/g, '');
};
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
const PRIORITY = { 3: 1, 2: 5, 1: 9 }; // iCalendar: 1 highest, 9 lowest

export function buildCalendar({ tasks, lists = new Map(), origin = '' }) {
  const now = stamp();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//homestack//To-do//DE',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:To-do',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const t of tasks) {
    if (!t.due_date) continue;
    lines.push('BEGIN:VEVENT', `UID:task-${t.id}@todo`, `DTSTAMP:${now}`);
    if (t.due_time) lines.push(`DTSTART:${day(t.due_date)}T${t.due_time.replace(':', '')}00`, `DTEND:${plus30(t.due_date, t.due_time)}00`);
    else lines.push(`DTSTART;VALUE=DATE:${day(t.due_date)}`, `DTEND;VALUE=DATE:${nextDay(t.due_date)}`);
    lines.push(`SUMMARY:${escape(t.title || '…')}`);
    const open = t.subtasks.filter((s) => !s.done).map((s) => `☐ ${s.title}`);
    const description = [lists.get(t.list_id), t.note, open.join('\n')].filter(Boolean).join('\n\n');
    if (description) lines.push(`DESCRIPTION:${escape(description)}`);
    if (PRIORITY[t.priority]) lines.push(`PRIORITY:${PRIORITY[t.priority]}`);
    if (origin) lines.push(`URL:${origin}/task/${t.id}`);
    lines.push('TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
