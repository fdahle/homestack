import { ref } from 'vue'
import L from 'leaflet'

const PIN_ICON = L.divIcon({
  className: '',
  html: `<svg width="22" height="32" viewBox="0 0 22 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11 0C4.9 0 0 4.9 0 11c0 8.25 11 21 11 21S22 19.25 22 11C22 4.9 17.1 0 11 0z" fill="#4a9eff"/>
    <circle cx="11" cy="11" r="4.5" fill="white"/>
  </svg>`,
  iconSize: [22, 32],
  iconAnchor: [11, 32],
})

const SETTINGS_KEY = 'mapper_settings'
const DEFAULT_EXCLUDED = ['waste_basket', 'bench']

function getExcludedAmenities() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return new Set(s.excludedAmenities ?? DEFAULT_EXCLUDED)
  } catch {
    return new Set(DEFAULT_EXCLUDED)
  }
}

function getPoiRadius() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}').poiRadius ?? 25
  } catch { return 25 }
}

const POI_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'historic']

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function elementToPoiShape(el) {
  const t = el.tags || {}
  const categoryKey = POI_KEYS.find(k => t[k])
  return {
    id: el.id,
    osmType: el.type,
    name: t.name || null,
    categoryKey,
    categoryValue: categoryKey ? t[categoryKey] : null,
    tags: t,
    lat: el.lat ?? el.center?.lat,
    lon: el.lon ?? el.center?.lon,
  }
}

// Mirrors are tried in order: the main instance returns 504/429 when overloaded,
// so we fall back to alternates before giving up.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

async function runOverpassQuery(query, signal) {
  let lastError = null
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, { method: 'POST', body: query, signal })
      if (!res.ok) {
        // 504/429/5xx → server busy; try the next mirror
        lastError = new Error(`Overpass ${res.status}`)
        continue
      }
      return await res.json()
    } catch (err) {
      if (err.name === 'AbortError') throw err
      lastError = err
    }
  }
  throw lastError ?? new Error('Overpass request failed')
}

