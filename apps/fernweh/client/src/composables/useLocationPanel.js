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

// Distance to the nearest point of a { minlat, minlon, maxlat, maxlon } box; 0 inside it.
function metersToBounds(lat, lon, b) {
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
  return haversineMeters(lat, lon, clamp(lat, b.minlat, b.maxlat), clamp(lon, b.minlon, b.maxlon))
}

// Nominatim-style address from a place's own addr:* tags, for the marker form.
function addressFromTags(t) {
  const road = t['addr:street'] || t['addr:place']
  if (!road && !t['addr:city']) return null
  return { house_number: t['addr:housenumber'], road, postcode: t['addr:postcode'], city: t['addr:city'], country_code: t['addr:country']?.toLowerCase() }
}

function elementToPoiShape(el) {
  const t = el.tags || {}
  const categoryKey = POI_KEYS.find(k => t[k])
  const b = el.bounds
  return {
    id: el.id,
    osmType: el.type,
    name: t.name || null,
    categoryKey,
    categoryValue: categoryKey ? t[categoryKey] : null,
    tags: t,
    lat: el.lat ?? el.center?.lat ?? (b && (b.minlat + b.maxlat) / 2),
    lon: el.lon ?? el.center?.lon ?? (b && (b.minlon + b.maxlon) / 2),
    bounds: b ?? null,
    containing: !!el.containing,
    address: el.address ?? addressFromTags(t),
  }
}

const poiKey = poi => `${poi.osmType}/${poi.id}`

// Valid places first: areas containing the click (smallest, i.e. most specific, first), then nearby ones by distance.
const boxArea = b => b ? (b.maxlat - b.minlat) * (b.maxlon - b.minlon) : Infinity
function byRank(a, b) {
  if (a.containing !== b.containing) return a.containing ? -1 : 1
  if (!a.containing) return 0
  const [x, y] = [boxArea(a.bounds), boxArea(b.bounds)]
  return x === y ? 0 : x < y ? -1 : 1
}

function sortCandidates(elements, lat, lon, excluded) {
  const seen = new Set()
  return elements
    .map(el => {
      const key = `${el.type}/${el.id}`
      if (seen.has(key) || !el.tags) return null
      seen.add(key)
      const poi = elementToPoiShape(el)
      if (poi.lat == null || poi.lon == null || !poi.categoryKey || excluded.has(el.tags.amenity)) return null
      return { poi, dist: haversineMeters(lat, lon, poi.lat, poi.lon) }
    })
    .filter(Boolean)
    .sort((a, b) => byRank(a.poi, b.poi) || (a.poi.containing ? 0 : a.dist - b.dist))
    .map(c => c.poi)
}

// GeoJSON point-in-polygon; the even-odd rule over all rings makes holes count as outside.
function inRings(rings, lat, lon) {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}
function containsPoint(geojson, lat, lon) {
  if (geojson?.type === 'Polygon') return inRings(geojson.coordinates, lat, lon)
  if (geojson?.type === 'MultiPolygon') return geojson.coordinates.some(p => inRings(p, lat, lon))
  return false
}

// The same place is often mapped twice (a node and its building), and may come from both sources.
// One entry is kept, the one with more tags unless the user picked the other; it takes the better rank.
const DUPLICATE_M = 30
function isDuplicate(a, b) {
  if (!a.name || a.name !== b.name || a.categoryKey !== b.categoryKey || a.categoryValue !== b.categoryValue) return false
  if (a.bounds && metersToBounds(b.lat, b.lon, a.bounds) <= DUPLICATE_M) return true
  if (b.bounds && metersToBounds(a.lat, a.lon, b.bounds) <= DUPLICATE_M) return true
  return haversineMeters(a.lat, a.lon, b.lat, b.lon) <= DUPLICATE_M
}
function dedupePois(list, keepKey) {
  const out = []
  const tagCount = p => Object.keys(p.tags).length
  for (const p of list) {
    const i = out.findIndex(q => isDuplicate(q, p))
    if (i < 0) { out.push(p); continue }
    const q = out[i]
    const keepNew = poiKey(p) === keepKey || (poiKey(q) !== keepKey && tagCount(p) > tagCount(q))
    const [kept, dropped] = keepNew ? [p, q] : [q, p]
    out[i] = { ...kept, containing: p.containing || q.containing, address: kept.address ?? dropped.address }
  }
  return out
}

