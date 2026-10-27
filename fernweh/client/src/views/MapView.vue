<template>
  <div class="map-shell">

    <!-- Map area (everything that sits over the map) -->
    <div class="map-area">
      <div class="map-container" ref="mapEl" />

      <!-- Messages over the map, stacked below the controls so they never cover each other -->
      <div class="map-status-stack">
        <div v-if="filterChip" class="filter-chip" role="status">
          <button type="button" class="filter-chip-label" :title="filterChip.title" @click="openSidebar">
            <span class="filter-chip-dot" :style="{ background: filterChip.color }" />
            Filtered: <strong>{{ filterChip.name }}</strong>
            <span v-if="filterChip.more" class="filter-chip-more">+{{ filterChip.more }}</span>
          </button>
          <button type="button" class="filter-chip-clear" aria-label="Clear filters" title="Clear filters" @click="markersStore.clearGroupFilter()">✕</button>
        </div>
        <!-- Move mode: drag the pin or click the map, then save -->
        <div v-if="moveTarget" class="move-banner" role="dialog" aria-label="Move marker">
          <span>Drag the pin or click the map to move <strong>{{ moveTarget.label || 'this marker' }}</strong></span>
          <span v-if="moveError" class="move-error">{{ moveError }}</span>
          <div class="move-actions">
            <button type="button" class="btn-secondary" :disabled="moveSaving" @click="cancelMove">Cancel</button>
            <button type="button" class="btn-primary" :disabled="moveSaving" @click="saveMove">{{ moveSaving ? '…' : 'Save position' }}</button>
          </div>
        </div>
        <div v-if="mapLoading || mapLoadError" class="map-status" role="status">
          {{ mapLoadError || 'Loading map…' }}
          <button v-if="mapLoadError" @click="initializeMap">Retry</button>
        </div>
        <div v-if="routeError" class="map-status" role="alert">{{ routeError }} <button @click="routeError = ''">Dismiss</button></div>
        <div v-if="locateError" class="map-status" role="alert">{{ locateError }} <button @click="locateError = ''">Dismiss</button></div>
      </div>

      <!-- Centered address search bar -->
      <div class="top-bar">
        <div class="search-wrapper">
          <input
            class="search-input"
            v-model="searchQuery"
            @input="onSearchInput"
            @keydown.enter.prevent="onSearchSubmit"
            @paste="onSearchPaste"
            @focus="searchOpen = true"
            @blur="onSearchBlur"
            placeholder="Search address or paste a Google Maps link…"
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
            <div v-if="searchError && !searchLoading" class="search-error">
              <span class="search-error-icon">⚠</span>{{ searchError }}
            </div>
            <div v-else-if="!searchSubmitted && !searchLoading && !searchResults[0]?._coord" class="search-no-results">
              Press Enter to search places
            </div>
            <div v-else-if="!searchResults.length && !searchLoading" class="search-no-results">
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
        :loading="locationLoading && !poiData"
        :poi-data="poiData"
        :poi-loading="poiLoading"
        :poi-alternatives="poiAlternatives"
        :location-error="locationError"
        :poi-error="poiError"
        :poi-status="poiStatus"
        :hint="placeHint"
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

      <!-- Locate me -->
      <button class="share-btn locate-btn" :class="{ busy: locating }" :disabled="locating" @click="locateMe" title="Show my location" aria-label="Show my location">
        <AppIcon name="location" />
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

<!-- Active trip: distance, duration and GPX export -->
      <TripSummaryChip v-if="tripSummary" :summary="tripSummary" />

<!-- Undo the last marker deletion -->
      <div v-if="markersStore.lastDeleted" class="delete-toast" role="status">
        <span>Deleted “{{ markersStore.lastDeleted.label || 'marker' }}”</span>
        <button type="button" :disabled="undoingDelete" @click="undoDelete">Undo</button>
        <button type="button" class="toast-close" aria-label="Dismiss" @click="markersStore.lastDeleted = null">✕</button>
      </div>

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
        class="safe-sidebar"
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
      :prefill="markerPrefill"
      :save-marker="onMarkerSave"
      :delete-marker="onMarkerDelete"
      @close="closeModal"
      @move="startMove"
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
import { loadSettings } from '../utils/settings.js'
import { COLOR_MODES, tileOptions, tooltipText, validTileKey } from '../utils/mapStyle.js'
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
import { findGoogleMapsLink } from '../utils/googleMaps.js'
import { useLocationPanel } from '../composables/useLocationPanel.js'
import { useMarkerLayer } from '../composables/useMarkerLayer.js'
import { useModals } from '../composables/useModals.js'
import { useStyleStore } from '../stores/style.js'
import { useAuthStore } from '../stores/auth.js'
import { loadSegments, saveSegment } from '../composables/useTripRouting.js'
import { useMapControl } from '../composables/useMapControl.js'
import { useTripRouteLayer } from '../composables/useTripRouteLayer.js'
import TripSummaryChip from '../components/TripSummaryChip.vue'

