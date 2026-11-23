// Notes from Google Keep, the way Google Takeout hands them out: a ZIP (or several, for a big
// download) with one JSON file per note and the attached pictures next to them. The folder is
// named after the account's language ("Keep", "Notizen", …), so notes are found by what's in
// their JSON, not by where they lie. Everything here runs on the device; the store
// (store/notes.js) then adds the notes like any others.
//
// A Keep note's JSON (the fields used here):
//   { title, textContent, listContent: [{ text, isChecked }], labels: [{ name }], color: 'RED',
//     isPinned, isArchived, isTrashed, createdTimestampUsec, userEditedTimestampUsec,
//     attachments: [{ filePath, mimetype }], annotations: [{ url, title }] }

import { isZip, readZip } from './unzip.js';

// Keep's colours → ours (the list is in store/notes.js)
const COLORS = {
  RED: 'red', ORANGE: 'orange', YELLOW: 'yellow', GREEN: 'green', TEAL: 'teal', BLUE: 'blue',
  CERULEAN: 'darkblue', PURPLE: 'purple', PINK: 'pink', BROWN: 'brown', GRAY: 'grey',
};

// --- plain text → Markdown ---
// Keep's text is plain: whatever looks like Markdown in it (a * or a "# " at the start of a
// line) is escaped, so it shows exactly as typed. Links are left alone, so they stay links.

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"]+/gi;

