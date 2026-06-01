<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h2>Settings</h2>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>

      <div class="tabs">
        <button class="tab-btn" :class="{ active: tab === 'general' }"    @click="tab = 'general'">General</button>
        <button class="tab-btn" :class="{ active: tab === 'appearance' }" @click="tab = 'appearance'">Appearance</button>
        <button class="tab-btn" :class="{ active: tab === 'data' }"       @click="tab = 'data'">Import / Export</button>
      </div>

      <div class="tab-body">

        <!-- ── General ── -->
        <template v-if="tab === 'general'">
          <form @submit.prevent="saveGeneral">
            <div class="group-label">Start position</div>
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
            <button type="button" class="btn-ghost full" @click="useCurrentView">
              Use current map view
            </button>
            <div class="actions">
              <div class="spacer" />
              <button type="button" class="btn-secondary" @click="$emit('close')">Cancel</button>
              <button type="submit" class="btn-primary">Save</button>
            </div>
          </form>
          <div class="logout-section">
            <button type="button" class="btn-logout" @click="logout">Sign out</button>
          </div>
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
            <div class="group-label" style="margin-top:16px">Map style</div>
            <div class="tile-grid">
              <button
                v-for="t in TILE_OPTIONS"
                :key="t.key"
                type="button"
                class="tile-btn"
                :class="{ selected: tileKey === t.key }"
                @click="setTile(t.key)"
              >
                {{ t.label }}
              </button>
            </div>
          </div>
        </template>

        <!-- ── Import / Export ── -->
        <template v-if="tab === 'data'">
          <div class="data-group">
            <div class="group-label">Export</div>
            <p class="hint">Download all markers as a JSON file.</p>
            <button type="button" class="btn-secondary full" @click="doExport" :disabled="exporting">
              {{ exporting ? 'Preparing…' : 'Download markers.json' }}
            </button>
          </div>

          <div class="data-group">
            <div class="group-label">Import</div>

            <input type="file" accept=".json" ref="fileInput" @change="onFileSelected" style="display:none" />
            <input type="file" accept=".csv" multiple ref="csvInput" @change="onCsvSelected" style="display:none" />

            <div class="import-btn-row">
              <button type="button" class="btn-secondary" @click="fileInput.click()">
                JSON export
              </button>
              <button type="button" class="btn-secondary" @click="csvInput.click()">
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

            <!-- CSV import state -->
            <template v-if="csvFiles || csvError || csvStatus">
              <div class="import-divider" />
              <div v-if="csvFiles && csvFiles.length" class="file-row">
                <span class="file-name">
                  {{ csvFiles.length === 1 ? csvFiles[0].name : `${csvFiles.length} files` }}
                </span>
                <span class="file-count" v-if="csvRows">{{ csvRows.length }} places</span>
                <button type="button" class="csv-cancel" @click="resetCsv" title="Cancel">✕</button>
              </div>
              <p v-if="csvError" class="msg error">{{ csvError }}</p>
              <p v-if="csvStatus" class="msg ok">{{ csvStatus }}</p>
              <div v-if="csvFailed.length" class="failed-list">
                Failed: {{ csvFailed.map(f => f.label).join(', ') }}
              </div>
              <button
                v-if="csvRows && csvRows.length && !geocoding && !geocodedMarkers"
                type="button"
                class="btn-primary full"
                @click="doGeocode"
              >
                Process {{ csvRows.length }} places…
              </button>
              <p v-if="geocoding" class="msg">
                Geocoding {{ geocodeProgress }} / {{ csvRows.length }}…
                <button type="button" class="csv-cancel" @click="resetCsv" title="Cancel">✕</button>
              </p>
              <button
                v-if="geocodedMarkers && geocodedMarkers.length"
                type="button"
                class="btn-primary full"
                :disabled="csvImporting"
                @click="doCsvImport"
              >
                {{ csvImporting
                  ? `Importing… (${csvImportProgress} / ${geocodedMarkers.length})`
                  : `Import ${geocodedMarkers.length} markers` }}
              </button>
            </template>
          </div>
        </template>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useMarkersStore } from '../stores/markers.js'