const styleStore = useStyleStore()
const markersStore = useMarkersStore()
const categoriesStore = useCategoriesStore()
const collectionsStore = useCollectionsStore()
const personsStore = usePersonsStore()
const authStore = useAuthStore()

const mapEl = ref(null)
let map = null
let clickTimer = null
let disposed = false
const mapLoading = ref(false)
const mapLoadError = ref('')
const routeEditBusy = ref(false)
const getMap = () => map
let csvPreviewLayer = null
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

const { tripSummary, routeError, render: renderTripRoute, dispose: disposeTripRoute } = useTripRouteLayer(getMap, {
  getSegments: loadSegments,
  onEdit: applyRouteEdit,
})

function pushUndo(colId, fromId, toId, viaPoints) {
  undoStack.value = [...undoStack.value, { colId, fromId, toId, via_points: [...viaPoints] }]
}

async function applyRouteEdit(colId, fromId, toId, mode, points, previous) {
  if (routeEditBusy.value || disposed) return
  routeEditBusy.value = true
  routeError.value = ''
  try {
    await saveSegment(colId, fromId, toId, mode, points)
    if (disposed) return
    const filter = markersStore.activeGroupFilter
    if (filter?.type === 'collection' && filter.id === colId) pushUndo(colId, fromId, toId, previous)
  } catch (err) { routeError.value = err.message }
  finally { routeEditBusy.value = false }
  if (!disposed) await renderTripRoute()
}

async function undoRouteEdit() {
  if (!undoStack.value.length || routeEditBusy.value) return
  routeEditBusy.value = true
  const entry = undoStack.value.at(-1)
  try {
    const segMap = await loadSegments(entry.colId)
    await saveSegment(entry.colId, entry.fromId, entry.toId, segMap[entry.fromId + '-' + entry.toId]?.mode || 'walk', entry.via_points)
    undoStack.value = undoStack.value.filter(e => e !== entry)
  } catch (err) { routeError.value = err.message }
  finally { routeEditBusy.value = false }
  if (!disposed) await renderTripRoute()
}

// ── Undo delete ─────────────────────────────────────────────────────────────
const undoingDelete = ref(false)
let deleteToastTimer = null
watch(() => markersStore.lastDeleted, (deleted) => {
  clearTimeout(deleteToastTimer)
  if (deleted) deleteToastTimer = setTimeout(() => { markersStore.lastDeleted = null }, 10000)
})

async function undoDelete() {
  const deleted = markersStore.lastDeleted
  if (!deleted || undoingDelete.value) return
  undoingDelete.value = true
  try { await markersStore.restoreFromTrash(deleted.id) }
  catch (err) { routeError.value = 'Could not restore the marker: ' + err.message }
  finally { undoingDelete.value = false }
}

// ── Locate me ───────────────────────────────────────────────────────────────
const locating = ref(false)
const locateError = ref('')
let locationLayer = null

function locateMe() {
  if (!navigator.geolocation) { locateError.value = 'This browser cannot share your location.'; return }
  locating.value = true
  locateError.value = ''
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      locating.value = false
      if (!map) return
      const { latitude, longitude, accuracy } = pos.coords
      locationLayer?.remove()
      locationLayer = L.layerGroup([
        L.circle([latitude, longitude], { radius: accuracy, color: '#2563eb', weight: 1, fillOpacity: 0.08, interactive: false }),
        L.circleMarker([latitude, longitude], { radius: 7, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1, interactive: false }),
      ]).addTo(map)
      map.flyTo([latitude, longitude], Math.max(map.getZoom(), 15), { duration: 0.8 })
    },
    (err) => {
      locating.value = false
      // Geolocation also requires HTTPS; browsers report that as a permission error.
      locateError.value = err.code === 1 ? 'Location access was denied (it also needs HTTPS).' : 'Could not determine your location.'
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
  )
}

