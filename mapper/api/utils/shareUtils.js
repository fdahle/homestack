import { getMarkers } from './markers.js'
import db from '../db.js'

const PUBLIC_MARKER_FIELDS = ['id', 'lat', 'lng', 'label', 'description', 'visited_at', 'color', 'image_url', 'address', 'country', 'use_coords', 'external_url']
const PUBLIC_GROUP_FIELDS = {
  categories: ['id', 'name', 'color'],
  collections: ['id', 'name', 'description', 'color', 'start_date', 'end_date', 'is_trip', 'show_route_line', 'show_exact_route'],
  persons: ['id', 'name', 'first_name', 'last_name', 'color'],
}
const pick = (value, fields) => Object.fromEntries(fields.map(key => [key, value[key]]))

export function parseShareFilter(json) {
  try {
    const filter = JSON.parse(json)
    return filter && typeof filter === 'object' ? filter : null
  } catch { return null }
}

export function resolveMarkerIds(filter) {
  if (filter.all) return db.prepare('SELECT id FROM markers').all().map(r => r.id)
  const ids = key => JSON.stringify(Array.isArray(filter[key]) ? filter[key].filter(Number.isInteger) : [])
  const linked = (junction, fk) => `EXISTS (SELECT 1 FROM ${junction} j WHERE j.marker_id = m.id AND j.${fk} IN (SELECT value FROM json_each(?)))`
  return db.prepare(`SELECT m.id FROM markers m WHERE ${linked('marker_categories', 'category_id')} OR ${linked('marker_collections', 'collection_id')} OR ${linked('marker_persons', 'person_id')} OR m.id IN (SELECT value FROM json_each(?))`)
    .all(ids('categories'), ids('collections'), ids('persons'), ids('markers')).map(r => r.id)
}

// A link reveals only the groups its filter selects, so private names and descriptions of other
// groups stay hidden. "All markers" includes every category and collection, but never persons.
function visibleGroups(filter) {
  const selected = key => new Set(Array.isArray(filter[key]) ? filter[key] : [])
  const everything = { has: () => true }
  return {
    categories: filter.all ? everything : selected('categories'),
    collections: filter.all ? everything : selected('collections'),
    persons: filter.all ? new Set() : selected('persons'),
  }
}

export function buildSharePayload(filter) {
  const visible = visibleGroups(filter)
  const raw = getMarkers(resolveMarkerIds(filter))
  const groups = { categories: new Map(), collections: new Map(), persons: new Map() }
  const markers = raw.map(marker => {
    const result = pick(marker, PUBLIC_MARKER_FIELDS)
    for (const key of ['categories', 'collections', 'persons']) {
      result[key] = marker[key].filter(group => visible[key].has(group.id)).map(group => {
        const shared = pick(group, PUBLIC_GROUP_FIELDS[key])
        groups[key].set(group.id, shared)
        return key === 'collections' ? { ...shared, position: group.position } : shared
      })
    }
    return result
  })
  return { markers, categories: [...groups.categories.values()], collections: [...groups.collections.values()], persons: [...groups.persons.values()], segments: tripSegments(markers) }
}

// Only legs between consecutive shared stops in the current order: legs left over from an older
// order or leading to an unshared stop would reveal places that are not part of the link.
function tripSegments(markers) {
  const stops = new Map()
  for (const marker of markers) {
    for (const c of marker.collections) if (c.is_trip && c.position != null) (stops.get(c.id) ?? stops.set(c.id, []).get(c.id)).push({ id: marker.id, position: c.position })
  }
  const legs = new Set()
  for (const [collectionId, list] of stops) {
    list.sort((a, b) => a.position - b.position)
    for (let i = 1; i < list.length; i++) legs.add(`${collectionId}-${list[i - 1].id}-${list[i].id}`)
  }
  if (!legs.size) return []
  return db.prepare('SELECT collection_id, from_marker_id, to_marker_id, mode, via_points FROM trip_waypoints WHERE collection_id IN (SELECT value FROM json_each(?))').all(JSON.stringify([...stops.keys()]))
    .filter(s => legs.has(`${s.collection_id}-${s.from_marker_id}-${s.to_marker_id}`))
    .map(s => {
      let via_points
      try { via_points = JSON.parse(s.via_points) } catch { via_points = [] }
      return { ...s, via_points }
    })
}
