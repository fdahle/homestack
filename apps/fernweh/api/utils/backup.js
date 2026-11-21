import { MARKER_BACKUP_FIELDS } from '../../shared/markers.js'
import { invalid, normalizeLegacyMarker, sqliteTimestamp, validId, validateCollection, validateColor, validateMarker, validatePosition, validateSegment } from './validation.js'

export { MARKER_BACKUP_FIELDS }
// Validates a backup before restore. Repairs legacy values (marker fields, timestamps, duplicate
// stop numbers) and drops stale trip segments in place.
export function validateBackup(data) {
  if (data?.type !== 'backup' || !Array.isArray(data.markers) || (data.version != null && ![1, 2].includes(data.version))) throw invalid('Unsupported backup file')
  const groups = {}
  for (const key of ['markers', 'categories', 'collections', 'persons']) {
    const rows = data[key] ?? []
    if (!Array.isArray(rows)) throw invalid(`${key} must be an array`)
    groups[key] = new Map()
    rows.forEach((row, index) => {
      const where = `${key} #${index + 1}`
      if (!row || typeof row !== 'object' || !validId(row.id) || groups[key].has(row.id)) throw invalid(`Invalid or duplicate ID in ${where}`)
      groups[key].set(row.id, row)
      try {
        if (key === 'markers') validateMarker(normalizeLegacyMarker(row))
        else if (key === 'collections') validateCollection(row)
        else {
          if (typeof row.name !== 'string' || !row.name.trim()) throw invalid('Name required')
          validateColor(row.color)
          for (const field of ['first_name', 'last_name']) if (key === 'persons' && row[field] != null && typeof row[field] !== 'string') throw invalid(`${field} must be text`)
        }
        for (const field of ['created_at', 'updated_at']) row[field] = sqliteTimestamp(row[field])
      } catch (err) { throw invalid(`${where}${key === 'markers' ? ` (${row.label || 'unnamed'})` : ''}: ${err.message}`) }
    })
  }
  const firstStop = new Map()
  for (const marker of data.markers) {
    for (const [key, target] of [['category_ids', 'categories'], ['person_ids', 'persons']]) {
      if (marker[key] != null && (!Array.isArray(marker[key]) || marker[key].some(id => !groups[target].has(id)))) throw invalid(`Unknown ${key} on marker ${marker.label || marker.id}`)
    }
    if (marker.collection_links != null && !Array.isArray(marker.collection_links)) throw invalid('Invalid collection links')
    const seen = new Set()
    for (const link of marker.collection_links ?? []) {
      if (!link || !groups.collections.has(link.id) || seen.has(link.id)) throw invalid(`Invalid collection link on marker ${marker.label || marker.id}`)
      seen.add(link.id)
      validatePosition(link.position)
      const key = `${link.id}-${link.position}`
      if (link.position != null && !(firstStop.get(key) < marker.id)) firstStop.set(key, marker.id)
    }
  }
  // Exports from before stop numbers were validated may repeat one; like migration 4, the lowest marker ID keeps it.
  for (const marker of data.markers) {
    for (const link of marker.collection_links ?? []) if (link.position != null && firstStop.get(`${link.id}-${link.position}`) !== marker.id) link.position = null
  }
  for (const person of groups.persons.values()) if (person.address_marker_id != null && !groups.markers.has(person.address_marker_id)) throw invalid('Person address marker is missing')
  if (data.trip_waypoints != null && !Array.isArray(data.trip_waypoints)) throw invalid('Invalid trip waypoints')
  const segments = new Set()
  const inTrip = (markerId, collectionId) => groups.markers.get(markerId)?.collection_links?.some(c => c.id === collectionId)
  data.trip_waypoints = (data.trip_waypoints ?? []).filter(row => {
    if (!row || typeof row !== 'object') throw invalid('Invalid trip segment')
    let points
    try { points = typeof row.via_points === 'string' ? JSON.parse(row.via_points) : row.via_points ?? [] } catch { throw invalid('Invalid waypoint JSON') }
    validateSegment({ mode: row.mode ?? 'walk', via_points: points })
    // Segments left behind by un-tripped collections or removed stops are harmless; skip them.
    if (!groups.collections.get(row.collection_id)?.is_trip || row.from_marker_id === row.to_marker_id || !inTrip(row.from_marker_id, row.collection_id) || !inTrip(row.to_marker_id, row.collection_id)) return false
    const key = `${row.collection_id}-${row.from_marker_id}-${row.to_marker_id}`
    if (segments.has(key)) throw invalid('Duplicate trip segment')
    segments.add(key)
    return true
  })
}
