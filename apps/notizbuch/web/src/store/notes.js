// The notes and their files, offline first: the kit's engine (kit/offline.js) keeps them on
// the device and in step with the server; this file is what Notizbuch does with them. Files
// picked on the device wait in their own local store ("uploads") and go up after the notes,
// once their note is on the server. How the server merges is in server/notes.js.

import { computed } from 'vue';
import { api, ApiError, session } from '../api.js';
import { t } from '../i18n.js';
import { showToast } from '../util.js';
import { createOffline } from '../kit/offline.js';
import { prepareFile } from '../lib/files.js';
import { readTakeout } from '../lib/keep.js';

// A note's colours ('' is none). The server checks against the same list (server/notes.js);
// style.css has a light and a dark shade of each.
export const NOTE_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'darkblue', 'purple', 'pink', 'brown', 'grey'];

const uploads = new Map(); // id → { id, meta, blob }
const blobUrls = new Map();

const off = createOffline({
  name: 'notizbuch',
  kinds: { note: 'notes', file: 'files' },
  extraStores: ['uploads'],
  async onOpen(local) {
    for (const up of await local.all('uploads')) {
      uploads.set(up.id, up);
      off.state.items.file.set(up.id, { ...up.meta, pending: true });
    }
    off.setExtraPending(uploads.size);
  },
  onClose() {
    uploads.clear();
    for (const url of blobUrls.values()) URL.revokeObjectURL(url);
    blobUrls.clear();
  },
  afterChanges: uploadFiles,
  onAnswer(answer) {
    if (answer.conflicts?.length) showToast(t('sync.conflict', { n: answer.conflicts.length }));
  },
});

// What the pages read (reactive through off.state)
export const store = {
  get ready() { return off.state.ready; },
  get notes() { return off.state.items.note; },
  get files() { return off.state.items.file; },
  get pending() { return off.state.pending; },
  get status() { return off.state.status; },
  get lastSync() { return off.state.lastSync; },
  get settings() { return off.state.settings || { maxFileMb: 25, trashDays: 30 }; },
};

export const { sync, whenReady } = off;

const now = () => new Date().toISOString();
const CONTENT = ['title', 'body', 'labels'];

// --- notes ---

export function createNote(fields = {}) {
  const at = now();
  const note = { id: crypto.randomUUID(), title: '', body: '', labels: [], color: '', pinned: false, archived_at: null, deleted_at: null, created_at: at, updated_at: at, ...fields };
  store.notes.set(note.id, { ...note, seq: 0 });
  const { id, ...patch } = note;
  off.queue('note', store.notes.get(id), patch);
  return store.notes.get(id);
}

export function updateNote(id, changes) {
  const note = store.notes.get(id);
  if (!note) return;
  const patch = { ...changes };
  if (CONTENT.some((key) => key in changes)) patch.updated_at = now();
  Object.assign(note, patch);
  off.queue('note', note, patch);
}

export const pinNote = (id, pinned) => updateNote(id, { pinned });
export const archiveNote = (id, archived) => updateNote(id, { archived_at: archived ? now() : null });
export const trashNote = (id) => updateNote(id, { deleted_at: now(), pinned: false });
export const restoreNote = (id) => updateNote(id, { deleted_at: null });

// Gone for good, with its files
export function purgeNote(id) {
  for (const file of filesOf(id)) dropFile(file.id);
  store.notes.delete(id);
  off.removeLocal('note', id);
  off.queue('note', null, { purge: true }, id);
}

export function isEmpty(note) {
  return !note.title.trim() && !note.body.trim() && !filesOf(note.id).length;
}

// Renames a label (or, with `to` empty, takes it off) in every note that has it
export function renameLabel(from, to) {
  const key = from.toLowerCase();
  for (const note of store.notes.values()) {
    if (!note.labels.some((l) => l.toLowerCase() === key)) continue;
    const labels = note.labels.flatMap((l) => (l.toLowerCase() === key ? (to ? [to] : []) : [l]));
    updateNote(note.id, { labels: labels.filter((l, i) => labels.findIndex((x) => x.toLowerCase() === l.toLowerCase()) === i) });
  }
}

// --- files ---

const filesByNote = computed(() => {
  const map = new Map();
  for (const file of store.files.values()) {
    if (!map.has(file.note_id)) map.set(file.note_id, []);
    map.get(file.note_id).push(file);
  }
  for (const list of map.values()) list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return map;
});
export const filesOf = (noteId) => filesByNote.value.get(noteId) || [];

