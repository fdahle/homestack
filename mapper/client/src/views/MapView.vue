<template>
  <div class="map-shell">

    <!-- Map area (everything that sits over the map) -->
    <div class="map-area">
      <div class="map-container" ref="mapEl" />

      <!-- Centered address search bar -->
      <div class="top-bar">
        <div class="search-wrapper">
          <input
            class="search-input"
            v-model="searchQuery"
            @input="onSearchInput"
            @focus="searchOpen = true"
            @blur="onSearchBlur"
            placeholder="Search address…"
            autocomplete="off"
            type="text"
          />
          <span v-if="searchLoading" class="search-spinner" aria-label="Searching" />
          <button
            v-else-if="searchQuery"
            class="search-clear"
            type="button"
            @mousedown.prevent="clearSearch"
            aria-label="Clear search"
          >✕</button>
          <div class="search-results" v-if="searchOpen && (searchResults.length || (!searchLoading && searchQuery.trim()))">
            <button
              v-for="r in searchResults"
              :key="r.place_id"
              type="button"
              class="search-result-item"
              :class="{ 'is-marker-result': r._marker }"
              @mousedown.prevent="handleSearchSelect(r)"
            >
              <span v-if="r._marker" class="result-pin">◉</span>{{ r.display_name }}
            </button>
            <div v-if="!searchResults.length && !searchLoading" class="search-no-results">
              No results found
            </div>
          </div>
        </div>
      </div>

      <!-- Left slide-in location panel -->
      <LocationPanel
        :open="locationPanelOpen"
        :latlng="locationLatLng"
        :info="locationInfo"
        :loading="locationLoading"
        :poi-data="poiData"
        :poi-loading="poiLoading"
        :poi-alternatives="poiAlternatives"
        @close="closeLocationPanel"
        @save-as-marker="handleSaveAsMarker"
        @select-poi="selectAlternativePoi"
      />

      <!-- Sidebar toggle (shown when sidebar is collapsed) -->
      <button v-show="!sidebarOpen" class="sidebar-open-btn" @click="openSidebar" title="Open panel">
        <AppIcon name="hamburger" />
      </button>

      <!-- Settings (only when sidebar is hidden, otherwise use the one in the sidebar) -->
      <button v-show="!sidebarOpen" class="settings-btn" @click="handleOpenSettings" title="Settings">
        <AppIcon name="settings" />
      </button>

      <!-- Share -->
      <button class="share-btn" @click="shareOpen = true" title="Share">
        <AppIcon name="share" />
      </button>

      <!-- Color mode dropdown -->
      <div class="color-mode-control" ref="colorModeRef">
        <button class="cm-trigger" @click.stop="colorMenuOpen = !colorMenuOpen" :title="'Color by: ' + currentColorMode.label">
          <span class="cm-trigger-label">{{ currentColorMode.label }}</span>
          <AppIcon name="chevronDown" class="cm-chevron" :class="{ open: colorMenuOpen }" />
        </button>
        <div v-if="colorMenuOpen" class="cm-dropdown">
          <button
            v-for="m in COLOR_MODES"
            :key="m.value"
            class="cm-option"
            :class="{ active: styleStore.colorMode === m.value }"
            @click="styleStore.setColorMode(m.value); colorMenuOpen = false"
          >{{ m.label }}</button>
        </div>
      </div>

<!-- Undo route edit -->
      <button
        v-if="undoStack.length > 0"
        class="undo-btn"
        @click="undoRouteEdit"
        title="Undo (Ctrl+Z)"
      ><AppIcon name="undo" /> Undo</button>

