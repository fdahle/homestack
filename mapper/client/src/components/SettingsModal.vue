<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h2>Settings</h2>
        <button class="close-btn" @click="$emit('close')"><AppIcon name="close" /></button>
      </div>

      <div class="tabs">
        <button class="tab-btn" :class="{ active: tab === 'general' }"    @click="tab = 'general'">General</button>
        <button class="tab-btn" :class="{ active: tab === 'appearance' }" @click="tab = 'appearance'">Appearance</button>
        <button class="tab-btn" :class="{ active: tab === 'advanced' }"   @click="tab = 'advanced'">Advanced</button>
        <button class="tab-btn" :class="{ active: tab === 'account' }"    @click="tab = 'account'">Account</button>
        <button class="tab-btn" :class="{ active: tab === 'data' }"       @click="tab = 'data'">Data</button>
      </div>

      <div class="tab-body">

        <!-- ── General ── -->
        <template v-if="tab === 'general'">
          <form @submit.prevent>
            <div class="group-label">Start position</div>
            <p class="hint">The map position and zoom level shown when the app first loads.</p>
            <div class="row">
              <div class="field">
                <label>Latitude</label>
                <input v-model.number="form.lat" type="number" step="any" min="-90" max="90" />
              </div>
              <div class="field">
                <label>Longitude</label>
                <input v-model.number="form.lng" type="number" step="any" min="-180" max="180" />
              </div>
            </div>
            <div class="field">
              <label>Zoom level (1–19)</label>
              <input v-model.number="form.zoom" type="number" min="1" max="19" step="1" />
            </div>
            <p class="hint">Or fill in the fields automatically:</p>
            <div class="btn-pair">
              <button type="button" class="btn-ghost" @click="useCurrentLocation" :disabled="gpsLoading">
                <template v-if="gpsLoading">Getting location…</template>
                <template v-else><AppIcon name="location" /> My location</template>
              </button>
              <button type="button" class="btn-ghost" @click="useCurrentView">
                Use current view
              </button>
            </div>
            <p v-if="gpsError" class="msg error">{{ gpsError }}</p>
          </form>
        </template>

        <!-- ── Appearance ── -->
        <template v-if="tab === 'appearance'">
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-name">Dark mode</span>
              <span class="setting-desc">Switch between light and dark theme</span>
            </div>
            <button class="toggle" :class="{ on: isDark }" @click="toggleDark" type="button">
              <span class="knob" />
            </button>
          </div>

          <div class="setting-row" style="margin-top:16px">
            <div class="setting-info">
              <span class="setting-name">Cluster markers</span>
              <span class="setting-desc">Group nearby markers when zoomed out</span>
            </div>
            <button class="toggle" :class="{ on: cluster }" @click="toggleCluster" type="button">
              <span class="knob" />
            </button>
          </div>

          <div class="setting-section">
            <div class="group-label" style="margin-top:20px">Map style</div>
            <div class="tile-grid">
              <button
                v-for="t in TILE_OPTIONS"
                :key="t.key"
                type="button"
                class="tile-btn"
                :class="{ selected: tileKey === t.key }"
                @click="setTile(t.key)"
              >
                <img :src="t.thumb" :alt="t.label" class="tile-thumb" @error="(e) => e.target.style.display='none'" />
                <span class="tile-label">{{ t.label }}</span>
              </button>
            </div>
          </div>
        </template>

        <!-- ── Advanced ── -->
        <template v-if="tab === 'advanced'">
          <div class="group-label">Routing API key (OpenRouteService)</div>
          <p class="hint">Optional. Enables hiking-trail routing. Get a free key at openrouteservice.org. Without a key, roads-only routing (OSRM) is used.</p>
          <div class="field">
            <input v-model="orsApiKey" type="text" placeholder="Paste your ORS key here…" @change="saveOrsKey" />
          </div>

          <div class="group-label" style="margin-top:16px">Nearby POI search radius</div>
          <p class="hint">How far from a clicked point to search for places.</p>
          <div class="segment">
            <button
              v-for="r in [25, 50, 100, 200]"
              :key="r"
              type="button"
              class="seg-btn"
              :class="{ active: poiRadius === r }"
              @click="setPoiRadius(r)"
            >{{ r }}m</button>
          </div>

          <div class="poi-section">
            <div class="group-label">Excluded POI types</div>
            <p class="hint">Amenity tags hidden from "nearby places" results.</p>
            <div class="exclude-tags">
              <span v-for="tag in excludedAmenities" :key="tag" class="exclude-tag">
                {{ tag }}
                <button type="button" class="tag-remove" @click="removeExcluded(tag)">✕</button>
              </span>
              <span v-if="!excludedAmenities.length" class="hint" style="margin:0">None</span>
            </div>
            <div class="exclude-add-row">
              <input
                v-model="newExclude"
                type="text"
                placeholder="e.g. vending_machine"
                @keydown.enter.prevent="addExcluded"
              />
              <button type="button" class="btn-ghost" @click="addExcluded" :disabled="!newExclude.trim()">Add</button>
            </div>
          </div>
        </template>

        <!-- ── Account ── -->
        <template v-if="tab === 'account'">
          <form @submit.prevent="doChangePassword">
            <div class="group-label">Change password</div>
            <p class="hint">Update your login password. You'll need your current password to confirm.</p>
            <div class="field">
              <label>Current password</label>
              <input v-model="pwForm.current" type="password" autocomplete="current-password" />
            </div>
            <div class="field">
              <label>New password <span class="hint-inline">(min 12 chars)</span></label>
              <input v-model="pwForm.newPass" type="password" autocomplete="new-password" />
            </div>
            <div class="field">
              <label>Confirm new password</label>
              <input v-model="pwForm.confirm" type="password" autocomplete="new-password" />
            </div>
            <p v-if="pwError"  class="msg error">{{ pwError }}</p>
            <p v-if="pwStatus" class="msg ok">{{ pwStatus }}</p>
            <div class="actions">
              <div class="spacer" />
              <button type="submit" class="btn-primary" :disabled="pwLoading">
                {{ pwLoading ? 'Saving…' : 'Change password' }}
              </button>
            </div>
          </form>

        </template>

        <!-- ── Data ── -->
        <template v-if="tab === 'data'">

          <!-- Review markers table -->
          <div class="data-group">
            <div class="group-label">Review</div>
            <p class="hint">Browse and edit all markers in a table — useful for quickly checking labels, images, and relations.</p>
            <button type="button" class="btn-secondary full" @click="$emit('open-marker-table')">
              Open marker table
            </button>
          </div>

          <!-- Backup & Restore -->
          <div class="data-group">
            <div class="group-label">Backup</div>
            <p class="hint">Full snapshot — saves markers, categories, collections, persons and all relations. Use Restore to bring everything back exactly.</p>
            <input type="file" accept=".json" ref="restoreInput" @change="onRestoreFileSelected" style="display:none" />
            <div class="import-btn-row">
              <button type="button" class="btn-secondary" @click="doBackup" :disabled="backingUp">
                {{ backingUp ? 'Preparing…' : 'Download backup' }}
              </button>
              <button type="button" class="btn-secondary" @click="restoreInput.click()">
                Restore from backup…
              </button>
            </div>
            <p v-if="backupError" class="msg error">{{ backupError }}</p>

            <!-- Restore state -->
            <template v-if="restoreFile || restoreError || restoreStatus">
              <div v-if="restoreFile && restoreData" class="file-row">
                <span class="file-name">{{ restoreFile.name }}</span>
                <span class="file-count">
                  {{ restoreData.markers.length }} markers · {{ restoreData.categories.length }} categories · {{ restoreData.collections.length }} collections · {{ restoreData.persons.length }} persons
                </span>
              </div>
              <p v-if="restoreError" class="msg error">{{ restoreError }}</p>
              <p v-if="restoreStatus" class="msg ok">{{ restoreStatus }}</p>
              <template v-if="restoreData && !restoreStatus">
                <p class="msg warn">This will replace ALL existing data and cannot be undone.</p>
                <div class="import-btn-row">
                  <button type="button" class="btn-secondary" @click="cancelRestore">Cancel</button>
                  <button type="button" class="btn-danger full" :disabled="restoring" @click="doRestore">
                    {{ restoring ? 'Restoring…' : 'Restore' }}
                  </button>
                </div>
              </template>
            </template>
          </div>

          <!-- Export -->
          <div class="data-group">
            <div class="group-label">Export</div>
            <p class="hint">Portable markers file — categories, collections and persons are saved as names only, not full relations.</p>
            <button type="button" class="btn-secondary full" @click="doExport" :disabled="exporting">
              {{ exporting ? 'Preparing…' : 'Download export' }}
            </button>
          </div>

          <!-- Import -->
          <div class="data-group">
            <div class="group-label">Import</div>
            <p class="hint">Add markers from a previous export or from a Google Maps saved places CSV.</p>

            <input type="file" accept=".json" ref="fileInput" @change="onFileSelected" style="display:none" />

            <div class="import-btn-row">
              <button type="button" class="btn-secondary" @click="fileInput.click()">
                JSON export
              </button>
              <button type="button" class="btn-secondary" @click="$emit('open-csv-import')">
                Google Maps CSV
              </button>
            </div>

            <!-- JSON import state -->
            <template v-if="importFile || importError || importStatus">
              <div v-if="importFile" class="file-row">
                <span class="file-name">{{ importFile.name }}</span>
                <span class="file-count" v-if="importMarkers">{{ importMarkers.length }} markers</span>
              </div>
              <p v-if="importError" class="msg error">{{ importError }}</p>
              <p v-if="importStatus" class="msg ok">{{ importStatus }}</p>
              <div v-if="importFailed.length" class="failed-list">
                Failed: {{ importFailed.map(f => f.label).join(', ') }}
              </div>
              <button
                v-if="importMarkers && importMarkers.length"
                type="button"
                class="btn-primary full"
                :disabled="importing"
                @click="doImport"
              >
                {{ importing
                  ? `Importing… (${importProgress} / ${importMarkers.length})`
                  : `Import ${importMarkers.length} markers` }}
              </button>
            </template>
          </div>
        </template>

      </div>

      <div class="modal-footer">
        <button v-if="tab === 'account'" type="button" class="btn-logout" @click="logout">Sign out</button>
        <div class="spacer" />
        <button type="button" class="btn-secondary" @click="$emit('close')">Done</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from './AppIcon.vue'
