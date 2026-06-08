<template>
  <div class="csv-panel">
    <div class="panel-header">
      <h2>Import Google Maps CSV</h2>
      <button class="close-btn" @click="handleClose"><AppIcon name="close" /></button>
    </div>

    <!-- Phase: Select & Geocode -->
    <div v-if="phase === 'select'" class="panel-body">
      <input type="file" ref="csvInput" accept=".csv" multiple style="display:none" @change="onCsvSelected" />

      <template v-if="!csvRows">
        <p class="hint">Select one or more exported Google Maps CSV files. Labels without coordinates will be geocoded via OpenStreetMap.</p>
        <button type="button" class="btn-primary full" @click="csvInput.click()">Choose CSV files…</button>
        <p v-if="csvError" class="msg error">{{ csvError }}</p>
      </template>

      <template v-else>
        <div class="file-summary">
          <span class="file-name">{{ csvFiles.length === 1 ? csvFiles[0].name : `${csvFiles.length} files` }}</span>
          <span class="file-count">{{ csvRows.length }} places</span>
          <button type="button" class="icon-btn" @click="resetCsv" title="Clear">✕</button>
        </div>
        <p v-if="csvError" class="msg error">{{ csvError }}</p>

        <template v-if="!geocoding">
          <button type="button" class="btn-primary full" @click="doGeocode">
            Process {{ csvRows.length }} places…
          </button>
        </template>
        <template v-else>
          <p class="msg">Geocoding {{ geocodeProgress }} / {{ csvRows.length }}…</p>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: geocodePercent + '%' }" />
          </div>
          <button type="button" class="btn-ghost full" @click="resetCsv">Cancel</button>
        </template>
      </template>
    </div>

    <!-- Phase: Preview -->
    <template v-else-if="phase === 'preview'">
      <div class="country-summary">
        <span class="accepted-count">{{ acceptedCount }} of {{ geocodedMarkers.length }}</span>
        <span
          v-for="(count, country) in countryCounts"
          :key="country"
          class="country-chip"
        >{{ country || '?' }} ({{ count }})</span>
      </div>

      <div class="filter-row">
        <select v-model="countryFilter" class="country-select">
          <option value="">All countries</option>
          <option v-for="c in uniqueCountries" :key="c" :value="c">{{ c || 'Unknown' }}</option>
        </select>
        <span class="filter-count">{{ filteredMarkers.length }} shown</span>
      </div>

      <div class="marker-list" ref="listEl">
        <div
          v-for="(m, i) in filteredMarkers"
          :key="m._origIdx"
          class="marker-row"
          :class="{ active: currentNavIdx === i, rejected: rejectedSet.has(m._origIdx) }"
          :ref="el => { if (el) rowEls[i] = el }"
        >
          <button class="row-nav" @click="navigateTo(i)">
            <span class="row-label">{{ m.label || `${m.lat.toFixed(4)}, ${m.lng.toFixed(4)}` }}</span>
            <span v-if="m.country" class="country-badge">{{ m.country }}</span>
          </button>
          <button
            class="row-reject"
            :class="{ active: rejectedSet.has(m._origIdx) }"
            @click="toggleReject(m._origIdx)"
            :title="rejectedSet.has(m._origIdx) ? 'Restore' : 'Reject'"
          >
            <AppIcon :name="rejectedSet.has(m._origIdx) ? 'undo' : 'trash'" />
          </button>
        </div>
        <div v-if="filteredMarkers.length === 0" class="empty">No markers for this filter.</div>
      </div>

      <div class="panel-footer">
        <div class="nav-controls">
          <button class="nav-btn" @click="navigate(-1)" :disabled="filteredMarkers.length === 0 || currentNavIdx === 0">
            <AppIcon name="chevronLeft" />
          </button>
          <span class="nav-pos">
            {{ filteredMarkers.length > 0 ? currentNavIdx + 1 : 0 }} / {{ filteredMarkers.length }}
          </span>
          <button class="nav-btn nav-next" @click="navigate(1)" :disabled="filteredMarkers.length === 0 || currentNavIdx >= filteredMarkers.length - 1">
            <AppIcon name="chevronLeft" />
          </button>
        </div>
        <button class="btn-primary" :disabled="acceptedCount === 0" @click="startImport">
          Import {{ acceptedCount }} markers
        </button>
      </div>
    </template>

    <!-- Phase: Importing -->
    <div v-else-if="phase === 'importing'" class="panel-body">
      <p class="msg">Importing {{ csvImportProgress }} / {{ importTotal }}…</p>
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: importPercent + '%' }" />
      </div>
    </div>

    <!-- Phase: Done -->
    <div v-else-if="phase === 'done'" class="panel-body">
      <p class="msg ok">{{ csvStatus }}</p>
      <div v-if="csvFailed.length" class="failed-list">
        Failed: {{ csvFailed.map(f => f.label).join(', ') }}
      </div>
      <button class="btn-primary full" @click="handleClose">Close</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import AppIcon from './AppIcon.vue'