// ── Move a marker ───────────────────────────────────────────────────────────
const moveTarget = ref(null)
const moveSaving = ref(false)
const moveError = ref('')
let movePin = null
const MOVE_PIN_HTML = '<svg width="26" height="38" viewBox="0 0 22 32" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11 0C4.9 0 0 4.9 0 11c0 8.25 11 21 11 21S22 19.25 22 11C22 4.9 17.1 0 11 0z" fill="#f97316"/><circle cx="11" cy="11" r="4.5" fill="white"/></svg>'

function startMove(marker) {
  if (!map || !marker) return
  closeModal()
  closeLocationPanel()
  addMode.value = false
  moveError.value = ''
  moveTarget.value = marker
  movePin?.remove()
  const icon = L.divIcon({ className: '', html: MOVE_PIN_HTML, iconSize: [26, 38], iconAnchor: [13, 38] })
  movePin = L.marker([marker.lat, marker.lng], { draggable: true, icon, zIndexOffset: 2000, autoPan: true }).addTo(map)
  map.panTo([marker.lat, marker.lng])
}

function endMove() {
  movePin?.remove()
  movePin = null
  moveTarget.value = null
  moveSaving.value = false
}

function cancelMove() {
  const marker = moveTarget.value
  endMove()
  if (marker) openMarkerModal(markersStore.items.find((m) => m.id === marker.id) ?? marker)
}

async function saveMove() {
  if (!moveTarget.value || !movePin || moveSaving.value) return
  const { lat, lng } = movePin.getLatLng()
  moveSaving.value = true
  moveError.value = ''
  try {
    const updated = await markersStore.update(moveTarget.value.id, { lat: +lat.toFixed(6), lng: +lng.toFixed(6) })
    endMove()
    openMarkerModal(updated)
    resetLegsAround(updated.id).catch((err) => { if (!disposed) routeError.value = 'The route around the moved stop could not be reset: ' + err.message })
  } catch (err) {
    moveError.value = err.message
    moveSaving.value = false
  }
}

