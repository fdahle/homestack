// The calendar feed: plans, the past two years and birthdays as an iCalendar file that a phone
// calendar subscribes to. Times are "floating", so they show as written in any time zone.
//
// The feed's URL is a secret that sits at Google or Apple and in logs, so the feed carries as
// little as it can: no notes (for an event from a pasted WhatsApp chat that is the whole chat)
// and no birth years, only titles, places, dates and who is coming.

// Every line break (\r\n, \n or a lone \r) becomes \n and other control characters are dropped,
// so no text can end a line early and start a property of its own
export const escape = (s) => String(s ?? '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
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
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10).replaceAll('-', '');
};
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

const TEXT = {
  de: { birthday: 'Geburtstag', with: 'mit' },
  en: { birthday: 'birthday', with: 'with' },
};

export function buildCalendar({ events, friends, lang = 'de', origin = '' }) {
  const text = TEXT[lang] || TEXT.de;
  const now = stamp();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//homestack//Stammtisch//DE',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Stammtisch',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];

  for (const e of events) {
    if (!e.date) continue;
    const names = e.friends.map((f) => f.nickname || f.name.split(' ')[0]).join(', ');
    lines.push('BEGIN:VEVENT', `UID:event-${e.id}@stammtisch`, `DTSTAMP:${now}`);
    if (e.time) {
      const start = `${day(e.date)}T${e.time.replace(':', '')}00`;
      lines.push(`DTSTART:${start}`);
      if (e.end_date && e.end_date > e.date) lines.push(`DTEND:${day(e.end_date)}T235900`);
      else lines.push('DURATION:PT2H');
    } else {
      lines.push(`DTSTART;VALUE=DATE:${day(e.date)}`, `DTEND;VALUE=DATE:${nextDay(e.end_date && e.end_date > e.date ? e.end_date : e.date)}`);
    }
    lines.push(`SUMMARY:${escape(names ? `${e.title} (${names})` : e.title)}`);
    if (e.place) lines.push(`LOCATION:${escape(e.place)}`);
    // Only who is coming; the notes stay in the app
    if (names) lines.push(`DESCRIPTION:${escape(`${text.with} ${e.friends.map((f) => f.name).join(', ')}`)}`);
    if (origin) lines.push(`URL:${origin}/event/${e.id}`);
    lines.push(`STATUS:${e.status === 'planned' ? 'TENTATIVE' : 'CONFIRMED'}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }

  for (const f of friends) {
    if (!f.birthday || f.archived) continue;
    const [, md] = /^(?:\d{4}|-)-(\d{2}-\d{2})$/.exec(f.birthday) || [];
    if (!md) continue;
    // A yearly event from 2000, not from the birth year, which would give the age away.
    // 29 February shows in leap years only.
    const start = `2000-${md}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:birthday-${f.id}@stammtisch`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${day(start)}`,
      `DTEND;VALUE=DATE:${nextDay(start)}`,
      'RRULE:FREQ=YEARLY',
      `SUMMARY:${escape(`🎂 ${f.name}`)}`,
      `DESCRIPTION:${escape(text.birthday)}`,
      ...(origin ? [`URL:${origin}/friend/${f.id}`] : []),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
