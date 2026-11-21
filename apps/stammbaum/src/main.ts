// The kit's palette, then the few components drawn in its style, then Stammbaum's own,
// then the frame the homestack apps share (tabs on a phone, a sidebar on a computer)
import './kit/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/shell.css';

import { createApp } from 'vue';
import { loadSource } from '@source';
import App from './app/App.vue';
import { start } from './app/store';
import { t } from './i18n';
import { applyTheme, theme } from './kit/theme.js';
import { readStored, writeStored } from './ui/storage';
import type { FamilySource } from './source/types';

// Flags next to countries, unless the build left them out (STAMMBAUM_FLAGS=off).
// A chunk of its own; the font is only fetched where the system draws no flags.
if (__FLAGS__) void import('./flags');

// A light or dark chosen before Stammbaum used the kit's switch carries over once
const before = readStored('stammbaum-mode');
if (before === 'light' || before === 'dark') {
  if (theme.value === 'auto') applyTheme(before);
  writeStored('stammbaum-mode', 'moved');
}

// The hosted app asks the server; the single file has the family built in.
start(await firstSource());
createApp(App).mount('#app');

/** The family, asked for until it comes: a failed load says so and offers to try again. */
async function firstSource(): Promise<FamilySource> {
  const page = document.querySelector<HTMLElement>('#view');
  if (!page) throw new Error('missing element: #view');
  for (;;) {
    const waiting = document.createElement('p');
    waiting.className = 'load-state';
    waiting.setAttribute('role', 'status');
    waiting.append(spinner(), t().loading);
    // Only once it takes a moment: a quick answer should not flash past.
    const slow = setTimeout(() => page.replaceChildren(waiting), 400);
    try {
      const loaded = await loadSource();
      clearTimeout(slow);
      page.replaceChildren();
      return loaded;
    } catch (error) {
      clearTimeout(slow);
      console.error(error);
      await new Promise<void>((retry) => {
        const failed = document.createElement('div');
        failed.className = 'load-state';
        failed.setAttribute('role', 'alert');
        const text = document.createElement('p');
        text.textContent = t().loadFailed;
        const again = document.createElement('button');
        again.type = 'button';
        again.className = 'btn btn-primary btn-sm';
        again.textContent = t().retry;
        again.addEventListener('click', () => retry());
        failed.append(text, again);
        page.replaceChildren(failed);
        again.focus();
      });
    }
  }
}

function spinner(): HTMLElement {
  const element = document.createElement('span');
  element.className = 'loading loading-spinner loading-sm';
  element.setAttribute('aria-hidden', 'true');
  return element;
}
