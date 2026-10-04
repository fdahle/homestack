import { MARKER_BACKUP_FIELDS } from '../../shared/markers.js'
import { validateDates } from '../../shared/dates.js'
import { invalid, validId, validateMarker, validatePosition, validateSegment } from './validation.js'

export { MARKER_BACKUP_FIELDS }
export function validateBackup(data) {
  if (data?.type !== 'backup' || !Array.isArray(data.markers) || (data.version != null && ![1, 2].includes(data.version))) throw invalid('Unsupported backup file')
  const groups = {}
  for (const key of ['markers', 'categories', 'collections', 'persons']) {
    const rows = data[key] ?? []
    if (!Array.isArray(rows)) throw invalid(`${key} must be an array`)
    groups[key] = new Map()
    for (const row of rows) {
      if (!row || !validId(row.id) || groups[key].has(row.id)) throw invalid(`Invalid or duplicate ${key} ID`)
      groups[key].set(row.id, row)
      if (key === 'markers') validateMarker(row)
      else {
        if (typeof row.name !== 'string' || !row.name.trim()) throw invalid(`${key} name required`)
        if (row.color && !/^#[\da-f]{6}$/i.test(row.color)) throw invalid('Invalid color')
        if (key === 'collections') {
          const error = validateDates(row.start_date, row.end_date)
          if (error) throw invalid(error)
          for (const field of ['is_trip', 'show_route_line', 'show_exact_route']) if (row[field] != null && ![0,1,true,false].includes(row[field])) throw invalid(`Invalid ${field}`)
        }
      }
    }
  }
  const positions = new Set()
  for (const marker of data.markers) {
    for (const [key, target] of [['category_ids', 'categories'], ['person_ids', 'persons']]) {
      if (marker[key] != null && (!Array.isArray(marker[key]) || marker[key].some(id => !groups[target].has(id)))) throw invalid(`Unknown ${key}`)
    }
    if (marker.collection_links != null && !Array.isArray(marker.collection_links)) throw invalid('Invalid collection links')
    const seen = new Set()
    for (const link of marker.collection_links ?? []) {
      if (!link || !groups.collections.has(link.id) || seen.has(link.id)) throw invalid('Invalid collection link')
      seen.add(link.id)
      validatePosition(link.position)
      if (groups.collections.get(link.id).is_trip && link.position != null) {
        const key = `${link.id}-${link.position}`
        if (positions.has(key)) throw invalid('Duplicate trip stop')
        positions.add(key)
      }
    }
  }
  for (const person of groups.persons.values()) if (person.address_marker_id != null && !groups.markers.has(person.address_marker_id)) throw invalid('Person address marker is missing')
  if (data.trip_waypoints != null && !Array.isArray(data.trip_waypoints)) throw invalid('Invalid trip waypoints')
  const segments = new Set()
  for (const row of data.trip_waypoints ?? []) {
    if (!row || typeof row !== 'object') throw invalid('Invalid trip segment')
    const key = `${row.collection_id}-${row.from_marker_id}-${row.to_marker_id}`
    if (segments.has(key)) throw invalid('Duplicate trip segment')
    segments.add(key)
    let points
    try { points = typeof row.via_points === 'string' ? JSON.parse(row.via_points) : row.via_points ?? [] } catch { throw invalid('Invalid waypoint JSON') }
    validateSegment({ mode: row.mode ?? 'walk', via_points: points })
    if (!groups.collections.get(row.collection_id)?.is_trip || row.from_marker_id === row.to_marker_id) throw invalid('Invalid trip segment')
    for (const id of [row.from_marker_id, row.to_marker_id]) if (!groups.markers.get(id)?.collection_links?.some(c => c.id === row.collection_id)) throw invalid('Segment endpoint is not in the trip')
  }
}
