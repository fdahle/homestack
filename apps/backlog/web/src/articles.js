// What you do with a post: read, read later, hide. The post object changes at once (so every
// list showing it follows), the server is told, and the toast offers to undo it.
import { shallowRef } from 'vue';
import { api } from './api.js';
import { t } from './i18n.js';
import { errorText, openSheet, showToast } from './util.js';

// The post that changed last, for lists showing another copy of it (see sameArticle)
export const lastChange = shallowRef(null);

// Copies a change into the matching post of a list
export function sameArticle(list, changed) {
  const mine = changed && list.find((a) => a.id === changed.id);
  if (mine && mine !== changed) Object.assign(mine, { read_at: changed.read_at, starred: changed.starred, ignored: changed.ignored });
}

async function patch(article, changes) {
  const before = { read_at: article.read_at, starred: article.starred, ignored: article.ignored };
  if ('read' in changes) article.read_at = changes.read ? new Date().toISOString() : null;
  if ('starred' in changes) article.starred = changes.starred ? 1 : 0;
  if ('ignored' in changes) article.ignored = changes.ignored ? 1 : 0;
  try {
    Object.assign(article, await api(`/articles/${article.id}`, { method: 'PATCH', body: changes }));
    lastChange.value = { ...article };
  } catch (err) {
    Object.assign(article, before);
    showToast(errorText(err));
    throw err;
  }
}

export async function setRead(article, read) {
  await patch(article, { read });
  showToast(t(read ? 'article.markedRead' : 'article.markedUnread'), { label: t('undo'), run: () => patch(article, { read: !read }) });
}

export async function setLater(article, starred) {
  await patch(article, { starred });
  if (starred) showToast(t('article.savedLater'));
}

// all: every post object on the page, so the older ones tick off as well
export async function readOlder(article, all = []) {
  const { ids } = await api(`/articles/${article.id}/read-older`, { method: 'POST' });
  const now = new Date().toISOString();
  const changed = all.filter((a) => ids.includes(a.id) && !a.read_at);
  for (const a of changed) a.read_at = now;
  showToast(t('article.olderDone', { n: ids.length }), {
    label: t('undo'),
    run: async () => {
      await api('/read-many', { method: 'POST', body: { ids, read: false } });
      for (const a of changed) a.read_at = null;
    },
  });
}

export async function hide(article) {
  await patch(article, { ignored: true });
  showToast(t('article.hidden'), { label: t('undo'), run: () => patch(article, { ignored: false }) });
}

export function moreActions(article, all) {
  openSheet(article.title, [
    { label: article.read_at ? t('article.markUnread') : t('article.markRead'), run: () => setRead(article, !article.read_at) },
    { label: article.starred ? t('article.unlater') : t('article.later'), run: () => setLater(article, !article.starred) },
    { label: t('article.older'), run: () => readOlder(article, all) },
    { label: t('article.hide'), run: () => hide(article) },
  ]);
}

// --- "Finished reading?" when you come back from a post ---

const KEY = 'backlog-open';

// Opening a post (it opens in a new tab or the browser): remember it for when you come back
export function rememberOpen(article) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ id: article.id, title: article.title, at: Date.now() }));
  } catch {
    // no storage: no question afterwards
  }
}

export async function askAboutOpened() {
  let pending;
  try {
    pending = JSON.parse(localStorage.getItem(KEY));
  } catch {
    return;
  }
  if (!pending || document.visibilityState !== 'visible') return;
  if (Date.now() - pending.at < 15_000) return; // back too fast to have read it
  localStorage.removeItem(KEY);
  if (Date.now() - pending.at > 24 * 3600_000) return;
  let article;
  try {
    article = await api(`/articles/${pending.id}`);
  } catch {
    return; // gone, or offline: nothing to ask
  }
  if (article.read_at) return;
  openSheet(t('article.finished', { title: article.title }), [
    { label: t('article.finishedYes'), primary: true, run: () => setRead(article, true) },
    { label: t('article.later'), run: () => setLater(article, true) },
  ]);
}