import { useAuthStore } from '../stores/auth.js'

const SETTINGS_KEY = 'mapper_settings'

const TILE_OPTIONS = [
  { key: 'osm',         label: 'Street' },
  { key: 'carto-light', label: 'Light' },
  { key: 'carto-dark',  label: 'Dark' },
  { key: 'topo',        label: 'Topo' },
]

const props = defineProps({
  saved:   { type: Object, default: null },
  current: { type: Object, default: null },
})
const emit = defineEmits(['save', 'close', 'tile-change', 'cluster-change'])

const markersStore = useMarkersStore()
const authStore = useAuthStore()
const router = useRouter()
const tab = ref('general')

async function logout() {
  await authStore.logout()
  router.push('/login')
}

// ── General ──────────────────────────────────────────────
const form = ref({ lat: 20, lng: 0, zoom: 2 })

const tileKey = ref('osm')
const cluster = ref(true)

onMounted(() => {
  if (props.saved) {
    form.value = { lat: props.saved.lat ?? 20, lng: props.saved.lng ?? 0, zoom: props.saved.zoom ?? 2 }
    tileKey.value = props.saved.tile ?? 'osm'
    cluster.value = props.saved.cluster !== false
  }
})

function setTile(key) {
  tileKey.value = key
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    s.tile = key
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {}
  emit('tile-change', key)
}

function toggleCluster() {
  cluster.value = !cluster.value
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    s.cluster = cluster.value
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {}
  emit('cluster-change', cluster.value)
}

function useCurrentView() {
  if (props.current) form.value = { ...props.current }
}

function saveGeneral() {
  emit('save', { ...form.value, theme: isDark.value ? 'dark' : 'light', tile: tileKey.value, cluster: cluster.value })
}

// ── Appearance ────────────────────────────────────────────
const isDark = ref(document.documentElement.getAttribute('data-theme') === 'dark')

function toggleDark() {
  isDark.value = !isDark.value
  if (isDark.value) {
    document.documentElement.setAttribute('data-theme', 'dark')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
  // persist immediately without closing
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    s.theme = isDark.value ? 'dark' : 'light'
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {}
}

// ── Import / Export ───────────────────────────────────────
const exporting = ref(false)

async function doExport() {
  exporting.value = true
  try {
    const res = await fetch('/api/markers')
    const markers = await res.json()
    const payload = {
      version: 1,
      exported_at: new Date().toISOString(),
      markers: markers.map((m) => ({
        lat: m.lat,
        lng: m.lng,
        label: m.label,
        description: m.description,
        visited_at: m.visited_at,
        categories: m.categories?.map((c) => c.name) ?? [],
        collections: m.collections?.map((c) => c.name) ?? [],
      })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'markers.json'
    a.click()
    URL.revokeObjectURL(url)
  } finally {
    exporting.value = false
  }
}

const fileInput    = ref(null)
const importFile   = ref(null)
const importMarkers = ref(null)
const importError  = ref(null)
const importStatus = ref(null)
const importing    = ref(false)
const importProgress = ref(0)
const importFailed = ref([])

function onFileSelected(e) {
  importError.value  = null
  importStatus.value = null
  importMarkers.value = null
  const file = e.target.files[0]
  if (!file) return
  importFile.value = file
  const reader = new FileReader()
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result)
      const list = Array.isArray(data) ? data : data.markers
      if (!Array.isArray(list)) throw new Error('Expected an array of markers')
      importMarkers.value = list
    } catch (err) {
      importError.value = 'Invalid file: ' + err.message
    }
  }
  reader.readAsText(file)
}