// Via-points shape the legs into and out of a trip stop. After the stop moves they would drag the
// route back towards its old place, so those two legs start over as direct routes (mode kept).
async function resetLegsAround(markerId) {
  const marker = markersStore.items.find((m) => m.id === markerId)
  const trips = (marker?.collections ?? []).filter((c) => c.position != null && collectionsStore.items.find((col) => col.id === c.id)?.is_trip)
  let changed = false
  for (const { id: colId } of trips) {
    const stops = markersStore.items
      .map((m) => ({ id: m.id, pos: m.collections?.find((c) => c.id === colId)?.position ?? null }))
      .filter((s) => s.pos != null)
      .sort((a, b) => a.pos - b.pos)
    const i = stops.findIndex((s) => s.id === markerId)
    const legs = [[stops[i - 1]?.id, markerId], [markerId, stops[i + 1]?.id]].filter(([from, to]) => from != null && to != null)
    if (!legs.length) continue
    const segments = await loadSegments(colId)
    for (const [from, to] of legs) {
      const seg = segments[`${from}-${to}`]
      if (!seg?.via_points?.length) continue
      await saveSegment(colId, from, to, seg.mode || 'walk', [])
      changed = true
    }
  }
  if (changed) markersStore.bumpRouteRevision()
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
const { searchQuery, searchResults, searchOpen, searchLoading, searchError, searchJustClosed, searchSubmitted, clearSearch, onSearchInput, onSearchSubmit, onSearchBlur, selectResult, openSharedLink, cleanup: cleanupSearch } = useSearch(
  getMap,
  () => markersStore.items,
  undefined,
  (place) => {
    addMode.value = false
    openLocationPanel({ lat: place.lat, lng: place.lng }, { name: place.name, approximate: place.approximate })
  },
)

// A pasted Google Maps link opens straight away; anything else waits for Enter as usual.
function onSearchPaste(e) {
  const text = e.clipboardData?.getData('text') ?? ''
  if (!findGoogleMapsLink(text)) return
  e.preventDefault()
  searchQuery.value = text.trim()
  closeLocationPanel()
  openSharedLink(text)
}

// Shared to the installed app from another app's share sheet (Android, see share_target in the
// manifest): /?share_title=…&share_text=…&share_url=…
function takeSharedText() {
  if (!globalThis.location?.search) return null
  const params = new URLSearchParams(location.search)
  const shared = ['share_title', 'share_text', 'share_url'].map((k) => params.get(k)).filter(Boolean).join('\n')
  if (!shared) return null
  for (const k of ['share_title', 'share_text', 'share_url']) params.delete(k)
  const query = params.toString()
  history.replaceState(history.state, '', location.pathname + (query ? `?${query}` : '') + location.hash)
  return shared
}
function openSharedText() {
  const shared = takeSharedText()
  if (!shared) return
  searchQuery.value = shared.replace(/\s+/g, ' ').trim()
  if (findGoogleMapsLink(shared)) openSharedLink(shared)
  else onSearchInput()
}

// Search results only move the map; clicking the spot or marker opens details. Markers are
// searched across all groups, and one hidden by the current filter has no pin to click there,
// so that one opens directly (the filter stays as the user set it).
function handleSearchSelect(r) {
  closeLocationPanel()
  selectResult(r)
  const id = r._markerObj?.id
  if (r._marker && !markersStore.filtered.some((m) => m.id === id)) {
    addMode.value = false
    openMarkerModal(markersStore.items.find((m) => m.id === id) ?? r._markerObj)
  }
}
const { locationPanelOpen, locationLatLng, locationInfo, locationLoading, locationError, poiData, poiLoading, poiError, poiStatus, poiAlternatives, placeHint, openLocationPanel, closeLocationPanel, selectAlternativePoi } = useLocationPanel(getMap)
const { renderMarkers, initClusterGroup, reconfigureClustering } = useMarkerLayer(getMap, (marker) => {
  closeLocationPanel()
  addMode.value = false
  openMarkerModal(marker)
})
const {
  modalOpen, editingMarker, pendingLatLng, markerSuggestedLabel, markerPrefill,
  manageOpen, manageType, manageItem, settingsOpen, markerTableOpen, csvImportOpen,
  closeModal, openManageModal, openMarkerModal, openNewMarkerModal,
  onMarkerSave, onMarkerDelete,
} = useModals()

const { flyToTarget, csvPreviewMarkers } = useMapControl()

// Prevent pull-to-refresh when the bottom sheet is open on mobile.
watch(sidebarOpen, (open) => {
  document.body.style.overscrollBehaviorY = open ? 'none' : ''
})

// Push a history entry when any modal or the location panel opens so the back gesture can close it.
watch(
  () => modalOpen.value || manageOpen.value || settingsOpen.value || statsOpen.value || markerTableOpen.value || csvImportOpen.value || shareOpen.value || locationPanelOpen.value,
  (anyOpen, wasOpen) => {
    if (anyOpen && !wasOpen) history.pushState({ ...history.state, mapperModal: true }, '')
    if (!anyOpen && wasOpen && history.state?.mapperModal) history.back()
  }
)

function handlePopState() {
  if (modalOpen.value) { closeModal(); return }
  if (manageOpen.value) { manageOpen.value = false; return }
  if (settingsOpen.value) { settingsOpen.value = false; return }
  if (statsOpen.value) { statsOpen.value = false; return }
  if (markerTableOpen.value) { markerTableOpen.value = false; return }
  if (csvImportOpen.value) { csvImportOpen.value = false; return }
  if (shareOpen.value) { shareOpen.value = false; return }
  if (locationPanelOpen.value) closeLocationPanel()
}

onUnmounted(() => { window.removeEventListener('popstate', handlePopState) })

function applyTileLayer(key) {
  if (!map) return
  const t = tileOptions(key)
  if (tileLayer) tileLayer.remove()
  tileLayer = L.tileLayer(t.url, t).addTo(map)
  // setMaxZoom (unlike assigning options.maxZoom) clamps the view and updates the zoom buttons.
  map.setMaxZoom(t.maxZoom)
}

async function initializeMap() {
  if (mapLoading.value || disposed || map) return
  mapLoading.value = true
  mapLoadError.value = ''
  try {
  window.addEventListener('popstate', handlePopState)
  savedSettings.value = loadSettings()
  const s = savedSettings.value

  await Promise.all([markersStore.fetch(), categoriesStore.fetch(), collectionsStore.fetch(), personsStore.fetch()])
  if (disposed) return

  map = L.map(mapEl.value, { zoomControl: false, maxZoom: 21 }).setView(
    [s?.lat ?? 20, s?.lng ?? 0],
    s?.zoom ?? 2
  )

  if (window.innerWidth > 640) L.control.zoom({ position: 'bottomright' }).addTo(map)
  applyTileLayer(validTileKey(s?.tile))
  initClusterGroup(s?.cluster !== false)

  map.on('click', (e) => {
    if (moveTarget.value) { movePin?.setLatLng(e.latlng); return }
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
  authStore.offline = false
  // Not awaited: slow routing services must not keep "Loading map…" up; route errors show on their own.
  renderTripRoute()
  openSharedText()
  } catch (err) {
    mapLoadError.value = err.message
    if (map) { map.remove(); map = null }
  } finally { mapLoading.value = false }
}
onMounted(initializeMap)

onUnmounted(() => {
  disposed = true
  clearTimeout(deleteToastTimer)
  markersStore.lastDeleted = null
  disposeTripRoute()
  movePin = null
  closeLocationPanel()
  document.body.style.overscrollBehaviorY = ''
  clearTimeout(clickTimer)
  if (map) { map.remove(); map = null }
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
    }).bindTooltip(tooltipText(m.label || `${m.lat.toFixed(4)}, ${m.lng.toFixed(4)}`), { permanent: false }).addTo(csvPreviewLayer)
  }
  if (markers.length === 0 && csvPreviewLayer) {
    csvPreviewLayer.remove()
    csvPreviewLayer = null
  }
}, { deep: true })

