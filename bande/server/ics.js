// The calendar feed: plans, the past two years and birthdays as an iCalendar file that a phone
// calendar subscribes to. Times are "floating", so they show as written in any time zone.

const escape = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

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
    'PRODID:-//homestack//Bande//DE',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Bande',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];

  for (const e of events) {
    if (!e.date) continue;
    const names = e.friends.map((f) => f.nickname || f.name.split(' ')[0]).join(', ');
    lines.push('BEGIN:VEVENT', `UID:event-${e.id}@bande`, `DTSTAMP:${now}`);
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
    const description = [names && `${text.with} ${e.friends.map((f) => f.name).join(', ')}`, e.notes].filter(Boolean).join('\n\n');
    if (description) lines.push(`DESCRIPTION:${escape(description)}`);
    if (origin) lines.push(`URL:${origin}/event/${e.id}`);
    lines.push(`STATUS:${e.status === 'planned' ? 'TENTATIVE' : 'CONFIRMED'}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }

  for (const f of friends) {
    if (!f.birthday || f.archived) continue;
    const [, y, md] = /^(\d{4}|-)-(\d{2}-\d{2})$/.exec(f.birthday) || [];
    if (!md) continue;
    // A yearly event from the birth year (or 2000 when it's unknown). 29 February shows in leap years only.
    const start = `${y === '-' ? '2000' : y}-${md}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:birthday-${f.id}@bande`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${day(start)}`,
      `DTEND;VALUE=DATE:${nextDay(start)}`,
      'RRULE:FREQ=YEARLY',
      `SUMMARY:${escape(`🎂 ${f.name}`)}`,
      `DESCRIPTION:${escape(y === '-' ? text.birthday : `${text.birthday} (${y})`)}`,
      ...(origin ? [`URL:${origin}/friend/${f.id}`] : []),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
