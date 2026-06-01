<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h2>{{ viewing ? 'Marker' : isEdit ? 'Edit Marker' : 'Add Marker' }}</h2>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>

      <!-- View mode for existing markers -->
      <div v-if="viewing" class="view-body">
        <div class="view-label">{{ form.label || '(unnamed)' }}</div>
        <p v-if="form.description" class="view-desc">{{ form.description }}</p>
        <div class="view-meta">
          <div v-if="selectedCategories.length" class="view-row">
            <span v-for="cat in selectedCategories" :key="cat.id" class="dot" :style="{ background: cat.color }" />
            <span>{{ selectedCategories.map(c => c.name).join(', ') }}</span>
          </div>
          <div v-if="selectedCollections.length" class="view-row">
            <span v-for="col in selectedCollections" :key="col.id" class="dot" :style="{ background: col.color }" />
            <span>{{ selectedCollections.map(c => c.name).join(', ') }}</span>
          </div>
          <div v-if="form.visited_at" class="view-row">Visited {{ form.visited_at }}</div>
          <div class="view-row view-coords">{{ latStr }}, {{ lngStr }}</div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-danger" @click="del" :disabled="saving">Delete</button>
          <div class="spacer" />
<button type="button" class="btn-secondary" @click="$emit('close')">Close</button>
          <button type="button" class="btn-primary" @click="viewing = false">Edit</button>
        </div>
      </div>

      <form v-else @submit.prevent="save">
        <div class="field">
          <label>Label</label>
          <input v-model="form.label" type="text" placeholder="e.g. Eiffel Tower" />
        </div>

        <div class="field">
          <label>Description</label>
          <textarea v-model="form.description" rows="3" placeholder="Notes about this place…" />
        </div>

        <div class="field">
          <label>Categories</label>
          <div class="checkbox-list">
            <label v-for="cat in categoriesStore.items" :key="cat.id" class="checkbox-item">
              <input type="checkbox" :value="cat.id" v-model="form.category_ids" style="width:auto" />
              <span class="dot" :style="{ background: cat.color }" />
              {{ cat.name }}
            </label>
            <span v-if="categoriesStore.items.length === 0" class="empty-hint">No categories yet</span>
          </div>
        </div>

        <div class="field">
          <label>Color</label>
          <div class="color-row">
            <button
              type="button"
              class="color-swatch inherit"
              :class="{ selected: !form.color }"
              @click="form.color = ''"
              title="Inherit from category"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <line x1="1" y1="13" x2="13" y2="1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </button>
            <button
              v-for="c in COLOR_PRESETS"
              :key="c"
              type="button"
              class="color-swatch"
              :class="{ selected: form.color === c }"
              :style="{ background: c }"
              @click="form.color = c"
            />
            <span class="effective-color">
              <span class="dot" :style="{ background: effectiveColor }" />
            </span>
          </div>
        </div>

        <div class="field">
          <label>Collections</label>
          <div class="checkbox-list">
            <label v-for="col in collectionsStore.items" :key="col.id" class="checkbox-item">
              <input
                type="checkbox"
                :value="col.id"
                v-model="form.collection_ids"
                style="width:auto"
              />
              <span class="dot" :style="{ background: col.color }" />
              {{ col.name }}
            </label>
            <span v-if="collectionsStore.items.length === 0" class="empty-hint">No collections yet</span>
          </div>
        </div>

        <div class="field">
          <div class="visited-row">
            <label class="checkbox-item" style="margin:0">
              <input type="checkbox" v-model="visitedChecked" style="width:auto" />
              Visited
            </label>
            <input v-if="visitedChecked" v-model="form.visited_at" type="date" class="visited-date" />
          </div>
        </div>

        <div class="field coords">
          <span>{{ latStr }}, {{ lngStr }}</span>
        </div>

        <p v-if="error" class="error">{{ error }}</p>

        <div class="modal-actions">
          <button v-if="isEdit" type="button" class="btn-danger" @click="del" :disabled="saving">
            Delete
          </button>
          <div class="spacer" />
          <button type="button" class="btn-secondary" @click="$emit('close')">Cancel</button>
          <button type="submit" class="btn-primary" :disabled="saving">
            {{ saving ? '...' : 'Save' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useCategoriesStore } from '../stores/categories.js'
import { useCollectionsStore } from '../stores/collections.js'
import { useMarkersStore } from '../stores/markers.js'

const COLOR_PRESETS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']

const props = defineProps({
  marker: { type: Object, default: null },
  latlng: { type: Object, default: null },
  suggestedLabel: { type: String, default: '' },
})
const emit = defineEmits(['save', 'delete', 'close'])

const categoriesStore = useCategoriesStore()
const collectionsStore = useCollectionsStore()
const markersStore = useMarkersStore()

const isEdit = computed(() => !!props.marker)
const viewing = ref(!!props.marker)
const saving = ref(false)
const error = ref(null)
const visitedChecked = ref(false)

const form = ref({
  label: '',
  description: '',
  category_ids: [],
  collection_ids: [],
  visited_at: '',
  color: '',
  lat: 0,
  lng: 0,
})

const selectedCategories = computed(() =>
  categoriesStore.items.filter((c) => form.value.category_ids.includes(c.id))
)
const effectiveColor = computed(() =>
  form.value.color || selectedCategories.value[0]?.color || '#6c757d'
)
const selectedCollections = computed(() =>
  collectionsStore.items.filter((c) => form.value.collection_ids.includes(c.id))
)

watch(visitedChecked, (val) => {
  if (!val) form.value.visited_at = ''
})

onMounted(() => {
  if (props.marker) {
    form.value = {
      label: props.marker.label || '',
      description: props.marker.description || '',
      category_ids: props.marker.categories?.map((c) => c.id) ?? [],
      collection_ids: props.marker.collections?.map((c) => c.id) ?? [],
      visited_at: props.marker.visited_at?.slice(0, 10) || '',
      color: props.marker.color || '',
      lat: props.marker.lat,
      lng: props.marker.lng,
    }
    visitedChecked.value = !!props.marker.visited_at
  } else if (props.latlng) {
    form.value.lat = props.latlng.lat
    form.value.lng = props.latlng.lng
    form.value.label = props.suggestedLabel || ''
    // Pre-fill category/collection from active group drill-down
    if (markersStore.activeGroupFilter?.type === 'category') {
      form.value.category_ids = [markersStore.activeGroupFilter.id]
    } else if (markersStore.activeGroupFilter?.type === 'collection') {
      form.value.collection_ids = [markersStore.activeGroupFilter.id]
    }
  }
})

const latStr = computed(() => Number(form.value.lat).toFixed(5))
const lngStr = computed(() => Number(form.value.lng).toFixed(5))

async function save() {
  error.value = null
  saving.value = true
  try {
    await emit('save', { ...form.value, color: form.value.color || null })
  } catch (err) {
    error.value = err.message
    saving.value = false
  }
}

async function del() {
  saving.value = true
  await emit('delete', props.marker.id)
}
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.modal {
  background: var(--surface);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  width: 420px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
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
}

h2 {
  font-size: 16px;
  font-weight: 700;
}

.close-btn {
  background: none;
  color: var(--text-2);
  padding: 4px 8px;
  font-size: 14px;
  border-radius: 4px;
}
.close-btn:hover { background: var(--surface-2); }

form {
  padding: 16px 20px 20px;
  overflow-y: auto;
}

.field { margin-bottom: 14px; }

textarea { resize: vertical; }

.color-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.color-swatch {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  padding: 0;
  cursor: pointer;
  transition: transform 0.1s, border-color 0.1s;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.color-swatch:hover { transform: scale(1.15); }
.color-swatch.selected { border-color: var(--text); transform: scale(1.1); }
.color-swatch.inherit {
  background: var(--surface-2);
  border-color: var(--border);
  color: var(--text-2);
}
.color-swatch.inherit.selected { border-color: var(--text); }

.effective-color {
  margin-left: 4px;
  display: flex;
  align-items: center;
}

.checkbox-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  max-height: 120px;
  overflow-y: auto;
}

.checkbox-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  color: var(--text);
  cursor: pointer;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.empty-hint {
  font-size: 12px;
  color: var(--text-2);
}

.coords {
  font-size: 12px;
  color: var(--text-2);
  font-family: monospace;
}

.view-body {
  padding: 16px 20px 20px;
}

.view-label {
  font-size: 17px;
  font-weight: 700;
  margin-bottom: 6px;
  color: var(--text);
}

.view-desc {
  font-size: 14px;
  color: var(--text-2);
  margin-bottom: 12px;
  white-space: pre-wrap;
  line-height: 1.5;
}

.view-meta {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 16px;
}

.view-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text);
}

.view-coords {
  font-family: monospace;
  font-size: 12px;
  color: var(--text-2);
}

.visited-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.visited-date {
  flex: 1;
  min-width: 0;
}

.error {
  color: var(--danger);
  font-size: 13px;
  margin-bottom: 10px;
}

.modal-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 4px;
}

.spacer { flex: 1; }

.btn-primary { background: var(--accent); color: #fff; font-weight: 600; }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }

.btn-secondary { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); }
.btn-secondary:hover { background: var(--border); }

.btn-danger { background: none; color: var(--danger); border: 1px solid var(--danger); }
.btn-danger:hover:not(:disabled) { background: var(--danger); color: #fff; }
</style>
