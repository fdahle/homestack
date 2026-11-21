import { reactive } from 'vue';
import { lang, t } from './i18n.js';

// Only covers stored on the server are shown. GCD's scans can't be used: GCD doesn't
// allow servers to download them, and its image server sends
// Cross-Origin-Resource-Policy, so browsers refuse to show them on other sites.
export const coverSrc = (issue) => (issue?.cover_file ? `/covers/${issue.cover_file}` : null);

// Whether an issue's cover is on its way from Comic Vine
export const coverWaiting = (issue) => Boolean(issue?.cv_cover_url && !issue.cover_file);

// Whether an issue's details are still on the waiting list for GCD
export const detailsWaiting = (issue) => Boolean(issue?.gcd_id && !issue.details_at && !issue.details_failed);

// A time from now as "in 25 Min.", "um 21:40" or "Mo., 08:00"
export function fmtWhen(iso) {
  if (!iso) return '';
  const at = new Date(iso);
  const minutes = Math.round((at - Date.now()) / 60_000);
  if (minutes <= 1) return t('time.now');
  if (minutes < 60) return t('time.inMinutes', { n: minutes });
  if (minutes < 24 * 60 && at.getDate() === new Date().getDate()) {
    return t('time.at', { time: at.toLocaleTimeString(lang.value, { hour: '2-digit', minute: '2-digit' }) });
  }
  const days = Math.round(minutes / (24 * 60));
  if (days >= 2) return t('time.inDays', { n: days });
  return at.toLocaleString(lang.value, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

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
