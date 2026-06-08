<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h2>Markers <span class="count">{{ filteredMarkers.length }}</span></h2>
        <div class="header-right">
          <input v-model="search" class="search-input" placeholder="Filter by label…" autocomplete="off" />
          <button class="close-btn" @click="$emit('close')"><AppIcon name="close" /></button>
        </div>
      </div>

      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th class="th-num">#</th>
              <th class="th-label">Label</th>
              <th class="th-image">Image</th>
              <th class="th-desc">Description</th>
              <th class="th-addr">Address</th>
              <th class="th-url">External URL</th>
              <th class="th-tags">Collections</th>
              <th class="th-tags">Persons</th>
              <th class="th-tags">Categories</th>
              <th class="th-vis">Visited</th>
              <th class="th-act"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(m, idx) in filteredMarkers" :key="m.id" :class="{ 'row-saving': savingIds.has(m.id) }">
              <td class="td-num">{{ idx + 1 }}</td>

              <!-- Label -->
              <td class="td-editable">
                <input v-if="isEditing(m.id, 'label')"
                  class="cell-input" v-model="draftValue"
                  @keydown.enter="commit" @keydown.esc="cancelEdit" @blur="commit"
                  v-focus />
                <span v-else class="cell-text" :class="{ 'cell-muted': !m.label }" @click="startEdit(m.id, 'label', m.label)">
                  {{ m.label || 'Unnamed' }}
                </span>
              </td>

              <!-- Image URL -->
              <td class="td-image td-editable">
                <input v-if="isEditing(m.id, 'image_url')"
                  class="cell-input" v-model="draftValue" placeholder="https://…"
                  @keydown.enter="commit" @keydown.esc="cancelEdit" @blur="commit"
                  v-focus />
                <template v-else>
                  <img v-if="m.image_url" :src="m.image_url" class="thumb"
                    @error="e => e.target.style.display = 'none'"
                    @click="startEdit(m.id, 'image_url', m.image_url)" />
                  <span v-else class="cell-text cell-muted" @click="startEdit(m.id, 'image_url', m.image_url)">—</span>
                </template>
              </td>

              <!-- Description -->
              <td class="td-editable td-desc">
                <textarea v-if="isEditing(m.id, 'description')"
                  class="cell-input cell-textarea" v-model="draftValue" rows="3"
                  @keydown.esc="cancelEdit" @blur="commit"
                  v-focus />
                <span v-else class="cell-text cell-clamp" :class="{ 'cell-muted': !m.description }"
                  @click="startEdit(m.id, 'description', m.description)">
                  {{ m.description || '—' }}
                </span>
              </td>

              <!-- Address -->
              <td class="td-editable">
                <input v-if="isEditing(m.id, 'address')"
                  class="cell-input" v-model="draftValue"
                  @keydown.enter="commit" @keydown.esc="cancelEdit" @blur="commit"
                  v-focus />
                <span v-else class="cell-text" :class="{ 'cell-muted': !m.address }"
                  @click="startEdit(m.id, 'address', m.address)">
                  {{ m.address || '—' }}
                </span>
              </td>

              <!-- External URL -->
              <td class="td-editable">
                <input v-if="isEditing(m.id, 'external_url')"
                  class="cell-input" v-model="draftValue" placeholder="https://…"
                  @keydown.enter="commit" @keydown.esc="cancelEdit" @blur="commit"
                  v-focus />
                <span v-else class="cell-text cell-overflow" :class="{ 'cell-muted': !m.external_url }"
                  @click="startEdit(m.id, 'external_url', m.external_url)">
                  {{ m.external_url || '—' }}
                </span>
              </td>

              <!-- Collections -->
              <td class="td-tags td-tag-cell"
                :class="{ 'tag-cell-active': tagPopup?.markerId === m.id && tagPopup?.type === 'collections' }"
                @click="openTagPopup($event, m.id, 'collections')">
                <span v-for="c in m.collections" :key="c.id" class="tag"
                  :style="{ background: c.color + '22', color: c.color, borderColor: c.color + '55' }">
                  {{ c.name }}
                </span>
                <span v-if="!m.collections?.length" class="cell-muted">—</span>
              </td>

              <!-- Persons -->
              <td class="td-tags td-tag-cell"
                :class="{ 'tag-cell-active': tagPopup?.markerId === m.id && tagPopup?.type === 'persons' }"
                @click="openTagPopup($event, m.id, 'persons')">
                <span v-for="p in m.persons" :key="p.id" class="tag"
                  :style="{ background: p.color + '22', color: p.color, borderColor: p.color + '55' }">
                  {{ p.name }}
                </span>
                <span v-if="!m.persons?.length" class="cell-muted">—</span>
              </td>

              <!-- Categories -->
              <td class="td-tags td-tag-cell"
                :class="{ 'tag-cell-active': tagPopup?.markerId === m.id && tagPopup?.type === 'categories' }"
                @click="openTagPopup($event, m.id, 'categories')">
                <span v-for="c in m.categories" :key="c.id" class="tag"
                  :style="{ background: c.color + '22', color: c.color, borderColor: c.color + '55' }">
                  {{ c.name }}
                </span>
                <span v-if="!m.categories?.length" class="cell-muted">—</span>
              </td>

              <!-- Visited -->
              <td class="td-vis">
                <AppIcon v-if="m.visited_at" name="check" class="visited-icon" />
                <span v-else class="cell-muted">—</span>
              </td>

              <!-- Actions -->
              <td class="td-act">
                <button class="btn-open" @click="$emit('open-marker', m)" title="Open full editor">
                  <AppIcon name="edit" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!filteredMarkers.length" class="empty">No markers found.</p>
      </div>
    </div>

    <!-- Tag picker dropdown — teleported so it's never clipped by table overflow -->
    <Teleport to="body">
    <div v-if="tagPopup" class="tag-popup" :style="popupStyle" ref="tagPopupEl">
      <div class="tag-popup-title">{{ tagPopupLabel }}</div>
      <div class="tag-popup-list">
        <button v-for="item in tagPopupItems" :key="item.id"
          class="tag-popup-item"
          @mousedown.prevent="toggleTag(item.id)">
          <span class="tag-dot" :style="{ background: item.color }" />
          <span class="tag-popup-name">{{ item.name }}</span>
          <AppIcon v-if="isTagSelected(item.id)" name="check" class="tag-check" />
        </button>
        <div v-if="!tagPopupItems.length" class="tag-popup-empty">Nothing created yet</div>
      </div>
    </div>
  </Teleport>
