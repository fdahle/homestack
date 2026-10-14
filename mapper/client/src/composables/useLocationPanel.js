import { ref, onScopeDispose, getCurrentScope } from 'vue'
import { loadSettings } from '../utils/settings.js'
import { nominatim, reverseGeocode } from '../utils/nominatim.js'
import { fetchJson } from '../utils/fetchJson.js'
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

const poiKey = poi => `${poi.osmType}/${poi.id}`

const PHOTON_URL = 'https://photon.komoot.io/reverse'
const PHOTON_TIMEOUT_MS = 8000
const PHOTON_OSM_TYPES = { N: 'node', W: 'way', R: 'relation' }

// Photon (komoot) usually answers within a second or two and has no slot limits, but it only knows
// named places, measures distance to their centre and carries no details. So it gives the first
// answer, Nominatim fills in the details, and Overpass later adds containing areas and full tags.
async function fetchPhotonPois(lat, lon, signal) {
  const r = getPoiRadius()
  const params = new URLSearchParams({ lat, lon, limit: 20, radius: r / 1000 })
  for (const k of POI_KEYS) params.append('osm_tag', k)
  const data = await fetchJson(`${PHOTON_URL}?${params}`, { signal, timeoutMs: PHOTON_TIMEOUT_MS, label: 'Photon' })
  const elements = (data.features ?? []).map(({ properties: p, geometry }) => ({
    type: PHOTON_OSM_TYPES[p.osm_type],
    id: p.osm_id,
    lat: geometry.coordinates[1],
    lon: geometry.coordinates[0],
    tags: { ...p.extra, name: p.name, [p.osm_key]: p.osm_value },
  }))
  // Photon has already applied the radius; an infinite one here just sorts everything by distance.
  return elementsToSortedCandidates(elements, lat, lon, Infinity, getExcludedAmenities()).map(({ el }) => elementToPoiShape(el))
}

// One Nominatim lookup returns most remaining tags (website, opening hours, phone, Wikipedia) for all places.
async function withExtraTags(pois, signal) {
  const ids = pois.map(p => p.osmType[0].toUpperCase() + p.id).join(',')
  const places = await nominatim('lookup', { osm_ids: ids, extratags: 1 }, { signal })
  const extra = new Map(places.map(pl => [`${pl.osm_type}/${pl.osm_id}`, pl.extratags]))
  return pois.map(p => extra.has(poiKey(p)) ? { ...p, tags: { ...extra.get(poiKey(p)), ...p.tags } } : p)
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

// overpass-api.de gives each IP only a few slots, and every finished query keeps its slot blocked for a
// cooldown; once they are used up, further queries wait in line or fail with 429/504. So each click
// sends a single query, re-clicks on the same spot are answered from a cache, and a failure is retried
// only once. A fallback mirror was dropped: overpass.private.coffee accepts connections but never answers.
// The client deadline only catches stalled connections — the server answers 429/504 itself when busy,
// and a busy server can legitimately take 20s+ to hand out a slot.
const OVERPASS_TIMEOUT_MS = 30000
const OVERPASS_RETRY_DELAY_MS = 2000
const POI_CACHE_SIZE = 50
const poiCache = new Map()

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

async function runOverpassQuery(query, signal, onStatus) {
  const request = () => fetchJson(OVERPASS_URL, { method: 'POST', body: query, signal, timeoutMs: OVERPASS_TIMEOUT_MS, label: 'Overpass' })
  try {
    return await request()
  } catch (err) {
    // A stalled connection is not worth another 30s; a quick "busy" answer often succeeds on retry.
    if (err.name === 'AbortError' || err.name === 'TimeoutError') throw err
    onStatus?.('Map data server is busy — retrying…')
    await sleep(OVERPASS_RETRY_DELAY_MS, signal)
    return await request()
  }
}

// Places within the radius, plus areas containing the point (a park, a campus) whose outline is
// further away than the radius. maxsize is far below the 512 MiB default: the server admits a query
// only while its declared memory fits, so a small one gets through much sooner under load.
function buildPoiQuery(lat, lon, r) {
  return `[out:json][timeout:10][maxsize:33554432];
(
  nw["amenity"](around:${r},${lat},${lon});
  nw["shop"](around:${r},${lat},${lon});
  nw["tourism"](around:${r},${lat},${lon});
  nw["leisure"](around:${r},${lat},${lon});
  nw["historic"](around:${r},${lat},${lon});
);
out tags center 30;
is_in(${lat},${lon})->.a;
(
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

// Resolves to the places found, best match first.
async function fetchOverpassPois(lat, lon, signal, onStatus) {
  const r = getPoiRadius()
  // ~1 m grid, so clicking the same spot again needs no request
  const key = `${lat.toFixed(5)},${lon.toFixed(5)},${r}`
  let elements = poiCache.get(key)
  if (elements) {
    poiCache.delete(key)
  } else {
    elements = (await runOverpassQuery(buildPoiQuery(lat, lon, r), signal, onStatus)).elements ?? []
  }
  poiCache.set(key, elements)
  if (poiCache.size > POI_CACHE_SIZE) poiCache.delete(poiCache.keys().next().value)

  return elementsToSortedCandidates(elements, lat, lon, r, getExcludedAmenities()).map(({ el }) => elementToPoiShape(el))
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

    // Nearby places come from Photon (fast) and Overpass (complete, slow); both lists are merged.
    const sources = { photon: [], overpass: [] }
    let pending = 2
    let overpassFailed = false
    const render = () => {
      if (signal.aborted) return
      const known = new Set(sources.overpass.map(poiKey))
      const list = [...sources.overpass, ...sources.photon.filter(p => !known.has(poiKey(p)))]
      // Later, richer results update the list but never swap away the place already shown.
      const shown = poiData.value && list.find(p => poiKey(p) === poiKey(poiData.value))
      poiAlternatives.value = list
      poiData.value = shown ?? list[0] ?? null
      if (list.length) poiLoading.value = false
    }
    // Overpass is the complete source, so only its failure counts as "couldn't load".
    const done = () => {
      if (signal.aborted || --pending) return
      poiLoading.value = false
      if (overpassFailed && !poiData.value) {
        poiError.value = 'Couldn\u2019t load nearby places \u2014 the map data service is busy or unreachable. Try again shortly.'
      }
    }

    fetchPhotonPois(latlng.lat, latlng.lng, signal)
      .then(async pois => {
        sources.photon = pois
        render()
        if (!pois.length) return
        sources.photon = await withExtraTags(pois, signal)
        render()
      })
      .catch(() => { /* Overpass still answers */ })
      .finally(done)

    // Overpass: debounced 500ms. Aborting a sent query doesn't give its server slot back, so rapid
    // clicks must not each send one.
    clearTimeout(overpassTimer)
    overpassTimer = setTimeout(async () => {
      if (signal.aborted) return
      try {
        const onStatus = status => { if (!signal.aborted) poiStatus.value = status }
        sources.overpass = await fetchOverpassPois(latlng.lat, latlng.lng, signal, onStatus)
        render()
      } catch (err) {
        if (err.name === 'AbortError') return
        overpassFailed = true
      }
      done()
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
