import { watch } from 'vue';
import { api, ApiError, onLogout, session } from './api.js';

// The kit asks the server who is logged in (GET /api/me) before the first page. Offline that
// fails, and To-do would show the login page instead of your tasks. So the device remembers
// the account it last saw: with it, the app starts at once and checks with the server behind
// the scenes. Only a real "not logged in" from the server ends it.

const KEY = 'todo-user';

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

// Logging out ends this device's reminders too: they'd show the tasks to whoever uses it next
onLogout({
  async before() {
    const reg = 'serviceWorker' in navigator && 'PushManager' in window ? await navigator.serviceWorker.getRegistration() : null;
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  },
});

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
