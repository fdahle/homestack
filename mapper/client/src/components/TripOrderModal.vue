<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h2>Stop order — {{ collection.name }}</h2>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>

      <p class="hint">Drag markers to reorder. Set the transport mode between each pair of stops.</p>

      <div class="modal-body">
        <p v-if="localItems.length === 0" class="empty">No markers in this trip yet.</p>
        <template v-for="(item, index) in localItems" :key="item.markerId">
          <div
            class="order-row"
            :class="{ 'is-drag-over': dragOverIndex === index }"
            draggable="true"
            @dragstart="onDragStart(index, $event)"
            @dragover.prevent="onDragOver(index)"
            @drop.prevent="onDrop(index)"
            @dragend="onDragEnd"
          >
            <span class="drag-handle">⠿</span>
            <span class="stop-num">{{ index + 1 }}</span>
            <span class="dot" :style="{ background: effectiveColor(item.marker) }" />
            <span class="marker-name">{{ item.marker.label || coords(item.marker) }}</span>
          </div>
          <div v-if="index < localItems.length - 1" class="segment-row">
            <div class="seg-line" :style="{ background: collection.color || '#10b981' }" />
            <div class="mode-pills">
              <button
                v-for="m in MODES"
                :key="m.value"
                type="button"
                class="mode-pill"
                :class="{ active: getSegMode(index) === m.value }"
                @click="setSegMode(index, m.value)"
              >{{ m.label }}</button>
            </div>
          </div>
        </template>
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <div class="modal-actions">
        <div class="spacer" />
        <button type="button" class="btn-secondary" @click="$emit('close')">Cancel</button>
        <button type="button" class="btn-primary" @click="save" :disabled="saving">
          {{ saving ? '…' : 'Save' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useMarkersStore } from '../stores/markers.js'

const MODES = [
  { value: 'walk',  label: 'Walk'  },
  { value: 'hike',  label: 'Hike'  },
  { value: 'bike',  label: 'Bike'  },
  { value: 'drive', label: 'Drive' },
]

const props = defineProps({
  collection: { type: Object, required: true },
})
const emit = defineEmits(['close'])

const markersStore = useMarkersStore()
const saving = ref(false)
const error = ref(null)
const localItems = ref([])
const segments = ref({})

onMounted(async () => {
  localItems.value = markersStore.items
    .filter((m) => m.collections.some((c) => c.id === props.collection.id))
    .map((m) => ({
      markerId: m.id,
      marker: m,
      position: m.collections.find((c) => c.id === props.collection.id)?.position ?? null,
    }))
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity))

  try {
    const res = await fetch(`/api/collections/${props.collection.id}/segments`)
    if (res.ok) {
      const rows = await res.json()
      segments.value = Object.fromEntries(rows.map(r => [`${r.from_marker_id}-${r.to_marker_id}`, r]))
    }
  } catch {}
})

function getSegMode(index) {
  const from = localItems.value[index]
  const to   = localItems.value[index + 1]
  if (!from || !to) return 'walk'
  return segments.value[`${from.markerId}-${to.markerId}`]?.mode || 'walk'
}

async function setSegMode(index, mode) {
  const from = localItems.value[index]
  const to   = localItems.value[index + 1]
  if (!from || !to) return
  const key = `${from.markerId}-${to.markerId}`
  const existing = segments.value[key]
  segments.value = { ...segments.value, [key]: { ...(existing || {}), mode } }
  try {
    await fetch(`/api/collections/${props.collection.id}/segments/${from.markerId}/${to.markerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, via_points: existing?.via_points || [] }),
    })
  } catch {}
}

// ── Drag and drop ────────────────────────────────────────────────────────────
const dragIndex     = ref(null)
const dragOverIndex = ref(null)

function onDragStart(index, e) {
  dragIndex.value = index
  e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(index) {
  if (dragIndex.value !== null) dragOverIndex.value = index
}

function onDrop(index) {
  if (dragIndex.value === null || dragIndex.value === index) {
    dragIndex.value = dragOverIndex.value = null
    return
  }
  const [item] = localItems.value.splice(dragIndex.value, 1)
  localItems.value.splice(index, 0, item)
  dragIndex.value = dragOverIndex.value = null
}

function onDragEnd() {
  dragIndex.value = dragOverIndex.value = null
}

// ── Save ─────────────────────────────────────────────────────────────────────
async function save() {
  error.value = null
  saving.value = true
  try {
    await markersStore.updateTripPositions(
      props.collection.id,
      localItems.value.map((item, i) => ({ marker_id: item.markerId, position: i + 1 }))
    )
    emit('close')
  } catch (err) {
    error.value = err.message
    saving.value = false
  }
}

function effectiveColor(m) { return m.color || m.categories?.[0]?.color || '#6c757d' }
function coords(m) { return `(${m.lat.toFixed(4)}, ${m.lng.toFixed(4)})` }
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3100;
}

.modal {
  background: var(--surface);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  width: 380px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

h2 { font-size: 15px; font-weight: 700; }

.close-btn {
  background: none;
  color: var(--text-2);
  padding: 4px 8px;
  border-radius: 4px;
}
.close-btn:hover { background: var(--surface-2); }

.hint {
  font-size: 12px;
  color: var(--text-2);
  padding: 8px 20px 4px;
  flex-shrink: 0;
}

.modal-body {
  overflow-y: auto;
  flex: 1;
  padding: 4px 0;
}

.empty {
  font-size: 13px;
  color: var(--text-2);
  padding: 20px;
  text-align: center;
}

.order-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  cursor: grab;
  user-select: none;
  transition: background 0.1s;
}
.order-row:last-child { border-bottom: none; }
.order-row:hover { background: var(--surface-2); }
.order-row.is-drag-over { background: color-mix(in srgb, var(--accent) 10%, var(--surface)); border-top: 2px solid var(--accent); }
.order-row:active { cursor: grabbing; }

.drag-handle {
  font-size: 16px;
  color: var(--text-2);
  flex-shrink: 0;
  line-height: 1;
}

.stop-num {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-2);
  width: 18px;
  text-align: right;
  flex-shrink: 0;
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}

.marker-name {
  flex: 1;
  font-size: 13px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.segment-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px 0 48px;
  min-height: 28px;
}

.seg-line {
  width: 2px;
  height: 20px;
  border-radius: 1px;
  opacity: 0.5;
  flex-shrink: 0;
}

.mode-pills {
  display: flex;
  gap: 4px;
}

.mode-pill {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text-2);
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.mode-pill:hover { background: var(--border); color: var(--text); }
.mode-pill.active { background: var(--accent); color: #fff; border-color: var(--accent); }

.error { color: var(--danger); font-size: 13px; margin: 0 20px 8px; }

.modal-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.spacer { flex: 1; }

.btn-primary { background: var(--accent); color: #fff; font-weight: 600; }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-secondary { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); }
.btn-secondary:hover { background: var(--border); }

@media (max-width: 640px) {
  .overlay { align-items: stretch; padding: 0; }
  .modal {
    width: 100vw;
    max-width: 100vw;
    height: 100vh;
    max-height: 100vh;
    border-radius: 0;
  }
  .modal-header { padding-top: calc(16px + var(--sat, 0px)); }
  .modal-actions { padding-bottom: calc(16px + var(--sab, 0px)); }
}
</style>
