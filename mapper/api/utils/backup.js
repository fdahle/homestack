import { MARKER_BACKUP_FIELDS } from '../../shared/markers.js'
import { validateDates } from '../../shared/dates.js'
import { invalid, normalizeLegacyMarker, validId, validateMarker, validatePosition, validateSegment } from './validation.js'

export { MARKER_BACKUP_FIELDS }
// Validates a backup before restore. Repairs legacy marker values and drops stale trip segments in place.
export function validateBackup(data) {
  if (data?.type !== 'backup' || !Array.isArray(data.markers) || (data.version != null && ![1, 2].includes(data.version))) throw invalid('Unsupported backup file')
  const groups = {}
  for (const key of ['markers', 'categories', 'collections', 'persons']) {
    const rows = data[key] ?? []
    if (!Array.isArray(rows)) throw invalid(`${key} must be an array`)
    groups[key] = new Map()
    rows.forEach((row, index) => {
      const where = `${key} #${index + 1}`
      if (!row || !validId(row.id) || groups[key].has(row.id)) throw invalid(`Invalid or duplicate ID in ${where}`)
      groups[key].set(row.id, row)
      if (key === 'markers') {
        try { validateMarker(normalizeLegacyMarker(row)) } catch (err) { throw invalid(`${where} (${row.label || 'unnamed'}): ${err.message}`) }
      } else {
        if (typeof row.name !== 'string' || !row.name.trim()) throw invalid(`Name required in ${where}`)
        if (row.color && !/^#[\da-f]{6}$/i.test(row.color)) throw invalid(`Invalid color in ${where}`)
        if (key === 'collections') {
          const error = validateDates(row.start_date, row.end_date)
          if (error) throw invalid(`${where}: ${error}`)
          for (const field of ['is_trip', 'show_route_line', 'show_exact_route']) if (row[field] != null && ![0,1,true,false].includes(row[field])) throw invalid(`Invalid ${field} in ${where}`)
        }
      }
    })
  }
  const positions = new Set()
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
      if (groups.collections.get(link.id).is_trip && link.position != null) {
        const key = `${link.id}-${link.position}`
        if (positions.has(key)) throw invalid(`Duplicate trip stop #${link.position} in ${groups.collections.get(link.id).name}`)
        positions.add(key)
      }
    }
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