// → how many were added. touch: false leaves the note's "edited" time as it is (an import).
export async function addFiles(noteId, list, { touch = true } = {}) {
  const limit = store.settings.maxFileMb * 1024 * 1024;
  const local = off.local();
  let added = 0;
  for (const original of list) {
    let prepared;
    try {
      prepared = await prepareFile(original);
    } catch {
      showToast(t('files.unreadable', { name: original.name }));
      continue;
    }
    if (prepared.blob.size > limit) {
      showToast(t('files.tooLarge', { name: original.name, mb: store.settings.maxFileMb }));
      continue;
    }
    const meta = {
      id: crypto.randomUUID(),
      note_id: noteId,
      name: prepared.name,
      type: prepared.blob.type || 'application/octet-stream',
      size: prepared.blob.size,
      width: prepared.width ?? null,
      height: prepared.height ?? null,
      created_at: now(),
    };
    const up = { id: meta.id, meta, blob: prepared.blob };
    uploads.set(meta.id, up);
    store.files.set(meta.id, { ...meta, pending: true });
    await local?.put('uploads', up);
    added++;
  }
  off.setExtraPending(uploads.size);
  if (touch && store.notes.has(noteId)) updateNote(noteId, { updated_at: now() });
  else off.syncSoon();
  return added;
}

// Off this device; true when the server has it and needs telling
function dropFile(id) {
  store.files.delete(id);
  off.removeLocal('file', id);
  if (blobUrls.has(id)) {
    URL.revokeObjectURL(blobUrls.get(id));
    blobUrls.delete(id);
  }
  if (uploads.has(id)) {
    uploads.delete(id);
    off.local()?.remove('uploads', id);
    off.setExtraPending(uploads.size);
    return false;
  }
  return true;
}

export function removeFile(id) {
  if (dropFile(id)) off.queue('file', null, { purge: true }, id);
}

// Where to show a file from: the device itself until it is uploaded
export function fileUrl(file) {
  const up = uploads.get(file.id);
  if (!up) return `/files/${file.id}`;
  if (!blobUrls.has(file.id)) blobUrls.set(file.id, URL.createObjectURL(up.blob));
  return blobUrls.get(file.id);
}

// After the notes went out (kit/offline.js): the files picked on this device. Their note has
// to be on the server first. True when something went up (then the engine pulls once more).
async function uploadFiles({ local, isOwner, requeue }) {
  let uploaded = false;
  for (const up of [...uploads.values()]) {
    const note = store.notes.get(up.meta.note_id);
    if (!note || !note.seq) {
      // Still in the outbox (made a moment ago): next round. Otherwise its note never made it.
      if (note && off.isQueued('note', note.id)) requeue();
      continue;
    }
    const { meta } = up;
    const query = new URLSearchParams({ note: meta.note_id, name: meta.name });
    if (meta.width) query.set('width', meta.width);
    if (meta.height) query.set('height', meta.height);
    try {
      const file = await api(`/files/${up.id}?${query}`, { method: 'PUT', raw: up.blob });
      if (!isOwner()) return false;
      uploaded = true;
      uploads.delete(up.id);
      await local.remove('uploads', up.id);
      if (store.files.has(up.id)) {
        store.files.set(up.id, file);
        off.putLocal('file', file);
      }
    } catch (err) {
      // The server won't take it (too large, note gone): waiting won't change that
      if (!(err instanceof ApiError) || ![400, 413].includes(err.status)) throw err;
      showToast(t(err.status === 413 ? 'files.tooLarge' : err.code === 'storage_full' ? 'files.storageFull' : 'files.notTaken', { name: meta.name, mb: store.settings.maxFileMb }));
      dropFile(up.id);
    }
  }
  off.setExtraPending(uploads.size);
  return uploaded;
}

// --- importing from Google Keep ---

// files: what was picked (Takeout ZIPs, or the notes' JSON files and pictures; see lib/keep.js).
// The notes are added like any others: on this device first, then synced, their pictures
// uploaded after them. A note that's here already (imported before) is left as it is, so
// importing again only brings what's new. Keep's trash is left out.
// onProgress(done, total) → { added, existing, trashed, files, missing, unreadable: [names] }
export async function importKeep(files, onProgress) {
  const { notes, unreadable } = await readTakeout(files, { owner: String(session.user?.id ?? '') });
  const result = { added: 0, existing: 0, trashed: 0, files: 0, missing: 0, unreadable, found: notes.length };
  for (const [i, note] of notes.entries()) {
    onProgress?.(i, notes.length);
    if (note.trashed) {
      result.trashed++;
      continue;
    }
    if (store.notes.has(note.fields.id)) {
      result.existing++;
      continue;
    }
    createNote(note.fields);
    result.added++;
    result.missing += note.missing;
    const picked = [];
    for (const file of note.files) {
      try {
        picked.push(new File([await file.open()], file.name, { type: file.type }));
      } catch {
        result.missing++;
      }
    }
    if (picked.length) result.files += await addFiles(note.fields.id, picked, { touch: false });
  }
  onProgress?.(notes.length, notes.length);
  return result;
}

// --- reading ---

// Labels on the notes that aren't in the trash, in alphabetical order: [[label, count]]
export const labelCounts = computed(() => {
  const counts = new Map();
  for (const note of store.notes.values()) {
    if (note.deleted_at) continue;
    for (const label of note.labels) counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base', numeric: true }));
});