</div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue'
import AppIcon from './AppIcon.vue'
import { useMarkersStore } from '../stores/markers.js'
import { useCollectionsStore } from '../stores/collections.js'
import { usePersonsStore } from '../stores/persons.js'
import { useCategoriesStore } from '../stores/categories.js'

const emit = defineEmits(['close', 'open-marker'])
const markersStore     = useMarkersStore()
const collectionsStore = useCollectionsStore()
const personsStore     = usePersonsStore()
const categoriesStore  = useCategoriesStore()

// ── Text cell editing ─────────────────────────────────────────────────────────

const search      = ref('')
const editingCell = ref(null)
const draftValue  = ref('')
const savingIds   = ref(new Set())

const filteredMarkers = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return markersStore.items
  return markersStore.items.filter(m => (m.label || '').toLowerCase().includes(q))
})

const isEditing = (id, field) =>
  editingCell.value?.id === id && editingCell.value?.field === field

function startEdit(id, field, value) {
  closeTagPopup()
  editingCell.value = { id, field }
  draftValue.value  = value ?? ''
}

function cancelEdit() {
  editingCell.value = null
  draftValue.value  = ''
}

async function commit() {
  if (!editingCell.value) return
  const { id, field } = editingCell.value
  const newValue = draftValue.value
  cancelEdit()
  const m = markersStore.items.find(m => m.id === id)
  if (!m) return
  if ((m[field] ?? '') === newValue) return
  await saveMarker(m, { [field]: newValue })
}

// ── Tag popup ─────────────────────────────────────────────────────────────────

const tagPopup   = ref(null)  // { markerId, type, x, yBelow, yAbove }
const tagPopupEl = ref(null)

const TAG_LABELS = { collections: 'Collections', persons: 'Persons', categories: 'Categories' }

const tagPopupLabel = computed(() => tagPopup.value ? TAG_LABELS[tagPopup.value.type] : '')

const tagPopupItems = computed(() => {
  if (!tagPopup.value) return []
  const t = tagPopup.value.type
  if (t === 'collections') return collectionsStore.items
  if (t === 'persons')     return personsStore.items
  if (t === 'categories')  return categoriesStore.items
  return []
})