<!-- Add marker FAB -->
      <button
        class="add-marker-btn"
        :class="{ active: addMode }"
        @click="toggleAddMode"
        :title="addMode ? 'Click on map to place marker — Esc to cancel' : 'Add a marker'"
      >
        <span class="add-icon">{{ addMode ? '✕' : '+' }}</span>
        {{ addMode ? 'Click map…' : 'Add Marker' }}
      </button>
    </div>

    <!-- Mobile: tap outside sheet to close -->
    <div class="mobile-overlay" v-if="sidebarOpen" @click="closeSidebar" />

    <!-- Right sidebar / bottom sheet -->
    <Transition name="panel">
      <FilterPanel
        v-show="sidebarOpen"
        @new-category="openManageModal('category', null)"
        @edit-category="openManageModal('category', $event)"
        @new-collection="openManageModal('collection', null)"
        @edit-collection="openManageModal('collection', $event)"
        @new-person="openManageModal('person', null)"
        @edit-person="openManageModal('person', $event)"
        @fly-to="(m) => map && map.flyTo([m.lat, m.lng], Math.max(map.getZoom(), 14))"
        @open-marker="openMarkerModal"
        @open-settings="handleOpenSettings"
        @open-stats="statsOpen = true"
        @new-marker="toggleAddMode"
        @close="closeSidebar"
      />
    </Transition>

    <!-- Modals (outside both panes — they're fixed-position overlays) -->
    <MarkerModal
      v-if="modalOpen"
      :marker="editingMarker"
      :latlng="pendingLatLng"
      :suggested-label="markerSuggestedLabel"
      @save="onMarkerSave"
      @delete="onMarkerDelete"
      @close="closeModal"
    />

    <ManageModal
      v-if="manageOpen"
      :type="manageType"
      :item="manageItem"
      @close="manageOpen = false"
    />

    <StatsModal
      v-if="statsOpen"
      @close="statsOpen = false"
    />

    <SettingsModal
      v-if="settingsOpen"
      :current="currentMapView"
      @close="settingsOpen = false"
      @tile-change="applyTileLayer"
      @cluster-change="(v) => reconfigureClustering(v, markersStore.filtered)"
      @open-marker-table="settingsOpen = false; markerTableOpen = true"
      @open-csv-import="settingsOpen = false; csvImportOpen = true"
    />

    <MarkerTableModal
      v-if="markerTableOpen"
      @close="markerTableOpen = false"
      @open-marker="(m) => { markerTableOpen = false; openMarkerModal(m) }"
    />

    <CsvImportModal
      v-if="csvImportOpen"
      @close="csvImportOpen = false"
    />

    <ShareManageModal
      v-if="shareOpen"
      @close="shareOpen = false"
    />

  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useMarkersStore } from '../stores/markers.js'
import { useCategoriesStore } from '../stores/categories.js'
import { useCollectionsStore } from '../stores/collections.js'
import { usePersonsStore } from '../stores/persons.js'
import MarkerModal from '../components/MarkerModal.vue'
import ManageModal from '../components/ManageModal.vue'
import SettingsModal from '../components/SettingsModal.vue'
import StatsModal from '../components/StatsModal.vue'
import LocationPanel from '../components/LocationPanel.vue'
import FilterPanel from '../components/FilterPanel.vue'
import ShareManageModal from '../components/ShareManageModal.vue'
import MarkerTableModal from '../components/MarkerTableModal.vue'
import CsvImportModal from '../components/CsvImportModal.vue'
import { useSearch } from '../composables/useSearch.js'
import { useLocationPanel } from '../composables/useLocationPanel.js'
import { useMarkerLayer } from '../composables/useMarkerLayer.js'
import { useModals } from '../composables/useModals.js'
import { useStyleStore } from '../stores/style.js'
import { loadSegments, saveSegment, fetchSegmentRoute } from '../composables/useTripRouting.js'
import { useMapControl } from '../composables/useMapControl.js'

const SETTINGS_KEY = 'mapper_settings'

const COLOR_MODES = [
  { value: 'marker', label: 'Marker' },
  { value: 'collection', label: 'Collection' },
  { value: 'person', label: 'Person' },
  { value: 'category', label: 'Category' },
]

const styleStore = useStyleStore()
const markersStore = useMarkersStore()
const categoriesStore = useCategoriesStore()
const collectionsStore = useCollectionsStore()
const personsStore = usePersonsStore()

