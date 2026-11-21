import { ref } from 'vue'
import { nominatim } from '../utils/nominatim.js'
import { searchMarkers } from '../utils/markerSearch.js'
import { findGoogleMapsLink, resolveGoogleMapsPlace } from '../utils/googleMaps.js'

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
// onSharedPlace: optional ({ lat, lng, name, approximate }) => void — enables pasting Google Maps
//   links (they are expanded by the API, so only for the signed-in owner)
export function useSearch(getMap, getMarkers, onMarkerSelect, onSharedPlace) {
  const searchQuery = ref('')
  const searchResults = ref([])
  const searchOpen = ref(false)
  const searchLoading = ref(false)
  const searchError = ref(null)
  const searchJustClosed = ref(false)
  // Address lookups run on Enter: Nominatim's usage policy forbids search-as-you-type.
  const searchSubmitted = ref(false)
  let controller = null
  let requestId = 0
  let localResults = []
  function cancelPending() {
    requestId++
    controller?.abort()
    controller = null
    searchLoading.value = false
  }
  function clearSearch() {
    cancelPending()
    searchQuery.value = ''
    searchResults.value = []
    searchError.value = null
    searchOpen.value = false
    searchSubmitted.value = false
  }

  function buildMarkerResults(q) {
    if (!getMarkers) return []
    return searchMarkers(getMarkers(), q, 5)
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
    cancelPending()
    searchError.value = null
    searchSubmitted.value = false
    searchOpen.value = true
    const q = searchQuery.value.trim()
    localResults = []
    if (!q) { searchResults.value = []; searchLoading.value = false; return }

    if (onSharedPlace && findGoogleMapsLink(q)) {
      searchResults.value = [{ place_id: '__gmaps__', display_name: 'Open this Google Maps place', _gmaps: true }]
      return
    }

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

    // Local marker matches appear while typing; places are looked up on Enter.
    localResults = buildMarkerResults(q)
    searchResults.value = localResults
  }

  async function onSearchSubmit() {
    const q = searchQuery.value.trim()
    if (!q) return
    if (q.match(COORD_RE) && searchResults.value[0]?._coord) return selectResult(searchResults.value[0])
    if (searchResults.value[0]?._gmaps) return openSharedLink(q)
    cancelPending()
    const currentId = requestId
    searchOpen.value = true
    searchError.value = null
    searchLoading.value = true
    controller = new AbortController()
    try {
      const results = await nominatim('search', { q, limit: 7, addressdetails: 1 }, { signal: controller.signal })
      if (currentId !== requestId) return
      searchResults.value = [...localResults, ...results]
    } catch {
      if (currentId !== requestId) return
      searchResults.value = [...localResults]
      searchError.value = 'Search is temporarily unavailable — the geocoding service didn’t respond.'
    }
    searchSubmitted.value = true
    searchLoading.value = false
  }

  function onSearchBlur() {
    if (searchOpen.value && (searchResults.value.length > 0 || searchQuery.value.trim())) {
      searchJustClosed.value = true
      setTimeout(() => { searchJustClosed.value = false }, 400)
    }
    setTimeout(() => { searchOpen.value = false }, 150)
  }

  // Moves the map to a place shared from Google Maps and hands it on; text may contain more than the link.
  async function openSharedLink(text) {
    cancelPending()
    const currentId = requestId
    searchOpen.value = true
    searchError.value = null
    searchResults.value = []
    searchLoading.value = true
    controller = new AbortController()
    try {
      const place = await resolveGoogleMapsPlace(text, { signal: controller.signal })
      if (currentId !== requestId) return
      searchLoading.value = false
      searchOpen.value = false
      searchQuery.value = place.name || `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`
      getMap()?.setView([place.lat, place.lng], place.approximate ? 17 : 18)
      onSharedPlace(place)
    } catch (err) {
      if (currentId !== requestId || err.name === 'AbortError') return
      searchLoading.value = false
      searchSubmitted.value = true
      searchError.value = err.status === 401 ? 'Sign in again to open Google Maps links.' : err.message
    }
  }

  function selectResult(r) {
    if (r._gmaps) return openSharedLink(searchQuery.value)
    cancelPending()
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
    cancelPending()
  }

  return { searchQuery, searchResults, searchOpen, searchLoading, searchError, searchJustClosed, searchSubmitted, onSearchInput, onSearchSubmit, onSearchBlur, selectResult, openSharedLink, clearSearch, cleanup }
}
