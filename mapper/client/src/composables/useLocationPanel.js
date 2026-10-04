import { ref, onScopeDispose, getCurrentScope } from 'vue'
import { loadSettings } from '../utils/settings.js'
import { reverseGeocode } from '../utils/nominatim.js'
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

const DEFAULT_EXCLUDED = ['waste_basket', 'bench']

function getExcludedAmenities() {
  try {
    const s = loadSettings()
    return new Set(s.excludedAmenities ?? DEFAULT_EXCLUDED)
  } catch {
    return new Set(DEFAULT_EXCLUDED)
  }
}

function getPoiRadius() {
  try {
    return loadSettings().poiRadius ?? 25
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

const OVERPASS_MAIN = 'https://overpass-api.de/api/interpreter'
const OVERPASS_MIRROR = 'https://overpass.private.coffee/api/interpreter'

// The main instance often answers 504/429 when overloaded but succeeds on a
// quick retry, so it gets a second try before falling back to the mirror.
// Every attempt has a hard client-side timeout: mirrors can accept the
// connection and then never respond, which used to hang the panel forever.
const OVERPASS_ATTEMPTS = [
  { url: OVERPASS_MAIN, timeoutMs: 15000 },
  { url: OVERPASS_MAIN, timeoutMs: 15000, delayMs: 1000, status: 'Map data server is busy — retrying…' },
  { url: OVERPASS_MIRROR, timeoutMs: 10000, status: 'Still busy — trying a backup server…' },
]

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

async function fetchJsonWithTimeout(url, query, signal, timeoutMs) {
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method: 'POST', body: query, signal: ctrl.signal })
    if (!res.ok) throw new Error(`Overpass ${res.status}`)
    return await res.json()
  } catch (err) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (err.name === 'AbortError') throw new Error(`Overpass timed out after ${timeoutMs / 1000}s`)
    throw err
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

async function runOverpassQuery(query, signal, onStatus) {
  let lastError = null
  for (const { url, timeoutMs, delayMs, status } of OVERPASS_ATTEMPTS) {
    if (lastError) {
      onStatus?.(status)
      if (delayMs) await sleep(delayMs, signal)
    }
    try {
      return await fetchJsonWithTimeout(url, query, signal, timeoutMs)
    } catch (err) {
      if (err.name === 'AbortError') throw err
      lastError = err
    }
  }
  throw lastError ?? new Error('Overpass request failed')
}

function buildAroundQuery(lat, lon, r) {
  return `[out:json][timeout:8];
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
}

function buildIsInQuery(lat, lon) {
  return `[out:json][timeout:12];
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
out tags center;`
}

function elementsToSortedCandidates(elements, lat, lon, r, excluded) {
  const seen = new Set()
  return elements
    .filter(el => {
      const key = `${el.type}/${el.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map(el => {
      const elLat = el.lat ?? el.center?.lat
      const elLon = el.lon ?? el.center?.lon
      if (elLat == null || !el.tags) return null
      if (!POI_KEYS.some(k => el.tags[k])) return null
      if (excluded.has(el.tags.amenity)) return null
      const dist = haversineMeters(lat, lon, elLat, elLon)
      const isContaining = dist > r
      return { el, dist, isContaining }
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.isContaining !== b.isContaining) return a.isContaining ? -1 : 1
      return a.dist - b.dist
    })
}

// Returns an async generator that yields results progressively: the around
// and is_in queries run in parallel, whichever finishes first is shown, then
// the other is merged in.
async function* fetchOverpassPoiProgressive(lat, lon, signal, onStatus) {
  const r = getPoiRadius()
  const excluded = getExcludedAmenities()

  const results = []
  const track = promise => promise.then(
    data => results.push({ elements: data.elements ?? [] }),
    error => results.push({ error, elements: [] }),
  )
  const pending = [
    track(runOverpassQuery(buildAroundQuery(lat, lon, r), signal, onStatus)),
    track(runOverpassQuery(buildIsInQuery(lat, lon), signal, onStatus)),
  ]

  const toResult = () => {
    const candidates = elementsToSortedCandidates(results.flatMap(x => x.elements), lat, lon, r, excluded)
    if (!candidates.length) return null
    const all = candidates.map(({ el }) => elementToPoiShape(el))
    return { best: all[0], all }
  }

  await Promise.race(pending)
  if (signal.aborted) return
  const first = toResult()
  if (first) yield first

  await Promise.all(pending)
  if (signal.aborted) return
  const merged = toResult()
  if (merged) {
    if (merged.all.length !== first?.all.length) yield merged
    return
  }
  // Nothing found: only report "no places" if both queries actually succeeded
  const failed = results.find(x => x.error)
  if (failed) throw failed.error
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
  const poiStatus = ref(null)
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
    poiStatus.value = null
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
    reverseGeocode(latlng.lat, latlng.lng, { addressdetails: 1, extratags: 1, polygon_geojson: 1 }, { signal })
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
    overpassTimer = setTimeout(async () => {
      if (signal.aborted) return
      try {
        const onStatus = status => { if (!signal.aborted) poiStatus.value = status }
        for await (const result of fetchOverpassPoiProgressive(latlng.lat, latlng.lng, signal, onStatus)) {
          if (signal.aborted) return
          poiData.value = result.best
          poiAlternatives.value = result.all
          poiLoading.value = false
        }
        // No results from either query
        if (poiLoading.value && !signal.aborted) poiLoading.value = false
      } catch (err) {
        if (err.name === 'AbortError') return
        poiData.value = null
        poiAlternatives.value = []
        poiError.value = 'Couldn\u2019t load nearby places \u2014 the map data service is busy or unreachable. Try again shortly.'
        poiLoading.value = false
      }
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

  if (getCurrentScope()) onScopeDispose(closeLocationPanel)

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
    poiStatus,
    poiAlternatives,
    openLocationPanel,
    closeLocationPanel,
    clearTempLayers,
    selectAlternativePoi,
  }
}