const mapEl = ref(null)
let map = null
const getMap = () => map
let routePolylines = []
let csvPreviewLayer = null
let routeHandles = []
let renderToken = 0
const undoStack = ref([])

// Settings state (stays in MapView — it needs direct map access)
const savedSettings = ref(null)
const currentMapView = ref({ lat: 20, lng: 0, zoom: 2 })
let tileLayer = null

// Color mode dropdown
const colorMenuOpen = ref(false)
const colorModeRef = ref(null)
const currentColorMode = computed(() => COLOR_MODES.find(m => m.value === styleStore.colorMode) ?? COLOR_MODES[0])
watch(colorMenuOpen, (open) => {
  const handler = (e) => { if (colorModeRef.value && !colorModeRef.value.contains(e.target)) colorMenuOpen.value = false }
  if (open) document.addEventListener('click', handler, { once: true })
})

// Add mode
const addMode = ref(false)

// Stats modal
const statsOpen = ref(false)

// Share modal
const shareOpen = ref(false)

// Sidebar — always open on desktop, collapsed by default on mobile
const sidebarOpen = ref(typeof window !== 'undefined' ? window.innerWidth > 640 : true)

const displayMarkers = computed(() => markersStore.filtered)

const tripRouteMarkers = computed(() => {
  const filter = markersStore.activeGroupFilter
  if (!filter || filter.type !== 'collection' || filter.id === '__none__') return null
  const col = collectionsStore.items.find((c) => c.id === filter.id)
  if (!col?.is_trip || (!col?.show_route_line && !col?.show_exact_route)) return null
  return markersStore.filtered
    .map((m) => ({ m, pos: m.collections.find((c) => c.id === filter.id)?.position ?? null }))
    .filter(({ pos }) => pos !== null)
    .sort((a, b) => a.pos - b.pos)
    .map(({ m }) => m)
})

function clearRouteLayer() {
  routePolylines.forEach(p => p.remove())
  routeHandles.forEach(h => h.remove())
  routePolylines = []
  routeHandles = []
}

function pushUndo(colId, fromId, toId, viaPoints) {
  undoStack.value = [...undoStack.value, { colId, fromId, toId, via_points: [...viaPoints] }]
}

async function undoRouteEdit() {
  if (!undoStack.value.length) return
  const entry = undoStack.value[undoStack.value.length - 1]
  undoStack.value = undoStack.value.slice(0, -1)
  try {
    let segMap = {}
    try { segMap = await loadSegments(entry.colId) } catch {}
    const seg = segMap[`${entry.fromId}-${entry.toId}`]
    await saveSegment(entry.colId, entry.fromId, entry.toId, seg?.mode || 'walk', entry.via_points)
  } catch {}
  await renderTripRoute()
}

