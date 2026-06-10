<template>
  <div class="map-shell">

    <!-- Password gate -->
    <div v-if="state === 'password'" class="gate">
      <div class="gate-card">
        <div class="gate-logo">MapMarker</div>
        <h2>{{ shareMeta?.name || 'Shared map' }}</h2>
        <p class="gate-hint">This link is password protected.</p>
        <form @submit.prevent="submitPassword">
          <div class="gate-field">
            <input
              v-model="passwordInput"
              :type="showPw ? 'text' : 'password'"
              placeholder="Enter password"
              class="gate-input"
              autofocus
              autocomplete="current-password"
            />
            <button type="button" class="pw-toggle" @click="showPw = !showPw">
              <AppIcon :name="showPw ? 'eyeOff' : 'eye'" />
            </button>
          </div>
          <p v-if="gateError" class="gate-error">{{ gateError }}</p>
          <button type="submit" class="gate-btn" :disabled="loading">
            {{ loading ? '…' : 'View map' }}
          </button>
        </form>
      </div>
    </div>

    <!-- Error states -->
    <div v-else-if="state === 'error'" class="gate">
      <div class="gate-card">
        <div class="gate-logo">MapMarker</div>
        <p class="gate-error-big">{{ errorMessage }}</p>
      </div>
    </div>

    <!-- Map -->
    <template v-else-if="state === 'loaded'">
      <div class="map-area">
        <div class="map-container" ref="mapEl" />

        <!-- Search bar -->
        <div class="top-bar">
          <div class="search-wrapper">
            <input
              class="search-input"
              v-model="searchQuery"
              @input="onSearchInput"
              @focus="searchOpen = true"
              @blur="onSearchBlur"
              placeholder="Search address or marker…"
              autocomplete="off"
              type="text"
            />
            <span v-if="searchLoading" class="search-spinner" aria-label="Searching" />
            <button
              v-else-if="searchQuery"
              class="search-clear"
              type="button"
              @mousedown.prevent="searchQuery = ''; searchResults = []"
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

        <!-- Tile switcher -->
        <div class="tile-control" ref="tileControlRef">
          <button class="tile-trigger" @click.stop="tileMenuOpen = !tileMenuOpen">
            <span class="tile-trigger-label">{{ TILE_LABELS[currentTile] ?? 'OSM' }}</span>
            <AppIcon name="chevronDown" class="tile-chevron" :class="{ open: tileMenuOpen }" />
          </button>
          <div v-if="tileMenuOpen" class="tile-dropdown">
            <button
              v-for="(_, key) in TILES"
              :key="key"
              class="tile-option"
              :class="{ active: currentTile === key }"
              @click="switchTile(key); tileMenuOpen = false"
            >{{ TILE_LABELS[key] }}</button>
          </div>
        </div>

        <!-- Sidebar toggle -->
        <button v-show="!sidebarOpen" class="sidebar-open-btn" @click="sidebarOpen = true" title="Open panel">
          <AppIcon name="hamburger" />
        </button>

      </div>

      <!-- Mobile backdrop -->
      <div class="mobile-overlay" v-if="sidebarOpen" @click="sidebarOpen = false" />

      <!-- Sidebar -->
      <Transition name="panel">
        <FilterPanel
          v-show="sidebarOpen"
          :read-only="true"
          @fly-to="(m) => map && map.flyTo([m.lat, m.lng], Math.max(map.getZoom(), 14))"
          @open-marker="openMarker"
          @close="sidebarOpen = false"
        />
      </Transition>

      <!-- Marker detail modal (read-only) -->
      <MarkerModal
        v-if="openedMarker"
        :marker="openedMarker"
        :read-only="true"
        @close="openedMarker = null"
      />
    </template>

    <!-- Loading -->
    <div v-else class="gate">
      <div class="gate-card">
        <div class="gate-logo">MapMarker</div>
        <p class="loading-text">Loading…</p>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import AppIcon from '../components/AppIcon.vue'
import FilterPanel from '../components/FilterPanel.vue'
import MarkerModal from '../components/MarkerModal.vue'
import { useMarkerLayer } from '../composables/useMarkerLayer.js'
import { useSearch } from '../composables/useSearch.js'
import { useMarkersStore } from '../stores/markers.js'
import { useCategoriesStore } from '../stores/categories.js'
import { useCollectionsStore } from '../stores/collections.js'
import { usePersonsStore } from '../stores/persons.js'

