import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { fetchJson } from '../src/utils/fetchJson.js'
import { nominatim, reverseGeocode } from '../src/utils/nominatim.js'

const nativeFetch = globalThis.fetch
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
// Answers after `ms` unless the request is aborted first, like a real fetch.
const later = (data, ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => resolve(response(data)), ms)
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) })
})
async function until(check, ms = 8000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting for ' + check)
    await delay(20)
  }
}
beforeEach(() => { globalThis.localStorage = { getItem: () => null, setItem: () => {} } })
afterEach(() => { globalThis.fetch = nativeFetch })

// The composable imports Leaflet, which needs a DOM; it is swapped for a stub, other imports stay real.
async function loadModule(path, stubs = {}) {
  const url = new URL(path, import.meta.url)
  let source = readFileSync(url, 'utf8')
  if (path.endsWith('.vue')) source = compileScript(parse(source).descriptor, { id: 'test' }).content
  source = source.replace(/from (['"])(.*?)\1/g, (_m, _q, specifier) => {
    const target = stubs[specifier] ?? (specifier.endsWith('.vue') ? 'data:text/javascript,export default { render() { return null } }' : specifier.startsWith('.') ? new URL(specifier, url).href : import.meta.resolve(specifier))
    return 'from ' + JSON.stringify(target)
  })
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
}
const leafletStub = 'data:text/javascript,' + encodeURIComponent('const layer = () => ({ addTo() { return this }, remove() {} }); export default { divIcon: () => ({}), marker: layer, geoJSON: layer }')
const { useLocationPanel } = await loadModule('../src/composables/useLocationPanel.js', { leaflet: leafletStub })

const renderer = createRenderer({ createElement: () => ({}), insert: () => {}, remove: () => {}, setElementText: () => {}, patchProp: () => {}, createText: () => ({}), createComment: () => ({}), parentNode: () => null, nextSibling: () => null })
function mount(Component, props) {
  Component.render = () => null
  const app = renderer.createApp({ render: () => h(Component, { ...props }) })
  app.mount({})
  return { app, state: app._instance.subTree.component.setupState }
}

test('fetchJson without timeoutMs has no deadline', async () => {
  globalThis.fetch = async () => { await delay(30); return response({ ok: 1 }) }
  assert.deepEqual(await fetchJson('https://example.test/'), { ok: 1 })
})

test('Nominatim "Unable to geocode" means no result and is not cached', async () => {
  let calls = 0
  globalThis.fetch = async () => { calls++; return response({ error: 'Unable to geocode' }) }
  assert.equal(await reverseGeocode(10.5, -30.5), null)
  assert.equal(await reverseGeocode(10.5, -30.5), null)
  assert.equal(calls, 2)
  assert.deepEqual(await nominatim('lookup', { osm_ids: 'N1' }), [])
})

test('identical Nominatim requests share one fetch; it stops only when every caller cancels', async () => {
  const fetched = []
  globalThis.fetch = (url, { signal }) => { fetched.push(signal); return later([{ id: url.length }], 60, signal) }
  const a = new AbortController(), b = new AbortController()
  const first = nominatim('search', { q: 'shared' }, { signal: a.signal })
  const second = nominatim('search', { q: 'shared' }, { signal: b.signal })
  await until(() => fetched.length)
  a.abort()
  await assert.rejects(first, { name: 'AbortError' })
  assert.equal(fetched[0].aborted, false)
  assert.equal((await second).length, 1)
  assert.equal(fetched.length, 1)

  const c = new AbortController(), d = new AbortController()
  const third = nominatim('search', { q: 'cancelled' }, { signal: c.signal })
  const fourth = nominatim('search', { q: 'cancelled' }, { signal: d.signal })
  await until(() => fetched.length === 2)
  c.abort(); d.abort()
  await assert.rejects(third, { name: 'AbortError' })
  await assert.rejects(fourth, { name: 'AbortError' })
  assert.equal(fetched[1].aborted, true)
})

// A click inside a museum next to a café: Photon only knows the café, Overpass knows the museum contains the point.
function services({ lat, lon, overpass, overpassDelay = 20, reverse }) {
  const log = { overpass: [], photon: 0, lookup: 0, reverse: 0 }
  globalThis.fetch = async (url, init = {}) => {
    if (url.startsWith('https://overpass-api.de')) {
      const entry = { body: init.body, signal: init.signal, done: false }
      log.overpass.push(entry)
      const data = typeof overpass === 'function' ? overpass(log.overpass.length) : overpass
      await delay(overpassDelay)
      entry.done = true
      return response(data)
    }
    if (url.startsWith('https://photon.komoot.io')) {
      log.photon++
      return response({ features: [
        { properties: { osm_type: 'X', osm_id: 1, osm_key: 'amenity', osm_value: 'cafe', name: 'Bad type' }, geometry: { coordinates: [lon, lat] } },
        { properties: { osm_type: 'N', osm_id: 2, osm_key: 'amenity', osm_value: 'cafe', name: 'No geometry' } },
        { properties: { osm_type: 'N', osm_id: 10, osm_key: 'amenity', osm_value: 'cafe', name: 'Café', street: 'Main St', housenumber: '3', postcode: '1000', city: 'Town', country: 'Nederland', countrycode: 'NL' }, geometry: { coordinates: [lon + 0.0001, lat] } },
        { properties: { osm_type: 'W', osm_id: 20, osm_key: 'tourism', osm_value: 'museum', name: 'Museum' }, geometry: { coordinates: [lon + 0.0002, lat] } },
      ] })
    }
    if (url.includes('/lookup?')) {
      log.lookup++
      assert.match(url, /osm_ids=N10%2CW20/)
      assert.match(url, /addressdetails=1/)
      return response([{ osm_type: 'node', osm_id: 10, extratags: { website: 'cafe.example' }, address: { road: 'Main Street', house_number: '3', city: 'Town', country_code: 'nl' } }])
    }
    if (url.includes('/reverse?')) { log.reverse++; return response(reverse ?? { error: 'Unable to geocode' }) }
    throw new Error('unexpected ' + url)
  }
  return log
}
const overpassAnswer = (lat, lon) => ({ elements: [
  { type: 'node', id: 10, lat, lon: lon + 0.0001, tags: { amenity: 'cafe', name: 'Café', opening_hours: '9-17' } },
  { type: 'node', id: 30, lat: lat + 0.00005, lon, tags: { tourism: 'museum', name: 'Museum', website: 'https://museum.example', wikipedia: 'en:Museum', 'addr:street': 'Museum Sq' } },
  // A big way nearby whose centre is far away: not containing, despite the old `dist > r` test.
  { type: 'way', id: 40, center: { lat: lat + 0.01, lon }, tags: { leisure: 'park', name: 'Far Park' } },
  { type: 'sep', id: 1 },
  { type: 'way', id: 50, bounds: { minlat: lat - 0.01, maxlat: lat + 0.01, minlon: lon - 0.01, maxlon: lon + 0.01 }, tags: { leisure: 'park', name: 'Big Park' } },
  { type: 'way', id: 20, bounds: { minlat: lat - 0.0003, maxlat: lat + 0.0003, minlon: lon - 0.0003, maxlon: lon + 0.0003 }, tags: { tourism: 'museum', name: 'Museum' } },
] })

test('the area the click is inside replaces Photon’s pick; photon features without type or geometry are skipped', async () => {
  const lat = 52.1, lon = 5.1
  const log = services({ lat, lon, overpass: overpassAnswer(lat, lon) })
  const panel = useLocationPanel(() => null)
  panel.openLocationPanel({ lat, lng: lon })
  await until(() => panel.poiData.value)
  assert.equal(panel.poiData.value.name, 'Café')
  assert.equal(panel.poiAlternatives.value.length, 2)
  assert.equal(panel.locationInfo.value, null) // sea-style {error} answer
  await until(() => panel.poiAlternatives.value.length > 2)
  const names = panel.poiAlternatives.value.map(p => `${p.osmType}/${p.id}`)
  // Smallest containing area first; the museum node and its building are one entry (the node has more tags).
  assert.deepEqual(names, ['node/30', 'way/50', 'node/10', 'way/40'])
  assert.equal(panel.poiData.value.id, 30)
  assert.equal(panel.poiData.value.containing, true)
  assert.equal(log.overpass.length, 1)
  assert.match(log.overpass[0].body, /make sep;\s*out;/)
  panel.closeLocationPanel()
})

test('a place the user picked stays shown when Overpass answers', async () => {
  const lat = 52.2, lon = 5.2
  services({ lat, lon, overpass: overpassAnswer(lat, lon), overpassDelay: 300 })
  const panel = useLocationPanel(() => null)
  panel.openLocationPanel({ lat, lng: lon })
  await until(() => panel.poiAlternatives.value.length === 2)
  panel.selectAlternativePoi(panel.poiAlternatives.value[1])
  assert.equal(panel.poiData.value.id, 20)
  await until(() => panel.poiAlternatives.value.length > 2)
  // The picked way is kept over the richer node duplicate.
  assert.equal(panel.poiData.value.id, 20)
  assert.equal(panel.poiData.value.osmType, 'way')
  panel.closeLocationPanel()
})

test('Overpass runtime errors count as failures and are not cached', async () => {
  const lat = 52.3, lon = 5.3
  const log = services({ lat, lon, overpass: n => n === 1 ? { remark: 'runtime error: Query timed out in "query" at line 3 after 10 seconds.', elements: [] } : overpassAnswer(lat, lon) })
  globalThis.fetch = (fetch => (url, init) => url.startsWith('https://photon') ? Promise.resolve(response({ features: [] })) : fetch(url, init))(globalThis.fetch)
  const panel = useLocationPanel(() => null)
  panel.openLocationPanel({ lat, lng: lon })
  await until(() => panel.poiError.value)
  assert.equal(panel.poiLoading.value, false)
  assert.equal(log.overpass.length, 1) // not retried
  panel.openLocationPanel({ lat, lng: lon })
  await until(() => panel.poiData.value)
  assert.equal(log.overpass.length, 2)
  panel.closeLocationPanel()
})

test('a sent Overpass query is not aborted, only one runs at a time, and its result is never shown for a newer click', async () => {
  const lat = 52.4, lon = 5.4
  const log = services({ lat, lon, overpass: overpassAnswer(lat, lon), overpassDelay: 1500 })
  const panel = useLocationPanel(() => null)
  panel.openLocationPanel({ lat, lng: lon })
  await until(() => log.overpass.length === 1)
  panel.openLocationPanel({ lat: lat + 1, lng: lon }) // far away: Photon/Overpass answers there are ignored below
  await delay(600)
  assert.equal(log.overpass.length, 1, 'the second click waits for the running query')
  await until(() => log.overpass.length === 2)
  assert.equal(log.overpass[0].done, true)
  assert.ok(panel.poiAlternatives.value.every(p => !p.containing), 'first click’s areas are not applied')
  panel.closeLocationPanel()
  assert.equal(log.overpass[1].signal.aborted, false)
  // The closed click's query still finishes into the cache: clicking the same spot sends nothing new.
  await until(() => log.overpass[1].done)
  panel.openLocationPanel({ lat: lat + 1, lng: lon })
  await until(() => panel.poiAlternatives.value.length > 2)
  assert.equal(log.overpass.length, 2)
  panel.closeLocationPanel()
})

test('closing mid-request resets loading state', async () => {
  const lat = 52.5, lon = 5.5
  services({ lat, lon, overpass: overpassAnswer(lat, lon), overpassDelay: 200 })
  const panel = useLocationPanel(() => null)
  panel.openLocationPanel({ lat, lng: lon })
  assert.equal(panel.poiLoading.value, true)
  panel.closeLocationPanel()
  assert.equal(panel.poiLoading.value, false)
  assert.equal(panel.locationLoading.value, false)
  assert.equal(panel.poiStatus.value, null)
})

test('the address is kept when the click is inside the result’s bounding box, however far its centre', async () => {
  const lat = 52.6, lon = 5.6
  // A long road: centre 2 km away, but the click is on it.
  const reverse = { lat: String(lat + 0.018), lon: String(lon), boundingbox: [String(lat - 0.02), String(lat + 0.04), String(lon - 0.0001), String(lon + 0.0001)], address: { road: 'Long Road' } }
  services({ lat, lon, overpass: { elements: [] }, reverse })
  const panel = useLocationPanel(() => null)
  panel.openLocationPanel({ lat, lng: lon })
  await until(() => !panel.locationLoading.value)
  assert.equal(panel.locationInfo.value?.address.road, 'Long Road')
  panel.closeLocationPanel()
})

const { default: LocationPanel } = await loadModule('../src/components/LocationPanel.vue')

test('website links accept bare hosts and the first of several, and stay http(s)-only', () => {
  const site = website => mount(LocationPanel, { open: true, latlng: { lat: 1, lng: 2 }, poiData: { id: 1, osmType: 'node', tags: { website } } })
  const cases = { 'www.example.com': 'https://www.example.com', 'https://a.example;https://b.example': 'https://a.example', 'javascript:alert(1)': null, 'http://x.example/p': 'http://x.example/p' }
  for (const [value, expected] of Object.entries(cases)) {
    const { app, state } = site(value)
    assert.equal(state.safeWebsite, expected, value)
    app.unmount()
  }
})

test('saving waits for the place details still loading, then prefills website, Wikipedia, address and country', async () => {
  const saved = []
  let resolve
  const details = new Promise(r => { resolve = r })
  const poi = { id: 10, osmType: 'node', name: 'Café', lat: 1, lon: 2, tags: { amenity: 'cafe' }, address: null, details }
  const { app, state } = mount(LocationPanel, { open: true, latlng: { lat: 1, lng: 2 }, poiData: poi, onSaveAsMarker: e => saved.push(e) })
  state.saveAsMarker()
  assert.equal(state.saving, true)
  assert.equal(saved.length, 0)
  resolve({ ...poi, details: undefined, tags: { amenity: 'cafe', website: 'cafe.example', wikipedia: 'en:Café' }, address: { road: 'Main Street', house_number: '3', city: 'Town', country_code: 'nl' } })
  await until(() => saved.length)
  assert.equal(state.saving, false)
  assert.deepEqual(saved[0].prefill, { external_url: 'https://cafe.example', wikipedia: 'en:Café', address: '3 Main Street, Town', country: 'Netherlands' })
  app.unmount()
})

test('the elapsed timer stops when the panel closes', async () => {
  const props = reactive({ open: true, latlng: { lat: 1, lng: 2 }, poiLoading: false })
  const app = renderer.createApp({ render: () => h(LocationPanel, { ...props }) })
  LocationPanel.render = () => null
  app.mount({})
  const state = app._instance.subTree.component.setupState
  props.poiLoading = true
  await until(() => state.poiElapsed >= 1, 3000)
  props.open = false
  await nextTick()
  assert.equal(state.poiElapsed, 0)
  await delay(1200)
  assert.equal(state.poiElapsed, 0)
  app.unmount()
})
