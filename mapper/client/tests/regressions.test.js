import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { useMarkersStore } from '../src/stores/markers.js'
import { useCategoriesStore } from '../src/stores/categories.js'
import { useCollectionsStore } from '../src/stores/collections.js'
import { usePersonsStore } from '../src/stores/persons.js'
import { useShareLinksStore } from '../src/stores/shareLinks.js'
import { useImportExport } from '../src/composables/useImportExport.js'
import { useSearch } from '../src/composables/useSearch.js'
import { apiJson, apiFetch, setUnauthorizedHandler } from '../src/api.js'
import { tooltipText } from '../src/utils/mapStyle.js'
import { parseDate, normDate } from '../../shared/dates.js'

const nativeFetch = globalThis.fetch
const response = (data, status = 200, headers) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } })
beforeEach(() => {
  setActivePinia(createPinia())
  globalThis.localStorage = { getItem: () => null, setItem: () => {} }
})
afterEach(() => { globalThis.fetch = nativeFetch; setUnauthorizedHandler(() => {}) })

test('failed GET preserves array state and invalidates authentication', async () => {
  let invalidated = false
  setUnauthorizedHandler(() => { invalidated = true })
  const store = useMarkersStore()
  store.items = [{ id: 1, label: 'Existing' }]
  globalThis.fetch = async () => response({ error: 'Unauthorized' }, 401)
  await assert.rejects(store.fetch(), /Unauthorized/)
  assert.equal(store.filtered[0].label, 'Existing')
  assert.equal(invalidated, true)
  await assert.rejects(store.patchCountry(1, 'NL'))
  assert.equal(store.items[0].country, undefined)
})

test('proxy errors and malformed success bodies are readable errors', async () => {
  globalThis.fetch = async () => new Response('<html>offline</html>', { status: 502 })
  await assert.rejects(apiJson('/api/markers'), /502/)
  globalThis.fetch = async () => new Response('<html>oops</html>')
  await assert.rejects(apiJson('/api/markers'), /invalid response/)
})

test('rate-limit retry respects cancellation', async () => {
  const controller = new AbortController()
  globalThis.fetch = async () => response({}, 429, { 'Retry-After': '900' })
  await assert.rejects(apiFetch('/api/markers/import', { retryRateLimit: true, signal: controller.signal, onRetry: () => controller.abort() }), { name: 'AbortError' })
})

test('restore refreshes all entity stores, clears filters and revokes cached shares', async () => {
  const markers = useMarkersStore(), categories = useCategoriesStore(), collections = useCollectionsStore(), persons = usePersonsStore()
  useShareLinksStore().items = [{ token: 'old' }]
  markers.activeGroupFilter = { type: 'collection', id: 99 }
  const calls = []
  globalThis.fetch = async url => {
    calls.push(url)
    return response(url.endsWith('/restore') ? { counts: { markers: 1, categories: 1, collections: 1, persons: 1 } } : [{ id: 7, name: 'Restored' }])
  }
  const transfer = useImportExport(markers, categories, collections, persons)
  transfer.restoreData.value = { type: 'backup', markers: [] }
  await transfer.doRestore()
  for (const key of ['markers','categories','collections','persons']) assert.ok(calls.includes('/api/' + key))
  assert.equal(persons.items[0].id, 7)
  assert.equal(markers.activeGroupFilter, null)
  assert.equal(useShareLinksStore().items.length, 0)
  assert.equal(markers.revision, 1)
})

test('JSON import supports old names and structured persons and reports relationship failures', async () => {
  const markers = useMarkersStore(), categories = useCategoriesStore(), collections = useCollectionsStore(), persons = usePersonsStore()
  const bodies = []
  globalThis.fetch = async (url, options) => {
    const data = JSON.parse(options.body)
    bodies.push({ url, data })
    if (url === '/api/persons') return response({ id: bodies.length, name: data.first_name, ...data })
    if (url === '/api/categories') return response({ error: 'Category unavailable' }, 400)
    if (url.endsWith('/import')) return response({ results: data.markers.map((m, index) => ({ index, marker: { id: index + 10, ...m } })) })
    throw new Error('Unexpected request ' + url)
  }
  const transfer = useImportExport(markers, categories, collections, persons)
  transfer.importMarkers.value = [
    { lat: 52, lng: 5, persons: ['Older Name'], source: 'original', use_coords: 1 },
    { lat: 53, lng: 6, persons: [{ name: 'New Name', first_name: 'New', last_name: 'Name' }] },
    { lat: 54, lng: 7, label: 'Failed relationship', categories: ['Unavailable'] },
  ]
  await transfer.doImport()
  assert.equal(bodies[0].data.first_name, 'Older Name')
  assert.equal(bodies[1].data.last_name, 'Name')
  assert.equal(markers.items.length, 2)
  assert.equal(markers.items.find(m => m.source === 'original').use_coords, 1)
  assert.equal(transfer.importFailed.value.length, 1)
  assert.match(transfer.importFailed.value[0].label, /Category unavailable/)
})

