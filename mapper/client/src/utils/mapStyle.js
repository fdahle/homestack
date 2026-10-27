export const COLOR_MODES = [
  { value: 'marker', label: 'Marker' }, { value: 'collection', label: 'Collection' },
  { value: 'person', label: 'Person' }, { value: 'category', label: 'Category' },
]
export function safeHex(color) { return /^#[\da-f]{6}$/i.test(color) ? color : '#6c757d' }
export function markerColors(marker, mode = 'category') {
  const key = { category: 'categories', collection: 'collections', person: 'persons' }[mode]
  const colors = key ? (marker[key] ?? []).map(item => item.color).filter(Boolean) : [marker.color]
  return colors.length ? colors.slice(0, 4).map(safeHex) : ['#6c757d']
}
export function tooltipText(label) {
  const element = document.createElement('span')
  element.textContent = label
  return element
}
export const TILES = {
  osm: { label: 'OSM', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', thumb: 'https://tile.openstreetmap.org/12/2074/1410.png' },
  // The German OSM style adds a Latin transliteration to names in other scripts (Tokyo, Beijing, …).
  'osm-de': { label: 'OSM Latin', url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, style <a href="https://www.openstreetmap.de">OSM Germany</a>', thumb: 'https://tile.openstreetmap.de/12/2074/1410.png' },
  // Replaces CARTO Voyager, which now needs an API key.
  street: { label: 'Street', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles &copy; Esri', thumb: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/12/1410/2074' },
  topo: { label: 'Topo', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>', thumb: 'https://a.tile.opentopomap.org/12/2074/1410.png' },
  satellite: { label: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles &copy; Esri', thumb: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/12/1410/2074' },
}
// Saved settings can name a layer that no longer exists (the CARTO ones were removed).
export function validTileKey(key) {
  return TILES[key] ? key : 'osm'
}
export function tileOptions(key) {
  return { ...TILES[key] ?? TILES.osm, maxNativeZoom: key === 'topo' ? 17 : 19, maxZoom: key === 'topo' ? 17 : 21 }
}
