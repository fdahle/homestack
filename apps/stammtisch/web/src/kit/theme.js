// Copied from kit/web/theme.js by kit/sync.mjs. Change it there, not here.
import { ref } from 'vue';

// Light, dark, or following the system ('auto'): chosen per device, so it also holds on the
// login page and offline. The colours in tokens.css (and each app's style.css) are
// light-dark() pairs; which half shows is decided by `color-scheme`, which data-theme on
// <html> pins (tokens.css). The app's index.html sets data-theme before the first paint:
//
//   <script>try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
//
// The phone's status bar takes its colour from <meta name="theme-color">. Index.html has one
// for light and one for dark (by media query); with a pinned theme both get that theme's colour,
// or the bar would stay light over a dark app (or the other way round).

const KEY = 'theme';
export const THEMES = ['auto', 'light', 'dark'];

function stored() {
  try {
    const value = localStorage.getItem(KEY);
    return THEMES.includes(value) ? value : 'auto';
  } catch {
    return 'auto';
  }
}

export const theme = ref(stored());

// The colours index.html gave the status bar, before anything changed them
const metas = typeof document === 'undefined' ? [] : [...document.querySelectorAll('meta[name="theme-color"]')].map((el) => ({
  el,
  content: el.content,
  dark: /dark/.test(el.media || ''),
}));

function paintStatusBar(value) {
  const light = metas.find((m) => !m.dark)?.content;
  const dark = metas.find((m) => m.dark)?.content;
  for (const m of metas) {
    if (value === 'auto') m.el.content = m.content;
    else m.el.content = (value === 'dark' ? dark : light) || m.content;
  }
}

// store: false for an app that keeps the choice itself (Fernweh)
export function applyTheme(value, { store = true } = {}) {
  const choice = THEMES.includes(value) ? value : 'auto';
  theme.value = choice;
  const root = document.documentElement;
  if (choice === 'auto') delete root.dataset.theme;
  else root.dataset.theme = choice;
  paintStatusBar(choice);
  if (!store) return;
  try {
    if (choice === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // remembered until the page is closed
  }
}

if (typeof document !== 'undefined') applyTheme(theme.value, { store: false });