const PHOTON_URL = 'https://photon.komoot.io/reverse'
const PHOTON_TIMEOUT_MS = 8000
const PHOTON_OSM_TYPES = { N: 'node', W: 'way', R: 'relation' }

function photonElement({ properties: p, geometry }) {
  const type = PHOTON_OSM_TYPES[p?.osm_type]
  const [lon, lat] = geometry?.coordinates ?? []
  if (!type || p.osm_id == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const e = p.extent // [minlon, maxlat, maxlon, minlat]
  return {
    type,
    id: p.osm_id,
    lat,
    lon,
    bounds: e?.length === 4 ? { minlat: e[3], maxlat: e[1], minlon: e[0], maxlon: e[2] } : undefined,
    tags: { ...p.extra, name: p.name, [p.osm_key]: p.osm_value },
    address: p.street ? { house_number: p.housenumber, road: p.street, postcode: p.postcode, city: p.city, country: p.country, country_code: p.countrycode?.toLowerCase() } : null,
  }
}

// Photon (komoot) usually answers within a second or two and has no slot limits, but it only knows
// named places, measures distance to their centre and carries no details. So it gives the first
// answer, Nominatim fills in the details, and Overpass later adds containing areas and full tags.
async function fetchPhotonPois(lat, lon, signal, r = getPoiRadius()) {
  const params = new URLSearchParams({ lat, lon, limit: 20, radius: r / 1000 })
  for (const k of POI_KEYS) params.append('osm_tag', k)
  const data = await fetchJson(`${PHOTON_URL}?${params}`, { signal, timeoutMs: PHOTON_TIMEOUT_MS, label: 'Photon' })
  // One malformed feature must not cost the others.
  const elements = (data.features ?? []).map(f => { try { return photonElement(f) } catch { return null } }).filter(Boolean)
  return sortCandidates(elements, lat, lon, getExcludedAmenities())
}

// One Nominatim lookup returns most remaining tags (website, opening hours, phone, Wikipedia), the
// names in other languages and the address for all places.
async function withExtraTags(pois, signal) {
  const ids = pois.map(p => p.osmType[0].toUpperCase() + p.id).join(',')
  const places = await nominatim('lookup', { osm_ids: ids, extratags: 1, namedetails: 1, addressdetails: 1 }, { signal })
  const extra = new Map((places ?? []).map(pl => [`${pl.osm_type}/${pl.osm_id}`, pl]))
  return pois.map(p => {
    const pl = extra.get(poiKey(p))
    return pl ? { ...p, tags: { ...pl.extratags, ...pl.namedetails, ...p.tags }, address: pl.address ?? p.address } : p
  })
}

// Large areas (a park, a campus, an archaeological site) are known to Photon only by their centre,
// which can be kilometres from the click. A second query for these kinds within a few km finds them;
// parks get a query of their own, as a city has so many small places of other kinds that they would
// crowd out a park whose centre is far away.
const AREA_RADIUS_KM = 3
const AREA_TAG_GROUPS = [
  ['leisure:park'],
  ['leisure:garden', 'leisure:nature_reserve', 'leisure:stadium', 'leisure:golf_course', 'tourism:attraction', 'tourism:theme_park',
    'tourism:zoo', 'tourism:museum', 'tourism:camp_site', 'historic:archaeological_site', 'historic:castle',
    'historic:palace', 'amenity:university', 'amenity:college', 'amenity:hospital', 'amenity:place_of_worship',
    'amenity:monastery'],
]
// Outlines from Nominatim are simplified to ~10 m.
const POLYGON_THRESHOLD = 0.0001

async function fetchPhotonAreas(lat, lon, signal) {
  const answers = await Promise.all(AREA_TAG_GROUPS.map(tags => {
    const params = new URLSearchParams({ lat, lon, limit: 50, radius: AREA_RADIUS_KM })
    for (const t of tags) params.append('osm_tag', t)
    return fetchJson(`${PHOTON_URL}?${params}`, { signal, timeoutMs: PHOTON_TIMEOUT_MS, label: 'Photon' })
  }))
  const boxed = answers.flatMap(d => d.features ?? []).map(f => { try { return photonElement(f) } catch { return null } })
    .filter(el => el?.bounds && metersToBounds(lat, lon, el.bounds) === 0)
  if (!boxed.length) return []
  // The box of a long or bent park covers much that is outside it, so the outline decides.
  const ids = [...new Set(boxed.map(el => el.type[0].toUpperCase() + el.id))].join(',')
  const places = await nominatim('lookup', { osm_ids: ids, extratags: 1, namedetails: 1, addressdetails: 1, polygon_geojson: 1, polygon_threshold: POLYGON_THRESHOLD }, { signal })
  const inside = new Map((places ?? []).filter(pl => containsPoint(pl.geojson, lat, lon)).map(pl => [`${pl.osm_type}/${pl.osm_id}`, pl]))
  const elements = boxed.filter(el => inside.has(`${el.type}/${el.id}`)).map(el => {
    const pl = inside.get(`${el.type}/${el.id}`)
    return { ...el, containing: true, tags: { ...pl.extratags, ...pl.namedetails, ...el.tags }, address: pl.address ?? el.address }
  })
  return sortCandidates(elements, lat, lon, getExcludedAmenities())
}

// Nominatim's reverse answer is the object at the click, sometimes an area (a building, a temple
// within a site), mostly a path or a bin. It stands in until Overpass answers, and for good when
// Overpass is busy. A place merely nearby counts only within the radius, like Photon's.
function reversePoi(data, lat, lon, r) {
  if (!data || !POI_KEYS.includes(data.category) || !['node', 'way', 'relation'].includes(data.osm_type)) return null
  const [minlat, maxlat, minlon, maxlon] = (data.boundingbox ?? []).map(Number)
  const bounds = data.osm_type !== 'node' && [minlat, maxlat, minlon, maxlon].every(Number.isFinite) ? { minlat, maxlat, minlon, maxlon } : undefined
  const element = {
    type: data.osm_type,
    id: data.osm_id,
    lat: parseFloat(data.lat),
    lon: parseFloat(data.lon),
    bounds,
    containing: !!bounds && containsPoint(data.geojson, lat, lon),
    // `name` is translated to the browser language; namedetails has OSM's own, like Overpass.
    tags: { ...data.extratags, ...(data.name && { name: data.name }), ...data.namedetails, [data.category]: data.type },
    address: data.address ?? null,
  }
  const poi = sortCandidates([element], lat, lon, getExcludedAmenities())[0]
  return poi && (poi.containing || haversineMeters(lat, lon, poi.lat, poi.lon) <= r) ? poi : null
}

// Overpass has the complete tags, Photon/Nominatim the better-computed address.
function mergePoi(overpassPoi, photonPoi) {
  return {
    ...overpassPoi,
    tags: { ...photonPoi.tags, ...overpassPoi.tags },
    address: photonPoi.address ?? overpassPoi.address,
    ...(photonPoi.details && { details: photonPoi.details }),
  }
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

// overpass-api.de gives each IP only a few slots, and every finished query keeps its slot blocked for a
// cooldown; once they are used up, further queries wait in line or fail with 429/504. So each click
// sends a single query and re-clicks on the same spot are answered from a cache. When its queue is
// full, the server turns queries away at once (502/429/504) and asks for retries with growing pauses.
// Fallback mirrors were dropped: overpass.private.coffee, overpass.kumi.systems and the Russian
// instances accept connections but never answer.
// The client deadline only catches stalled connections — a busy server can legitimately take 30s+ to
// hand out a slot.
const OVERPASS_TIMEOUT_MS = 60000
const OVERPASS_RETRY_DELAYS_MS = [1000, 3000, 8000]
const POI_CACHE_SIZE = 50
const poiCache = new Map()
// Only one query at a time: a sent query's slot is spent anyway, so it is never aborted but finishes
// into the cache, and the next click waits for it.
let overpassInFlight = null

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

// `signal` only stops a retry: the query itself is not cancelled once sent.
async function runOverpassQuery(query, signal, onStatus) {
  const request = () => fetchJson(OVERPASS_URL, { method: 'POST', body: query, timeoutMs: OVERPASS_TIMEOUT_MS, label: 'Overpass' })
  let data
  for (let attempt = 0; ; attempt++) {
    try {
      data = await request()
      break
    } catch (err) {
      // A stalled connection is not worth another minute; a quick "busy" answer often succeeds on retry.
      if (err.name === 'TimeoutError' || attempt >= OVERPASS_RETRY_DELAYS_MS.length) throw err
      onStatus?.('Map data server is busy — retrying…')
      await sleep(OVERPASS_RETRY_DELAYS_MS[attempt], signal)
    }
  }
  // A query that ran out of time or memory still answers 200, with partial or no elements.
  if (/runtime error/i.test(data?.remark ?? '')) throw new Error(`Overpass: ${data.remark}`)
  return data
}

// Places within the radius, then a "sep" element, then the areas containing the point (a park, a
// building, a campus) whose outline may be further away than the radius. maxsize is far below the
// 512 MiB default: the server admits a query only while its declared memory fits, so a small one gets
// through much sooner under load.
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
make sep;
out;
is_in(${lat},${lon})->.a;
(
  way(pivot.a)["tourism"];
  way(pivot.a)["leisure"];
  way(pivot.a)["amenity"];
  way(pivot.a)["shop"];
  way(pivot.a)["historic"];
  relation(pivot.a)["tourism"];
  relation(pivot.a)["leisure"];
  relation(pivot.a)["amenity"];
  relation(pivot.a)["historic"];
);
out tags bb;`
}

// Everything after the separator contains the point. A building the point is in usually also matches
// "around", so the two copies are merged (centre from one, bounds from the other).
function markContaining(elements) {
  const sep = elements.findIndex(el => el.type === 'sep')
  if (sep < 0) return elements
  const inside = new Map(elements.slice(sep + 1).map(el => [`${el.type}/${el.id}`, el]))
  const nearby = elements.slice(0, sep).map(el => {
    const container = inside.get(`${el.type}/${el.id}`)
    return container ? { ...el, ...container, containing: true } : el
  })
  return [...nearby, ...[...inside.values()].map(el => ({ ...el, containing: true }))]
}

const overpassKey = (lat, lon, r) => `${lat.toFixed(5)},${lon.toFixed(5)},${r}`

// Resolves to the raw elements for a spot (~1 m grid), from the cache, the query already running for it,
// or a new query once the running one is done.
async function loadOverpassElements(lat, lon, r, signal, onStatus) {
  const key = overpassKey(lat, lon, r)
  for (;;) {
    signal.throwIfAborted()
    const hit = poiCache.get(key)
    if (hit) {
      poiCache.delete(key)
      poiCache.set(key, hit)
      return hit
    }
    if (!overpassInFlight) break
    const running = overpassInFlight
    if (running.key === key) {
      try { return await running.promise }
      catch (err) { if (err.name !== 'AbortError') throw err } // its retry was cancelled: send our own
    } else {
      onStatus?.('Waiting for the previous lookup to finish…')
      await running.promise.catch(() => {})
      onStatus?.(null)
    }
  }
  const entry = { key }
  entry.promise = runOverpassQuery(buildPoiQuery(lat, lon, r), signal, onStatus)
    .then(data => {
      const elements = data.elements ?? []
      poiCache.set(key, elements)
      if (poiCache.size > POI_CACHE_SIZE) poiCache.delete(poiCache.keys().next().value)
      return elements
    })
    .finally(() => { if (overpassInFlight === entry) overpassInFlight = null })
  overpassInFlight = entry
  return entry.promise
}

// Resolves to the places found, best match first.
async function fetchOverpassPois(lat, lon, signal, onStatus, r = getPoiRadius()) {
  const elements = await loadOverpassElements(lat, lon, r, signal, onStatus)
  return sortCandidates(markContaining(elements), lat, lon, getExcludedAmenities())
}

// Reverse geocoding falls back to far-away objects (e.g. a coastline for a click at sea). Measured to the
// object's bounding box, so clicks on a long road or a large building keep their address.
const ADDRESS_MAX_M = 250
function isNearResult(lat, lon, data) {
  const [minlat, maxlat, minlon, maxlon] = (data.boundingbox ?? []).map(Number)
  if ([minlat, maxlat, minlon, maxlon].every(Number.isFinite)) {
    return metersToBounds(lat, lon, { minlat, maxlat, minlon, maxlon }) <= ADDRESS_MAX_M
  }
  return haversineMeters(lat, lon, parseFloat(data.lat), parseFloat(data.lon)) <= ADDRESS_MAX_M
}

// A place shared from Google Maps is matched to an OSM place by name ("Café Zoë" ~ "Cafe Zoe Amsterdam").
// Google writes "&" where OSM often has the word ("Byzantine & Christian Museum"), so both are dropped.
const AND_WORDS = new Set(['and', 'und', 'et', 'y', 'e', 'en'])
const normalizeName = s => s?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  .split(' ').filter(w => !AND_WORDS.has(w)).join(' ') ?? ''
function sameName(a, b) {
  const [x, y] = [normalizeName(a), normalizeName(b)]
  if (x.length < 3 || y.length < 3) return x === y && !!x
  return x.includes(y) || y.includes(x)
}
// Google shows the name in the user's language, OSM's `name` is the local one ("Βυζαντινό και
// Χριστιανικό Μουσείο"), so every name a place has counts.
const NAME_KEY_RE = /^(?:name|alt_name|official_name|short_name|int_name|loc_name)(?::[a-z]{2,3}(?:-[A-Za-z]+)?)?$/
const namesOf = poi => Object.entries(poi.tags ?? {}).filter(([k]) => NAME_KEY_RE.test(k)).flatMap(([, v]) => String(v).split(';'))
// Google's pin and OSM's node for the same shop are often a few dozen metres apart; a position found
// from the address only can be further off.
const HINT_RADIUS_M = { exact: 60, approximate: 120 }
// Picked "none of these": the hint's own name is kept.
const NO_PLACE = 'none'

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
  // { name, approximate } of a place opened from a Google Maps link
  const placeHint = ref(null)

  let locationLayer = null
  let clickPin = null
  let activeAbort = null
  let overpassTimer = null
  // Only a place the user chose themselves is kept when better results arrive.
  let pickedKey = null

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

  async function openLocationPanel(latlng, hint = null) {
    // Cancel any in-flight requests from a previous click
    if (activeAbort) activeAbort.abort()
    activeAbort = new AbortController()
    const { signal } = activeAbort

    clearTempLayers()
    const map = getMap()
    pickedKey = null
    locationLatLng.value = latlng
    locationInfo.value = null
    locationError.value = null
    poiData.value = null
    poiError.value = null
    poiStatus.value = null
    poiAlternatives.value = []
    placeHint.value = hint
    const radius = hint ? Math.max(getPoiRadius(), HINT_RADIUS_M[hint.approximate ? 'approximate' : 'exact']) : getPoiRadius()
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

    // Nearby places come from Photon (fast), Nominatim's reverse answer, Photon's large areas and
    // Overpass (complete, slow); the lists are merged.
    const sources = { photon: [], nominatim: [], areas: [], overpass: [] }
    let pending = 2
    let overpassFailed = false
    const render = () => {
      if (signal.aborted) return
      const fast = new Map([...sources.photon, ...sources.areas, ...sources.nominatim].map(p => [poiKey(p), p]))
      const overpass = sources.overpass.map(p => fast.has(poiKey(p)) ? mergePoi(p, fast.get(poiKey(p))) : p)
      const known = new Set(overpass.map(poiKey))
      // Areas containing the click (smallest first) go before Photon's nearest places, as in Overpass's order.
      const rest = [...sources.nominatim, ...sources.areas, ...sources.photon]
        .filter(p => !known.has(poiKey(p)) && known.add(poiKey(p)))
        .sort(byRank)
      const list = dedupePois([...overpass, ...rest], pickedKey)
      poiAlternatives.value = list
      // Overpass's order (containing area first) replaces Photon's guess, unless the user picked a place.
      // A shared place only takes a nearby place of the same name: a different shop next door is not it.
      const auto = hint?.name ? list.find(p => namesOf(p).some(n => sameName(n, hint.name))) : list[0]
      poiData.value = pickedKey === NO_PLACE ? null : (pickedKey && list.find(p => poiKey(p) === pickedKey)) || auto || null
      if (list.length) poiLoading.value = false
    }

    // Nominatim: resolves first (~200ms) — update address immediately
    reverseGeocode(latlng.lat, latlng.lng, { addressdetails: 1, extratags: 1, namedetails: 1, polygon_geojson: 1 }, { signal })
      .then(data => {
        if (signal.aborted) return
        if (!data || !isNearResult(latlng.lat, latlng.lng, data)) {
          locationInfo.value = null
        } else {
          locationInfo.value = data
          drawLocationPolygon(data.geojson)
          const place = reversePoi(data, latlng.lat, latlng.lng, radius)
          if (place) {
            sources.nominatim = [place]
            render()
          }
        }
      })
      .catch(err => {
        if (err.name === 'AbortError') return
        locationInfo.value = null
        locationError.value = 'Address lookup failed — the geocoding service is unreachable. Check your connection and try again.'
      })
      .finally(() => { if (!signal.aborted) locationLoading.value = false })

    // Overpass is the complete source, so only its failure counts as "couldn't load".
    const done = () => {
      if (signal.aborted || --pending) return
      poiLoading.value = false
      if (overpassFailed && !poiData.value) {
        poiError.value = 'Couldn’t load nearby places — the map data service is busy or unreachable. Try again shortly.'
      }
    }

    fetchPhotonPois(latlng.lat, latlng.lng, signal, radius)
      .then(async pois => {
        if (!pois.length) return render()
        const lookup = withExtraTags(pois, signal)
        // Saving before the details arrive waits for them (see LocationPanel), so the website and
        // Wikipedia article are not lost.
        const settled = lookup.catch(() => null)
        sources.photon = pois.map(p => ({ ...p, details: settled.then(list => list?.find(q => poiKey(q) === poiKey(p)) ?? null) }))
        render()
        sources.photon = await lookup
        render()
      })
      .catch(() => { /* Overpass still answers */ })
      .finally(done)

    fetchPhotonAreas(latlng.lat, latlng.lng, signal)
      .then(areas => {
        sources.areas = areas
        if (areas.length) render()
      })
      .catch(() => { /* Overpass still answers */ })

    // Overpass: debounced 500ms, so rapid clicks don't each spend a server slot.
    clearTimeout(overpassTimer)
    overpassTimer = setTimeout(async () => {
      if (signal.aborted) return
      try {
        const onStatus = status => { if (!signal.aborted) poiStatus.value = status }
        sources.overpass = await fetchOverpassPois(latlng.lat, latlng.lng, signal, onStatus, radius)
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
    pickedKey = null
    placeHint.value = null
    locationPanelOpen.value = false
    poiAlternatives.value = []
    locationError.value = null
    poiError.value = null
    poiStatus.value = null
    poiLoading.value = false
    locationLoading.value = false
    clearTempLayers()
  }

  if (getCurrentScope()) onScopeDispose(closeLocationPanel)

  function selectAlternativePoi(poi) {
    pickedKey = poi ? poiKey(poi) : NO_PLACE
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
    placeHint,
    openLocationPanel,
    closeLocationPanel,
    clearTempLayers,
    selectAlternativePoi,
  }
}
