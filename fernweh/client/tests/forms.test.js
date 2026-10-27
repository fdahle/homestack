import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { createRenderer, defineComponent, h, nextTick, ref, shallowRef } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { useMarkersStore } from '../src/stores/markers.js'
import { useCollectionsStore } from '../src/stores/collections.js'
import { useCategoriesStore } from '../src/stores/categories.js'
import { usePersonsStore } from '../src/stores/persons.js'
import { useImportExport } from '../src/composables/useImportExport.js'
import { useDialog } from '../src/composables/useDialog.js'
import { normalizeUrl, parseWikipediaTag } from '../src/utils/url.js'
import { recentPicks } from '../src/utils/recentPicks.js'

const nativeFetch = globalThis.fetch
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
let stored = {}
beforeEach(() => {
  setActivePinia(createPinia())
  stored = {}
  globalThis.localStorage = { getItem: key => stored[key] ?? null, setItem: (key, value) => { stored[key] = value } }
  globalThis.window = { confirm: () => true, location: { origin: 'http://localhost' } }
})
afterEach(() => { globalThis.fetch = nativeFetch; delete globalThis.document; delete globalThis.FileReader })

// Compiles the real SFC script (child components stubbed), as in regressions.test.js.
async function component(name) {
  const url = new URL('../src/components/' + name + '.vue', import.meta.url)
  const { descriptor } = parse(readFileSync(url, 'utf8'))
  const source = compileScript(descriptor, { id: name }).content.replace(/from (['"])(.*?)\1/g, (_match, _quote, specifier) => {
    const target = specifier.endsWith('.vue') ? 'data:text/javascript,export default { render() { return null } }' : specifier.startsWith('.') ? new URL(specifier, url).href : import.meta.resolve(specifier)
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
const flush = () => new Promise(resolve => setTimeout(resolve, 0))
// A FileReader stand-in: "files" are plain objects carrying their text.
class FakeReader { readAsText(file) { this.onload({ target: { result: file.text } }) } }

test('URLs without a scheme get https; ports are not mistaken for schemes', () => {
  assert.equal(normalizeUrl(' example.com '), 'https://example.com')
  assert.equal(normalizeUrl('example.com:8080/x'), 'https://example.com:8080/x')
  assert.equal(normalizeUrl('http://a.org'), 'http://a.org')
  assert.equal(normalizeUrl('//cdn.org/i.png'), 'https://cdn.org/i.png')
  assert.equal(normalizeUrl('  '), null)
})

test('Wikipedia tags parse in lang:Title and URL form', () => {
  assert.deepEqual(parseWikipediaTag('de:Köln: Dom'), { lang: 'de', title: 'Köln: Dom' })
  assert.deepEqual(parseWikipediaTag('https://de.wikipedia.org/wiki/K%C3%B6lner_Dom#Geschichte'), { lang: 'de', title: 'Kölner Dom' })
  assert.deepEqual(parseWikipediaTag('https://en.m.wikipedia.org/wiki/Big_Ben'), { lang: 'en', title: 'Big Ben' })
  assert.equal(parseWikipediaTag('https://example.com/wiki/X'), null)
})

test('backdrop closes only when the press started on it; Escape closes only the topmost dialog', async () => {
  const listeners = {}
  globalThis.document = { activeElement: null, addEventListener: (type, fn) => { listeners[type] = fn }, removeEventListener: type => { delete listeners[type] } }
  const closed = []
  const dialogs = {}
  const Dialog = defineComponent({
    props: { name: String },
    setup(props) {
      dialogs[props.name] = useDialog(ref(null), { close: () => closed.push(props.name) })
      return () => null
    },
  })
  const show = ref(false)
  // One root element: the stub renderer cannot walk a fragment's siblings on unmount.
  const app = renderer.createApp({ render: () => h('div', [h(Dialog, { name: 'outer' }), show.value ? h(Dialog, { name: 'inner' }) : null]) })
  app.mount({})
  const overlay = {}
  dialogs.outer.onOverlayMousedown({ target: {}, currentTarget: overlay }) // text selection started inside
  dialogs.outer.onOverlayClick({ target: overlay, currentTarget: overlay })
  assert.deepEqual(closed, [])
  dialogs.outer.onOverlayMousedown({ target: overlay, currentTarget: overlay })
  dialogs.outer.onOverlayClick({ target: overlay, currentTarget: overlay })
  assert.deepEqual(closed, ['outer'])
  show.value = true
  await nextTick()
  let stopped = false
  listeners.keydown({ key: 'Escape', stopPropagation: () => { stopped = true } })
  assert.deepEqual(closed, ['outer', 'inner'])
  assert.equal(stopped, true)
  app.unmount()
  assert.equal(listeners.keydown, undefined)
})

test('Tab wraps inside the topmost modal dialog; side panels do not trap', async () => {
  const listeners = {}
  globalThis.document = { activeElement: null, addEventListener: (type, fn) => { listeners[type] = fn }, removeEventListener: type => { delete listeners[type] } }
  const node = (name, { disabled = false, hidden = false, tabIndex = 0 } = {}) => ({
    name, tabIndex, matches: () => disabled, closest: () => null, getClientRects: () => (hidden ? [] : [{}]),
    focus() { globalThis.document.activeElement = this },
  })
  const box = items => ({ ...node('box', { tabIndex: -1 }), querySelectorAll: () => items(), contains: el => items().includes(el) })
  const [first, last] = [node('first'), node('last')]
  const extra = ref(false) // a v-if section appearing while the dialog is open
  const outer = box(() => [first, node('disabled', { disabled: true }), node('hidden', { hidden: true }), node('skip', { tabIndex: -1 }), last, ...(extra.value ? [node('extra')] : [])])
  const empty = box(() => [])
  const panel = box(() => [node('panel')])
  const Dialog = defineComponent({
    props: { el: Object, modal: Boolean },
    setup(props) { useDialog(shallowRef(props.el), { close() {}, modal: props.modal }); return () => null },
  })
  const open = shallowRef(null)
  const app = renderer.createApp({ render: () => h('div', [h(Dialog, { el: outer, modal: true }), open.value ? h(Dialog, open.value) : null]) })
  app.mount({})
  await nextTick()
  const tab = (shiftKey = false) => {
    let prevented = false
    listeners.keydown({ key: 'Tab', shiftKey, preventDefault: () => { prevented = true } })
    return prevented && globalThis.document.activeElement.name
  }
  assert.equal(globalThis.document.activeElement, outer) // initial focus on the container
  assert.equal(tab(), 'first')
  assert.equal(tab(true), 'last') // disabled, hidden and tabindex=-1 are skipped
  assert.equal(tab(true), false) // not at an end: the browser moves focus
  globalThis.document.activeElement = last
  assert.equal(tab(), 'first')
  extra.value = true
  globalThis.document.activeElement = last
  assert.equal(tab(), false) // the new field now comes after it
  open.value = { key: 'empty', el: empty, modal: true }
  await nextTick()
  assert.equal(tab(), 'box') // nothing focusable: stays on the nested dialog, the outer one is ignored
  assert.equal(globalThis.document.activeElement, empty)
  open.value = { key: 'panel', el: panel, modal: false }
  await nextTick()
  globalThis.document.activeElement = first
  assert.equal(tab(), false)
  app.unmount()
})

test('cancelling geocoding stops the run and never shows its results', async () => {
  let release
  globalThis.fetch = () => new Promise(resolve => { release = () => resolve(response([{ lat: '1', lon: '2', address: {} }])) })
  const transfer = useImportExport(useMarkersStore())
  transfer.csvRows.value = [{ title: 'Cancelled cafe ' + Date.now(), label: 'A' }, { title: 'Never asked', label: 'B' }]
  const run = transfer.doGeocode()
  await flush()
  assert.equal(transfer.geocoding.value, true)
  transfer.cancelGeocode()
  release?.()
  await run
  assert.equal(transfer.geocoding.value, false)
  assert.equal(transfer.geocodedMarkers.value, null)
  assert.equal(transfer.geocodeProgress.value, 0)
  assert.deepEqual(transfer.csvRows.value.map(r => r.label), ['A', 'B']) // kept for another try
})

test('a failed CSV import keeps the preview and reports what was imported', async () => {
  globalThis.fetch = async () => response({ error: 'Server down' }, 500)
  const transfer = useImportExport(useMarkersStore())
  transfer.geocodedMarkers.value = [{ lat: 1, lng: 2, label: 'X' }]
  await transfer.doCsvImport()
  assert.match(transfer.csvError.value, /Server down/)
  assert.match(transfer.csvStatus.value, /^Stopped — 0 imported/)
  assert.equal(transfer.geocodedMarkers.value.length, 1)
})

test('JSON import skips duplicates and recreates collections with their trip settings', async () => {
  const markers = useMarkersStore()
  markers.items = [{ id: 1, lat: 52.000001, lng: 5, label: 'Existing', categories: [], collections: [], persons: [] }]
  const created = []
  globalThis.fetch = async (url, options) => {
    const data = JSON.parse(options.body)
    if (url === '/api/collections') { created.push(data); return response({ id: 9, ...data }) }
    if (url.endsWith('/import')) return response({ results: data.markers.map((m, index) => ({ index, marker: { id: index + 10, ...m } })) })
    throw new Error('Unexpected request ' + url)
  }
  globalThis.FileReader = FakeReader
  const transfer = useImportExport(markers, useCategoriesStore(), useCollectionsStore(), usePersonsStore())
  transfer.onFileSelected({ target: { files: [{ name: 'export.json', text: JSON.stringify({
    version: 5,
    type: 'export',
    collections: [{ name: 'Alps', is_trip: 1, start_date: '2024-06', color: '#ef4444', show_route_line: 1, description: 'Summer' }],
    markers: [
      { lat: 52, lng: 5, label: 'Existing' },
      { lat: 46, lng: 8, label: 'Pass', collections: [{ name: 'Alps', position: 1 }] },
      { lat: 46, lng: 8, label: 'Pass' },
    ],
  }) }] } })
  await transfer.doImport()
  assert.deepEqual(created, [{ name: 'Alps', description: 'Summer', color: '#ef4444', is_trip: true, show_route_line: true, start_date: '2024-06' }])
  assert.equal(markers.items.length, 2)
  assert.match(transfer.importStatus.value, /1 imported, 2 duplicates skipped, 0 failed/)
})

test('exports carry collection settings; old backups without lists still load', async () => {
  const collections = useCollectionsStore()
  collections.items = [{ id: 3, name: 'Alps', is_trip: 1, start_date: '2024', end_date: null, color: '#10b981', show_route_line: 0, show_exact_route: 1, description: null }]
  globalThis.fetch = async () => response([{ id: 1, lat: 1, lng: 2, label: 'A', categories: [], collections: [{ id: 3, name: 'Alps', position: 2 }], persons: [] }])
  let blob
  globalThis.document = { createElement: () => ({ click() {} }) }
  const { createObjectURL, revokeObjectURL } = URL
  URL.createObjectURL = b => { blob = b; return 'blob:x' }
  URL.revokeObjectURL = () => {}
  try {
    const transfer = useImportExport(useMarkersStore(), useCategoriesStore(), collections, usePersonsStore())
    await transfer.doExport()
    const data = JSON.parse(await blob.text())
    assert.equal(data.version, 5)
    assert.deepEqual(data.collections[0], { name: 'Alps', description: null, is_trip: 1, start_date: '2024', end_date: null, color: '#10b981', show_route_line: 0, show_exact_route: 1 })
    assert.deepEqual(data.markers[0].collections, [{ name: 'Alps', position: 2 }])

    globalThis.FileReader = FakeReader
    transfer.onRestoreFileSelected({ target: { files: [{ name: 'old.json', text: JSON.stringify({ type: 'backup', markers: [] }) }] } })
    assert.deepEqual([transfer.restoreData.value.categories, transfer.restoreData.value.collections, transfer.restoreData.value.persons], [[], [], []])
  } finally { Object.assign(URL, { createObjectURL, revokeObjectURL }) }
})

test('marker form: Back restores the draft, Visited keeps its date, use-coords drops the address on save', async () => {
  globalThis.fetch = async () => response({})
  const saved = []
  const marker = { id: 1, lat: 52, lng: 5, label: 'Old', address: 'Main St 1', visited_at: '2024-05-01', categories: [], collections: [], persons: [] }
  const { app, state } = mount(await component('MarkerModal'), { marker, saveMarker: async data => { saved.push(data) } })
  await nextTick()
  state.startEdit()
  assert.equal(state.isDirty(), false)
  state.form.label = 'New'
  state.visitedChecked = false
  await nextTick()
  assert.equal(state.visitedDate, '2024-05-01')
  state.visitedChecked = true
  await nextTick()
  assert.equal(state.form.visited_at, '2024-05-01')
  assert.equal(state.isDirty(), true)
  state.backToView()
  assert.equal(state.viewing, true)
  assert.equal(state.form.label, 'Old')

  state.startEdit()
  state.useCoordLink = true
  state.form.external_url = 'example.com:8080'
  assert.equal(state.form.address, 'Main St 1')
  await state.save()
  assert.equal(saved[0].address, null)
  assert.equal(saved[0].external_url, 'https://example.com:8080')
  app.unmount()
})

test('new marker form: trip stop is prefilled and the filter-preselected group is not a recent pick', async () => {
  globalThis.fetch = async () => response({})
  const markers = useMarkersStore()
  markers.items = [{ id: 2, lat: 1, lng: 1, categories: [], persons: [], collections: [{ id: 7, position: 3 }] }]
  useCollectionsStore().items = [{ id: 7, name: 'Trip', is_trip: 1, color: '#10b981' }]
  useCategoriesStore().items = [{ id: 5, name: 'Food', color: '#ef4444' }, { id: 6, name: 'Art', color: '#3b82f6' }]
  markers.activeGroupFilter = { type: 'category', id: 5 }
  const { app, state } = mount(await component('MarkerModal'), { latlng: { lat: 52, lng: 5 }, prefill: { address: 'Here', country: 'NL' }, saveMarker: async () => {} })
  await nextTick()
  assert.deepEqual(state.form.category_ids, [5])
  assert.equal(state.isDirty(), false)
  state.form.collection_ids = [7]
  state.onCollectionToggle({ id: 7, is_trip: 1 }, true)
  assert.equal(state.form.collection_positions[7], 4)
  state.form.category_ids = [5, 6]
  await state.save()
  assert.deepEqual(recentPicks().category_ids, [6])
  app.unmount()
})

test('trip stops move with buttons and count as unsaved', async () => {
  const store = useMarkersStore()
  store.items = [1, 2, 3].map(id => ({ id, lat: 52, lng: id, collections: [{ id: 1, position: id }] }))
  globalThis.fetch = async () => response([])
  const { app, state } = mount(await component('TripOrderModal'), { collection: { id: 1 } })
  await flush()
  assert.equal(state.isDirty(), false)
  state.move(0, 1)
  assert.deepEqual(state.localItems.map(i => i.markerId), [2, 1, 3])
  state.move(2, 1) // already last
  assert.equal(state.isDirty(), true)
  app.unmount()
})

test('deleting a trip says how many markers use it and that routes go', async () => {
  useMarkersStore().items = [1, 2].map(id => ({ id, lat: 1, lng: 1, categories: [], persons: [], collections: [{ id: 4, position: id }] }))
  const { app, state } = mount(await component('ManageModal'), { type: 'collection', item: { id: 4, name: 'Alps', is_trip: 1 } })
  assert.match(state.deleteWarning, /2 markers use it/)
  assert.match(state.deleteWarning, /stop order and routes/)
  app.unmount()
})

test('a created share link is edited on the next save and expiry has a time zone', async () => {
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ method: options.method || 'GET', url, body: options.body && JSON.parse(options.body) })
    if (!options.method) return response([])
    return response({ token: 'abc', name: null, hasPassword: false, filter: { all: true, categories: [], collections: [], persons: [], markers: [] }, markerCount: 0, expiresAt: '2030-01-01T22:59:59.999Z' })
  }
  const { app, state } = mount(await component('ShareManageModal'))
  await flush()
  state.openCreateForm()
  state.form.filter.all = true
  state.form.expiresAt = '2030-01-01'
  await state.save()
  assert.match(calls.at(-1).body.expiresAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  assert.equal(state.editingLink.token, 'abc')
  assert.equal(state.isDirty(), false)
  await state.save()
  assert.deepEqual(calls.filter(c => c.method !== 'GET').map(c => c.method + ' ' + c.url), ['POST /api/share-links', 'PUT /api/share-links/abc'])
  app.unmount()
})

test('filter panel: visited sort puts undated visits after dated ones; outside clears leave the detail pane', async () => {
  globalThis.document = { addEventListener() {}, removeEventListener() {} }
  stored.mapper_sort = 'default'
  const markers = useMarkersStore()
  const base = { categories: [{ id: 3 }], collections: [], persons: [] }
  markers.items = [
    { ...base, id: 1, lat: 0, lng: 0, visited_at: 'yes' },
    { ...base, id: 2, lat: 0, lng: 0, visited_at: '2023-01-01' },
    { ...base, id: 3, lat: 0, lng: 0, visited_at: null },
    { ...base, id: 4, lat: 0, lng: 0, visited_at: '2025-01-01' },
  ]
  useCategoriesStore().items = [{ id: 3, name: 'Food', color: '#000000' }]
  const { app, state } = mount(await component('FilterPanel'))
  assert.equal(state.sortOverview, 'name-asc')
  await nextTick()
  assert.equal(stored.mapper_sort, 'name-asc')
  state.drillInto({ type: 'category', id: 3 })
  state.sortBy = 'visited'
  assert.deepEqual(state.detailMarkers.map(m => m.id), [4, 2, 1, 3])
  await nextTick()
  markers.clearGroupFilter()
  await nextTick()
  assert.equal(state.pane, 'overview')
  app.unmount()
})