import { useMarkersStore } from '../stores/markers.js'
import { useAuthStore } from '../stores/auth.js'
import { useCategoriesStore } from '../stores/categories.js'
import { useCollectionsStore } from '../stores/collections.js'
import { usePersonsStore } from '../stores/persons.js'
import { useImportExport } from '../composables/useImportExport.js'

const SETTINGS_KEY = 'mapper_settings'

const TILE_OPTIONS = [
  { key: 'osm',           label: 'OSM',       thumb: 'https://tile.openstreetmap.org/12/2074/1410.png' },
  { key: 'carto-voyager', label: 'Carto',     thumb: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/12/2074/1410.png' },
  { key: 'topo',          label: 'Topo',      thumb: 'https://a.tile.opentopomap.org/12/2074/1410.png' },
  { key: 'satellite',     label: 'Satellite', thumb: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/12/1410/2074' },
]

const props = defineProps({
  current: { type: Object, default: null },
})
const emit = defineEmits(['close', 'tile-change', 'cluster-change', 'open-marker-table', 'open-csv-import'])

const markersStore     = useMarkersStore()
const authStore        = useAuthStore()
const categoriesStore  = useCategoriesStore()
const collectionsStore = useCollectionsStore()
const personsStore     = usePersonsStore()
const router       = useRouter()
const tab          = ref('general')

async function logout() {
  await authStore.logout()
  router.push('/login')
}

// ── General ──────────────────────────────────────────────
const form       = ref({ lat: 20, lng: 0, zoom: 2 })
const gpsLoading = ref(false)
const gpsError   = ref('')

onMounted(() => {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    form.value              = { lat: s.lat ?? 20, lng: s.lng ?? 0, zoom: s.zoom ?? 2 }
    tileKey.value           = s.tile === 'carto-light' ? 'carto-voyager' : (s.tile ?? 'osm')
    cluster.value           = s.cluster !== false
    excludedAmenities.value = s.excludedAmenities ?? ['waste_basket', 'bench']
    poiRadius.value         = s.poiRadius ?? 25
    orsApiKey.value         = s.orsApiKey ?? ''
  } catch {}
})

function useCurrentView() {
  if (props.current) form.value = { ...props.current }
}

function useCurrentLocation() {
  if (!navigator.geolocation) {
    gpsError.value = 'Geolocation is not supported by this browser'
    return
  }
  gpsLoading.value = true
  gpsError.value = ''
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      form.value.lat  = +pos.coords.latitude.toFixed(5)
      form.value.lng  = +pos.coords.longitude.toFixed(5)
      form.value.zoom = 13
      gpsLoading.value = false
    },
    (err) => {
      gpsError.value = err.code === 1 ? 'Location permission denied' : 'Could not get location'
      gpsLoading.value = false
    },
    { timeout: 10000 },
  )
}