function onKeyDown(e) {
  if (e.key === 'Escape') {
    if (moveTarget.value) cancelMove()
    else if (addMode.value) addMode.value = false
    else if (locationPanelOpen.value) closeLocationPanel()
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.target.closest('input, textarea, [contenteditable=true]')) {
    e.preventDefault()
    undoRouteEdit()
  }
}

watch(addMode, (val) => {
  if (map) map.getContainer().style.cursor = val ? 'crosshair' : ''
})

function toggleAddMode() { addMode.value = !addMode.value }

function handleSaveAsMarker({ latlng, suggestedLabel, prefill }) {
  closeLocationPanel()
  openNewMarkerModal(latlng, suggestedLabel || '', prefill)
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

// Open the sidebar when a filter is applied from outside (e.g. chip click in the marker modal),
// so the active group is always shown somewhere. Closing it afterwards leaves the map chip.
watch(() => markersStore.activeGroupFilter, (filter) => {
  if (filter && !sidebarOpen.value) openSidebar()
})

// The sidebar has no collapse control on desktop; one closed on a narrow window comes back
// when the window widens.
const desktopQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 641px)') : null
const onDesktopChange = (e) => { if (e.matches && !sidebarOpen.value) openSidebar() }
desktopQuery?.addEventListener?.('change', onDesktopChange)
onUnmounted(() => desktopQuery?.removeEventListener?.('change', onDesktopChange))

// With the sidebar closed nothing else says that markers are hidden by a filter.
const NONE_NAMES = { category: 'Uncategorized', collection: 'No collection', person: 'No person' }
const SMART_NAMES = { favorites: 'Favorites', planned: 'Planned' }
const GROUP_STORES = { category: categoriesStore, collection: collectionsStore, person: personsStore }
const filterChip = computed(() => {
  const filter = markersStore.activeGroupFilter
  if (!filter || sidebarOpen.value) return null
  const item = GROUP_STORES[filter.type]?.items.find((i) => i.id === filter.id)
  const name = filter.type === 'smart' ? SMART_NAMES[filter.id] : filter.id === '__none__' ? NONE_NAMES[filter.type] : item?.name
  const visited = { visited: ' · visited', unvisited: ' · not visited' }[markersStore.visitedFilter] ?? ''
  // Refinements show as a count to keep the chip short; their names are in the tooltip.
  const refined = markersStore.refineFilters.map((r) => GROUP_STORES[r.type]?.items.find((i) => i.id === r.id)?.name).filter(Boolean)
  const title = refined.length ? `Show in panel (also: ${refined.join(', ')})` : 'Show in panel'
  return { name: (name || 'Group') + visited, more: markersStore.refineFilters.length, title, color: item?.color || '#9ca3af' }
})

watch(() => styleStore.colorMode, () => {
  if (map) renderMarkers(displayMarkers.value)
})

watch(() => markersStore.revision, () => { undoStack.value = []; closeModal(); manageOpen.value = false; renderTripRoute() })

