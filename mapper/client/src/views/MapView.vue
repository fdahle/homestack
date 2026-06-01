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
            type="search"
          />
          <div class="search-results" v-if="searchOpen && searchResults.length">
            <button
              v-for="r in searchResults"
              :key="r.place_id"
              type="button"
              class="search-result-item"
              @mousedown.prevent="handleSearchSelect(r)"
            >
              {{ r.display_name }}
            </button>
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
        @close="closeLocationPanel"
        @save-as-marker="handleSaveAsMarker"
      />

      <!-- Sidebar toggle (shown when sidebar is collapsed) -->
      <button v-show="!sidebarOpen" class="sidebar-open-btn" @click="openSidebar" title="Open panel">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <rect x="1" y="3" width="16" height="2" rx="1" fill="currentColor"/>
          <rect x="1" y="8" width="16" height="2" rx="1" fill="currentColor"/>
          <rect x="1" y="13" width="16" height="2" rx="1" fill="currentColor"/>
        </svg>
      </button>

      <!-- Settings (only when sidebar is hidden, otherwise use the one in the sidebar) -->
      <button v-show="!sidebarOpen" class="settings-btn" @click="handleOpenSettings" title="Settings">⚙</button>

      <!-- Color mode floating control -->
      <div class="color-mode-control">
        <button
          v-for="m in COLOR_MODES"
          :key="m.value"
          class="cm-btn"
          :class="{ active: styleStore.colorMode === m.value }"
          @click="styleStore.colorMode = m.value"
          :title="'Color by ' + m.label"
        >{{ m.label }}</button>
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

    <!-- Right sidebar -->
    <FilterPanel
      v-show="sidebarOpen"
      @new-category="openManageModal('category', null)"
      @edit-category="openManageModal('category', $event)"
      @new-collection="openManageModal('collection', null)"
      @edit-collection="openManageModal('collection', $event)"
      @fly-to="(m) => map && map.flyTo([m.lat, m.lng], Math.max(map.getZoom(), 14))"
      @open-marker="openMarkerModal"
      @open-settings="handleOpenSettings"
      @open-stats="statsOpen = true"
      @new-marker="toggleAddMode"
      @close="closeSidebar"
    />

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
      :saved="savedSettings"
      :current="currentMapView"
      @save="onSettingsSave"
      @close="settingsOpen = false"
      @tile-change="applyTileLayer"
      @cluster-change="(v) => reconfigureClustering(v, markersStore.filtered)"
    />

  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useMarkersStore } from '../stores/markers.js'
import { useCategoriesStore } from '../stores/categories.js'
import { useCollectionsStore } from '../stores/collections.js'
import MarkerModal from '../components/MarkerModal.vue'
import ManageModal from '../components/ManageModal.vue'
import SettingsModal from '../components/SettingsModal.vue'
import StatsModal from '../components/StatsModal.vue'
import LocationPanel from '../components/LocationPanel.vue'
import FilterPanel from '../components/FilterPanel.vue'
import { useSearch } from '../composables/useSearch.js'
import { useLocationPanel } from '../composables/useLocationPanel.js'
import { useMarkerLayer } from '../composables/useMarkerLayer.js'
import { useModals } from '../composables/useModals.js'
import { useStyleStore } from '../stores/style.js'

const SETTINGS_KEY = 'mapper_settings'

const COLOR_MODES = [
  { value: 'marker', label: 'Marker' },
  { value: 'category', label: 'Category' },
  { value: 'collection', label: 'Collection' },
]

const styleStore = useStyleStore()
const markersStore = useMarkersStore()
const categoriesStore = useCategoriesStore()
const collectionsStore = useCollectionsStore()

const mapEl = ref(null)
let map = null
const getMap = () => map

// Settings state (stays in MapView — it needs direct map access)
const savedSettings = ref(null)
const currentMapView = ref({ lat: 20, lng: 0, zoom: 2 })
let tileLayer = null

// Add mode
const addMode = ref(false)

// Stats modal
const statsOpen = ref(false)

// Sidebar — always open on desktop, collapsed by default on mobile
const sidebarOpen = ref(typeof window !== 'undefined' ? window.innerWidth > 640 : true)

const displayMarkers = computed(() => markersStore.filtered)

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
const { searchQuery, searchResults, searchOpen, onSearchInput, onSearchBlur, selectResult, cleanup: cleanupSearch } = useSearch(getMap)

