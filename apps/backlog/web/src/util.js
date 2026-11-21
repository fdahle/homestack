import { reactive } from 'vue';
import { lang, t } from './i18n.js';

export * from './kit/util.js';

// "12 Mar 2024"
export const fmtDate = (iso) => (iso ? new Intl.DateTimeFormat(lang.value, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '');

// "vor 3 Std."
export function timeAgo(iso) {
  if (!iso) return t('ago.never');
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return t('ago.now');
  if (mins < 60) return t('ago.min', { n: mins });
  if (mins < 48 * 60) return t('ago.h', { n: Math.round(mins / 60) });
  return t('ago.d', { n: Math.round(mins / 1440) });
}

export const percent = (read, total) => (total ? Math.round((read / total) * 100) : 0);

// --- a sheet of choices from the bottom (ActionSheet.vue, in App.vue) ---

export const sheet = reactive({ open: false, title: '', actions: [] });

// actions: [{ label, run, primary }]
export function openSheet(title, actions) {
  sheet.title = title;
  sheet.actions = actions;
  sheet.open = true;
}
