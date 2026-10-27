export const MARKER_FIELDS = ['lat', 'lng', 'label', 'description', 'visited_at', 'planned_at', 'color', 'image_url', 'address', 'country', 'rating', 'is_favorite', 'use_coords', 'external_url', 'source']
export const MARKER_BACKUP_FIELDS = ['id', ...MARKER_FIELDS, 'created_at', 'updated_at']

export function markerFields(marker) {
  return Object.fromEntries(MARKER_FIELDS.filter(key => Object.hasOwn(marker, key)).map(key => [key, marker[key]]))
}

export function validLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}