test('CSV import batches more than 300 rows and retains geocoded country/source', async () => {
  const batches = []
  globalThis.fetch = async (_url, options) => {
    const { markers } = JSON.parse(options.body)
    batches.push(markers)
    return response({ results: markers.map((marker, index) => ({ index, marker: { ...marker, id: batches.length * 100 + index } })) })
  }
  const transfer = useImportExport(useMarkersStore())
  await transfer.doCsvImport(Array.from({ length: 350 }, (_, i) => ({ lat: 52, lng: 5, label: 'Place ' + i, country: 'Netherlands' })))
  assert.deepEqual(batches.map(b => b.length), [100, 100, 100, 50])
  assert.equal(batches[0][0].country, 'Netherlands')
  assert.equal(batches[0][0].source, 'google_maps_csv')
  assert.equal(transfer.csvImportProgress.value, 350)
})

test('stale requests cannot overwrite coordinate searches or cleared searches', async () => {
  let finish
  globalThis.fetch = () => new Promise(resolve => { finish = resolve })
  const search = useSearch(() => null, () => [])
  search.searchQuery.value = 'old place'
  search.onSearchInput()
  search.onSearchSubmit()
  await new Promise(resolve => setTimeout(resolve, 5))
  search.searchQuery.value = '52,5'
  search.onSearchInput()
  finish(response([{ display_name: 'stale' }]))
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(search.searchResults.value[0]._coord, true)
  search.clearSearch()
  assert.deepEqual(search.searchResults.value, [])
  search.cleanup()
})

test('tooltips use text and dates validate leap days and real month ends', () => {
  const previous = globalThis.document
  globalThis.document = { createElement: () => ({}) }
  try {
    const element = tooltipText('<img src=x onerror=alert(1)>')
    assert.equal(element.textContent, '<img src=x onerror=alert(1)>')
    assert.equal(element.innerHTML, undefined)
  } finally { globalThis.document = previous }
  assert.equal(parseDate('29.02.2024'), '2024-02-29')
  assert.equal(parseDate('29.02.2025'), null)
  assert.equal(parseDate('2026-13'), null)
  assert.equal(normDate('2026-02', true), '2026-02-28')
})

// Compile the real SFC script, with child views stubbed because these checks target behavior.
async function component(name, folder = 'components') {
  const url = new URL('../src/' + folder + '/' + name + '.vue', import.meta.url)
  const { descriptor } = parse(readFileSync(url, 'utf8'))
  let source = compileScript(descriptor, { id: name }).content
  source = source.replace(/import ['"][^'"]+\.css['"]/g, '')
  source = source.replace(/from (['"])(.*?)\1/g, (_match, _quote, specifier) => {
    let target = specifier.endsWith('.vue') ? 'data:text/javascript,export default { render() { return null } }' : specifier.startsWith('.') ? new URL(specifier, url).href : import.meta.resolve(specifier)
    if (folder === 'views') {
      if (specifier === 'leaflet') target = 'data:text/javascript,export default new Proxy({}, {get(_, key) {return globalThis.__testLeaflet[key]}})'
      if (specifier === 'vue-router') target = 'data:text/javascript,export const useRoute = () => globalThis.__testRoute'
      if (specifier.endsWith('useMarkerLayer.js')) target = 'data:text/javascript,export const useMarkerLayer = () => ({renderMarkers(){}, initClusterGroup(){}, reconfigureClustering(){}, clearAll(){}})'
      if (specifier.endsWith('useLocationPanel.js')) target = 'data:text/javascript,' + encodeURIComponent(`import { ref } from ${JSON.stringify(import.meta.resolve('vue'))}; export const useLocationPanel = () => ({ locationPanelOpen:ref(false), locationLatLng:ref(null), locationInfo:ref(null),locationLoading:ref(false),locationError:ref(null),poiData:ref(null),poiLoading:ref(false),poiError:ref(null),poiAlternatives:ref([]),openLocationPanel(){},closeLocationPanel(){},selectAlternativePoi(){} })`)
    }
    return 'from ' + JSON.stringify(target)
  })
  return (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default
}
const renderer = createRenderer({ createElement: () => ({}), insert: () => {}, remove: () => {}, setElementText: () => {}, patchProp: () => {}, createText: () => ({}), createComment: () => ({}), parentNode: () => null, nextSibling: () => null })
function mount(Component, props) {
  Component.render = () => null
  const app = renderer.createApp({ render: () => h(Component, props) })
  app.mount({})
  return { app, state: app._instance.subTree.component.setupState }
}

test('marker modal awaits failures and restores Save/Delete controls', async () => {
  globalThis.fetch = async () => response({})
  const Component = await component('MarkerModal')
  const { app, state } = mount(Component, { latlng: { lat: 52, lng: 5 }, saveMarker: async () => { throw new Error('Save rejected') }, deleteMarker: async () => { throw new Error('Delete rejected') }, marker: { id: 1, lat: 52, lng: 5 } })
  await nextTick()
  await state.save()
  assert.equal(state.error, 'Save rejected')
  assert.equal(state.saving, false)
  await state.del()
  assert.equal(state.error, 'Delete rejected')
  assert.equal(state.saving, false)
  app.unmount()
})

test('trip mode edits stay local until Save and skip excluded stops', async () => {
  const store = useMarkersStore()
  store.items = [1,2,3].map(id => ({ id, lat: 52, lng: id, collections: [{ id: 1, position: id }] }))
  const writes = []
  globalThis.fetch = async (_url, options) => {
    if (!options?.method) return response([])
    writes.push(JSON.parse(options.body))
    return response({ ok: true })
  }
  const Component = await component('TripOrderModal')
  const { app, state } = mount(Component, { collection: { id: 1 } })
  await new Promise(resolve => setTimeout(resolve, 5))
  state.toggleExclude(state.localItems[1])
  assert.equal(state.nextStop(0).markerId, 3)
  state.setSegMode(0, 'bike')
  assert.equal(writes.length, 0)
  await state.save()
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].segments, [{ from_marker_id: 1, to_marker_id: 3, mode: 'bike', via_points: [] }])
  assert.equal(writes[0].positions[1].position, null)
  app.unmount()
})