watch(form, (val) => {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    s.lat  = val.lat
    s.lng  = val.lng
    s.zoom = val.zoom
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {}
}, { deep: true })

// ── Appearance ────────────────────────────────────────────
const tileKey = ref('osm')
const cluster = ref(true)
const isDark  = ref(document.documentElement.getAttribute('data-theme') === 'dark')

function toggleDark() {
  isDark.value = !isDark.value
  isDark.value
    ? document.documentElement.setAttribute('data-theme', 'dark')
    : document.documentElement.removeAttribute('data-theme')
  try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); s.theme = isDark.value ? 'dark' : 'light'; localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch {}
}

function setTile(key) {
  tileKey.value = key
  try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); s.tile = key; localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch {}
  emit('tile-change', key)
}

function toggleCluster() {
  cluster.value = !cluster.value
  try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); s.cluster = cluster.value; localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch {}
  emit('cluster-change', cluster.value)
}

// ── Advanced ──────────────────────────────────────────────
const orsApiKey = ref('')

function saveOrsKey() {
  try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); s.orsApiKey = orsApiKey.value.trim(); localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch {}
}

const excludedAmenities = ref(['waste_basket', 'bench'])
const newExclude        = ref('')
const poiRadius         = ref(25)

function saveExcludedToStorage() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    s.excludedAmenities = excludedAmenities.value
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {}
}

