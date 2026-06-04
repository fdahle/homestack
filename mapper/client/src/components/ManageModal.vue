<template>
  <div class="overlay" @click.self="$emit('close')">
    <TripOrderModal
      v-if="tripOrderOpen && props.item"
      :collection="props.item"
      @close="tripOrderOpen = false"
    />
    <div class="modal">
      <div class="modal-header">
        <h2>{{ isEdit ? `Edit ${label}` : `New ${label}` }}</h2>
        <button class="close-btn" @click="$emit('close')"><AppIcon name="close" /></button>
      </div>

      <form @submit.prevent="save">
        <div class="field">
          <label>Name</label>
          <input v-model="form.name" type="text" :placeholder="label + ' name'" required />
        </div>

        <div class="field" v-if="type === 'collection'">
          <label>Description</label>
          <textarea v-model="form.description" rows="2" placeholder="Optional notes" />
        </div>

        <div class="field" v-if="type === 'collection'">
          <label class="checkbox-label">
            <input type="checkbox" v-model="form.is_trip" @change="if (!form.is_trip) { form.start_date = ''; form.end_date = ''; form.show_route_line = false }" />
            This is a trip
          </label>
        </div>

        <div class="row" v-if="type === 'collection' && form.is_trip">
          <div class="field">
            <label>Start</label>
            <input v-model="form.start_date" type="text" placeholder="e.g. 2024, 06/2024, 15.06.2024" />
          </div>
          <div class="field">
            <label>End</label>
            <input v-model="form.end_date" type="text" placeholder="e.g. 2024, 06/2024, 15.06.2024" />
          </div>
        </div>

        <div class="field" v-if="type === 'collection' && form.is_trip">
          <label class="checkbox-label">
            <input type="checkbox" v-model="form.show_route_line" />
            Show straight line between stops
          </label>
        </div>

        <div class="field" v-if="type === 'collection' && form.is_trip">
          <label class="checkbox-label">
            <input type="checkbox" v-model="form.show_exact_route" />
            Show road-snapped route
          </label>
          <p v-if="form.show_exact_route" class="hint-text">Click the route to add waypoints · Click a waypoint to delete it · Drag to move</p>
        </div>

        <div v-if="type === 'collection' && form.is_trip && isEdit" class="field">
          <button type="button" class="btn-order" @click="tripOrderOpen = true">
            <AppIcon name="reorder" /> Manage stop order
          </button>
        </div>

        <div class="field">
          <label>Color</label>
          <div class="color-row">
            <input v-model="form.color" type="color" class="color-input" />
            <div class="color-presets">
              <button
                v-for="c in presets"
                :key="c"
                type="button"
                class="preset"
                :style="{ background: c, outline: form.color === c ? '2px solid #000' : 'none' }"
                @click="form.color = c"
              />
              <button type="button" class="preset auto-preset" @click="form.color = generateAutoColor()" title="Pick a color distinct from existing ones">Auto</button>
            </div>
          </div>
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
import { ref, computed, onMounted } from 'vue'
import AppIcon from './AppIcon.vue'
import { useCategoriesStore } from '../stores/categories.js'
import { useCollectionsStore } from '../stores/collections.js'
import { usePersonsStore } from '../stores/persons.js'
import TripOrderModal from './TripOrderModal.vue'

const props = defineProps({
  type: { type: String, required: true }, // 'category' | 'collection' | 'person'
  item: { type: Object, default: null },
})
const emit = defineEmits(['close'])

const categoriesStore = useCategoriesStore()
const collectionsStore = useCollectionsStore()
const personsStore = usePersonsStore()

const isEdit = computed(() => !!props.item)
const label = computed(() => props.type === 'category' ? 'Category' : props.type === 'collection' ? 'Collection' : 'Person')
const saving = ref(false)
const error = ref(null)
const tripOrderOpen = ref(false)

const presets = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']

function hslToHex(h, s, l) {
  s /= 100; l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1))).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

function generateAutoColor() {
  const items = props.type === 'category' ? categoriesStore.items : props.type === 'collection' ? collectionsStore.items : personsStore.items
  const hue = Math.round((items.length * 137.508) % 360)
  return hslToHex(hue, 65, 50)
}

const form = ref({
  name: '',
  description: '',
  is_trip: false,
  start_date: '',
  end_date: '',
  color: '#3b82f6',
  show_route_line: false,
  show_exact_route: false,
})

