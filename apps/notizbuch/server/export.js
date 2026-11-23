// All notes as Markdown files in a ZIP, with their attached files next to them, so they
// stay readable without Notizbuch. The trash isn't part of it; the archive is (in archive/).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zip } from './zip.js';

// Something every file system takes as a name
export function safeName(text, fallback = 'Notiz') {
  const name = String(text || '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 80)
    .trim();
  return name || fallback;
}

const firstLine = (body) => (body || '').split('\n').map((l) => l.replace(/^[#>*\-+\s]+|\[[ xX]\]\s*/g, '').trim()).find(Boolean);

export function noteMarkdown(note, fileLinks = []) {
  const front = [
    '---',
    note.title ? `title: ${JSON.stringify(note.title)}` : null,
    note.labels.length ? `labels: [${note.labels.map((l) => JSON.stringify(l)).join(', ')}]` : null,
    note.pinned ? 'pinned: true' : null,
    note.archived_at ? `archived: ${note.archived_at}` : null,
    `created: ${note.created_at}`,
    `updated: ${note.updated_at}`,
    '---',
    '',
  ].filter((l) => l !== null);
  const parts = [front.join('\n')];
  if (note.title) parts.push(`# ${note.title}\n`);
  if (note.body.trim()) parts.push(`${note.body.trim()}\n`);
  if (fileLinks.length) parts.push(fileLinks.map((f) => (f.image ? `![${f.name}](<${f.path}>)` : `[${f.name}](<${f.path}>)`)).join('\n\n') + '\n');
  return parts.join('\n');
}

// Already compressed: deflating these again costs time and saves next to nothing
const COMPRESSED = /^(image\/(?!svg|bmp|x-icon)|video\/|audio\/|font\/woff)|^application\/(pdf|zip|gzip|x-gzip|x-7z-compressed|x-rar-compressed|vnd\.rar|x-bzip2|x-xz|zstd|epub\+zip|vnd\.openxmlformats|vnd\.oasis\.opendocument)/;
export const isCompressed = (type) => COMPRESSED.test(type || '');

// The ZIP as Buffers, one after the other (see zip.js). Files are read when their turn comes,
// so only one of them is in memory at a time.
export function exportZip(notes, fileDir, root = 'Notizbuch') {
  return zip(entries(notes, fileDir, root));
}

async function* entries(notes, fileDir, root) {
  const used = new Set();
  const unique = (path) => {
    let candidate = path;
    for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = path.replace(/(\.[^./]+)?$/, ` (${i})$1`);
    used.add(candidate.toLowerCase());
    return candidate;
  };

  for (const note of notes) {
    const dir = note.archived_at ? 'archive/' : '';
    const base = safeName(note.title || firstLine(note.body));
    const mdPath = unique(`${dir}${base}.md`);
    const links = [];
    for (const file of note.files) {
      let data;
      try {
        data = await readFile(join(fileDir, file.id));
      } catch {
        continue; // missing on disk: leave it out rather than fail the whole export
      }
      const path = unique(`${dir}files/${safeName(base)} - ${safeName(file.name, 'Datei')}`);
      yield { name: `${root}/${path}`, data, date: new Date(file.created_at), store: isCompressed(file.type) };
      links.push({ name: file.name, path: path.slice(dir.length), image: file.type.startsWith('image/') });
    }
    yield { name: `${root}/${mdPath}`, data: noteMarkdown(note, links), date: new Date(note.updated_at) };
  }
}
