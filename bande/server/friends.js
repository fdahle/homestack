// What's coming up with friends: birthdays and who is due for getting in touch.
// Dates are 'YYYY-MM-DD' strings in local time.

const DAY_MS = 86_400_000;
const toDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY_MS);
const pad = (n) => String(n).padStart(2, '0');

// The next birthday on or after today: { date, days, age } (age null when the year is unknown).
// Someone born on 29 February celebrates on 28 February in other years.
export function nextBirthday(birthday, today) {
  const [, y, m, d] = /^(\d{4}|-)-(\d{2})-(\d{2})$/.exec(birthday || '') || [];
  if (!m) return null;
  const year = Number(today.slice(0, 4));
  const on = (yy) => {
    const leap = new Date(yy, 1, 29).getMonth() === 1;
    return `${yy}-${m}-${m === '02' && d === '29' && !leap ? '28' : d}`;
  };
  let date = on(year);
  if (date < today) date = on(year + 1);
  const age = y === '-' ? null : Number(date.slice(0, 4)) - Number(y);
  return { date, days: daysBetween(today, date), age };
}

export function upcomingBirthdays(friends, today, withinDays = 30) {
  return friends
    .filter((f) => !f.archived)
    .map((f) => ({ friend: f, ...nextBirthday(f.birthday, today) }))
    .filter((b) => b.date && b.days <= withinDays)
    .sort((a, b) => a.days - b.days);
}

// Friends with a contact interval who haven't been in touch for longer than that:
// { friend, days (since last contact, null = never), overdue (days past the interval) }
export function overdueFriends(friends, today) {
  const out = [];
  for (const f of friends) {
    if (f.archived || !f.contact_weeks) continue;
    const since = f.last_contact ?? f.created_at.slice(0, 10);
    const days = daysBetween(since, today);
    const overdue = days - f.contact_weeks * 7;
    if (overdue >= 0 && !(f.next_plan && f.next_plan >= today)) out.push({ friend: f, days: f.last_contact ? days : null, overdue });
  }
  return out.sort((a, b) => b.overdue - a.overdue);
}

export const addDays = (iso, n) => {
  const d = toDate(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