async function renderTripRoute() {
  const token = ++renderToken
  clearRouteLayer()
  if (!map) return
  const markers = tripRouteMarkers.value
  if (!markers || markers.length < 2) return

  const colId = markersStore.activeGroupFilter?.id
  const col = collectionsStore.items.find((c) => c.id === colId)
  const color = col?.color || '#3b82f6'
  const showStraight = !!col?.show_route_line
  const showExact = !!col?.show_exact_route

  let segmentMap = {}
  try { segmentMap = await loadSegments(colId) } catch {}
  if (token !== renderToken) return

  for (let i = 0; i < markers.length - 1; i++) {
    const from = markers[i]
    const to   = markers[i + 1]
    const seg  = segmentMap[`${from.id}-${to.id}`]
    const viaPoints = seg?.via_points || []

    // Straight reference line
    if (showStraight) {
      const straight = L.polyline([[from.lat, from.lng], [to.lat, to.lng]], {
        color, weight: showExact ? 2 : 3, opacity: showExact ? 0.4 : 0.8, dashArray: showExact ? '6,5' : null,
      }).addTo(map)
      routePolylines.push(straight)
    }

    if (showExact) {
      let routedPath = [[from.lat, from.lng], [to.lat, to.lng]]
      try { routedPath = await fetchSegmentRoute(from, to, viaPoints, seg?.mode || 'walk') } catch {}
      if (token !== renderToken) return
      if (!map) return

      const routedPoly = L.polyline(routedPath, { color, weight: 4, opacity: 0.88 }).addTo(map)
      routePolylines.push(routedPoly)

      // Click on the routed line to insert a via-point
      routedPoly.on('click', async (e) => {
        L.DomEvent.stopPropagation(e)
        const clickLat = e.latlng.lat
        const clickLng = e.latlng.lng
        const allWps = [{ lat: from.lat, lng: from.lng }, ...viaPoints, { lat: to.lat, lng: to.lng }]
        let bestIdx = 0, bestDist = Infinity
        for (let k = 0; k < allWps.length - 1; k++) {
          const d = (clickLat - (allWps[k].lat + allWps[k+1].lat)/2)**2 + (clickLng - (allWps[k].lng + allWps[k+1].lng)/2)**2
          if (d < bestDist) { bestDist = d; bestIdx = k }
        }
        pushUndo(colId, from.id, to.id, viaPoints)
        const newVia = [...viaPoints]
        newVia.splice(bestIdx, 0, { lat: +clickLat.toFixed(6), lng: +clickLng.toFixed(6) })
        try { await saveSegment(colId, from.id, to.id, seg?.mode || 'walk', newVia) } catch {}
        await renderTripRoute()
      })

      // Existing via-point handles: drag to move, click to delete
      for (let j = 0; j < viaPoints.length; j++) {
        const vp = viaPoints[j]
        const capturedJ = j
        const vpHandle = L.marker([vp.lat, vp.lng], {
          draggable: true,
          title: 'Drag to move · Click to delete',
          icon: L.divIcon({
            className: '',
            html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;cursor:grab;box-shadow:0 1px 5px rgba(0,0,0,0.45)"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          }),
        }).addTo(map)
        vpHandle.on('dragend', async (e) => {
          const p = e.target.getLatLng()
          pushUndo(colId, from.id, to.id, viaPoints)
          const newVia = viaPoints.map((v, k) => k === capturedJ ? { lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) } : v)
          try { await saveSegment(colId, from.id, to.id, seg?.mode || 'walk', newVia) } catch {}
          await renderTripRoute()
        })
        vpHandle.on('click', async (ev) => {
          L.DomEvent.stopPropagation(ev)
          pushUndo(colId, from.id, to.id, viaPoints)
          const newVia = viaPoints.filter((_, k) => k !== capturedJ)
          try { await saveSegment(colId, from.id, to.id, seg?.mode || 'walk', newVia) } catch {}
          await renderTripRoute()
        })
        routeHandles.push(vpHandle)
      }

      // Ghost "add" handles at midpoints between consecutive waypoints
      const allWps = [{ lat: from.lat, lng: from.lng }, ...viaPoints, { lat: to.lat, lng: to.lng }]
      for (let j = 0; j < allWps.length - 1; j++) {
        const midLat = (allWps[j].lat + allWps[j+1].lat) / 2
        const midLng = (allWps[j].lng + allWps[j+1].lng) / 2
        const capturedJ = j
        const addHandle = L.marker([midLat, midLng], {
          draggable: true,
          title: 'Drag to add a waypoint here',
          icon: L.divIcon({
            className: '',
            html: `<div style="width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid ${color};opacity:0.75;cursor:grab;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`,
            iconSize: [10, 10],
            iconAnchor: [5, 5],
          }),
          zIndexOffset: -100,
        }).addTo(map)
        addHandle.on('dragend', async (e) => {
          const p = e.target.getLatLng()
          pushUndo(colId, from.id, to.id, viaPoints)
          const newVia = [...viaPoints]
          newVia.splice(capturedJ, 0, { lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) })
          try { await saveSegment(colId, from.id, to.id, seg?.mode || 'walk', newVia) } catch {}
          await renderTripRoute()
        })
        routeHandles.push(addHandle)
      }
    }
  }
}