// Like the editor's own escaping (prosemirror-markdown), plus entities like &amp;
function escapeInline(text) {
  return text
    .replace(/[`*\\~[\]_]/g, (m, i) => (m === '_' && i > 0 && i + 1 < text.length && /\w/.test(text[i - 1]) && /\w/.test(text[i + 1]) ? m : `\\${m}`))
    .replace(/&(?=#?[a-z0-9]+;)/gi, '\\&');
}

// One line of text. What only means something at the start of a line (a list, a heading, a
// quote, "===" under a line) is escaped there, on every line: after a line break each line
// could start one.
export function escapeLine(line) {
  let out = '';
  let last = 0;
  for (const m of line.matchAll(URL_IN_TEXT)) {
    out += escapeInline(line.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  out += escapeInline(line.slice(last));
  return out
    .replace(/^(\+ |[-*>=])/, '\\$&')
    .replace(/^(#{1,6})(\s|$)/, '\\$1$2')
    .replace(/^(\d+)([.)])(\s|$)/, '$1\\$2$3');
}

// Lines stay lines (a line break inside a paragraph), an empty line starts a new paragraph,
// as in Keep. Spaces at the start or end of a line don't survive Markdown and are dropped.
export function textToMarkdown(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.split('\n').map((l) => l.trim()).filter(Boolean).map(escapeLine).join('\\\n'))
    .filter(Boolean)
    .join('\n\n');
}

function checklist(items) {
  return items
    .map((item) => ({ checked: Boolean(item?.isChecked), lines: String(item?.text || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean) }))
    .filter((item) => item.lines.length)
    .map((item) => `- [${item.checked ? 'x' : ' '}] ${item.lines.map(escapeLine).join('\\\n  ')}`)
    .join('\n');
}

function link({ url, title }) {
  const target = url.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20');
  const text = String(title || '').trim();
  return text ? `[${escapeInline(text)}](${target})` : target;
}

// --- a note ---

export const isKeepNote = (data) =>
  Boolean(data) && typeof data === 'object' && !Array.isArray(data) && 'userEditedTimestampUsec' in data && ('textContent' in data || 'listContent' in data || 'title' in data);

const fromUsec = (usec) => {
  const ms = Number(usec) / 1000;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
};

function cleanLabels(labels) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(labels) ? labels : []) {
    const label = String(raw?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push(label);
  }
  return out.slice(0, 30);
}

// The same Keep note always gets the same id, so importing again skips what's already here.
// Keep's JSON has no id of its own; the moment it was made (in microseconds) is as good. The
// account is part of it: a note shared in Keep is in two people's downloads, with the same time.
export async function keepId(data, owner = '') {
  const key = data.createdTimestampUsec
    ? `keep:${owner}:${data.createdTimestampUsec}`
    : `keep:${owner}:${data.title}\n${data.textContent}\n${JSON.stringify(data.listContent)}`;
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  hash[6] = (hash[6] & 0x0f) | 0x80; // a UUID of version 8: made up by the app
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// A Keep note → { trashed, fields } with the fields createNote takes
export async function fromKeep(data, owner = '') {
  const text = String(data.textContent || '');
  const items = Array.isArray(data.listContent) ? data.listContent : [];
  const parts = [];
  if (text.trim()) parts.push(textToMarkdown(text));
  if (items.length) parts.push(checklist(items));
  // Keep keeps the links it found as annotations; most of them are in the text already
  const written = [text, ...items.map((i) => String(i?.text || ''))].join('\n');
  const links = (Array.isArray(data.annotations) ? data.annotations : [])
    .filter((a) => typeof a?.url === 'string' && /^https?:\/\//i.test(a.url))
    .filter((a) => !written.includes(a.url) && !written.includes(a.url.replace(/\/$/, '')));
  if (links.length) parts.push(links.map(link).join('\n\n'));

  const updated = fromUsec(data.userEditedTimestampUsec) || fromUsec(data.createdTimestampUsec) || new Date().toISOString();
  return {
    trashed: Boolean(data.isTrashed),
    fields: {
      id: await keepId(data, owner),
      title: String(data.title || '').trim().slice(0, 300),
      body: parts.filter(Boolean).join('\n\n'),
      labels: cleanLabels(data.labels),
      color: COLORS[data.color] || '',
      pinned: Boolean(data.isPinned),
      // Keep doesn't say when it went into the archive
      archived_at: data.isArchived ? updated : null,
      created_at: fromUsec(data.createdTimestampUsec) || updated,
      updated_at: updated,
    },
  };
}

// --- the download ---

const TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  '3gp': 'audio/3gpp', m4a: 'audio/mp4', mp3: 'audio/mpeg', amr: 'audio/amr', awb: 'audio/amr-wb',
};
const extension = (path) => (path.match(/\.([^./]+)$/)?.[1] || '').toLowerCase();
const baseName = (path) => path.slice(path.lastIndexOf('/') + 1);

// Finds an attached file: next to the note's JSON, else by its name anywhere (a big download
// comes in several ZIPs, and the picture may be in another one), else by its name without the
// extension (Takeout sometimes writes .jpg in the JSON and .jpeg on the file).
function fileFinder(entries) {
  const byPath = new Map();
  const byName = new Map();
  const byStem = new Map();
  for (const entry of entries) {
    const path = entry.path.toLowerCase();
    const name = baseName(path);
    byPath.set(path, entry);
    if (!byName.has(name)) byName.set(name, entry);
    if (!/\.(json|html|txt)$/.test(name)) {
      const stem = name.replace(/\.[^.]*$/, '');
      if (!byStem.has(stem)) byStem.set(stem, entry);
    }
  }
  return (dir, filePath) => {
    const name = baseName(String(filePath || '')).toLowerCase();
    if (!name) return null;
    return byPath.get(dir.toLowerCase() + name) || byName.get(name) || byStem.get(name.replace(/\.[^.]*$/, '')) || null;
  };
}

// files: what was picked (Takeout ZIPs, or the JSON files and pictures themselves) →
// { notes: [{ trashed, fields, files: [{ name, type, open }], missing }], unreadable: [file names] }
export async function readTakeout(files, { owner = '' } = {}) {
  const entries = [];
  const unreadable = [];
  for (const file of files) {
    if (isZip(file)) {
      try {
        for (const e of await readZip(file)) entries.push({ path: e.name, size: e.size, open: e.open });
      } catch {
        unreadable.push(file.name);
      }
    } else {
      entries.push({ path: file.webkitRelativePath || file.name, size: file.size, open: async () => file });
    }
  }

  const find = fileFinder(entries);
  const notes = [];
  for (const entry of entries) {
    if (!/\.json$/i.test(entry.path) || entry.size > 5_000_000) continue;
    let data;
    try {
      data = JSON.parse(await (await entry.open()).text());
    } catch {
      continue; // not JSON, or not readable: not a note
    }
    if (!isKeepNote(data)) continue;
    const note = await fromKeep(data, owner);
    const dir = entry.path.slice(0, entry.path.lastIndexOf('/') + 1);
    const attachments = Array.isArray(data.attachments) ? data.attachments : [];
    note.files = [];
    for (const a of attachments) {
      const found = find(dir, a?.filePath);
      if (!found) continue;
      const name = baseName(found.path);
      note.files.push({ name, type: TYPES[extension(name)] || a.mimetype || 'application/octet-stream', open: found.open });
    }
    note.missing = attachments.length - note.files.length;
    if (!note.fields.title && !note.fields.body && !note.files.length) continue; // nothing in it
    notes.push(note);
  }
  notes.sort((a, b) => a.fields.created_at.localeCompare(b.fields.created_at));
  return { notes, unreadable };
}
