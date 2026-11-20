// Copied from design/web/api.js by design/sync.mjs. Change it there, not here.
import { reactive } from 'vue';

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || `HTTP ${status}`);
    this.status = status;
    this.code = data?.error || 'server_error';
    this.data = data;
  }
}

export const session = reactive({ user: null, checked: false });
let appRouter = null;

// Behind Authelia, an expired login doesn't answer the API with a 401: nginx redirects the
// request to the login portal, which fetch can't follow (another origin). The API itself
// never redirects, so a redirect means exactly that, and reloading the page lets nginx
// send the whole page to the portal, which comes back here after the login.
// At most once a minute, so a broken setup can't reload forever.
function proxyLoginExpired() {
  try {
    const last = Number(sessionStorage.getItem('proxyLoginReload') || 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem('proxyLoginReload', String(Date.now()));
  } catch {
    // no sessionStorage: reload anyway
  }
  window.location.reload();
}

// fetch wrapper for the JSON API. A 401 sends you to the login page.
export async function api(path, { method = 'GET', body, raw } = {}) {
  const init = { method, headers: {}, redirect: 'manual' };
  if (raw) {
    init.body = raw;
    init.headers['Content-Type'] = raw.type || 'application/octet-stream';
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`/api${path}`, init);
  if (res.type === 'opaqueredirect') {
    proxyLoginExpired();
    throw new ApiError(401, { error: 'not_logged_in' });
  }
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (res.status === 401 && path !== '/login' && path !== '/me') {
    session.user = null;
    appRouter?.replace({ name: 'login', query: { next: appRouter.currentRoute.value.fullPath } });
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export async function loadSession() {
  try {
    session.user = await api('/me');
  } catch {
    session.user = null;
  }
  session.checked = true;
  return session.user;
}

// Every page except those with meta.public needs a login. The login route must be named 'login'.
export function installAuthGuard(router, { home = '/' } = {}) {
  appRouter = router;
  router.beforeEach(async (to) => {
    if (!session.checked) await loadSession();
    if (!to.meta.public && !session.user) return { name: 'login', query: { next: to.fullPath } };
    if (to.name === 'login' && session.user) return home;
  });
}
