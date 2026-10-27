import db from '../db.js'
import { transaction } from './transaction.js'
import { getMarkers } from './markers.js'

// Deleted markers are kept as complete snapshots (fields, links, trip segments, person
// addresses) instead of soft-deleted rows, so no other query has to know about the trash.
const RETENTION_DAYS = 30

export function purgeTrash() {
  db.prepare(`DELETE FROM deleted_markers WHERE deleted_at < datetime('now', ?)`).run(`-${RETENTION_DAYS} days`)
}

export function listTrash() {
  purgeTrash()
  return db.prepare('SELECT id, label, deleted_at FROM deleted_markers ORDER BY deleted_at DESC, id DESC').all()
}

export function trashMarker(id) {
  return transaction(db, () => {
    const marker = db.prepare('SELECT * FROM markers WHERE id=?').get(id)
    if (!marker) throw Object.assign(new Error('Not found'), { status: 404 })
    const snapshot = {
      marker,
      category_ids: db.prepare('SELECT category_id AS id FROM marker_categories WHERE marker_id=?').all(id).map(r => r.id),
      collection_links: db.prepare('SELECT collection_id AS id, position FROM marker_collections WHERE marker_id=?').all(id).map(r => ({ ...r })),
      person_ids: db.prepare('SELECT person_id AS id FROM marker_persons WHERE marker_id=?').all(id).map(r => r.id),
      segments: db.prepare('SELECT collection_id, from_marker_id, to_marker_id, mode, via_points FROM trip_waypoints WHERE from_marker_id=? OR to_marker_id=?').all(id, id).map(r => ({ ...r })),
      address_of: db.prepare('SELECT id FROM persons WHERE address_marker_id=?').all(id).map(r => r.id),
    }
    db.prepare(`INSERT OR REPLACE INTO deleted_markers (id, label, deleted_at, snapshot) VALUES (?, ?, datetime('now'), ?)`).run(id, marker.label, JSON.stringify(snapshot))
    db.prepare('DELETE FROM markers WHERE id=?').run(id)
    purgeTrash()
    return { id, label: marker.label }
  })
}

// Restores everything that still fits: links to groups that were deleted meanwhile are
// dropped, and a trip stop number that is now taken becomes unset.
export function restoreMarker(id) {
  return transaction(db, () => {
    const row = db.prepare('SELECT snapshot FROM deleted_markers WHERE id=?').get(id)
    if (!row) throw Object.assign(new Error('Not in trash'), { status: 404 })
    const s = JSON.parse(row.snapshot)
    const columns = new Set(db.prepare('PRAGMA table_info(markers)').all().map(c => c.name))
    const fields = Object.keys(s.marker).filter(f => columns.has(f) && (f !== 'id' || !db.prepare('SELECT 1 FROM markers WHERE id=?').get(s.marker.id)))
    const newId = Number(db.prepare(`INSERT INTO markers (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`).run(...fields.map(f => s.marker[f])).lastInsertRowid)
    const exists = (table, rowId) => !!db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(rowId)

    for (const categoryId of s.category_ids) if (exists('categories', categoryId)) db.prepare('INSERT INTO marker_categories (marker_id, category_id) VALUES (?, ?)').run(newId, categoryId)
    for (const personId of s.person_ids) if (exists('persons', personId)) db.prepare('INSERT INTO marker_persons (marker_id, person_id) VALUES (?, ?)').run(newId, personId)
    for (const link of s.collection_links) {
      const collection = db.prepare('SELECT is_trip FROM collections WHERE id=?').get(link.id)
      if (!collection) continue
      const taken = link.position != null && collection.is_trip && db.prepare('SELECT 1 FROM marker_collections WHERE collection_id=? AND position=?').get(link.id, link.position)
      db.prepare('INSERT INTO marker_collections (marker_id, collection_id, position) VALUES (?, ?, ?)').run(newId, link.id, taken ? null : link.position)
    }
    const remap = markerId => markerId === s.marker.id ? newId : markerId
    const inTrip = (markerId, collectionId) => !!db.prepare('SELECT 1 FROM marker_collections m JOIN collections c ON c.id=m.collection_id WHERE m.marker_id=? AND m.collection_id=? AND c.is_trip=1').get(markerId, collectionId)
    for (const seg of s.segments) {
      const from = remap(seg.from_marker_id), to = remap(seg.to_marker_id)
      if (inTrip(from, seg.collection_id) && inTrip(to, seg.collection_id)) {
        db.prepare('INSERT OR IGNORE INTO trip_waypoints (collection_id, from_marker_id, to_marker_id, mode, via_points) VALUES (?, ?, ?, ?, ?)').run(seg.collection_id, from, to, seg.mode, seg.via_points)
      }
    }
    for (const personId of s.address_of) db.prepare('UPDATE persons SET address_marker_id=? WHERE id=? AND address_marker_id IS NULL').run(newId, personId)
    db.prepare('DELETE FROM deleted_markers WHERE id=?').run(id)
    return getMarkers([newId])[0]
  })
}

export function deleteFromTrash(id) {
  if (!db.prepare('DELETE FROM deleted_markers WHERE id=?').run(id).changes) throw Object.assign(new Error('Not in trash'), { status: 404 })
}

export function emptyTrash() {
  db.exec('DELETE FROM deleted_markers')
}