async function doImport() {
  importing.value = true
  importProgress.value = 0
  importError.value  = null
  importStatus.value = null
  importFailed.value = []
  let ok = 0
  for (let i = 0; i < importMarkers.value.length; i++) {
    const m = importMarkers.value[i]
    try {
      await markersStore.create({
        lat:         m.lat,
        lng:         m.lng,
        label:       m.label       || null,
        description: m.description || null,
        visited_at:  m.visited_at  || null,
        category_ids: [],
        collection_ids: [],
      })
      ok++
    } catch {
      importFailed.value.push({ label: m.label || `Line ${i + 1}` })
    }
    importProgress.value++
  }
  importing.value = false
  const fail = importFailed.value.length
  importStatus.value = `Done — ${ok} imported${fail ? `, ${fail} failed` : ''}.`
  importMarkers.value = null
  importFile.value = null
  if (fileInput.value) fileInput.value.value = ''
}

// ── Google Maps CSV Import ────────────────────────────────
const csvInput          = ref(null)
const csvFiles          = ref(null)
const csvRows           = ref(null)
const csvError          = ref(null)
const csvStatus         = ref(null)
const geocoding         = ref(false)
const geocodeProgress   = ref(0)
const geocodedMarkers   = ref(null)
const csvImporting      = ref(false)
const csvImportProgress = ref(0)
const csvFailed         = ref([])

// RFC 4180 CSV parser — handles multi-line quoted fields correctly
function parseCsvRecords(text) {
  const records = []
  let i = 0
  while (i < text.length) {
    while (i < text.length && (text[i] === '\r' || text[i] === '\n')) i++
    if (i >= text.length) break
    const fields = []
    for (;;) {
      let field = ''
      if (text[i] === '"') {
        i++
        while (i < text.length) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') { field += '"'; i += 2 }
            else { i++; break }
          } else field += text[i++]
        }
      } else {
        while (i < text.length && text[i] !== ',' && text[i] !== '\r' && text[i] !== '\n') field += text[i++]
      }
      fields.push(field)
      if (i < text.length && text[i] === ',') { i++; continue }
      break
    }
    while (i < text.length && (text[i] === '\r' || text[i] === '\n')) i++
    if (fields.length > 0) records.push(fields)
  }
  return records
}

function extractCoordsFromUrl(url) {
  const m = url.match(/\/maps\/search\/([-\d.]+),([-\d.]+)/)
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }
  return null
}

function isCoordTitle(title) {
  return /[0-9]+°/.test(title) || title === 'Gesetzte Markierung' || title === 'Dropped pin'
}

function parseGoogleCsv(text) {
  const records = parseCsvRecords(text)

  // Find the actual header row — some files have a list title before it
  const headerIdx = records.findIndex(r => r[0]?.trim() === 'Title')
  if (headerIdx === -1) throw new Error('Could not find header row (expected Title,Note,URL,…)')

  const rows = []
  for (let i = headerIdx + 1; i < records.length; i++) {
    const fields = records[i]
    if (fields.every(f => !f.trim())) continue // blank separator row

    const title = fields[0]?.trim() || ''
    // collapse multi-line notes (e.g. "mit Lydia,\nNovember 2022") to single line
    const note  = (fields[1]?.trim() || '').replace(/\s*\n\s*/g, ' ')
    const url   = fields[2]?.trim() || ''

    const coords = extractCoordsFromUrl(url)

    if (!coords && !title) continue

    let label, description
    if (coords) {
      label       = note || (isCoordTitle(title) ? null : title) || null
      description = null
    } else {
      label       = title
      description = note || null
    }

    rows.push({ title, note, url, coords, label, description })
  }
  // Drop anything with no label and no coords (empty place URLs, etc.)
  return rows.filter(r => r.label || r.coords)
}

function resetCsv() {
  csvFiles.value = null
  csvRows.value = null
  csvError.value = null
  csvStatus.value = null
  geocoding.value = false
  geocodedMarkers.value = null
  csvImporting.value = false
  csvFailed.value = []
  if (csvInput.value) csvInput.value.value = ''
}

