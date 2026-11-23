import { watch } from 'vue';
import { api, ApiError, onLogout, session } from './api.js';

// The kit asks the server who is logged in (GET /api/me) before the first page. Offline that
// fails, and Notizbuch would show the login page instead of your notes. So the device remembers
// the account it last saw: with it, the app starts at once and checks with the server behind
// the scenes. Only a real "not logged in" from the server ends it.

const KEY = 'notizbuch-user';

function remembered() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

function remember(user) {
  try {
    if (user) localStorage.setItem(KEY, JSON.stringify(user));
    else localStorage.removeItem(KEY);
  } catch {
    // no storage: the app just won't open offline
  }
}

// Logging out: the service worker's copies of attached files (sw.js) leave the device too.
// The notes themselves are deleted by the kit (offline.js).
onLogout({ after: () => (globalThis.caches ? caches.delete('notizbuch-files') : null) });

export function restoreSession(router) {
  const user = remembered();
  if (user) {
    session.user = user;
    session.checked = true;
    api('/me').then((fresh) => (session.user = fresh), (err) => {
      if (!(err instanceof ApiError) || ![401, 403].includes(err.status)) return; // offline: carry on
      session.user = null;
      router.replace({ name: 'login', query: { next: router.currentRoute.value.fullPath } });
    });
  }
  watch(() => session.user, remember, { deep: true });
}