async function openSidebar() {
  sidebarOpen.value = true
  await nextTick()
  if (map) map.invalidateSize()
}

async function closeSidebar() {
  sidebarOpen.value = false
  await nextTick()
  if (map) map.invalidateSize()
}

// Composables
const { searchQuery, searchResults, searchOpen, searchLoading, searchJustClosed, onSearchInput, onSearchBlur, selectResult, cleanup: cleanupSearch } = useSearch(
  getMap,
  () => markersStore.filtered,
  (marker) => { closeLocationPanel(); addMode.value = false; openMarkerModal(marker) },
)

function clearSearch() {
  searchQuery.value = ''
  searchResults.value = []
  searchOpen.value = false
}

function handleSearchSelect(r) {
  const latlng = selectResult(r)
  if (!r._marker) openLocationPanel(latlng)
}
const { locationPanelOpen, locationLatLng, locationInfo, locationLoading, poiData, poiLoading, poiAlternatives, openLocationPanel, closeLocationPanel, selectAlternativePoi } = useLocationPanel(getMap)
const { renderMarkers, initClusterGroup, reconfigureClustering } = useMarkerLayer(getMap, (marker) => {
  closeLocationPanel()
  addMode.value = false
  openMarkerModal(marker)
})
const {
  modalOpen, editingMarker, pendingLatLng, markerSuggestedLabel,
  manageOpen, manageType, manageItem, settingsOpen, markerTableOpen, csvImportOpen,
  closeModal, openManageModal, openMarkerModal, openNewMarkerModal,
  onMarkerSave, onMarkerDelete,
} = useModals()

const { flyToTarget, csvPreviewMarkers } = useMapControl()

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) } catch { return null }
}