async function onCsvSelected(e) {
  csvError.value = null
  csvStatus.value = null
  csvRows.value = null
  geocodedMarkers.value = null
  const files = [...e.target.files]
  if (!files.length) return
  csvFiles.value = files

  const readFile = (f) => new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = (ev) => resolve({ name: f.name, text: ev.target.result })
    r.onerror = () => reject(new Error(`Could not read ${f.name}`))
    r.readAsText(f, 'UTF-8')
  })

  try {
    const results = await Promise.all(files.map(readFile))
    const allRows = []
    const errors = []
    for (const { name, text } of results) {
      try {
        allRows.push(...parseGoogleCsv(text))
      } catch (err) {
        errors.push(`${name}: ${err.message}`)
      }
    }
    if (errors.length) csvError.value = errors.join(' | ')
    if (!allRows.length) throw new Error('No valid rows found in any file')
    csvRows.value = allRows
  } catch (err) {
    csvError.value = err.message
  }
}

async function doGeocode() {
  geocoding.value = true
  geocodeProgress.value = 0
  geocodedMarkers.value = null
  csvStatus.value = null
  csvError.value = null
  const results = []
  let failed = 0

  for (const row of csvRows.value) {
    if (row.coords) {
      // Coordinates already in the URL — no network call needed
      results.push({ lat: row.coords.lat, lng: row.coords.lng, label: row.label, description: row.description })
      geocodeProgress.value++
      continue
    }

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(row.title)}&format=json&limit=1`
      )
      const data = await res.json()
      if (data.length) {
        results.push({
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
          label: row.label,
          description: row.description,
        })
      } else {
        failed++
      }
    } catch {
      failed++
    }
    geocodeProgress.value++
    await new Promise((r) => setTimeout(r, 1100))
  }

  geocoding.value = false
  geocodedMarkers.value = results
  const pinned = csvRows.value.filter(r => r.coords).length
  const geocoded = results.length - pinned
  const parts = []
  if (pinned)   parts.push(`${pinned} pinned`)
  if (geocoded) parts.push(`${geocoded} geocoded`)
  const summary = `${results.length} markers ready (${parts.join(', ')}).`
  csvStatus.value = failed ? `${summary} ${failed} not found — skipped.` : summary
}

async function doCsvImport() {
  csvImporting.value = true
  csvImportProgress.value = 0
  csvError.value = null
  csvFailed.value = []
  let ok = 0
  for (let i = 0; i < geocodedMarkers.value.length; i++) {
    const m = geocodedMarkers.value[i]
    try {
      await markersStore.create({
        lat: m.lat, lng: m.lng,
        label: m.label, description: m.description,
        visited_at: null, category_ids: [], collection_ids: [],
      })
      ok++
    } catch {
      csvFailed.value.push({ label: m.label || `Line ${i + 1}` })
    }
    csvImportProgress.value++
  }
  csvImporting.value = false
  const fail = csvFailed.value.length
  csvStatus.value = `Done — ${ok} imported${fail ? `, ${fail} failed` : ''}.`
  geocodedMarkers.value = null
  csvRows.value = null
  csvFiles.value = null
  if (csvInput.value) csvInput.value.value = ''
}
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
  padding: 10px 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-2);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.15s, border-color 0.15s;
}
.tab-btn:hover { color: var(--text); }
.tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }

/* ── Tab body ── */
.tab-body {
  padding: 20px;
  overflow-y: auto;
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

.btn-ghost {
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
  font-size: 13px;
  margin-bottom: 20px;
}
.btn-ghost:hover { background: var(--border); }

.full { width: 100%; }

.actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.spacer { flex: 1; }

.btn-primary    { background: var(--accent); color: #fff; font-weight: 600; }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
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

/* ── Tile selector ── */
.tile-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 8px;
}

.tile-btn {
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 500;
  background: var(--surface-2);
  color: var(--text);
  border: 2px solid var(--border);
  border-radius: var(--radius);
  transition: border-color 0.15s, background 0.15s;
}
.tile-btn:hover { background: var(--border); }
.tile-btn.selected { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }

/* ── Import / Export ── */
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

.logout-section {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.btn-logout {
  width: 100%;
  padding: 9px;
  font-size: 14px;
  font-weight: 500;
  color: var(--danger);
  border: 1px solid var(--danger);
  background: none;
  border-radius: var(--radius);
}
.btn-logout:hover { background: color-mix(in srgb, var(--danger) 8%, transparent); }
</style>
