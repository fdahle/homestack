// How dates, times and repeats read in the interface
import { lang, t, weekdayNames } from '../i18n.js';
import { daysBetween, toDate } from './dates.js';
import { presetOf } from './repeat.js';

// "Heute", "Morgen", "Gestern", "Freitag" (within a week), "24. Dez." (this year), "24. Dez. 2027"
export function dayLabel(iso, today) {
  if (!iso) return '';
  const diff = daysBetween(today, iso);
  if (diff === 0) return t('when.today');
  if (diff === 1) return t('when.tomorrow');
  if (diff === -1) return t('when.yesterday');
  const d = toDate(iso);
  if (diff > 1 && diff < 7) return new Intl.DateTimeFormat(lang.value, { weekday: 'long' }).format(d);
  const opts = { day: 'numeric', month: 'short' };
  if (iso.slice(0, 4) !== today.slice(0, 4)) opts.year = 'numeric';
  return new Intl.DateTimeFormat(lang.value, opts).format(d);
}

// A whole heading: "Morgen · Sonntag, 22. November"
export function dayHeading(iso, today) {
  const long = new Intl.DateTimeFormat(lang.value, { weekday: 'long', day: 'numeric', month: 'long' }).format(toDate(iso));
  const diff = daysBetween(today, iso);
  if (diff === 0) return `${t('when.today')} · ${long}`;
  if (diff === 1) return `${t('when.tomorrow')} · ${long}`;
  return long;
}

export function repeatLabel(rule) {
  if (!rule) return '';
  const preset = presetOf(rule);
  if (preset !== 'custom') return t(`repeat.${preset}`);
  if (rule.unit === 'week' && rule.weekdays?.length) {
    const names = weekdayNames();
    // "Wöchentlich (Mo, Do)", "Alle 2 Wochen (Mo)"
    const days = rule.weekdays.map((d) => names[d - 1]).join(', ');
    return `${rule.every > 1 ? t('repeat.everyN.week', { n: rule.every }) : t('repeat.weekly')} (${days})`;
  }
  return t(`repeat.everyN.${rule.unit}`, { n: rule.every });
}

export function timeLabel(time) {
  if (!time) return '';
  if (lang.value === 'en') {
    const [h, m] = time.split(':').map(Number);
    return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
  }
  return time;
}

export const LIST_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'gray'];