function addExcluded() {
  const tag = newExclude.value.trim().toLowerCase().replace(/\s+/g, '_')
  if (tag && !excludedAmenities.value.includes(tag)) {
    excludedAmenities.value = [...excludedAmenities.value, tag]
    saveExcludedToStorage()
  }
  newExclude.value = ''
}

function removeExcluded(tag) {
  excludedAmenities.value = excludedAmenities.value.filter(t => t !== tag)
  saveExcludedToStorage()
}

function setPoiRadius(r) {
  poiRadius.value = r
  try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); s.poiRadius = r; localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch {}
}

// ── Account ───────────────────────────────────────────────
const pwForm    = ref({ current: '', newPass: '', confirm: '' })
const pwError   = ref('')
const pwStatus  = ref('')
const pwLoading = ref(false)

async function doChangePassword() {
  pwError.value = ''
  pwStatus.value = ''
  if (!pwForm.value.current || !pwForm.value.newPass || !pwForm.value.confirm) {
    pwError.value = 'All fields are required'
    return
  }
  if (pwForm.value.newPass !== pwForm.value.confirm) {
    pwError.value = 'New passwords do not match'
    return
  }
  if (pwForm.value.newPass.length < 12) {
    pwError.value = 'New password must be at least 12 characters'
    return
  }
  pwLoading.value = true
  try {
    await authStore.changePassword(pwForm.value.current, pwForm.value.newPass)
    pwStatus.value = 'Password changed successfully'
    pwForm.value = { current: '', newPass: '', confirm: '' }
  } catch (err) {
    pwError.value = err.message
  } finally {
    pwLoading.value = false
  }
}

// ── Import / Export / Backup ──────────────────────────────
const {
  backingUp, backupError, doBackup,
  restoreInput, restoreFile, restoreData, restoreError, restoreStatus,
  restoring, onRestoreFileSelected, cancelRestore, doRestore,
  exporting, doExport,
  fileInput, importFile, importMarkers, importError, importStatus,
  importing, importProgress, importFailed, onFileSelected, doImport,
} = useImportExport(markersStore, categoriesStore, collectionsStore, personsStore)
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 80px;
  z-index: 3000;
}

.modal {
  background: var(--surface);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  width: 400px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 100px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

h2 { font-size: 16px; font-weight: 700; }

.close-btn {
  background: none;
  color: var(--text-2);
  padding: 4px 8px;
  border-radius: 4px;
}
.close-btn:hover { background: var(--surface-2); }

/* ── Tabs ── */
.tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.tab-btn {
  flex: 1;
  background: none;
  border: none;
  border-radius: 0;
  padding: 10px 2px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-2);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.15s, border-color 0.15s;
  white-space: nowrap;
}
.tab-btn:hover { color: var(--text); }
.tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }

/* ── Tab body ── */
.tab-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.group-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-2);
  margin-bottom: 10px;
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.field { margin-bottom: 14px; }

.hint-inline {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-2);
}

/* Two-button row for "My location" / "Current view" */
.btn-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 20px;
}

.btn-ghost {
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.btn-ghost:hover:not(:disabled) { background: var(--border); }
.btn-ghost:disabled { opacity: 0.5; cursor: default; }

.full { width: 100%; }

.actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.spacer { flex: 1; }

.modal-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.btn-primary    { background: var(--accent); color: #fff; font-weight: 600; }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: default; }
.btn-secondary  { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); }
.btn-secondary:hover:not(:disabled) { background: var(--border); }

/* ── Appearance ── */
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 4px 0;
}

.setting-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.setting-name { font-size: 14px; font-weight: 500; color: var(--text); }
.setting-desc { font-size: 12px; color: var(--text-2); }

