// Keeping devices in step, for apps that work offline (Notizbuch, To-do). The device keeps
// everything and writes there first; its changes wait in an outbox until POST /api/sync:
//
//   { since, changes: [{ kind, id, base_seq, patch }] }
//   → { seq, items: { <kind>: [rows changed after `since`] }, rejected: [{ kind, id, error }], conflicts: [...] }
//
// Every write gets the next number of one counter (`seq`), so "since" is just a number.
// Ids come from the device (UUIDs), so an item exists before the server has heard of it.
// Changes are patches; by default the latest change to a field wins. An app can take a kind's
// changes itself (Notizbuch: two devices changing the same note's text keep both).
//
// createSync(db, { kinds }) — each kind: {
//   table,                     its table: id TEXT PRIMARY KEY, user_id, seq, purged, …
//   clean(patch) → patch,      checks what the device sent; throws BadRequest
//   json: [...], bool: [...],  columns stored as JSON / as 0 and 1
//   out(row) → item,           what devices get (a purged row: { id, seq, purged: true })
//   apply(ctx) → {} | { conflict }   optional: take the change yourself (ctx below)
// }

import { BadRequest } from './errors.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_CHANGES = 500;

export function createSync(db, { kinds }) {
  db.exec('CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL)');

  const nextSeq = () =>
    db.prepare("INSERT INTO counters (name, value) VALUES ('seq', 1) ON CONFLICT (name) DO UPDATE SET value = value + 1 RETURNING value").get().value;
  const currentSeq = () => db.prepare("SELECT value FROM counters WHERE name = 'seq'").get()?.value ?? 0;

  function transaction(fn) {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // The patch as column values
  function toColumns(kind, patch) {
    const values = {};
    for (const [key, value] of Object.entries(patch)) {
      if (kind.json?.includes(key)) values[key] = value === null ? null : JSON.stringify(value);
      else if (kind.bool?.includes(key)) values[key] = value ? 1 : 0;
      else values[key] = value;
    }
    return values;
  }

  // Latest change wins: insert the item or update the fields in the patch
  function write(kind, userId, id, row, values, seq = nextSeq()) {
    const keys = Object.keys(values);
    if (!row) {
      const now = new Date().toISOString();
      values.created_at ??= now;
      values.updated_at ??= now;
      const cols = Object.keys(values);
      db.prepare(`INSERT INTO ${kind.table} (id, user_id, seq, ${cols.join(', ')}) VALUES (?, ?, ?, ${cols.map(() => '?').join(', ')})`)
        .run(id, userId, seq, ...cols.map((k) => values[k]));
    } else {
      db.prepare(`UPDATE ${kind.table} SET ${[...keys.map((k) => `${k} = ?`), 'seq = ?'].join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => values[k]), seq, id);
    }
  }

  function applyChange(userId, change, removed) {
    const kind = kinds[change?.kind];
    if (!kind) throw new BadRequest('bad_kind');
    const id = String(change.id ?? '');
    if (!UUID.test(id)) throw new BadRequest('bad_id');
    const patch = kind.clean(change.patch);
    const row = db.prepare(`SELECT * FROM ${kind.table} WHERE id = ?`).get(id);
    if (row && row.user_id !== userId) throw new BadRequest('bad_id');
    if (row?.purged) return {}; // gone for good: nothing left to change
    const baseSeq = Number.isInteger(change.base_seq) ? change.base_seq : 0;
    if (kind.apply) {
      return kind.apply({ userId, id, row, patch, baseSeq, removed, nextSeq, write: (values, seq) => write(kind, userId, id, row, toColumns(kind, values), seq), toColumns: (p) => toColumns(kind, p) }) || {};
    }
    write(kind, userId, id, row, toColumns(kind, patch));
    return {};
  }

  function changesSince(userId, since) {
    const items = {};
    for (const [name, kind] of Object.entries(kinds)) {
      items[name] = db.prepare(`SELECT * FROM ${kind.table} WHERE user_id = ? AND seq > ? ORDER BY seq`).all(userId, since).map(kind.out);
    }
    return { seq: currentSeq(), items };
  }

  // → { answer, removed }: `removed` collects what the app has to clean up afterwards (Notizbuch: files on the disk)
  function sync(userId, { since, changes = [] } = {}) {
    if (!Array.isArray(changes) || changes.length > MAX_CHANGES) throw new BadRequest('bad_sync');
    const after = Number.isInteger(since) && since > 0 ? since : 0;
    const rejected = [];
    const conflicts = [];
    const removed = [];
    transaction(() => {
      for (const change of changes) {
        try {
          const { conflict } = applyChange(userId, change, removed);
          if (conflict) conflicts.push({ kind: change.kind, id: change.id, copy: conflict });
        } catch (err) {
          // A change the server can't take would block the device's outbox for good: say so, and go on
          if (!(err instanceof BadRequest)) throw err;
          rejected.push({ kind: String(change?.kind ?? ''), id: String(change?.id ?? ''), error: err.code });
        }
      }
    });
    return { answer: { ...changesSince(userId, after), rejected, conflicts }, removed };
  }

  return { sync, nextSeq, currentSeq, transaction };
}

// --- checking what devices send ---

export const isIso = (v) => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));

export function isoOrNull(v, key) {
  if (v === null) return null;
  if (!isIso(v)) throw new BadRequest(`bad_${key}`);
  return new Date(v).toISOString();
}

export function text(v, key, max) {
  if (typeof v !== 'string') throw new BadRequest(`bad_${key}`);
  return v.slice(0, max);
}

// created_at / updated_at written on the device, maybe offline: a clock running ahead doesn't
// get to write the future. deleted_at: when it went into the trash (or null).
export function cleanStamps(patch, out) {
  const now = Date.now();
  for (const key of ['created_at', 'updated_at']) {
    if (!(key in patch)) continue;
    if (!isIso(patch[key])) throw new BadRequest(`bad_${key}`);
    out[key] = new Date(Math.min(Date.parse(patch[key]), now)).toISOString();
  }
  if ('deleted_at' in patch) out.deleted_at = isoOrNull(patch.deleted_at, 'deleted_at');
  return out;
}