function applyTileLayer(key) {
  const tiles = {
    osm:             { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
    'carto-voyager': { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' },
    'carto-light':   { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', attribution: '&copy; <a href="https://carto.com/">CARTO</a>' },
    topo:            { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>' },
    satellite:       { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community' },
  }
  const t = tiles[key] ?? tiles.osm
  const maxZoom = key === 'topo' ? 17 : 21
  const maxNative = key === 'topo' ? 17 : 19
  if (tileLayer) tileLayer.remove()
  tileLayer = L.tileLayer(t.url, { attribution: t.attribution, maxNativeZoom: maxNative, maxZoom }).addTo(map)
  map.options.maxZoom = maxZoom
  if (map.getZoom() > maxZoom) map.setZoom(maxZoom)
}

onMounted(async () => {
  savedSettings.value = loadSettings()
  const s = savedSettings.value

  await Promise.all([markersStore.fetch(), categoriesStore.fetch(), collectionsStore.fetch(), personsStore.fetch()])

  map = L.map(mapEl.value, { zoomControl: false, maxZoom: 21 }).setView(
    [s?.lat ?? 20, s?.lng ?? 0],
    s?.zoom ?? 2
  )

  if (window.innerWidth > 640) L.control.zoom({ position: 'bottomright' }).addTo(map)
  applyTileLayer(s?.tile ?? 'osm')
  initClusterGroup(s?.cluster !== false)

let clickTimer = null
  map.on('click', (e) => {
    clearTimeout(clickTimer)
    clickTimer = setTimeout(() => {
      if (searchJustClosed.value) {
        searchJustClosed.value = false
        return
      }
      if (addMode.value) {
        addMode.value = false
        openNewMarkerModal(e.latlng, '')
        return
      }
      openLocationPanel(e.latlng)
    }, 250)
  })
  map.on('dblclick', () => { clearTimeout(clickTimer) })

  window.addEventListener('keydown', onKeyDown)
  renderMarkers(displayMarkers.value)
})

onUnmounted(() => {
  clearTimeout(clickTimer)
  clearRouteLayer()
  if (map) map.remove()
  window.removeEventListener('keydown', onKeyDown)
  cleanupSearch()
})

watch(flyToTarget, (target) => {
  if (map && target) map.flyTo([target.lat, target.lng], target.zoom, { duration: 0.8 })
})

watch(csvPreviewMarkers, (markers) => {
  if (!map) return
  if (!csvPreviewLayer) {
    csvPreviewLayer = L.layerGroup().addTo(map)
  }
  csvPreviewLayer.clearLayers()
  for (const m of markers) {
    L.circleMarker([m.lat, m.lng], {
      radius: 7,
      color: m.rejected ? '#ef4444' : '#6b7280',
      fillColor: m.rejected ? '#fca5a5' : '#d1d5db',
      fillOpacity: 0.85,
      weight: 2,
    }).bindTooltip(m.label || `${m.lat.toFixed(4)}, ${m.lng.toFixed(4)}`, { permanent: false }).addTo(csvPreviewLayer)
  }
  if (markers.length === 0 && csvPreviewLayer) {
    csvPreviewLayer.remove()
    csvPreviewLayer = null
  }
}, { deep: true })

function onKeyDown(e) {
  if (e.key === 'Escape') {
    if (addMode.value) addMode.value = false
    else if (locationPanelOpen.value) closeLocationPanel()
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault()
    undoRouteEdit()
  }
}

watch(addMode, (val) => {
  if (map) map.getContainer().style.cursor = val ? 'crosshair' : ''
})

function toggleAddMode() { addMode.value = !addMode.value }

function handleSaveAsMarker({ latlng, suggestedLabel }) {
  closeLocationPanel()
  openNewMarkerModal(latlng, suggestedLabel || '')
}

function handleOpenSettings() {
  if (map) {
    const c = map.getCenter()
    currentMapView.value = { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5), zoom: map.getZoom() }
  }
  settingsOpen.value = true
}


watch(displayMarkers, (markers) => {
  if (map) renderMarkers(markers)
})

// On mobile, open the sidebar when a filter is applied from outside (e.g. chip click in modal)
watch(() => markersStore.activeGroupFilter, (filter) => {
  if (filter && window.innerWidth <= 640) sidebarOpen.value = true
})

watch(() => styleStore.colorMode, () => {
  if (map) renderMarkers(displayMarkers.value)
})

watch(tripRouteMarkers, () => {
  undoStack.value = []
  renderTripRoute()
})
</script>

<style scoped>
.map-shell {
  display: flex;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}

.mobile-overlay { display: none; }

/* Map pane: fills all space left of the sidebar */
.map-area {
  flex: 1;
  position: relative;
  overflow: hidden;
  min-width: 0;
}

.map-container {
  position: absolute;
  inset: 0;
}

.top-bar {
  position: absolute;
  top: 10px;
  left: 0;
  right: 0;
  z-index: 1010;
  display: flex;
  justify-content: center;
  pointer-events: none;
}

.search-wrapper {
  width: 420px;
  max-width: calc(100% - 120px);
  position: relative;
  pointer-events: auto;
}

.search-input {
  width: 100%;
  padding: 9px 36px 9px 14px;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  font-size: 14px;
  color: var(--text);
}
.search-input:focus { border-color: var(--accent); outline: none; }

.search-clear {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--text-muted, #888);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 50%;
}
.search-clear:hover { color: var(--text); }

.search-spinner {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: search-spin 0.6s linear infinite;
}
@keyframes search-spin {
  to { transform: translateY(-50%) rotate(360deg); }
}

.search-results {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  z-index: 1001;
}

.search-result-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text);
  background: none;
  border: none;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.search-result-item:last-child { border-bottom: none; }
.search-result-item:hover { background: var(--surface-2); }
.is-marker-result { border-left: 2px solid var(--accent); }
.result-pin { color: var(--accent); font-size: 10px; margin-right: 4px; }

.search-no-results {
  padding: 10px 12px;
  font-size: 13px;
  color: var(--text-muted, #888);
}

/* Sidebar toggle + settings overlay — only needed on mobile */
.sidebar-open-btn,
.settings-btn { display: none; }

@media (max-width: 640px) {
  /* Full-width search bar — no buttons at top on mobile */
  .top-bar {
    padding-left: 10px;
    padding-right: 10px;
    top: calc(10px + var(--sat, 0px));
  }
  .search-wrapper {
    width: 100%;
    max-width: 100%;
  }

  /* Hamburger moves to bottom-right (thumb zone), mirroring the Add Marker button */
  .sidebar-open-btn {
    display: flex;
    position: absolute;
    bottom: calc(22px + var(--sab, 0px));
    right: 10px;
    top: auto;
    z-index: 1000;
    width: 44px;
    height: 44px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    align-items: center;
    justify-content: center;
    color: var(--text-2);
    padding: 0;
    transition: background 0.12s, color 0.12s;
  }
  .sidebar-open-btn:hover { background: var(--surface-2); color: var(--text); }
  .sidebar-open-btn:active { background: var(--border); }

  /* Settings accessible via the sheet footer — hide the floating button */
  .settings-btn { display: none; }
}


.share-btn {
  position: absolute;
  top: 52px;
  right: 10px;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-2);
  background: var(--surface);
  border: none;
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg), inset 0 0 0 1px var(--border);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.share-btn:hover { background: var(--surface-2); color: var(--text); }

.color-mode-control {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1000;
}

.cm-trigger {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-2);
  background: var(--surface);
  border: none;
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg), inset 0 0 0 1px var(--border);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.1s, color 0.1s;
}
.cm-trigger:hover { background: var(--surface-2); color: var(--text); }

.cm-trigger-label { color: var(--accent); font-weight: 600; }

.cm-chevron { transition: transform 0.15s; flex-shrink: 0; }
.cm-chevron.open { transform: rotate(180deg); }

.cm-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  min-width: 110px;
}