const SETTINGS_KEY = 'mapper_settings'
const TILES = {
  osm:             { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  'carto-voyager': { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' },
  'carto-light':   { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', attribution: '&copy; <a href="https://carto.com/">CARTO</a>' },
  topo:            { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>' },
  satellite:       { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles &copy; Esri' },
}
const TILE_LABELS = {
  osm: 'OSM',
  'carto-voyager': 'Voyager',
  'carto-light': 'Light',
  topo: 'Topo',
  satellite: 'Satellite',
}

const route = useRoute()
const markersStore = useMarkersStore()
const categoriesStore = useCategoriesStore()
const collectionsStore = useCollectionsStore()
const personsStore = usePersonsStore()

const state = ref('loading')  // 'loading' | 'password' | 'loaded' | 'error'
const shareMeta = ref(null)
const errorMessage = ref('')
const passwordInput = ref('')
const showPw = ref(false)
const gateError = ref('')
const loading = ref(false)
const sidebarOpen = ref(typeof window !== 'undefined' ? window.innerWidth > 640 : true)
const openedMarker = ref(null)

const mapEl = ref(null)
let map = null
let tileLayer = null

// Tile switcher
const currentTile = ref('osm')
const tileMenuOpen = ref(false)
const tileControlRef = ref(null)
watch(tileMenuOpen, (open) => {
  const handler = (e) => { if (tileControlRef.value && !tileControlRef.value.contains(e.target)) tileMenuOpen.value = false }
  if (open) document.addEventListener('click', handler, { once: true })
})

function switchTile(key) {
  currentTile.value = key
  if (!map) return
  const t = TILES[key] ?? TILES.osm
  const maxNative = key === 'topo' ? 17 : 19
  const maxZoom = key === 'topo' ? 17 : 21
  if (tileLayer) tileLayer.remove()
  tileLayer = L.tileLayer(t.url, { attribution: t.attribution, maxNativeZoom: maxNative, maxZoom }).addTo(map)
}

const getMap = () => map
const { renderMarkers, initClusterGroup } = useMarkerLayer(getMap, (marker) => {
  openedMarker.value = marker
})

// Search
const { searchQuery, searchResults, searchOpen, searchLoading, onSearchInput, onSearchBlur, selectResult, cleanup: cleanupSearch } = useSearch(
  getMap,
  () => markersStore.items,
  (marker) => { openedMarker.value = marker },
)

function handleSearchSelect(r) {
  selectResult(r)
}

async function fetchData(password) {
  const headers = {}
  if (password) headers['X-Share-Password'] = password
  const res = await fetch(`/api/public/share/${route.params.token}/data`, { headers })
  return { status: res.status, data: await res.json() }
}

async function loadMap(data) {
  markersStore.items = data.markers
  markersStore.activeGroupFilter = null
  markersStore.visitedFilter = 'all'
  categoriesStore.items = data.categories
  collectionsStore.items = data.collections
  personsStore.items = data.persons

  state.value = 'loaded'
  await nextTick()

  const s = (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) } catch { return null } })()
  map = L.map(mapEl.value, { zoomControl: false, maxZoom: 21 }).setView([s?.lat ?? 20, s?.lng ?? 0], s?.zoom ?? 2)
  if (window.innerWidth > 1024) L.control.zoom({ position: 'bottomright' }).addTo(map)

  const tileKey = s?.tile ?? 'osm'
  currentTile.value = tileKey
  const t = TILES[tileKey] ?? TILES.osm
  const maxNative = tileKey === 'topo' ? 17 : 19
  const maxZoom = tileKey === 'topo' ? 17 : 21
  tileLayer = L.tileLayer(t.url, { attribution: t.attribution, maxNativeZoom: maxNative, maxZoom }).addTo(map)

  initClusterGroup(s?.cluster !== false)
  renderMarkers(markersStore.filtered)

  if (markersStore.items.length > 0) {
    const bounds = L.latLngBounds(markersStore.items.map((m) => [m.lat, m.lng]))
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 })
  }
}

onMounted(async () => {
  const { status, data } = await fetchData(null)
  if (status === 404) { errorMessage.value = 'This share link does not exist.'; state.value = 'error'; return }
  if (status === 410) { errorMessage.value = 'This share link has expired.'; state.value = 'error'; return }
  if (status === 401 && data.requiresPassword) { shareMeta.value = data.meta; state.value = 'password'; return }
  if (status !== 200) { errorMessage.value = 'Failed to load shared map.'; state.value = 'error'; return }
  await loadMap(data)
})

onUnmounted(() => {
  if (map) { map.remove(); map = null }
  cleanupSearch()
  markersStore.items = []
  markersStore.activeGroupFilter = null
  categoriesStore.items = []
  collectionsStore.items = []
  personsStore.items = []
})