function mapEnvironment() {
  const listeners = new Map()
  const removed = []
  globalThis.window = { innerWidth: 1200, addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) }
  globalThis.document = { body: { style: {} }, addEventListener() {}, removeEventListener() {} }
  globalThis.__testLeaflet = {
    map: () => ({ options: {}, setView() { return this }, getZoom: () => 2, on() { return this }, remove() { removed.push('map') }, invalidateSize() {} }),
    control: { zoom: () => ({ addTo() {} }) },
    tileLayer: () => ({ addTo() { return this }, remove() {} }),
  }
  return { listeners, removed }
}

test('MapView mounts and tears down map/keyboard handlers without an out-of-scope timer', async () => {
  const env = mapEnvironment()
  globalThis.fetch = async () => response([])
  const Component = await component('MapView', 'views')
  const { app, state } = mount(Component)
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(state.mapLoadError, '')
  assert.ok(env.listeners.has('keydown'))
  app.unmount()
  assert.deepEqual(env.removed, ['map'])
  assert.equal(env.listeners.has('keydown'), false)
  assert.equal(env.listeners.has('popstate'), false)
})

test('public share recovers from network errors and reloads when token changes', async () => {
  mapEnvironment()
  globalThis.__testRoute = reactive({ params: { token: 'first' } })
  globalThis.fetch = async () => { throw new Error('offline') }
  const Component = await component('ShareView', 'views')
  const { app, state } = mount(Component)
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(state.state, 'error')
  assert.equal(state.loading, false)
  globalThis.fetch = async () => response({ requiresPassword: true, meta: { name: 'Protected' } }, 401)
  await state.requestShare()
  assert.equal(state.state, 'password')
  state.passwordInput = 'test-password'
  globalThis.fetch = async () => { throw new Error('offline') }
  await state.submitPassword()
  assert.equal(state.loading, false)
  assert.match(state.gateError, /connection/)
  const urls = []
  globalThis.fetch = async url => { urls.push(url); return response({ meta: { name: 'Second' }, markers: [], categories: [], collections: [], persons: [] }) }
  globalThis.__testRoute.params.token = 'second'
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.match(urls[0], /second\/data/)
  assert.equal(state.state, 'loaded')
  assert.equal(state.shareMeta.name, 'Second')
  app.unmount()
})

test('typing searches local markers only; Nominatim runs on Enter and repeated lookups are cached', async () => {
  const calls = []
  globalThis.fetch = async url => { calls.push(String(url)); return response([{ place_id: 1, display_name: 'Cached town', lat: '1', lon: '2' }]) }
  const search = useSearch(() => null, () => [{ id: 1, label: 'Cached café', lat: 1, lng: 2 }])
  search.searchQuery.value = 'cached'
  search.onSearchInput()
  await new Promise(resolve => setTimeout(resolve, 450))
  assert.equal(calls.length, 0)
  assert.equal(search.searchResults.value[0]._marker, true)
  await search.onSearchSubmit()
  assert.equal(calls.length, 1)
  assert.equal(search.searchResults.value.length, 2)
  assert.equal(search.searchSubmitted.value, true)
})

test('Nominatim requests are spaced at least one second apart', async () => {
  const { nominatim } = await import('../src/utils/nominatim.js')
  const times = []
  globalThis.fetch = async () => { times.push(Date.now()); return response([]) }
  await Promise.all([nominatim('search', { q: 'spacing-a' }), nominatim('search', { q: 'spacing-b' })])
  assert.equal(times.length, 2)
  assert.ok(times[1] - times[0] >= 1000)
})

