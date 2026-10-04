import db from '../db.js'
import { transaction } from './transaction.js'
import { invalid, validId, validatePosition, validateSegment } from './validation.js'

export function saveTrip(collectionId, positions, segments = []) {
  return transaction(db, () => {
    const collection = db.prepare('SELECT * FROM collections WHERE id=?').get(collectionId)
    if (!collection) throw Object.assign(new Error('Collection not found'), { status: 404 })
    if (!collection.is_trip) throw invalid('Not a trip')
    const members = new Map(db.prepare('SELECT marker_id, position FROM marker_collections WHERE collection_id=?').all(collectionId).map(r => [r.marker_id, r.position]))
    if (positions !== undefined) {
      if (!Array.isArray(positions)) throw invalid('Positions must be an array')
      const submitted = new Set()
      for (const row of positions) {
        if (!row || !validId(row.marker_id) || !members.has(row.marker_id) || submitted.has(row.marker_id)) throw invalid('Invalid or duplicate trip marker')
        submitted.add(row.marker_id)
        validatePosition(row.position)
        members.set(row.marker_id, row.position ?? null)
      }
      const used = new Set()
      for (const pos of members.values()) {
        if (pos == null) continue
        if (used.has(pos)) throw invalid(`Stop #${pos} is already used in this trip`)
        used.add(pos)
      }
    }
    if (!Array.isArray(segments) || segments.length > 1000) throw invalid('Invalid segments')
    const seen = new Set()
    for (const seg of segments) {
      validateSegment(seg)
      if (!members.has(seg.from_marker_id) || !members.has(seg.to_marker_id) || seg.from_marker_id === seg.to_marker_id) throw invalid('Segment endpoints must be distinct markers in this trip')
      const key = `${seg.from_marker_id}-${seg.to_marker_id}`
      if (seen.has(key)) throw invalid('Duplicate segment')
      seen.add(key)
    }
    for (const [id, position] of members) db.prepare('UPDATE marker_collections SET position=? WHERE collection_id=? AND marker_id=?').run(position, collectionId, id)
    for (const seg of segments) db.prepare(`INSERT INTO trip_waypoints (collection_id,from_marker_id,to_marker_id,mode,via_points) VALUES (?,?,?,?,?) ON CONFLICT(collection_id,from_marker_id,to_marker_id) DO UPDATE SET mode=excluded.mode,via_points=excluded.via_points`).run(collectionId, seg.from_marker_id, seg.to_marker_id, seg.mode, JSON.stringify(seg.via_points))
    return { ok: true }
  })
}