async function submitPassword() {
  if (!passwordInput.value) return
  gateError.value = ''
  loading.value = true
  const { status, data } = await fetchData(passwordInput.value)
  loading.value = false
  if (status === 403) { gateError.value = 'Incorrect password. Try again.'; return }
  if (status !== 200) { gateError.value = 'Something went wrong. Try again.'; return }
  await loadMap(data)
}

function openMarker(marker) {
  openedMarker.value = marker
}

watch(() => markersStore.filtered, (markers) => {
  if (map) renderMarkers(markers)
})

watch(sidebarOpen, async () => {
  await nextTick()
  if (map) map.invalidateSize()
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

/* Gate (password/error/loading) */
.gate {
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-2, #f5f5f5);
}

.gate-card {
  background: var(--surface, #fff);
  border-radius: 14px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.12);
  padding: 32px 28px 28px;
  width: 340px;
  max-width: calc(100vw - 32px);
  text-align: center;
}

.gate-logo {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--accent, #3b82f6);
  margin-bottom: 16px;
}

.gate-card h2 {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 8px;
  color: var(--text, #111);
}

.gate-hint {
  font-size: 13px;
  color: var(--text-2, #666);
  margin-bottom: 20px;
}

.gate-field {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}

.gate-input {
  flex: 1;
  padding: 9px 12px;
  border: 1px solid var(--border, #e0e0e0);
  border-radius: 8px;
  font-size: 14px;
  background: var(--surface, #fff);
  color: var(--text, #111);
}
.gate-input:focus { outline: 2px solid var(--accent, #3b82f6); border-color: transparent; }

.pw-toggle {
  background: none;
  border: none;
  box-shadow: none;
  padding: 6px;
  color: var(--text-2, #666);
  cursor: pointer;
  border-radius: 6px;
}
.pw-toggle:hover { background: var(--surface-2, #f5f5f5); }

.gate-error { font-size: 13px; color: #ef4444; margin-bottom: 10px; }
.gate-error-big { font-size: 15px; color: #ef4444; }

.gate-btn {
  width: 100%;
  padding: 10px;
  background: var(--accent, #3b82f6);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 4px;
}
.gate-btn:hover:not(:disabled) { background: var(--accent-hover, #2563eb); }
.gate-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.loading-text { font-size: 14px; color: var(--text-2, #666); }

/* ── Search bar ──────────────────────────────────────────────────────────── */
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
  max-width: calc(100% - 130px);
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
  color: var(--text-2);
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
@keyframes search-spin { to { transform: translateY(-50%) rotate(360deg); } }

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
  color: var(--text-2);
}

/* ── Tile switcher ───────────────────────────────────────────────────────── */
.tile-control {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1000;
}

.tile-trigger {
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
.tile-trigger:hover { background: var(--surface-2); color: var(--text); }

.tile-trigger-label { color: var(--accent); font-weight: 600; }

.tile-chevron { transition: transform 0.15s; flex-shrink: 0; }
.tile-chevron.open { transform: rotate(180deg); }

.tile-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  min-width: 110px;
}

.tile-option {
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
.tile-option:last-child { border-bottom: none; }
.tile-option:hover { background: var(--surface-2); color: var(--text); }
.tile-option.active { color: var(--accent); font-weight: 700; background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }

/* ── Map UI ──────────────────────────────────────────────────────────────── */
.sidebar-open-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 500;
  background: var(--surface, #fff);
  border: 1px solid var(--border, #e0e0e0);
  border-radius: 8px;
  box-shadow: 0 1px 6px rgba(0,0,0,0.12);
  padding: 8px 10px;
  cursor: pointer;
  color: var(--text, #111);
}
.sidebar-open-btn:hover { background: var(--surface-2, #f5f5f5); }

.mobile-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.35);
  z-index: 900;
}

@media (max-width: 640px) {
  .mobile-overlay { display: block; }

  /* Full-width search bar on mobile */
  .top-bar {
    top: calc(10px + var(--sat, 0px));
    padding: 0 10px;
  }
  .search-wrapper {
    width: 100%;
    max-width: 100%;
  }

  /* Tile switcher to bottom-left on mobile */
  .tile-control {
    top: auto;
    bottom: calc(22px + var(--sab, 0px));
    left: 10px;
  }

  /* Move hamburger to bottom-right on mobile so it doesn't clash with search */
  .sidebar-open-btn {
    top: auto;
    bottom: calc(22px + var(--sab, 0px));
    right: 10px;
  }
}

/* Panel transition (mirrors MapView.vue) */
.panel-enter-active, .panel-leave-active { transition: transform 0.22s ease; }
.panel-enter-from, .panel-leave-to { transform: translateX(100%); }
@media (max-width: 640px) {
  .panel-enter-from, .panel-leave-to { transform: translateY(100%); }
}
</style>
