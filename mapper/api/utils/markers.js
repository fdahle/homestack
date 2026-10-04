import db from '../db.js'
import { MARKER_FIELDS, MARKER_BACKUP_FIELDS } from '../../shared/markers.js'
import { invalid, requireObject, validId, validateMarker, validatePosition } from './validation.js'
import { transaction } from './transaction.js'

export function getMarkers(ids = null) {
  const params = ids === null ? [] : [JSON.stringify(ids)]
  const where = field => ids === null ? '' : ` WHERE ${field} IN (SELECT value FROM json_each(?))`
  const markers = db.prepare('SELECT * FROM markers' + where('id') + ' ORDER BY created_at DESC, id DESC').all(...params)
  const byId = new Map(markers.map(m => [m.id, { ...m, categories: [], collections: [], persons: [] }]))
  for (const [table, junction, fk] of [['categories', 'marker_categories', 'category_id'], ['collections', 'marker_collections', 'collection_id'], ['persons', 'marker_persons', 'person_id']]) {
    const position = table === 'collections' ? ', j.position' : ''
    for (const { marker_id, ...entity } of db.prepare(`SELECT j.marker_id, e.*${position} FROM ${table} e JOIN ${junction} j ON e.id=j.${fk}` + where('j.marker_id')).all(...params)) byId.get(marker_id)?.[table].push(entity)
  }
  return [...byId.values()]
}

const pick = (value, fields) => Object.fromEntries(fields.map(key => [key, value[key]]))
export function publicMarker(marker) {
  return {
    ...pick(marker, MARKER_BACKUP_FIELDS),
    categories: marker.categories.map(c => pick(c, ['id', 'name', 'color', 'created_at'])),
    collections: marker.collections.map(c => pick(c, ['id', 'name', 'description', 'color', 'start_date', 'end_date', 'is_trip', 'show_route_line', 'show_exact_route', 'created_at', 'position'])),
    persons: marker.persons.map(p => pick(p, ['id', 'name', 'first_name', 'last_name', 'color', 'created_at'])),
  }
}

function relations(body, existingId) {
  const result = {}
  for (const [key, table, junction, fk] of [['category_ids', 'categories', 'marker_categories', 'category_id'], ['collection_ids', 'collections', 'marker_collections', 'collection_id'], ['person_ids', 'persons', 'marker_persons', 'person_id']]) {
    let ids = body[key]
    if (ids === undefined) ids = existingId ? db.prepare(`SELECT ${fk} AS id FROM ${junction} WHERE marker_id=?`).all(existingId).map(r => r.id) : []
    if (!Array.isArray(ids) || ids.some(id => !validId(id) || !db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id))) throw invalid(`Invalid ${key}`)
    result[key] = [...new Set(ids)]
  }
  const oldPositions = existingId ? Object.fromEntries(db.prepare('SELECT collection_id, position FROM marker_collections WHERE marker_id=?').all(existingId).map(r => [r.collection_id, r.position])) : {}
  const supplied = body.collection_positions ?? {}
  requireObject(supplied, 'Collection positions')
  for (const id of Object.keys(supplied)) if (!result.collection_ids.includes(Number(id))) throw invalid('Position belongs to an unselected collection')
  result.collection_positions = {}
  for (const id of result.collection_ids) {
    const position = Object.hasOwn(supplied, id) ? supplied[id] : oldPositions[id] ?? null
    validatePosition(position)
    if (position != null && db.prepare('SELECT is_trip FROM collections WHERE id=?').get(id).is_trip) {
      if (db.prepare('SELECT marker_id FROM marker_collections WHERE collection_id=? AND position=? AND marker_id != ?').get(id, position, existingId ?? -1)) throw invalid(`Stop #${position} is already used in this trip`)
    }
    result.collection_positions[id] = position
  }
  return result
}

export function saveMarker(body, id = null) {
  return transaction(db, () => {
    requireObject(body, 'Marker')
    const existing = id == null ? {} : db.prepare('SELECT * FROM markers WHERE id=?').get(id)
    if (!existing) throw Object.assign(new Error('Marker not found'), { status: 404 })
    const data = { ...existing, ...Object.fromEntries(MARKER_FIELDS.filter(k => Object.hasOwn(body, k)).map(k => [k, body[k]])) }
    validateMarker(data)
    const links = relations(body, id)
    for (const field of MARKER_FIELDS) data[field] ??= null
    data.source ||= 'manual'
    data.is_favorite = data.is_favorite ? 1 : 0
    data.use_coords = data.use_coords ? 1 : 0
    const values = MARKER_FIELDS.map(f => data[f])
    if (id == null) id = db.prepare(`INSERT INTO markers (${MARKER_FIELDS.join(',')}, updated_at) VALUES (${MARKER_FIELDS.map(() => '?').join(',')}, datetime('now'))`).run(...values).lastInsertRowid
    else db.prepare(`UPDATE markers SET ${MARKER_FIELDS.map(f => f + '=?').join(',')}, category_id=NULL, updated_at=datetime('now') WHERE id=?`).run(...values, id)
    for (const [key, junction, fk] of [['category_ids', 'marker_categories', 'category_id'], ['collection_ids', 'marker_collections', 'collection_id'], ['person_ids', 'marker_persons', 'person_id']]) {
      db.prepare(`DELETE FROM ${junction} WHERE marker_id=?`).run(id)
      for (const linkedId of links[key]) {
        if (key === 'collection_ids') db.prepare('INSERT INTO marker_collections (marker_id,collection_id,position) VALUES (?,?,?)').run(id, linkedId, links.collection_positions[linkedId])
        else db.prepare(`INSERT INTO ${junction} (marker_id,${fk}) VALUES (?,?)`).run(id, linkedId)
      }
    }
    db.prepare(`DELETE FROM trip_waypoints WHERE (from_marker_id=? OR to_marker_id=?) AND NOT EXISTS (SELECT 1 FROM marker_collections WHERE marker_id=? AND collection_id=trip_waypoints.collection_id)`).run(id, id, id)
    return getMarkers([Number(id)])[0]
  })
}
