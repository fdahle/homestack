import { api } from './kit/api.js';

export * from './kit/api.js';

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

// Shared or pasted text → a draft for the event form, with what Bande could guess.
// friendId: add this friend (pasted on their page).
export async function draftFromText(text, { title = '', friendId = null } = {}) {
  const d = await api('/share/parse', { method: 'POST', body: { text, title } });
  if (friendId && !d.friendIds.includes(friendId)) d.friendIds.push(friendId);
  setDraft(d);
}
