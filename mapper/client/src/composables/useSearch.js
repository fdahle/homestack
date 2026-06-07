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

export function useSearch(getMap) {
  const searchQuery = ref('')
  const searchResults = ref([])
  const searchOpen = ref(false)
  const searchLoading = ref(false)
  let searchTimer = null

  function onSearchInput() {
    clearTimeout(searchTimer)
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

    searchLoading.value = true
    searchTimer = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=7&addressdetails=1`
        )
        searchResults.value = await res.json()
      } catch { searchResults.value = [] }
      searchLoading.value = false
    }, 400)
  }

  function onSearchBlur() {
    setTimeout(() => { searchOpen.value = false }, 150)
  }

  function selectResult(r) {
    const map = getMap()
    if (map) {
      const zoom = r._coord ? 16 : zoomForResult(r)
      map.setView([parseFloat(r.lat), parseFloat(r.lon)], zoom)
    }
    searchQuery.value = r.display_name
    searchResults.value = []
    searchOpen.value = false
    return { lat: parseFloat(r.lat), lng: parseFloat(r.lon) }
  }

  function cleanup() {
    clearTimeout(searchTimer)
  }

  return { searchQuery, searchResults, searchOpen, searchLoading, onSearchInput, onSearchBlur, selectResult, cleanup }
}
