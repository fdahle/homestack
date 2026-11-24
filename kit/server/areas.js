// Areas ("Zuhause", "Arbeit"): named groups of what an app sorts by, so a device can show one
// part of your things at a time. Notizbuch groups labels, To-do groups lists. They sync like
// any other kind (sync.js); which area a device shows is that device's own choice (web/areas.js).
//
//   createSync(db, { kinds: { …, area: areaKind(db, { member: cleanLabel }) } })
//
// member(value) → the value checked and cleaned (throws BadRequest); null or '' leaves it out.

import { BadRequest } from './errors.js';
import { cleanStamps, text } from './sync.js';

const MAX_MEMBERS = 200;

export function areaKind(db, { member }) {
  db.exec(`
    -- members: JSON array of what the area groups (label names, list ids).
    -- position: the order in the switcher. deleted_at: deleted (devices drop it).
    CREATE TABLE IF NOT EXISTS areas (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      position REAL NOT NULL DEFAULT 0,
      members TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      purged INTEGER NOT NULL DEFAULT 0,
      seq INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS areas_user_seq ON areas (user_id, seq);
  `);
  return { table: 'areas', json: ['members'], clean: (patch) => cleanAreaPatch(patch, member), out: areaOut };
}

export function cleanAreaPatch(patch, member) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new BadRequest('bad_patch');
  const out = {};
  if ('name' in patch) {
    out.name = text(patch.name, 'name', 40).trim();
    if (!out.name) throw new BadRequest('bad_name');
  }
  if ('position' in patch) {
    if (typeof patch.position !== 'number' || !Number.isFinite(patch.position)) throw new BadRequest('bad_position');
    out.position = patch.position;
  }
  if ('members' in patch) {
    if (!Array.isArray(patch.members) || patch.members.length > MAX_MEMBERS) throw new BadRequest('bad_members');
    const seen = new Set();
    out.members = [];
    for (const raw of patch.members) {
      const value = member(raw);
      const key = typeof value === 'string' ? value.toLowerCase() : value;
      if (value == null || value === '' || seen.has(key)) continue;
      seen.add(key);
      out.members.push(value);
    }
  }
  return cleanStamps(patch, out);
}

export function areaOut(row) {
  if (row.purged) return { id: row.id, seq: row.seq, purged: true };
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    members: JSON.parse(row.members),
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    seq: row.seq,
  };
}
