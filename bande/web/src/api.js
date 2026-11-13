import { reactive } from 'vue';
import { router } from './router.js';

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || `HTTP ${status}`);
    this.status = status;
    this.code = data?.error || 'server_error';
    this.data = data;
  }
}

// fetch wrapper for the JSON API. A 401 sends you to the login page.
export async function api(path, { method = 'GET', body, raw } = {}) {
  const init = { method, headers: {} };
  if (raw) {
    init.body = raw;
    init.headers['Content-Type'] = raw.type || 'application/octet-stream';
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`/api${path}`, init);
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (res.status === 401 && path !== '/login' && path !== '/me') {
    session.user = null;
    router.replace({ name: 'login', query: { next: router.currentRoute.value.fullPath } });
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const session = reactive({ user: null, checked: false });

export async function loadSession() {
  try {
    session.user = await api('/me');
  } catch {
    session.user = null;
  }
  session.checked = true;
  return session.user;
}

// The friends list, loaded once and shared by the pickers; refreshFriends() after changes
let friendsPromise = null;
export const loadFriends = () => (friendsPromise ??= api('/friends').catch((err) => {
  friendsPromise = null;
  throw err;
}));
export const refreshFriends = () => {
  friendsPromise = null;
};

// Hands a prepared event from one page to the next (shared text → event form)
let draft = null;
export const setDraft = (d) => {
  draft = d;
};
export const takeDraft = () => {
  const d = draft;
  draft = null;
  return d;
};

// A shared chat file on its way from the share page to the import page
let sharedFile = null;
export const setSharedFile = (f) => {
  sharedFile = f;
};
export const takeSharedFile = () => {
  const f = sharedFile;
  sharedFile = null;
  return f;
};
