import { computed, reactive } from 'vue';
import { api } from './api.js';

// Background work across the collection (covers from Comic Vine, GCD details),
// shown by ActivityPanel. Polled often while covers come in, rarely otherwise.

function readMinimized() {
  try {
    return localStorage.getItem('stapel.activity.minimized') === '1';
  } catch {
    return false;
  }
}

export const activity = reactive({ data: null, open: false, minimized: readMinimized() });

export function setMinimized(value) {
  activity.minimized = value;
  activity.open = false;
  try {
    localStorage.setItem('stapel.activity.minimized', value ? '1' : '0');
  } catch {
    // only a convenience
  }
}

const needsPick = (s) => s.cv && (s.cv.state === 'unmatched' || s.cv.state === null);
const cvBusy = (s) => s.cv && (s.cv.waiting > 0 || s.cv.state === null || (s.cv.volumeName && !s.cv.synced));

// Shown while covers are on their way or a series needs its Comic Vine series picked.
// GCD details alone take days, so they don't bring it up.
export const activityVisible = computed(() => Boolean(activity.data?.series.some((s) => cvBusy(s) || needsPick(s))));
export const seriesToPick = computed(() => (activity.data?.series || []).filter((s) => s.cv?.state === 'unmatched'));

let timer = null;
let running = false;

export async function refreshActivity() {
  clearTimeout(timer);
  if (!running) return;
  if (!document.hidden) activity.data = await api('/activity').catch(() => activity.data);
  const fast = activity.data?.series.some(cvBusy);
  timer = setTimeout(refreshActivity, fast ? 8000 : 60_000);
}

function onVisible() {
  if (!document.hidden) refreshActivity();
}

export function startActivity() {
  if (running) return;
  running = true;
  document.addEventListener('visibilitychange', onVisible);
  refreshActivity();
}

export function stopActivity() {
  running = false;
  clearTimeout(timer);
  document.removeEventListener('visibilitychange', onVisible);
  activity.data = null;
}
