// Notes and their files. Devices keep them all and sync through the kit (kit/sync.js):
// POST /api/sync with changes of the kinds `note` and `file`.
//
// Notes merge like this: when two devices change the text of the same note before either has
// synced, the second one doesn't overwrite the first. Its text becomes a copy of the note, and
// the device is told. Everything else (title, labels, colour, pinned, archived, …) takes the latest
// change. Files are uploaded on their own (PUT /api/files/:id); a sync only deletes them.

import { randomUUID } from 'node:crypto';
import { BadRequest } from './kit/errors.js';
import { createSync, isIso, isoOrNull, UUID } from './kit/sync.js';

export { UUID };
const MAX_BODY = 500_000;
const MAX_LABELS = 30;
// A note's colour ('' for none). The device has the same list (web/src/store/notes.js), and
// web/src/style.css a light and a dark shade for each.
export const COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'darkblue', 'purple', 'pink', 'brown', 'grey'];

export function createNoteStore(db) {
  db.exec(`
    -- id: made by the device that wrote the note first.
    -- body: Markdown, checklists as "- [ ] …". labels: JSON array of strings.
    -- color: one of COLORS, '' for none.
    -- archived_at / deleted_at: when it went into the archive or the trash (NULL: not there).
    -- purged = 1: deleted for good; only the id is left, so other devices learn about it.
    -- created_at / updated_at: from the device, when it was written (possibly offline).
    -- seq: the counter value of the last change. body_seq: of the last change to the body.
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      labels TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '',
      pinned INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      deleted_at TEXT,
      purged INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      seq INTEGER NOT NULL,
      body_seq INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS notes_user_seq ON notes (user_id, seq);

    -- Pictures and other files attached to a note. The file itself is FILE_DIR/<id>.
    -- purged = 1: removed (and gone from the disk); kept so other devices learn about it.
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      size INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL,
      purged INTEGER NOT NULL DEFAULT 0,
      seq INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS files_user_seq ON files (user_id, seq);
    CREATE INDEX IF NOT EXISTS files_note ON files (note_id);
  `);
  // Databases from before colours
  if (!db.prepare('PRAGMA table_info(notes)').all().some((c) => c.name === 'color')) {
    db.exec("ALTER TABLE notes ADD COLUMN color TEXT NOT NULL DEFAULT ''");
  }

  let engine;
  const nextSeq = () => engine.nextSeq();
  const getNote = (id) => db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  const getFile = (id) => db.prepare('SELECT * FROM files WHERE id = ?').get(id);

  function insertNote(userId, note, seq) {
    db.prepare(`INSERT INTO notes (id, user_id, title, body, labels, color, pinned, archived_at, deleted_at, created_at, updated_at, seq, body_seq)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      note.id, userId, note.title ?? '', note.body ?? '', JSON.stringify(note.labels ?? []), note.color ?? '', note.pinned ? 1 : 0,
      note.archived_at ?? null, note.deleted_at ?? null, note.created_at, note.updated_at, seq, seq,
    );
  }

  // Deletes a note for good. Returns the ids of its files, for the caller to remove from the disk.
  function purgeNote(row) {
    const seq = nextSeq();
    db.prepare("UPDATE notes SET title = '', body = '', labels = '[]', color = '', pinned = 0, purged = 1, seq = ? WHERE id = ?").run(seq, row.id);
    const files = db.prepare('SELECT id FROM files WHERE note_id = ? AND purged = 0').all(row.id).map((f) => f.id);
    db.prepare('UPDATE files SET purged = 1, seq = ? WHERE note_id = ? AND purged = 0').run(seq, row.id);
    return files;
  }

  // A note's change, with the merging described at the top
  function applyNote({ userId, id, row, patch, baseSeq, removed }) {
    if (patch.purge) {
      if (row) removed.push(...purgeNote(row));
      return {};
    }
    const now = new Date().toISOString();
    if (!row) {
      insertNote(userId, { id, created_at: patch.created_at || now, updated_at: patch.updated_at || now, ...patch }, nextSeq());
      return {};
    }
    const seq = nextSeq();
    const result = {};
    let bodySeq = row.body_seq;
    if ('body' in patch && patch.body !== row.body) {
      if (row.body_seq > baseSeq) {
        // The text changed here since the device last saw it: keep both
        const copy = randomUUID();
        insertNote(userId, { id: copy, title: patch.title ?? row.title, body: patch.body, labels: JSON.parse(row.labels), color: patch.color ?? row.color, created_at: now, updated_at: patch.updated_at || now }, seq);
        delete patch.body;
        result.conflict = copy;
      } else {
        bodySeq = seq;
      }
    }
    const sets = [];
    const values = [];
    for (const key of ['title', 'body', 'color', 'archived_at', 'deleted_at', 'updated_at']) {
      if (key in patch) {
        sets.push(`${key} = ?`);
        values.push(patch[key]);
      }
    }
    if ('labels' in patch) {
      sets.push('labels = ?');
      values.push(JSON.stringify(patch.labels));
    }
    if ('pinned' in patch) {
      sets.push('pinned = ?');
      values.push(patch.pinned ? 1 : 0);
    }
    db.prepare(`UPDATE notes SET ${[...sets, 'seq = ?', 'body_seq = ?'].join(', ')} WHERE id = ?`).run(...values, seq, bodySeq, id);
    return result;
  }

  // A file's change: only deleting it
  function applyFile({ row, removed }) {
    if (!row) return {}; // never uploaded: nothing to delete
    db.prepare('UPDATE files SET purged = 1, seq = ? WHERE id = ?').run(nextSeq(), row.id);
    removed.push(row.id);
    return {};
  }

  engine = createSync(db, {
    kinds: {
      note: { table: 'notes', clean: cleanPatch, out: noteOut, apply: applyNote },
      file: { table: 'files', clean: cleanFilePatch, out: fileOut, apply: applyFile },
    },
  });

  // POST /api/sync → { answer, removedFiles }
  function sync(userId, body) {
    const { answer, removed } = engine.sync(userId, body);
    return { answer, removedFiles: removed };
  }

  // Bytes of a user's files (not those deleted for good), for the storage limit
  const bytesUsed = (userId) => db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM files WHERE user_id = ? AND purged = 0').get(userId).n;

  // Before an upload touches the disk: may this file come in? Returns the file when this user
  // sent it before (a retry whose answer got lost), null when it is new and may be written.
  // An id that is taken (another account's file, or one deleted for good) is refused, so the
  // upload can't overwrite or remove what's on the disk under that id.
  function checkUpload(userId, { id, note_id: noteId, size }, maxBytes = Infinity) {
    const existing = getFile(id);
    if (existing) {
      if (existing.user_id !== userId || existing.purged) throw new BadRequest('bad_id');
      return fileOut(existing);
    }
    const note = getNote(noteId);
    if (!note || note.user_id !== userId || note.purged) throw new BadRequest('bad_note');
    if (bytesUsed(userId) + size > maxBytes) throw new BadRequest('storage_full');
    return null;
  }

  // A file arrived (PUT /api/files/:id) and is on the disk. Sending the same file again is fine.
  function addFile(userId, meta, maxBytes = Infinity) {
    const sent = checkUpload(userId, meta, maxBytes);
    if (sent) return sent;
    const { id, note_id: noteId, name, type, size, width, height } = meta;
    db.prepare(`INSERT INTO files (id, user_id, note_id, name, type, size, width, height, created_at, seq)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, userId, noteId, name, type, size, width ?? null, height ?? null, new Date().toISOString(), nextSeq());
    return fileOut(getFile(id));
  }

  // A file to send back, if it is this user's and still there
  function fileFor(userId, id) {
    const row = getFile(String(id));
    return row && row.user_id === userId && !row.purged ? row : null;
  }

  // Notes in the trash for longer than `days` go for good. Returns the file ids to remove from the disk.
  function emptyOldTrash(days) {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    return engine.transaction(() => db.prepare('SELECT * FROM notes WHERE purged = 0 AND deleted_at IS NOT NULL AND deleted_at < ?').all(cutoff).flatMap(purgeNote));
  }

  // For the export: the user's notes that aren't in the trash, with their files
  function notesForExport(userId) {
    const files = db.prepare('SELECT * FROM files WHERE user_id = ? AND purged = 0').all(userId);
    return db.prepare('SELECT * FROM notes WHERE user_id = ? AND purged = 0 AND deleted_at IS NULL ORDER BY created_at').all(userId).map((n) => ({
      ...noteOut(n),
      files: files.filter((f) => f.note_id === n.id),
    }));
  }

  return { sync, checkUpload, addFile, fileFor, emptyOldTrash, notesForExport, getNote };
}

