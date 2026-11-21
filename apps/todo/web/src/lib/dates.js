// Dates as 'YYYY-MM-DD' strings in local time (what a date picker gives), and a little
// arithmetic on them. Noon avoids surprises around daylight saving changes.

const pad = (n) => String(n).padStart(2, '0');

export const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function toDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export const addDays = (iso, n) => {
  const d = toDate(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};

export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86_400_000);

// 1 = Monday … 7 = Sunday
export const weekday = (iso) => toDate(iso).getDay() || 7;

export const daysInMonth = (year, month) => new Date(year, month, 0).getDate(); // month 1–12

// n months later, on `day` (or the month's last day when it's shorter)
export function addMonths(iso, n, day) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${pad(month)}-${pad(Math.min(day ?? d, daysInMonth(year, month)))}`;
}

// The Monday of the week
export const weekStart = (iso) => addDays(iso, 1 - weekday(iso));

// The next date (after `from`, or `from` itself with `orToday`) that is this weekday
export function nextWeekday(from, wd, orToday = false) {
  const diff = (wd - weekday(from) + 7) % 7;
  return addDays(from, diff === 0 && !orToday ? 7 : diff);
}