onMounted(() => {
  if (props.item) {
    form.value = {
      name: props.item.name || '',
      description: props.item.description || '',
      is_trip: !!props.item.is_trip,
      start_date: props.item.start_date || '',
      end_date: props.item.end_date || '',
      color: props.item.color || form.value.color,
      show_route_line: !!props.item.show_route_line,
      show_exact_route: !!props.item.show_exact_route,
    }
  } else {
    form.value.color = generateAutoColor()
  }
})

const store = computed(() => props.type === 'category' ? categoriesStore : props.type === 'collection' ? collectionsStore : personsStore)

function parseDate(input) {
  if (!input) return ''
  const s = input.trim()
  if (/^\d{4}$/.test(s)) return s
  if (/^\d{4}[-/]\d{1,2}$/.test(s)) { const [y, m] = s.split(/[-/]/); return `${y}-${m.padStart(2, '0')}` }
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(s)) { const [y, m, d] = s.split(/[-/]/); return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` }
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(s)) { const [d, m, y] = s.split(/[-/.]/); return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` }
  if (/^\d{1,2}[-/.]\d{4}$/.test(s)) { const [m, y] = s.split(/[-/.]/); return `${y}-${m.padStart(2, '0')}` }
  return null
}
function isValidDate(d) { return !d || parseDate(d) !== null }
function normDate(d, isEnd = false) {
  if (!d) return ''
  if (/^\d{4}$/.test(d)) return d + (isEnd ? '-12-31' : '-01-01')
  if (/^\d{4}-\d{2}$/.test(d)) return d + (isEnd ? '-31' : '-01')
  return d
}

async function save() {
  error.value = null
  if (form.value.is_trip) {
    if (!isValidDate(form.value.start_date) || !isValidDate(form.value.end_date)) {
      error.value = 'Accepted: 2024 · 06/2024 · 15.06.2024 · 2024-06-15'
      return
    }
    const startNorm = parseDate(form.value.start_date)
    const endNorm = parseDate(form.value.end_date)
    if (startNorm && endNorm && normDate(startNorm, false) > normDate(endNorm, true)) {
      error.value = 'Start date must be before end date'
      return
    }
    form.value.start_date = startNorm
    form.value.end_date = endNorm
  }
  saving.value = true
  try {
    if (isEdit.value) {
      await store.value.update(props.item.id, form.value)
    } else {
      await store.value.create(form.value)
    }
    emit('close')
  } catch (err) {
    error.value = err.message
    saving.value = false
  }
}

async function del() {
  saving.value = true
  try {
    await store.value.remove(props.item.id)
    emit('close')
  } catch (err) {
    error.value = err.message
    saving.value = false
  }
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
  z-index: 3000;
}

.modal {
  background: var(--surface);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  width: 360px;
  max-width: calc(100vw - 32px);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border);
}

h2 { font-size: 16px; font-weight: 700; }

.close-btn {
  background: none;
  color: var(--text-2);
  padding: 4px 8px;
  border-radius: 4px;
}
.close-btn:hover { background: var(--surface-2); }

form { padding: 16px 20px 20px; }

.field { margin-bottom: 14px; }

textarea { resize: vertical; }

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.color-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.color-input {
  width: 42px;
  height: 36px;
  padding: 2px;
  cursor: pointer;
  border-radius: var(--radius);
}

.color-presets {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.preset {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: none;
  box-shadow: none;
  padding: 0;
  cursor: pointer;
  outline-offset: 2px;
}

.auto-preset {
  border-radius: 4px;
  width: auto;
  height: 22px;
  padding: 0 7px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-2);
}
.auto-preset:hover { background: var(--border); color: var(--text); }

.checkbox-label { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.checkbox-label input[type="checkbox"] { width: 14px; height: 14px; cursor: pointer; }
.hint-text { font-size: 11px; color: var(--text-2); margin-top: 4px; }

.btn-order {
  width: 100%;
  padding: 7px 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  border: 1px dashed color-mix(in srgb, var(--accent) 30%, var(--border));
  border-radius: var(--radius);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-align: left;
  transition: background 0.1s;
}
.btn-order:hover { background: color-mix(in srgb, var(--accent) 14%, var(--surface)); }

.error { color: var(--danger); font-size: 13px; margin-bottom: 10px; }

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

@media (max-width: 640px) {
  .overlay { align-items: stretch; padding: 0; }
  .modal {
    width: 100vw;
    max-width: 100vw;
    min-height: 100vh;
    border-radius: 0;
  }
  .modal-header { padding-top: calc(16px + var(--sat, 0px)); }
  form { padding-bottom: calc(20px + var(--sab, 0px)); }
}
</style>
