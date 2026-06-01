<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h2>{{ isEdit ? `Edit ${label}` : `New ${label}` }}</h2>
        <button class="close-btn" @click="$emit('close')">✕</button>
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
            <input type="checkbox" v-model="form.is_trip" @change="if (!form.is_trip) { form.start_date = ''; form.end_date = '' }" />
            This is a trip
          </label>
        </div>

        <div class="row" v-if="type === 'collection' && form.is_trip">
          <div class="field">
            <label>Start</label>
            <input v-model="form.start_date" type="month" />
          </div>
          <div class="field">
            <label>End</label>
            <input v-model="form.end_date" type="month" />
          </div>
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
import { useCategoriesStore } from '../stores/categories.js'
import { useCollectionsStore } from '../stores/collections.js'

const props = defineProps({
  type: { type: String, required: true }, // 'category' | 'collection'
  item: { type: Object, default: null },
})
const emit = defineEmits(['close'])

const categoriesStore = useCategoriesStore()
const collectionsStore = useCollectionsStore()

const isEdit = computed(() => !!props.item)
const label = computed(() => props.type === 'category' ? 'Category' : 'Collection')
const saving = ref(false)
const error = ref(null)

const presets = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']

const form = ref({
  name: '',
  description: '',
  is_trip: false,
  start_date: '',
  end_date: '',
  color: props.type === 'collection' ? '#10b981' : '#3b82f6',
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
    }
  }
})

const store = computed(() => props.type === 'category' ? categoriesStore : collectionsStore)

async function save() {
  error.value = null
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
  padding: 0;
  cursor: pointer;
  outline-offset: 2px;
}

.checkbox-label { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.checkbox-label input[type="checkbox"] { width: 14px; height: 14px; cursor: pointer; }

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
</style>
