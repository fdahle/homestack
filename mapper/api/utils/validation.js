import { validDate, validateDates, parseDate } from '../../shared/dates.js'
import { validLatLng } from '../../shared/markers.js'

export function invalid(message) {
  return Object.assign(new Error(message), { status: 400 })
}
export function requireObject(value, label = 'Data') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(`${label} must be an object`)
}
export function validId(id) { return Number.isSafeInteger(id) && id > 0 }
export function validatePosition(position) {
  if (position != null && !validId(position)) throw invalid('Stop positions must be positive integers or null')
}
// `only` limits validation to the given fields, so stored legacy values cannot block unrelated edits.
export function validateMarker(marker, only = null) {
  requireObject(marker, 'Marker')
  const check = field => !only || only.has(field)
  if ((check('lat') || check('lng')) && !validLatLng(marker.lat, marker.lng)) throw invalid('Latitude/longitude are out of range')
  for (const field of ['label', 'description', 'image_url', 'address', 'country', 'color', 'external_url', 'source']) {
    if (check(field) && marker[field] != null && typeof marker[field] !== 'string') throw invalid(`${field} must be text`)
  }
  for (const field of ['visited_at', 'planned_at']) {
    if (check(field) && marker[field] && !(field === 'visited_at' && marker[field] === 'yes') && !validDate(marker[field])) throw invalid(`${field} must be a valid date`)
  }
  if (check('rating') && marker.rating != null && (!Number.isInteger(marker.rating) || marker.rating < 1 || marker.rating > 5)) throw invalid('Rating must be between 1 and 5')
  for (const field of ['is_favorite', 'use_coords']) {
    if (check(field) && marker[field] != null && ![true, false, 0, 1].includes(marker[field])) throw invalid(`${field} must be a boolean`)
  }
  if (check('color') && marker.color && !/^#[\da-f]{6}$/i.test(marker.color)) throw invalid('Color must be a six-digit hex color')
  for (const field of ['image_url', 'external_url']) {
    if (check(field) && marker[field]) {
      let url
      try { url = new URL(marker[field]) } catch { throw invalid(`${field} must be an HTTP(S) URL`) }
      if (!['http:', 'https:'].includes(url.protocol)) throw invalid(`${field} must be an HTTP(S) URL`)
    }
  }
}

// Repairs value formats stored before validation existed (short colors, scheme-less URLs,
// timestamps or dd.mm.yyyy dates). Unrepairable values are kept unless `dropInvalid` is set.
// Mutates and returns the marker.
export function normalizeLegacyMarker(marker, { dropInvalid = false } = {}) {
  const fix = (field, value, fallback = null) => {
    if (value != null) marker[field] = value
    else if (dropInvalid) marker[field] = fallback
  }
  for (const field of ['label', 'description', 'image_url', 'address', 'country', 'color', 'external_url', 'source']) {
    if (marker[field] != null && typeof marker[field] !== 'string') marker[field] = String(marker[field])
  }
  if (marker.color && !/^#[\da-f]{6}$/i.test(marker.color)) {
    const short = /^#?([\da-f])([\da-f])([\da-f])$/i.exec(marker.color)
    const long = /^#?([\da-f]{6})$/i.exec(marker.color)
    fix('color', short ? '#' + short.slice(1).map(c => c + c).join('') : long ? '#' + long[1] : null)
  }
  for (const field of ['image_url', 'external_url']) {
    const value = marker[field]?.trim()
    if (!value) { if (marker[field] != null) marker[field] = null; continue }
    const httpUrl = candidate => { try { return ['http:', 'https:'].includes(new URL(candidate).protocol) } catch { return false } }
    if (httpUrl(value)) continue
    fix(field, /^[\w-]+(\.[\w-]+)+([/?#]|$)/.test(value) && httpUrl('https://' + value) ? 'https://' + value : null)
  }
  for (const field of ['visited_at', 'planned_at']) {
    const value = marker[field]
    if (!value || (field === 'visited_at' && value === 'yes') || validDate(value)) continue
    const repaired = typeof value === 'string' ? (validDate(value.slice(0, 10)) ? value.slice(0, 10) : parseDate(value)) : null
    fix(field, repaired || null, field === 'visited_at' ? 'yes' : null)
  }
  if (marker.rating != null && !(Number.isInteger(marker.rating) && marker.rating >= 1 && marker.rating <= 5)) {
    const rating = Math.round(Number(marker.rating))
    fix('rating', rating >= 1 && rating <= 5 ? rating : null)
  }
  for (const field of ['is_favorite', 'use_coords']) if (marker[field] != null) marker[field] = marker[field] ? 1 : 0
  return marker
}

export function validateSegment(segment) {
  requireObject(segment, 'Segment')
  if (!['walk', 'hike', 'bike', 'drive'].includes(segment.mode)) throw invalid('Invalid transport mode')
  if (!Array.isArray(segment.via_points) || segment.via_points.length > 100 || segment.via_points.some(p => !p || !validLatLng(p.lat, p.lng))) throw invalid('Waypoints must contain valid coordinates (maximum 100)')
}

export function validateCollection(collection) {
  requireObject(collection, 'Collection')
  if (typeof collection.name !== 'string' || !collection.name.trim()) throw invalid('Name required')
  if (collection.description != null && typeof collection.description !== 'string') throw invalid('Description must be text')
  if (collection.color && !/^#[\da-f]{6}$/i.test(collection.color)) throw invalid('Invalid color')
  for (const field of ['is_trip', 'show_route_line', 'show_exact_route']) {
    if (collection[field] != null && ![0, 1, true, false].includes(collection[field])) throw invalid(`${field} must be a boolean`)
  }
  const error = validateDates(collection.start_date, collection.end_date)
  if (error) throw invalid(error)
}

export function validateShare(body) {
  requireObject(body, 'Share link')
  if (body.name != null && typeof body.name !== 'string') throw invalid('Name must be text')
  if (body.password != null && (typeof body.password !== 'string' || Buffer.byteLength(body.password) > 72)) throw invalid('Password must be text and at most 72 bytes')
  if (body.expiresAt && (typeof body.expiresAt !== 'string' || !validDate(body.expiresAt.slice(0, 10)) || !Number.isFinite(Date.parse(body.expiresAt)))) throw invalid('Expiry must be a valid date')
  if (body.filter !== undefined) requireObject(body.filter, 'Filter')
}