async function fetchOverpassPoi(lat, lon, signal) {
  const r = getPoiRadius()
  const query = `[out:json][timeout:8];
(
  is_in(${lat},${lon})->.a;
  way(pivot.a)["tourism"];
  way(pivot.a)["leisure"];
  way(pivot.a)["amenity"];
  way(pivot.a)["shop"];
  relation(pivot.a)["tourism"];
  relation(pivot.a)["leisure"];
  relation(pivot.a)["amenity"];
  relation(pivot.a)["historic"];
);
out tags center;
(
  node["amenity"](around:${r},${lat},${lon});
  node["shop"](around:${r},${lat},${lon});
  node["tourism"](around:${r},${lat},${lon});
  node["leisure"](around:${r},${lat},${lon});
  node["historic"](around:${r},${lat},${lon});
  way["amenity"](around:${r},${lat},${lon});
  way["shop"](around:${r},${lat},${lon});
  way["tourism"](around:${r},${lat},${lon});
  way["leisure"](around:${r},${lat},${lon});
  way["historic"](around:${r},${lat},${lon});
);
out tags center 30;`

  const data = await runOverpassQuery(query, signal)
  if (!data.elements?.length) return null

  const excluded = getExcludedAmenities()

  const seen = new Set()
  const uniqueElements = data.elements.filter(el => {
    const key = `${el.type}/${el.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const candidates = uniqueElements
    .map(el => {
      const elLat = el.lat ?? el.center?.lat
      const elLon = el.lon ?? el.center?.lon
      if (elLat == null || !el.tags) return null
      if (!POI_KEYS.some(k => el.tags[k])) return null
      if (excluded.has(el.tags.amenity)) return null
      const dist = haversineMeters(lat, lon, elLat, elLon)
      // Elements from is_in have their center far from the click (click is inside them)
      const isContaining = dist > r
      return { el, dist, isContaining }
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.isContaining !== b.isContaining) return a.isContaining ? -1 : 1
      return a.dist - b.dist
    })

  if (!candidates.length) return null
  const all = candidates.map(({ el }) => elementToPoiShape(el))
  return { best: all[0], all }
}

export function useLocationPanel(getMap) {
  const locationPanelOpen = ref(false)
  const locationLatLng = ref(null)
  const locationInfo = ref(null)
  const locationLoading = ref(false)
  const locationError = ref(null)
  const poiData = ref(null)
  const poiLoading = ref(false)
  const poiError = ref(null)
  const poiAlternatives = ref([])

  let locationLayer = null
  let clickPin = null
  let activeAbort = null
  let overpassTimer = null

  function clearTempLayers() {
    if (locationLayer) { locationLayer.remove(); locationLayer = null }
    if (clickPin) { clickPin.remove(); clickPin = null }
  }

  function drawLocationPolygon(geojson) {
    if (!geojson || geojson.type === 'Point') return
    const map = getMap()
    if (!map) return
    locationLayer = L.geoJSON(geojson, {
      style: { color: '#4a9eff', weight: 2, fillColor: '#4a9eff', fillOpacity: 0.12 },
    }).addTo(map)
  }

  async function openLocationPanel(latlng) {
    // Cancel any in-flight requests from a previous click
    if (activeAbort) activeAbort.abort()
    activeAbort = new AbortController()
    const { signal } = activeAbort

    clearTempLayers()
    const map = getMap()
    locationLatLng.value = latlng
    locationInfo.value = null
    locationError.value = null
    poiData.value = null
    poiError.value = null
    poiAlternatives.value = []
    locationLoading.value = true
    poiLoading.value = true
    locationPanelOpen.value = true

    if (map) {
      clickPin = L.marker([latlng.lat, latlng.lng], {
        icon: PIN_ICON,
        interactive: false,
        zIndexOffset: 1000,
      }).addTo(map)
    }

    // Nominatim: resolves first (~200ms) — update address immediately
    fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${latlng.lat}&lon=${latlng.lng}&format=json&addressdetails=1&extratags=1&polygon_geojson=1`,
      { signal }
    )
      .then(r => {
        if (!r.ok) throw new Error(`Nominatim ${r.status}`)
        return r.json()
      })
      .then(data => {
        const dist = haversineMeters(latlng.lat, latlng.lng, parseFloat(data.lat), parseFloat(data.lon))
        if (dist > 250) {
          locationInfo.value = null
        } else {
          locationInfo.value = data
          drawLocationPolygon(data?.geojson)
        }
      })
      .catch(err => {
        if (err.name === 'AbortError') return
        locationInfo.value = null
        locationError.value = 'Address lookup failed — the geocoding service is unreachable. Check your connection and try again.'
      })
      .finally(() => { if (!signal.aborted) locationLoading.value = false })

    // Overpass: debounced 500ms so rapid clicks don't stack up requests
    clearTimeout(overpassTimer)
    overpassTimer = setTimeout(() => {
      if (signal.aborted) return
      fetchOverpassPoi(latlng.lat, latlng.lng, signal)
        .then(result => {
          if (!signal.aborted) {
            poiData.value = result?.best ?? null
            poiAlternatives.value = result?.all ?? []
          }
        })
        .catch(err => {
          if (err.name === 'AbortError') return
          poiData.value = null
          poiAlternatives.value = []
          poiError.value = 'Couldn’t load nearby places — the map data service is busy. Try again shortly.'
        })
        .finally(() => { if (!signal.aborted) poiLoading.value = false })
    }, 500)
  }

  function closeLocationPanel() {
    if (activeAbort) { activeAbort.abort(); activeAbort = null }
    clearTimeout(overpassTimer)
    locationPanelOpen.value = false
    poiAlternatives.value = []
    locationError.value = null
    poiError.value = null
    clearTempLayers()
  }

  function selectAlternativePoi(poi) {
    poiData.value = poi
  }

  return {
    locationPanelOpen,
    locationLatLng,
    locationInfo,
    locationLoading,
    locationError,
    poiData,
    poiLoading,
    poiError,
    poiAlternatives,
    openLocationPanel,
    closeLocationPanel,
    clearTempLayers,
    selectAlternativePoi,
  }
}