const popupStyle = computed(() => {
  if (!tagPopup.value) return {}
  const popW = 200
  const popH = Math.min(tagPopupItems.value.length * 36 + 36, 320)
  let x = tagPopup.value.x
  let y = tagPopup.value.yBelow + 4
  if (x + popW > window.innerWidth - 8)  x = window.innerWidth - popW - 8
  if (y + popH > window.innerHeight - 8) y = tagPopup.value.yAbove - popH - 4
  return { left: Math.max(8, x) + 'px', top: Math.max(8, y) + 'px', width: popW + 'px' }
})

function isTagSelected(itemId) {
  if (!tagPopup.value) return false
  const m = markersStore.items.find(m => m.id === tagPopup.value.markerId)
  if (!m) return false
  const t = tagPopup.value.type
  if (t === 'collections') return m.collections?.some(c => c.id === itemId) ?? false
  if (t === 'persons')     return m.persons?.some(p => p.id === itemId) ?? false
  if (t === 'categories')  return m.categories?.some(c => c.id === itemId) ?? false
  return false
}

function openTagPopup(e, markerId, type) {
  commit() // flush any open text edit (fire-and-forget is fine)
  const rect = e.currentTarget.getBoundingClientRect()
  tagPopup.value = { markerId, type, x: rect.left, yBelow: rect.bottom, yAbove: rect.top }
  document.addEventListener('mousedown', onDocMouseDown, { capture: true })
}

function closeTagPopup() {
  if (!tagPopup.value) return
  tagPopup.value = null
  document.removeEventListener('mousedown', onDocMouseDown, { capture: true })
}

function onDocMouseDown(e) {
  if (tagPopupEl.value && !tagPopupEl.value.contains(e.target)) closeTagPopup()
}

async function toggleTag(itemId) {
  if (!tagPopup.value) return
  const { markerId, type } = tagPopup.value
  const m = markersStore.items.find(m => m.id === markerId)
  if (!m) return

  const col = m.collections?.map(c => c.id) ?? []
  const per = m.persons?.map(p => p.id) ?? []
  const cat = m.categories?.map(c => c.id) ?? []

  const toggle = (arr) => arr.includes(itemId) ? arr.filter(i => i !== itemId) : [...arr, itemId]

  await saveMarker(m, {
    collection_ids: type === 'collections' ? toggle(col) : col,
    person_ids:     type === 'persons'     ? toggle(per) : per,
    category_ids:   type === 'categories'  ? toggle(cat) : cat,
  })
}

// ── Shared save helper ────────────────────────────────────────────────────────

async function saveMarker(m, patch) {
  savingIds.value = new Set([...savingIds.value, m.id])
  try {
    await markersStore.update(m.id, {
      label:        m.label,
      description:  m.description,
      address:      m.address,
      color:        m.color,
      image_url:    m.image_url,
      external_url: m.external_url,
      visited_at:   m.visited_at,
      planned_at:   m.planned_at,
      rating:       m.rating,
      is_favorite:  m.is_favorite,
      category_ids:   m.categories?.map(c => c.id) ?? [],
      collection_ids: m.collections?.map(c => c.id) ?? [],
      person_ids:     m.persons?.map(p => p.id) ?? [],
      ...patch,
    })
  } finally {
    savingIds.value = new Set([...savingIds.value].filter(i => i !== m.id))
  }
}

onUnmounted(() => {
  document.removeEventListener('mousedown', onDocMouseDown, { capture: true })
})

const vFocus = {
  mounted(el) {
    el.focus()
    if (el.tagName === 'INPUT') el.select()
  },
}
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3000;
  padding: 20px;
}

