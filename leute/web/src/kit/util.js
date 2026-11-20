// Copied from design/web/util.js by design/sync.mjs. Change it there, not here.
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { hasText, lang, t } from './i18n.js';

export { hasText };

// --- dates ('YYYY-MM-DD', or 'YYYY' / 'YYYY-MM' when that's all you know) ---

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

// '2015' → "2015", '2015-03' → "März 2015", '2015-03-04' → "4. März 2015"
export function formatPartial(value) {
  if (!value) return '';
  const [y, m, d] = value.split('-');
  if (!m) return y;
  const opts = { month: 'long', year: 'numeric' };
  if (d) opts.day = 'numeric';
  return new Intl.DateTimeFormat(lang.value, opts).format(toDate(value));
}

// "vor 3 Wochen", "in 2 Tagen" (an ISO timestamp or date)
export function relativeDay(iso, today = isoDate()) {
  if (!iso) return '';
  const days = Math.round((toDate(iso.slice(0, 10)) - toDate(today)) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat(lang.value, { numeric: 'auto' });
  const abs = Math.abs(days);
  if (abs < 7) return rtf.format(days, 'day');
  if (abs < 30) return rtf.format(Math.round(days / 7), 'week');
  if (abs < 365) return rtf.format(Math.round(days / 30.4), 'month');
  return rtf.format(Math.round(days / 365), 'year');
}

export const yearOf = (iso) => (iso ? Number(iso.slice(0, 4)) : null);

// --- numbers ---

export const formatNumber = (n, digits = 0) => new Intl.NumberFormat(lang.value, { maximumFractionDigits: digits }).format(n);
// 1–10 → "4,5"
export const starValue = (rating) => formatNumber(rating / 2, 1);

// --- lists ---

// Counts per value, largest first: [['PC', 12], ['Switch', 8]]. key may return a list.
export function countBy(items, key) {
  const counts = new Map();
  for (const item of items) {
    const values = [key(item)].flat().filter((v) => v != null && v !== '');
    for (const v of new Set(values)) counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

export const compareText = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), lang.value, { sensitivity: 'base', numeric: true });

// --- pictures ---

// A photo → a JPEG cut from its middle (default 600×900, 2:3), ready to upload as a cover
export async function coverPhoto(file, { width = 600, height = 900 } = {}) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, (width - bitmap.width * scale) / 2, (height - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', 0.85));
}

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
  if (err?.code && hasText(`errors.${err.code}`)) return t(`errors.${err.code}`);
  return t('errors.generic');
}

// --- screen and keyboard ---

// The width from which the sidebar and the list-beside-entry layout take over (base.css)
export const WIDE_QUERY = '(min-width: 1024px)';
const wideMedia = typeof window !== 'undefined' ? window.matchMedia(WIDE_QUERY) : null;
export const wide = ref(!!wideMedia?.matches);
wideMedia?.addEventListener('change', (e) => (wide.value = e.matches));

// Runs handler on a key press while the component is shown. Ignores presses while typing,
// except Escape. key: '/', 'Escape', 'n', …
export function useShortcut(key, handler) {
  const listener = (event) => {
    if (event.key !== key || event.ctrlKey || event.metaKey || event.altKey) return;
    const el = event.target;
    const typing = el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    if (typing && key !== 'Escape') return;
    if (handler(event) !== false) event.preventDefault();
  };
  onMounted(() => window.addEventListener('keydown', listener));
  onBeforeUnmount(() => window.removeEventListener('keydown', listener));
}

// Router scrollBehavior: back/forward restore, new pages start at the top, and
// opening or switching an entry beside the list (SplitView, on a wide screen) keeps the list where it is.
export function scrollBehavior(to, from, saved) {
  const sameSplit = to.matched[0] && to.matched[0] === from.matched[0] && (to.matched.length > 1 || from.matched.length > 1);
  if (sameSplit && wide.value) return false;
  return saved || { top: 0 };
}