.toggle {
  width: 44px;
  height: 24px;
  border-radius: 12px;
  background: var(--border);
  border: none;
  padding: 3px;
  display: flex;
  align-items: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.2s;
}
.toggle.on { background: var(--accent); }

.knob {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.25);
  display: block;
  transition: transform 0.2s;
}
.toggle.on .knob { transform: translateX(20px); }

/* ── Tile selector with thumbnails ── */
.tile-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 8px;
}

.tile-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 4px;
  font-size: 12px;
  font-weight: 500;
  background: var(--surface-2);
  color: var(--text);
  border: 2px solid var(--border);
  border-radius: var(--radius);
  transition: border-color 0.15s, background 0.15s;
  overflow: hidden;
}
.tile-btn:hover { background: var(--border); }
.tile-btn.selected { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }

.tile-thumb {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 2px;
  display: block;
}

.tile-label {
  padding-bottom: 2px;
}

/* ── Advanced: POI radius segmented control ── */
.segment {
  display: flex;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  margin-bottom: 20px;
}

.seg-btn {
  flex: 1;
  background: none;
  border: none;
  border-right: 1px solid var(--border);
  padding: 7px 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-2);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.seg-btn:last-child { border-right: none; }
.seg-btn:hover { background: var(--surface-2); color: var(--text); }
.seg-btn.active { background: var(--accent); color: #fff; }

/* ── Advanced: POI exclusions ── */
.poi-section {
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.exclude-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
  min-height: 28px;
}

.exclude-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 2px 6px 2px 9px;
  font-size: 12px;
  font-family: monospace;
  color: var(--text);
}

.tag-remove {
  background: none;
  border: none;
  padding: 0 2px;
  font-size: 10px;
  color: var(--text-2);
  cursor: pointer;
  line-height: 1;
  border-radius: 2px;
}
.tag-remove:hover { color: var(--danger); }

.exclude-add-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.exclude-add-row input { flex: 1; }
.exclude-add-row .btn-ghost { flex-shrink: 0; white-space: nowrap; }

/* ── Account ── */
.btn-logout {
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 500;
  color: var(--danger);
  border: 1px solid var(--danger);
  background: none;
  border-radius: var(--radius);
}
.btn-logout:hover { background: color-mix(in srgb, var(--danger) 8%, transparent); }

/* ── Data / Import / Export ── */
.data-group {
  margin-bottom: 24px;
}
.data-group:last-child { margin-bottom: 0; }

.hint {
  font-size: 12px;
  color: var(--text-2);
  margin-bottom: 10px;
  line-height: 1.5;
}

.file-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  margin-bottom: 10px;
  font-size: 13px;
}

.file-name {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-count {
  color: var(--text-2);
  white-space: nowrap;
  flex-shrink: 0;
}

.msg {
  font-size: 13px;
  margin: 8px 0;
  padding: 8px 10px;
  border-radius: var(--radius);
}
.msg.error { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }
.msg.ok    { color: #16a34a;        background: color-mix(in srgb, #16a34a 10%, transparent); }
.msg.warn  { color: #b45309;        background: color-mix(in srgb, #b45309 10%, transparent); }

.btn-danger {
  background: var(--danger);
  color: #fff;
  border: none;
  border-radius: var(--radius);
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity .15s;
}
.btn-danger:hover { opacity: .85; }
.btn-danger:disabled { opacity: .5; cursor: not-allowed; }
.btn-danger.full { width: 100%; }

.csv-cancel {
  margin-left: auto;
  flex-shrink: 0;
  background: none;
  border: none;
  color: var(--text-2);
  font-size: 13px;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
  line-height: 1;
}
.csv-cancel:hover { background: var(--surface-2); color: var(--text); }

.btn-secondary.full,
.btn-primary.full { margin-top: 6px; }

.import-btn-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 8px;
}

.import-divider {
  border-top: 1px solid var(--border);
  margin: 12px 0;
}

.failed-list {
  font-size: 12px;
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 8%, transparent);
  border-radius: var(--radius);
  padding: 6px 10px;
  margin: 4px 0;
  word-break: break-word;
}

@media (max-width: 640px) {
  .overlay { align-items: stretch; padding: 0; }
  .modal {
    width: 100vw;
    max-width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
  }
  .modal-header { padding-top: calc(16px + var(--sat, 0px)); }
  .tabs {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar { display: none; }
  .tab-btn { flex: 0 0 auto; padding: 10px 14px; }
  .modal-footer { padding-bottom: calc(24px + var(--sab, 0px)); }
}
</style>