import { useMarkersStore } from '../stores/markers.js'
import { useImportExport } from '../composables/useImportExport.js'
import { useMapControl } from '../composables/useMapControl.js'

const emit = defineEmits(['close'])

const markersStore = useMarkersStore()
const {
  csvInput, csvFiles, csvRows, csvError, csvStatus,
  geocoding, geocodeProgress, geocodedMarkers,
  csvImporting, csvImportProgress, csvFailed,
  resetCsv, onCsvSelected, doGeocode, doCsvImport,
} = useImportExport(markersStore)

const { csvPreviewMarkers, flyTo } = useMapControl()

// ── Rejection state ──────────────────────────────────────────────────────────
const rejectedSet = ref(new Set())

function toggleReject(origIdx) {
  const s = new Set(rejectedSet.value)
  if (s.has(origIdx)) s.delete(origIdx)
  else s.add(origIdx)
  rejectedSet.value = s
}

// ── Country filter ───────────────────────────────────────────────────────────
const countryFilter = ref('')

const uniqueCountries = computed(() => {
  if (!geocodedMarkers.value) return []
  const set = new Set(geocodedMarkers.value.map(m => m.country).filter(Boolean))
  return [...set].sort()
})

const countryCounts = computed(() => {
  if (!geocodedMarkers.value) return {}
  const counts = {}
  for (const m of geocodedMarkers.value) {
    const key = m.country || ''
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
})

// ── Filtered & indexed marker list ───────────────────────────────────────────
const filteredMarkers = computed(() => {
  if (!geocodedMarkers.value) return []
  return geocodedMarkers.value
    .map((m, i) => ({ ...m, _origIdx: i }))
    .filter(m => !countryFilter.value || m.country === countryFilter.value)
})

const acceptedCount = computed(() =>
  geocodedMarkers.value
    ? geocodedMarkers.value.filter((_, i) => !rejectedSet.value.has(i)).length
    : 0
)

// ── Navigation ───────────────────────────────────────────────────────────────
const currentNavIdx = ref(0)
const listEl = ref(null)
const rowEls = ref([])

watch(filteredMarkers, () => {
  currentNavIdx.value = 0
  rowEls.value = []
  if (filteredMarkers.value.length > 0) flyToMarker(0)
})

function navigateTo(i) {
  currentNavIdx.value = i
  flyToMarker(i)
  scrollRowIntoView(i)
}

function navigate(dir) {
  const next = currentNavIdx.value + dir
  if (next < 0 || next >= filteredMarkers.value.length) return
  navigateTo(next)
}

function flyToMarker(i) {
  const m = filteredMarkers.value[i]
  if (m) flyTo(m.lat, m.lng, 15)
}

function scrollRowIntoView(i) {
  nextTick(() => {
    const el = rowEls.value[i]
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}

// ── Sync preview pins to map ─────────────────────────────────────────────────
watch(geocodedMarkers, (markers) => {
  if (!markers) {
    csvPreviewMarkers.value = []
    return
  }
  syncPreviewMarkers()
  if (markers.length > 0) flyToMarker(0)
})

watch(rejectedSet, () => syncPreviewMarkers(), { deep: false })

function syncPreviewMarkers() {
  if (!geocodedMarkers.value) return
  csvPreviewMarkers.value = geocodedMarkers.value.map((m, i) => ({
    ...m,
    rejected: rejectedSet.value.has(i),
  }))
}

// ── Import ───────────────────────────────────────────────────────────────────
const importTotal = ref(0)

const importPercent = computed(() =>
  importTotal.value > 0 ? Math.round(csvImportProgress.value / importTotal.value * 100) : 0
)

async function startImport() {
  const accepted = geocodedMarkers.value.filter((_, i) => !rejectedSet.value.has(i))
  importTotal.value = accepted.length
  await doCsvImport(accepted)
}

// ── Phase ────────────────────────────────────────────────────────────────────
const phase = computed(() => {
  if (csvStatus.value && !geocodedMarkers.value && !csvImporting.value) return 'done'
  if (csvImporting.value) return 'importing'
  if (geocodedMarkers.value) return 'preview'
  return 'select'
})

// ── Progress helpers ─────────────────────────────────────────────────────────
const geocodePercent = computed(() =>
  csvRows.value?.length
    ? Math.round(geocodeProgress.value / csvRows.value.length * 100)
    : 0
)

// ── Cleanup ──────────────────────────────────────────────────────────────────
function handleClose() {
  csvPreviewMarkers.value = []
  emit('close')
}

onUnmounted(() => {
  csvPreviewMarkers.value = []
})
</script>

<style scoped>
.csv-panel {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  width: 380px;
  max-width: 100vw;
  background: var(--surface);
  box-shadow: 2px 0 16px rgba(0,0,0,0.18);
  display: flex;
  flex-direction: column;
  z-index: 1200;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.panel-header h2 {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 4px;
  display: flex;
  align-items: center;
  border-radius: 4px;
}
.close-btn:hover { background: var(--border); color: var(--text); }

/* ── Select phase ─────────────────────────────── */
.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-body.done { justify-content: center; }

.hint { font-size: 13px; color: var(--text-muted); margin: 0; line-height: 1.5; }

.file-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--surface-alt, var(--border));
  border-radius: 6px;
  font-size: 13px;
}
.file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.file-count { color: var(--text-muted); white-space: nowrap; }
.icon-btn { background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 2px 4px; font-size: 12px; }
.icon-btn:hover { color: var(--text); }

.progress-bar {
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.2s;
}

.msg { font-size: 13px; margin: 0; color: var(--text-muted); }
.msg.error { color: var(--danger); }
.msg.ok { color: var(--accent); }

/* ── Preview phase ────────────────────────────── */
.country-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  flex-shrink: 0;
}

.accepted-count { font-weight: 600; font-size: 13px; margin-right: 4px; }

.country-chip {
  background: var(--border);
  border-radius: 10px;
  padding: 2px 8px;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.country-select {
  flex: 1;
  font-size: 13px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
}

.filter-count { font-size: 12px; color: var(--text-muted); white-space: nowrap; }

.marker-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.marker-row {
  display: flex;
  align-items: center;
  padding: 0 8px 0 12px;
  border-radius: 0;
  transition: background 0.1s;
}
.marker-row:hover { background: var(--border); }
.marker-row.active { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.marker-row.rejected { opacity: 0.45; }
.marker-row.rejected .row-label { text-decoration: line-through; }

.row-nav {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 9px 4px 9px 0;
  text-align: left;
  min-width: 0;
  color: var(--text);
}

.row-label {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.country-badge {
  font-size: 10px;
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  color: var(--accent);
  border-radius: 8px;
  padding: 2px 7px;
  white-space: nowrap;
  flex-shrink: 0;
}

.row-reject {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 6px;
  display: flex;
  align-items: center;
  border-radius: 4px;
  flex-shrink: 0;
}
.row-reject:hover { background: var(--border); color: var(--danger); }
.row-reject.active { color: var(--accent); }
.row-reject.active:hover { color: var(--accent); background: var(--border); }

.empty {
  padding: 24px 20px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}

/* ── Footer ───────────────────────────────────── */
.panel-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  gap: 12px;
  flex-shrink: 0;
}

.nav-controls {
  display: flex;
  align-items: center;
  gap: 4px;
}

.nav-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  color: var(--text);
  padding: 5px 7px;
  display: flex;
  align-items: center;
}
.nav-btn:hover:not(:disabled) { background: var(--border); }
.nav-btn:disabled { opacity: 0.35; cursor: default; }
.nav-next { transform: rotate(180deg); }

.nav-pos { font-size: 12px; color: var(--text-muted); padding: 0 6px; min-width: 48px; text-align: center; }

/* ── Buttons ──────────────────────────────────── */
.btn-primary {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}
.btn-primary:hover:not(:disabled) { opacity: 0.88; }
.btn-primary:disabled { opacity: 0.45; cursor: default; }
.btn-primary.full { width: 100%; }

.btn-ghost {
  background: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 14px;
  font-size: 13px;
  cursor: pointer;
  color: var(--text);
}
.btn-ghost:hover { background: var(--border); }
.btn-ghost.full { width: 100%; }

.failed-list { font-size: 12px; color: var(--danger); }

@media (max-width: 640px) {
  .csv-panel { width: 100vw; }
}
</style>