function handleSearchSelect(r) {
  const latlng = selectResult(r)
  openLocationPanel(latlng)
}
const { locationPanelOpen, locationLatLng, locationInfo, locationLoading, poiData, poiLoading, openLocationPanel, closeLocationPanel } = useLocationPanel(getMap)
const { renderMarkers, initClusterGroup, reconfigureClustering } = useMarkerLayer(getMap, (marker) => {
  closeLocationPanel()
  addMode.value = false
  openMarkerModal(marker)
})
const {
  modalOpen, editingMarker, pendingLatLng, markerSuggestedLabel,
  manageOpen, manageType, manageItem, settingsOpen,
  closeModal, openManageModal, openMarkerModal, openNewMarkerModal,
  onMarkerSave, onMarkerDelete,
} = useModals()

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) } catch { return null }
}

function applyTileLayer(key) {
  const tiles = {
    osm:         { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
    'carto-light': { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', attribution: '&copy; <a href="https://carto.com/">CARTO</a>' },
    'carto-dark':  { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attribution: '&copy; <a href="https://carto.com/">CARTO</a>' },
    topo:          { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>' },
  }
  const t = tiles[key] ?? tiles.osm
  if (tileLayer) tileLayer.remove()
  tileLayer = L.tileLayer(t.url, { attribution: t.attribution, maxNativeZoom: 19, maxZoom: 21 }).addTo(map)
}

onMounted(async () => {
  savedSettings.value = loadSettings()
  const s = savedSettings.value

  await Promise.all([markersStore.fetch(), categoriesStore.fetch(), collectionsStore.fetch()])

  map = L.map(mapEl.value, { zoomControl: false, maxZoom: 21 }).setView(
    [s?.lat ?? 20, s?.lng ?? 0],
    s?.zoom ?? 2
  )

  L.control.zoom({ position: 'bottomright' }).addTo(map)
  applyTileLayer(s?.tile ?? 'osm')
  initClusterGroup(s?.cluster !== false)

let clickTimer = null
  map.on('click', (e) => {
    clearTimeout(clickTimer)
    clickTimer = setTimeout(() => {
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
  if (map) map.remove()
  window.removeEventListener('keydown', onKeyDown)
  cleanupSearch()
})

function onKeyDown(e) {
  if (e.key === 'Escape') {
    if (addMode.value) addMode.value = false
    else if (locationPanelOpen.value) closeLocationPanel()
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

function onSettingsSave(settings) {
  savedSettings.value = settings
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  if (settings.tile) applyTileLayer(settings.tile)
  settingsOpen.value = false
}

watch(displayMarkers, (markers) => {
  if (map) renderMarkers(markers)
}, { deep: true })

watch(() => styleStore.colorMode, () => {
  if (map) renderMarkers(displayMarkers.value)
})
</script>

<style scoped>
.map-shell {
  display: flex;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

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
  z-index: 1000;
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
  padding: 9px 14px;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  font-size: 14px;
  color: var(--text);
}
.search-input:focus { border-color: var(--accent); outline: none; }

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

/* Sidebar toggle + settings overlay — only needed on mobile */
.sidebar-open-btn,
.settings-btn { display: none; }

@media (max-width: 640px) {
  .color-mode-control {
    top: 106px;
  }

  .sidebar-open-btn {
    display: flex;
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 1000;
    width: 40px;
    height: 40px;
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

  .settings-btn {
    display: flex;
    position: absolute;
    top: 58px;
    right: 10px;
    z-index: 1000;
    width: 40px;
    height: 40px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    font-size: 18px;
    color: var(--text-2);
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .settings-btn:hover { background: var(--surface-2); color: var(--text); }
}


.color-mode-control {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1000;
  display: flex;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.cm-btn {
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-2);
  background: none;
  border: none;
  border-right: 1px solid var(--border);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.1s, color 0.1s;
}
.cm-btn:last-child { border-right: none; }
.cm-btn:hover { background: var(--surface-2); color: var(--text); }
.cm-btn.active { background: var(--accent); color: #fff; }

.add-marker-btn {
  position: absolute;
  bottom: 36px;
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
.add-marker-btn.active { background: var(--danger); }
.add-marker-btn.active:hover { background: var(--danger-hover); }

.add-icon {
  font-size: 18px;
  line-height: 1;
  font-weight: 400;
}
</style>