// --- checking what devices send ---

export function cleanLabels(labels) {
  if (!Array.isArray(labels)) throw new BadRequest('bad_labels');
  const seen = new Set();
  const out = [];
  for (const raw of labels) {
    if (typeof raw !== 'string') throw new BadRequest('bad_labels');
    const label = raw.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push(label);
  }
  if (out.length > MAX_LABELS) throw new BadRequest('bad_labels');
  return out;
}

// The fields of a note's patch the server knows, checked. Unknown fields are left out.
export function cleanPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new BadRequest('bad_patch');
  const out = {};
  if (patch.purge === true) return { purge: true };
  if ('title' in patch) {
    if (typeof patch.title !== 'string') throw new BadRequest('bad_title');
    out.title = patch.title.slice(0, 300);
  }
  if ('body' in patch) {
    if (typeof patch.body !== 'string') throw new BadRequest('bad_body');
    if (patch.body.length > MAX_BODY) throw new BadRequest('too_large');
    out.body = patch.body;
  }
  if ('labels' in patch) out.labels = cleanLabels(patch.labels);
  if ('color' in patch) {
    if (patch.color !== '' && !COLORS.includes(patch.color)) throw new BadRequest('bad_color');
    out.color = patch.color;
  }
  if ('pinned' in patch) out.pinned = Boolean(patch.pinned);
  for (const key of ['archived_at', 'deleted_at']) if (key in patch) out[key] = isoOrNull(patch[key], key);
  // Written on the device, maybe offline; a clock running ahead doesn't get to write the future
  const now = Date.now();
  for (const key of ['created_at', 'updated_at']) {
    if (!(key in patch)) continue;
    if (!isIso(patch[key])) throw new BadRequest(`bad_${key}`);
    out[key] = new Date(Math.min(Date.parse(patch[key]), now)).toISOString();
  }
  return out;
}

// A file only ever gets deleted: { purge: true }
function cleanFilePatch(patch) {
  if (patch?.purge !== true) throw new BadRequest('bad_patch');
  return { purge: true };
}

export function noteOut(row) {
  if (row.purged) return { id: row.id, seq: row.seq, purged: true };
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    labels: JSON.parse(row.labels),
    color: row.color,
    pinned: Boolean(row.pinned),
    archived_at: row.archived_at,
    deleted_at: row.deleted_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    seq: row.seq,
  };
}

export function fileOut(row) {
  if (row.purged) return { id: row.id, note_id: row.note_id, seq: row.seq, purged: true };
  return {
    id: row.id,
    note_id: row.note_id,
    name: row.name,
    type: row.type,
    size: row.size,
    width: row.width,
    height: row.height,
    created_at: row.created_at,
    seq: row.seq,
  };
}
