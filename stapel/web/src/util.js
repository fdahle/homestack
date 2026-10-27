import { reactive } from 'vue';
import { lang, t } from './i18n.js';

// Covers stored on the server win; otherwise the browser loads GCD's scan directly.
export const coverSrc = (issue) => (issue?.cover_file ? `/covers/${issue.cover_file}` : issue?.cover_url || null);

// "1, 2, 3, 5, 7, 8, 9" → "1–3, 5, 7–9" (non-numeric numbers are listed as they are)
export function compressNumbers(numbers) {
  const parts = [];
  let start = null;
  let prev = null;
  const flush = () => {
    if (start === null) return;
    parts.push(start === prev ? String(start) : prev === start + 1 ? `${start}, ${prev}` : `${start}–${prev}`);
    start = prev = null;
  };
  for (const n of numbers) {
    const v = /^\d+$/.test(n) ? Number(n) : null;
    if (v !== null && prev !== null && v === prev + 1) {
      prev = v;
      continue;
    }
    flush();
    if (v === null) parts.push(n || '–');
    else start = prev = v;
  }
  flush();
  return parts.join(', ');
}

// "1-5, 8, 10a" → Set of number strings
export function parseNumberList(text) {
  const out = new Set();
  for (const part of String(text).split(/[,;\s]+/).filter(Boolean)) {
    const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(part);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])].sort((x, y) => x - y);
      for (let n = a; n <= b && out.size < 10000; n++) out.add(String(n));
    } else out.add(part);
  }
  return out;
}

export const issueLabel = (issue) => (issue.number ? `#${issue.number}` : t('oneShot'));

export function formatKeyDate(keyDate) {
  if (!keyDate) return '';
  const [y, m] = keyDate.split('-');
  if (!m || m === '00') return y;
  return new Intl.DateTimeFormat(lang.value, { month: 'long', year: 'numeric' }).format(new Date(Number(y), Number(m) - 1, 1));
}

export const yearRange = (s) => (s.year_began ? `${s.year_began}${s.year_ended && s.year_ended !== s.year_began ? `–${s.year_ended}` : ''}` : '');

const LANGUAGE_NAMES = { de: 'DE', en: 'EN', fr: 'FR', nl: 'NL', it: 'IT', es: 'ES', sv: 'SV', da: 'DA', no: 'NO', fi: 'FI', pl: 'PL', pt: 'PT' };
export const languageTag = (code) => (code ? LANGUAGE_NAMES[code] || code.toUpperCase() : '');

// --- toasts ---

export const toast = reactive({ text: '', action: null, timer: null });

export function showToast(text, action = null) {
  clearTimeout(toast.timer);
  toast.text = text;
  toast.action = action;
  toast.timer = setTimeout(() => {
    toast.text = '';
    toast.action = null;
  }, action ? 5000 : 2500);
}

export function errorText(err) {
  if (err?.code === 'gcd_busy') {
    const at = err.data?.retryAt ? new Date(err.data.retryAt) : null;
    return at ? t('errors.gcdBusyUntil', { time: at.toLocaleTimeString(lang.value, { hour: '2-digit', minute: '2-digit' }) }) : t('errors.gcdBusy');
  }
  if (err?.code && t(`errors.${err.code}`) !== `errors.${err.code}`) return t(`errors.${err.code}`);
  return t('errors.generic');
}
