import { ref } from 'vue'

const COORD_RE = /^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/

function zoomForResult(r) {
  const type = r.type
  const cls  = r.class
  if (['country', 'continent'].includes(type)) return 5
  if (['state', 'region', 'county', 'province'].includes(type)) return 8
  if (['city', 'municipality'].includes(type)) return 11
  if (['town', 'village', 'suburb', 'hamlet', 'borough', 'administrative'].includes(type)) return 13
  if (cls === 'highway' || ['road', 'residential', 'path', 'footway', 'pedestrian'].includes(type)) return 16
  return 17
}

// getMarkers: optional () => marker[]  — enables local marker search
// onMarkerSelect: optional (marker) => void — called when a marker result is chosen
export function useSearch(getMap, getMarkers, onMarkerSelect) {
  const searchQuery = ref('')
  const searchResults = ref([])
  const searchOpen = ref(false)
  const searchLoading = ref(false)
  const searchError = ref(null)
  const searchJustClosed = ref(false)
  let searchTimer = null

  function buildMarkerResults(q) {
    if (!getMarkers) return []
    const ql = q.toLowerCase()
    return getMarkers()
      .filter((m) =>
        (m.label || '').toLowerCase().includes(ql) ||
        (m.description || '').toLowerCase().includes(ql) ||
        (m.address || '').toLowerCase().includes(ql)
      )
      .slice(0, 3)
      .map((m) => ({
        place_id: `__marker__${m.id}`,
        display_name: m.label || `${Number(m.lat).toFixed(4)}, ${Number(m.lng).toFixed(4)}`,
        lat: String(m.lat),
        lon: String(m.lng),
        _marker: true,
        _markerObj: m,
      }))
  }

  function onSearchInput() {
    clearTimeout(searchTimer)
    searchError.value = null
    const q = searchQuery.value.trim()
    if (!q) { searchResults.value = []; searchLoading.value = false; return }

    // Coordinate shortcut — no network request needed
    const coordMatch = q.match(COORD_RE)
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1])
      const lon = parseFloat(coordMatch[2])
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        searchResults.value = [{
          place_id: '__coord__',
          display_name: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
          lat: String(lat),
          lon: String(lon),
          _coord: true,
        }]
        searchLoading.value = false
        return
      }
    }

    // Show local marker matches immediately while geocoding request is in-flight
    const markerResults = buildMarkerResults(q)
    searchResults.value = markerResults

    searchLoading.value = true
    searchTimer = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=7&addressdetails=1`
        )
        if (!res.ok) throw new Error(`Nominatim ${res.status}`)
        searchResults.value = [...markerResults, ...await res.json()]
      } catch {
        searchResults.value = [...markerResults]
        searchError.value = 'Search is temporarily unavailable — the geocoding service didn’t respond.'
      }
      searchLoading.value = false
    }, 400)
  }

  function onSearchBlur() {
    if (searchOpen.value && (searchResults.value.length > 0 || searchQuery.value.trim())) {
      searchJustClosed.value = true
      setTimeout(() => { searchJustClosed.value = false }, 400)
    }
    setTimeout(() => { searchOpen.value = false }, 150)
  }

  function selectResult(r) {
    const map = getMap()
    if (map) {
      const zoom = r._coord ? 16 : r._marker ? Math.max(map.getZoom(), 14) : zoomForResult(r)
      map.setView([parseFloat(r.lat), parseFloat(r.lon)], zoom)
    }
    if (r._marker && onMarkerSelect) onMarkerSelect(r._markerObj)
    searchQuery.value = r.display_name
    searchResults.value = []
    searchOpen.value = false
    return { lat: parseFloat(r.lat), lng: parseFloat(r.lon) }
  }

  function cleanup() {
    clearTimeout(searchTimer)
  }

  return { searchQuery, searchResults, searchOpen, searchLoading, searchError, searchJustClosed, onSearchInput, onSearchBlur, selectResult, cleanup }
}
