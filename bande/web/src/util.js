import { reactive } from 'vue';
import { lang, t } from './i18n.js';

// --- dates (always 'YYYY-MM-DD' strings in local time) ---

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86_400_000);

// "Sa., 14. Nov." (with the year when it isn't this year)
export function formatDate(iso, { weekday = true, long = false } = {}) {
  if (!iso) return '';
  const date = toDate(iso);
  const opts = { day: 'numeric', month: long ? 'long' : 'short' };
  if (weekday) opts.weekday = 'short';
  if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return new Intl.DateTimeFormat(lang.value, opts).format(date);
}

// '2015' → "2015", '2015-03' → "März 2015", '2015-03-04' → "4. März 2015"
export function formatPartial(value) {
  if (!value) return '';
  const [y, m, d] = value.split('-');
  if (!m) return y;
  const opts = { month: 'long', year: 'numeric' };
  if (d) opts.day = 'numeric';
  return new Intl.DateTimeFormat(lang.value, opts).format(toDate(value));
}

// '1990-11-20' → "20. November 1990", '--11-20' → "20. November"
export function formatBirthday(value) {
  const [, y, m, d] = /^(\d{4}|-)-(\d{2})-(\d{2})$/.exec(value || '') || [];
  if (!m) return '';
  const opts = { day: 'numeric', month: 'long' };
  if (y !== '-') opts.year = 'numeric';
  return new Intl.DateTimeFormat(lang.value, opts).format(new Date(y === '-' ? 2000 : Number(y), Number(m) - 1, Number(d)));
}

// "heute", "gestern", "vor 3 Wochen", "in 2 Tagen"
export function relativeDay(iso, today = isoDate()) {
  if (!iso) return '';
  const days = daysBetween(today, iso);
  const rtf = new Intl.RelativeTimeFormat(lang.value, { numeric: 'auto' });
  const abs = Math.abs(days);
  if (abs < 7) return rtf.format(days, 'day');
  if (abs < 30) return rtf.format(Math.round(days / 7), 'week');
  if (abs < 365) return rtf.format(Math.round(days / 30.4), 'month');
  return rtf.format(Math.round(days / 365), 'year');
}

// "3 Wochen", "5 Monate": a span without "ago"
export function duration(days) {
  const unit = (n, u) => new Intl.NumberFormat(lang.value, { style: 'unit', unit: u, unitDisplay: 'long' }).format(n);
  if (days < 14) return unit(days, 'day');
  if (days < 60) return unit(Math.round(days / 7), 'week');
  if (days < 730) return unit(Math.round(days / 30.4), 'month');
  return unit(Math.round(days / 365), 'year');
}

export const monthLabel = (iso) =>
  new Intl.DateTimeFormat(lang.value, { month: 'long', year: 'numeric' }).format(toDate(iso));

// --- friends & events ---

export const firstName = (f) => f.nickname || f.name.split(' ')[0];
export const friendNames = (friends) => friends.map(firstName).join(', ');

export const KINDS = ['meet', 'call', 'trip', 'party', 'note'];
export const KIND_ICONS = { meet: 'users', call: 'phone', trip: 'map', party: 'sparkle', note: 'note' };

// A calm color per person for avatars without a photo
export function avatarHue(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}

// The first letter of the first name, for avatars without a photo
export const initial = (name) => ([...String(name || '?').trim()][0] || '?').toUpperCase();

// Address and city as one text, without the city twice
export function fullAddress({ address, city }) {
  const lines = [address?.trim()].filter(Boolean);
  if (city && !lines.some((l) => l.toLowerCase().includes(city.toLowerCase()))) lines.push(city);
  return lines.join('\n');
}

// "Musterstraße 1\n20095 Hamburg" → "Hamburg", for the list when no city is filled in
export const cityFromAddress = (address) => /(?:^|\n|,)\s*(?:[A-Z]{1,2}-)?\d{4,5}\s+([^\n,]+)\s*$/.exec(String(address || '').trim())?.[1].trim() || '';

// A Google Maps search (opens the Maps app on phones)
export const mapsLink = (text) =>
  text?.trim() ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text.trim().replace(/\s*\n\s*/g, ', '))}` : null;

// Groups for "good to know", and words that point to one in a label or value
export const FACT_CATEGORIES = ['family', 'work', 'likes', 'food', 'other'];
const CATEGORY_WORDS = [
  ['family', /partner|freundin\b|\bfreund\b|\bfrau\b|\bmann\b|ehemann|ehefrau|verheiratet|verlobt|kind|sohn|tochter|eltern|mutter|vater|mama|papa|bruder|schwester|geschwister|oma\b|opa\b|haustier|hund|katze|husband|wife|girlfriend|boyfriend|married|child|kids|\bson\b|daughter|parents|mother|father|brother|sister|sibling|\bpets?\b|\bdog\b|\bcat\b/],
  ['work', /\bjob|beruf|arbeit|firma|chef|kolleg|studium|studiert|\buni\b|schule|ausbildung|\bwork|company|\bboss|employer|stud(y|ies)|school|degree/],
  ['food', /essen|ernährung|vegetar|vegan|allerg|unverträglich|laktose|gluten|getränk|trinkt|kaffee|\btee\b|\bbier|wein\b|\bfood|diet|drinks?\b|coffee|\btea\b|\bbeer|\bwine/],
  ['likes', /hobby|hobbies|\bmag\b|liebt|lieblings|musik|\bband\b|buch|bücher|film|serie|sport|verein|spiel|\blikes?\b|\bloves?\b|favou?rite|music|book|movie|series|\bteam\b|\bgames?\b/],
];

// The group a fact most likely belongs in: as the label was used before, else from its words
export function guessCategory(label, value, known = []) {
  const l = String(label || '').trim().toLowerCase();
  const before = l && known.find((k) => k.label.toLowerCase() === l)?.category;
  if (before) return before;
  for (const text of [l, String(value || '').toLowerCase()]) {
    const hit = text && CATEGORY_WORDS.find(([, re]) => re.test(text));
    if (hit) return hit[0];
  }
  return 'other';
}

// A square, small JPEG from a photo, cut from the middle
export async function squarePhoto(file, size = 512) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('image');
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.min(size, side);
  canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('image'))), 'image/jpeg', 0.85));
}

// "wa.me" wants the number with country code and digits only; German numbers without it get +49
export function whatsappLink(phone) {
  let digits = String(phone || '').replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `49${digits.slice(1)}`;
  return `https://wa.me/${digits}`;
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
  if (err?.code && t(`errors.${err.code}`) !== `errors.${err.code}`) return t(`errors.${err.code}`);
  return t('errors.generic');
}
