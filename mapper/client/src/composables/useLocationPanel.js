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

const POI_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'historic']

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

async function fetchOverpassPoi(lat, lon, signal) {
  const query = `[out:json][timeout:5];
(
  node["amenity"](around:25,${lat},${lon});
  node["shop"](around:25,${lat},${lon});
  node["tourism"](around:25,${lat},${lon});
  node["leisure"](around:25,${lat},${lon});
  node["historic"](around:25,${lat},${lon});
  way["amenity"](around:25,${lat},${lon});
  way["shop"](around:25,${lat},${lon});
);
out tags center 5;`

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: query,
    signal,
  })
  const data = await res.json()
  if (!data.elements?.length) return null

  let best = null
  let bestDist = Infinity
  for (const el of data.elements) {
    const elLat = el.lat ?? el.center?.lat
    const elLon = el.lon ?? el.center?.lon
    if (elLat == null) continue
    const dist = haversineMeters(lat, lon, elLat, elLon)
    if (dist < bestDist) { bestDist = dist; best = el }
  }
  if (!best || bestDist > 25) return null

  const t = best.tags || {}
  const categoryKey = POI_KEYS.find(k => t[k])
  return {
    id: best.id,
    osmType: best.type,
    name: t.name || null,
    categoryKey,
    categoryValue: categoryKey ? t[categoryKey] : null,
    tags: t,
    lat: best.lat ?? best.center?.lat,
    lon: best.lon ?? best.center?.lon,
  }
}

export function useLocationPanel(getMap) {
  const locationPanelOpen = ref(false)
  const locationLatLng = ref(null)
  const locationInfo = ref(null)
  const locationLoading = ref(false)
  const poiData = ref(null)
  const poiLoading = ref(false)

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
    poiData.value = null
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
      .then(r => r.json())
      .then(data => {
        const dist = haversineMeters(latlng.lat, latlng.lng, parseFloat(data.lat), parseFloat(data.lon))
        if (dist > 250) {
          locationInfo.value = null
        } else {
          locationInfo.value = data
          drawLocationPolygon(data?.geojson)
        }
      })
      .catch(err => { if (err.name !== 'AbortError') locationInfo.value = null })
      .finally(() => { if (!signal.aborted) locationLoading.value = false })

    // Overpass: debounced 500ms so rapid clicks don't stack up requests
    clearTimeout(overpassTimer)
    overpassTimer = setTimeout(() => {
      if (signal.aborted) return
      fetchOverpassPoi(latlng.lat, latlng.lng, signal)
        .then(data => { if (!signal.aborted) poiData.value = data })
        .catch(err => { if (err.name !== 'AbortError') poiData.value = null })
        .finally(() => { if (!signal.aborted) poiLoading.value = false })
    }, 500)
  }

  function closeLocationPanel() {
    if (activeAbort) { activeAbort.abort(); activeAbort = null }
    clearTimeout(overpassTimer)
    locationPanelOpen.value = false
    clearTempLayers()
  }

  return {
    locationPanelOpen,
    locationLatLng,
    locationInfo,
    locationLoading,
    poiData,
    poiLoading,
    openLocationPanel,
    closeLocationPanel,
    clearTempLayers,
  }
}