.modal {
  background: var(--surface);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  width: min(95vw, 1400px);
  height: min(90vh, 900px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  gap: 12px;
}

h2 {
  font-size: 16px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.count {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-2);
  background: var(--surface-2);
  border-radius: 10px;
  padding: 1px 7px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  justify-content: flex-end;
}

.search-input {
  width: 200px;
  padding: 6px 10px;
  font-size: 13px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
}
.search-input:focus { border-color: var(--accent); outline: none; }

.close-btn {
  background: none;
  color: var(--text-2);
  padding: 4px 8px;
  border-radius: 4px;
  flex-shrink: 0;
}
.close-btn:hover { background: var(--surface-2); }

/* ── Table ── */
.table-scroll {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

thead th {
  position: sticky;
  top: 0;
  background: var(--surface);
  border-bottom: 2px solid var(--border);
  padding: 8px 10px;
  text-align: left;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-2);
  white-space: nowrap;
  z-index: 1;
}

tbody tr {
  border-bottom: 1px solid var(--border);
  transition: background 0.1s;
}
tbody tr:last-child { border-bottom: none; }
tbody tr:hover { background: color-mix(in srgb, var(--accent) 3%, var(--surface)); }
tbody tr.row-saving { background: color-mix(in srgb, var(--accent) 6%, var(--surface)); }

td {
  padding: 7px 10px;
  vertical-align: middle;
  color: var(--text);
}

/* Column widths */
.th-num   { width: 40px; }
.th-label { width: 160px; }
.th-image { width: 80px; }
.th-desc  { width: 200px; }
.th-addr  { width: 150px; }
.th-url   { width: 150px; }
.th-tags  { width: 120px; }
.th-vis   { width: 60px; text-align: center; }
.th-act   { width: 44px; }

.td-num {
  color: var(--text-2);
  font-size: 12px;
  text-align: right;
  padding-right: 12px;
}

.td-image { width: 80px; }
.td-desc  { width: 200px; max-width: 200px; }
.td-tags  { max-width: 120px; }
.td-vis   { text-align: center; }
.td-act   { text-align: center; padding: 4px; }

/* Editable text cells */
.td-editable { cursor: text; }
.td-editable:hover {
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}
.td-editable:hover .cell-text {
  text-decoration: underline dotted;
  text-underline-offset: 3px;
  text-decoration-color: var(--text-2);
}

/* Tag cells */
.td-tag-cell {
  cursor: pointer;
}
.td-tag-cell:hover {
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}
.td-tag-cell.tag-cell-active {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  outline: 2px solid color-mix(in srgb, var(--accent) 40%, transparent);
  outline-offset: -2px;
  border-radius: 2px;
}

.cell-text {
  display: block;
  color: var(--text);
  word-break: break-word;
  min-height: 18px;
}

.cell-muted { color: var(--text-2); }

.cell-clamp {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.cell-overflow {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
  display: block;
}

.cell-input {
  width: 100%;
  padding: 4px 6px;
  font-size: 13px;
  border: 1px solid var(--accent);
  border-radius: 4px;
  background: var(--surface);
  color: var(--text);
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
  font-family: inherit;
}

.cell-textarea {
  resize: vertical;
  min-height: 60px;
  line-height: 1.4;
  display: block;
}

/* Image thumbnail */
.thumb {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid var(--border);
  cursor: pointer;
  display: block;
}

/* Tags */
.tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 10px;
  border: 1px solid;
  font-size: 11px;
  font-weight: 500;
  margin: 1px 2px 1px 0;
  white-space: nowrap;
}

/* Visited */
.visited-icon {
  color: var(--accent);
  display: inline-flex;
}

/* Open in form button */
.btn-open {
  background: none;
  color: var(--text-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s, color 0.1s;
}
.btn-open:hover { background: var(--surface-2); color: var(--text); }

.empty {
  padding: 48px 20px;
  text-align: center;
  color: var(--text-2);
  font-size: 14px;
}

@media (max-width: 640px) {
  .overlay { padding: 0; align-items: stretch; }
  .modal { width: 100vw; height: 100dvh; border-radius: 0; }
  .search-input { width: 140px; }
}
</style>

<!-- Tag popup lives outside scoped styles so it's not affected by the modal's overflow -->
<style>
.tag-popup {
  position: fixed;
  z-index: 4000;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.tag-popup-title {
  padding: 7px 12px 5px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-2);
  border-bottom: 1px solid var(--border);
}

.tag-popup-list {
  max-height: 280px;
  overflow-y: auto;
}

.tag-popup-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  background: none;
  border: none;
  border-radius: 0;
  text-align: left;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
  transition: background 0.1s;
}
.tag-popup-item:hover { background: var(--surface-2); }

.tag-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.tag-popup-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-check {
  color: var(--accent);
  flex-shrink: 0;
}

.tag-popup-empty {
  padding: 10px 12px;
  font-size: 13px;
  color: var(--text-2);
}
</style>
