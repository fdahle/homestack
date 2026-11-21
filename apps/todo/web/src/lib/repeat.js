// Repeating tasks. A rule: { unit: 'day' | 'week' | 'month' | 'year', every: n,
// weekdays?: [1..7] (weeks only, Monday = 1), day?: 1..31 (months and years: the day of the
// month it belongs on), from: 'due' | 'done' }.
//
// from 'due': the next date counts from the due date ("every Monday", rent on the 1st).
// from 'done': from the day you tick it off ("water the plants 3 days after the last time").
// A task that was overdue for a while doesn't come back with dates in the past: it skips to
// the first one after today.

import { addDays, addMonths, daysBetween, weekday, weekStart } from './dates.js';

export const PRESETS = {
  daily: { unit: 'day', every: 1 },
  weekdays: { unit: 'week', every: 1, weekdays: [1, 2, 3, 4, 5] },
  weekly: { unit: 'week', every: 1 },
  biweekly: { unit: 'week', every: 2 },
  monthly: { unit: 'month', every: 1 },
  yearly: { unit: 'year', every: 1 },
};

// Which preset a rule is, or 'custom'
export function presetOf(rule) {
  if (!rule) return 'none';
  for (const [name, p] of Object.entries(PRESETS)) {
    if (p.unit === rule.unit && p.every === rule.every && String(p.weekdays || '') === String(rule.weekdays || '')) return name;
  }
  return 'custom';
}

// The rule as it is stored: the day of the month taken from the due date
export function anchored(rule, due) {
  if (!rule) return null;
  const out = { unit: rule.unit, every: Math.max(1, Math.round(rule.every || 1)), from: rule.from === 'done' ? 'done' : 'due' };
  if (rule.unit === 'week' && rule.weekdays?.length) out.weekdays = [...new Set(rule.weekdays)].sort();
  if ((rule.unit === 'month' || rule.unit === 'year') && due) out.day = Number(due.slice(8, 10));
  return out;
}

function step(rule, from) {
  const every = rule.every || 1;
  switch (rule.unit) {
    case 'day':
      return addDays(from, every);
    case 'week': {
      if (!rule.weekdays?.length) return addDays(from, 7 * every);
      // The next chosen weekday, in this week or in every n-th week after it
      const start = weekStart(from);
      for (let i = 1; i <= 7 * every + 7; i++) {
        const d = addDays(from, i);
        const weeks = daysBetween(start, weekStart(d)) / 7;
        if (weeks % every === 0 && rule.weekdays.includes(weekday(d))) return d;
      }
      return addDays(from, 7 * every);
    }
    case 'month':
      return addMonths(from, every, rule.day);
    case 'year':
      return addMonths(from, 12 * every, rule.day);
    default:
      return addDays(from, 1);
  }
}

// The date a repeating task moves to when it's ticked off on `today`
export function nextDue(rule, due, today) {
  let next = step(rule, rule.from === 'done' || !due ? today : due);
  for (let i = 0; next <= today && i < 1000; i++) next = step(rule, next);
  return next;
}

// The first date for a rule that was just set on a task without a date
export function firstDue(rule, today) {
  if (rule.unit === 'week' && rule.weekdays?.length && !rule.weekdays.includes(weekday(today))) return nextDue({ ...rule, every: 1 }, today, today);
  return today;
}