// Undo entries belong to the trip on screen: keyed by type and id, since category 3 and
// collection 3 are different groups.
watch(() => { const f = markersStore.activeGroupFilter; return f ? `${f.type}:${f.id}` : '' }, () => { undoStack.value = [] })
// Reordering stops or changing leg modes rewrites the legs the undo entries refer to.
watch(() => markersStore.routeRevision, () => { undoStack.value = [] })
</script>

<style scoped>
/* Below the search bar, clear of the right-hand buttons; under the dropdowns (z-index 1000+). */
.map-status-stack {
  position: absolute;
  top: calc(56px + var(--sat, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 999;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: max-content;
  max-width: min(520px, calc(100% - 120px - var(--sal, 0px) - var(--sar, 0px)));
  pointer-events: none;
}
.map-status-stack > * { pointer-events: auto; max-width: 100%; }
.map-status { padding: 10px 12px; background: var(--surface); color: var(--text); border-radius: 8px; box-shadow: var(--shadow); font-size: 13px; }
.map-status button { padding: 2px 8px; margin-left: 6px; background: var(--surface-2); color: var(--text); }
.filter-chip {
  display: flex;
  align-items: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  box-shadow: var(--shadow-lg);
  font-size: 12px;
  color: var(--text-2);
}
.filter-chip button { background: none; color: inherit; font-size: 12px; }
.filter-chip-label { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 5px 4px 5px 12px; }
.filter-chip-label strong { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.filter-chip-more { flex-shrink: 0; font-weight: 600; color: var(--accent); }
.filter-chip-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.filter-chip-clear { padding: 5px 10px 5px 6px; }
.filter-chip-clear:hover { color: var(--text); }
@media (max-width: 640px) {
  /* Mobile stacks the colour-mode, share and locate buttons on the right below the search bar. */
  .map-status-stack { top: calc(178px + var(--sat, 0px)); max-width: calc(100% - 20px - var(--sal, 0px) - var(--sar, 0px)); }
}

/* Landscape notches: keep the sidebar content and Leaflet's own controls clear of them. */
.safe-sidebar { padding-right: var(--sar, 0px); }
@media (max-width: 640px) {
  .safe-sidebar { padding-left: var(--sal, 0px); }
}
.map-area :deep(.leaflet-left) { left: var(--sal, 0px); }
.map-area :deep(.leaflet-right) { right: var(--sar, 0px); }
.map-area :deep(.leaflet-bottom) { bottom: var(--sab, 0px); }
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

.search-error {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 10px 12px;
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--text);
}

.search-error-icon {
  flex-shrink: 0;
  color: #e0a800;
}

/* Sidebar toggle + settings overlay — only needed on mobile */
.sidebar-open-btn,
.settings-btn { display: none; }

@media (max-width: 640px) {
  /* Full-width search bar — no buttons at top on mobile */
  .top-bar {
    padding-left: calc(10px + var(--sal, 0px));
    padding-right: calc(10px + var(--sar, 0px));
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
    right: calc(10px + var(--sar, 0px));
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
  right: calc(10px + var(--sar, 0px));
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
.locate-btn { top: 94px; }
.locate-btn.busy { color: var(--accent); }

.color-mode-control {
  position: absolute;
  top: 10px;
  right: calc(10px + var(--sar, 0px));
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
  left: calc(10px + var(--sal, 0px));
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

.delete-toast {
  position: absolute;
  bottom: calc(76px + var(--sab, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 1100;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 8px 14px;
  background: var(--text);
  color: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  font-size: 13px;
  max-width: calc(100% - 32px);
}
.delete-toast span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.delete-toast button { background: none; color: inherit; padding: 4px 8px; font-weight: 700; }
.delete-toast .toast-close { font-weight: 400; opacity: 0.7; }
@media (max-width: 640px) {
  .delete-toast { bottom: calc(126px + var(--sab, 0px)); }
}

.move-banner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  font-size: 13px;
  text-align: center;
}
.move-actions { display: flex; gap: 8px; }
.move-actions .btn-primary { background: var(--accent); color: #fff; font-weight: 600; }
.move-actions .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.move-actions .btn-secondary { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); }
.move-error { color: var(--danger); font-size: 12px; }

.add-marker-btn {
  position: absolute;
  bottom: calc(22px + var(--sab, 0px));
  left: calc(10px + var(--sal, 0px));
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
    right: calc(10px + var(--sar, 0px));
  }

  .share-btn {
    top: calc(96px + var(--sat, 0px));
  }
  .locate-btn {
    top: calc(136px + var(--sat, 0px));
  }
}
</style>