.cm-option {
  display: block;
  width: 100%;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  background: none;
  border: none;
  border-bottom: 1px solid var(--border);
  color: var(--text-2);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.cm-option:last-child { border-bottom: none; }
.cm-option:hover { background: var(--surface-2); color: var(--text); }
.cm-option.active { color: var(--accent); font-weight: 700; background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }

.undo-btn {
  position: absolute;
  bottom: calc(76px + var(--sab, 0px));
  left: 10px;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 13px;
  font-weight: 500;
  box-shadow: var(--shadow-lg);
  cursor: pointer;
  transition: background 0.12s;
}
.undo-btn:hover { background: var(--surface-2); }
.undo-btn:active { background: var(--border); }

.add-marker-btn {
  position: absolute;
  bottom: calc(22px + var(--sab, 0px));
  left: 10px;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  background: var(--accent);
  color: #fff;
  border-radius: 24px;
  font-size: 14px;
  font-weight: 600;
  box-shadow: var(--shadow-lg);
  border: none;
  transition: background 0.15s;
}
.add-marker-btn:hover { background: var(--accent-hover); }
.add-marker-btn:active { opacity: 0.85; }
.add-marker-btn.active { background: var(--danger); }
.add-marker-btn.active:hover { background: var(--danger-hover); }

.add-icon {
  font-size: 18px;
  line-height: 1;
  font-weight: 400;
}

@media (max-width: 640px) {
  .mobile-overlay {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 1999;
  }
}

/* Bottom-sheet slide-up transition (mobile only) */
@media (max-width: 640px) {
  .panel-enter-active,
  .panel-leave-active {
    transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .panel-enter-from,
  .panel-leave-to {
    transform: translateY(100%);
  }

  /* Stack color-mode and share below the full-width search bar on mobile */
  .color-mode-control {
    top: calc(56px + var(--sat, 0px));
    right: 10px;
  }

  .share-btn {
    top: calc(96px + var(--sat, 0px));
  }
}
</style>
