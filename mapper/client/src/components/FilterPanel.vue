<template>
  <div class="sidebar">
    <div class="pane-track" :class="{ 'is-detail': pane === 'detail' }">

      <!-- ── Overview pane ── -->
      <div class="pane">

        <div class="sidebar-header">
          <div class="header-row1">
            <input
              v-model="overviewQuery"
              type="search"
              :placeholder="activeTab === 'category' ? 'Filter categories…' : 'Filter collections…'"
              class="search-input"
              autocomplete="off"
            />
            <button class="icon-btn" @click="$emit('open-stats')" title="Statistics">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="7" width="3" height="6" rx="1" fill="currentColor"/>
                <rect x="5.5" y="4" width="3" height="9" rx="1" fill="currentColor"/>
                <rect x="10" y="1" width="3" height="12" rx="1" fill="currentColor"/>
              </svg>
            </button>
            <button class="icon-btn" @click="$emit('open-settings')" title="Settings">⚙</button>
            <button class="icon-btn collapse-btn" @click="$emit('close')" title="Collapse">◀</button>
          </div>
          <div class="tab-row">
            <button class="tab-btn" :class="{ active: activeTab === 'category' }" @click="activeTab = 'category'; overviewQuery = ''">Categories</button>
            <button class="tab-btn" :class="{ active: activeTab === 'collection' }" @click="activeTab = 'collection'; overviewQuery = ''">Collections</button>
          </div>
        </div>

        <div class="sidebar-body">

          <!-- Categories tab -->
          <template v-if="activeTab === 'category'">
            <div
              v-for="cat in filteredCategories"
              :key="cat.id"
              class="group-row"
              @click="drillInto({ type: 'category', id: cat.id, name: cat.name, color: cat.color, item: cat })"
            >
              <span class="group-dot" :style="{ background: cat.color }" />
              <span class="group-name">{{ cat.name }}</span>
              <span class="group-count">{{ categoryCount(cat.id) }}</span>
              <button class="icon-btn" @click.stop="$emit('edit-category', cat)" title="Edit">✎</button>
              <span class="group-arrow">›</span>
            </div>
            <!-- Uncategorized -->
            <div
              v-if="uncategorizedCount > 0"
              class="group-row group-row-muted"
              @click="drillInto({ type: 'category', id: '__none__', name: 'Uncategorized', color: '#9ca3af', item: null })"
            >
              <span class="group-dot" style="background: #9ca3af" />
              <span class="group-name">Uncategorized</span>
              <span class="group-count">{{ uncategorizedCount }}</span>
              <span class="group-arrow">›</span>
            </div>
            <p v-if="filteredCategories.length === 0 && overviewQuery" class="empty-hint">No categories match</p>
            <p v-else-if="categoriesStore.items.length === 0" class="empty-hint">No categories yet</p>
            <button class="add-group-btn" @click="$emit('new-category')">+ New category</button>
          </template>

          <!-- Collections tab -->
          <template v-else>
            <div
              v-for="col in filteredCollections"
              :key="col.id"
              class="group-row"
              @click="drillInto({ type: 'collection', id: col.id, name: col.name, color: col.color, item: col })"
            >
              <span class="group-dot" :style="{ background: col.color }" />
              <span class="group-name">{{ col.name }}</span>
              <span v-if="formatDateRange(col)" class="group-dates">{{ formatDateRange(col) }}</span>
              <span class="group-count">{{ collectionCount(col.id) }}</span>
              <button class="icon-btn" @click.stop="$emit('edit-collection', col)" title="Edit">✎</button>
              <span class="group-arrow">›</span>
            </div>
            <!-- No collection -->
            <div
              v-if="noCollectionCount > 0"
              class="group-row group-row-muted"
              @click="drillInto({ type: 'collection', id: '__none__', name: 'No collection', color: '#9ca3af', item: null })"
            >
              <span class="group-dot" style="background: #9ca3af" />
              <span class="group-name">No collection</span>
              <span class="group-count">{{ noCollectionCount }}</span>
              <span class="group-arrow">›</span>
            </div>
            <p v-if="filteredCollections.length === 0 && overviewQuery" class="empty-hint">No collections match</p>
            <p v-else-if="collectionsStore.items.length === 0" class="empty-hint">No collections yet</p>
            <button class="add-group-btn" @click="$emit('new-collection')">+ New collection</button>
          </template>

        </div>
      </div>

      <!-- ── Detail pane ── -->
      <div class="pane">

        <div class="sidebar-header">
          <div class="header-row1">
            <button class="back-btn" @click="goBack" title="Back">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <span v-if="detailGroup" class="group-dot" :style="{ background: detailGroup.color }" />
            <span class="detail-title">{{ detailGroup?.name ?? '' }}</span>
            <span class="detail-count">({{ markersStore.filtered.length }})</span>
            <button
              class="icon-btn"
              @click="editDetailGroup"
              title="Edit"
            >✎</button>
            <button class="icon-btn collapse-btn" @click="$emit('close')" title="Collapse">◀</button>
          </div>
          <div class="header-row2">
            <div class="segmented">
              <button class="seg-btn" :class="{ active: markersStore.visitedFilter === 'all' }"       @click="markersStore.setVisitedFilter('all')">All</button>
              <button class="seg-btn" :class="{ active: markersStore.visitedFilter === 'visited' }"   @click="markersStore.setVisitedFilter('visited')">✓</button>
              <button class="seg-btn" :class="{ active: markersStore.visitedFilter === 'unvisited' }" @click="markersStore.setVisitedFilter('unvisited')">○</button>
            </div>
            <div class="segmented">
              <button class="seg-btn" :class="{ active: sortBy === 'added' }"   @click="sortBy = 'added'">Added</button>
              <button class="seg-btn" :class="{ active: sortBy === 'name' }"    @click="sortBy = 'name'">Name</button>
              <button class="seg-btn" :class="{ active: sortBy === 'visited' }" @click="sortBy = 'visited'">Visited</button>
            </div>
          </div>
          <div class="header-search">
            <input
              v-model="detailQuery"
              type="search"
              placeholder="Search markers…"
              class="search-input"
              autocomplete="off"
            />
          </div>
        </div>

        <div class="sidebar-body">
          <button
            v-for="m in detailMarkers"
            :key="m.id"
            class="marker-row"
            type="button"
            @click="selectMarker(m)"
          >
            <span class="color-dot" :style="{ background: effectiveColor(m) }" />
            <div class="row-body">
              <span class="row-label">{{ m.label || coords(m) }}</span>
              <span class="row-meta">
                <span v-for="c in m.categories" :key="'cat-'+c.id" class="tag" :style="{ background: c.color + '22', color: c.color }">{{ c.name }}</span>
                <span v-for="c in m.collections" :key="'col-'+c.id" class="tag" :style="{ background: c.color + '22', color: c.color }">{{ c.name }}</span>
                <span v-if="m.visited_at" class="visited-dot" title="Visited">✓</span>
              </span>
            </div>
          </button>
          <p v-if="detailMarkers.length === 0" class="empty">No markers here.</p>

          <button class="add-group-btn" @click="$emit('new-marker')">+ Add marker here</button>
        </div>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useMarkersStore } from '../stores/markers.js'
import { useCategoriesStore } from '../stores/categories.js'
import { useCollectionsStore } from '../stores/collections.js'

const emit = defineEmits([
  'new-category', 'edit-category',
  'new-collection', 'edit-collection',
  'fly-to', 'open-marker',
  'open-settings', 'open-stats', 'close',
  'new-marker',
])

const markersStore = useMarkersStore()
const categoriesStore = useCategoriesStore()
const collectionsStore = useCollectionsStore()

// ── Navigation state ────────────────────────────────────────────────────────
const pane = ref('overview')      // 'overview' | 'detail'
const detailGroup = ref(null)     // { type, id, name, color, item }
const activeTab = ref('category') // 'category' | 'collection'

function drillInto(group) {
  detailGroup.value = group
  pane.value = 'detail'
  detailQuery.value = ''
  markersStore.setGroupFilter({ type: group.type, id: group.id })
}

function goBack() {
  pane.value = 'overview'
  detailGroup.value = null
  markersStore.clearGroupFilter()
}

function editDetailGroup() {
  if (!detailGroup.value) return
  if (detailGroup.value.type === 'category') emit('edit-category', detailGroup.value.item)
  else emit('edit-collection', detailGroup.value.item)
}

// ── Overview ────────────────────────────────────────────────────────────────
const overviewQuery = ref('')

const filteredCategories = computed(() => {
  const q = overviewQuery.value.trim().toLowerCase()
  if (!q) return categoriesStore.items
  return categoriesStore.items.filter((c) => c.name.toLowerCase().includes(q))
})

const filteredCollections = computed(() => {
  const q = overviewQuery.value.trim().toLowerCase()
  if (!q) return collectionsStore.items
  return collectionsStore.items.filter((c) => c.name.toLowerCase().includes(q))
})

function categoryCount(id) {
  return markersStore.items.filter((m) => m.categories?.some((c) => c.id === id)).length
}

function collectionCount(id) {
  return markersStore.items.filter((m) => m.collections?.some((c) => c.id === id)).length
}

const uncategorizedCount = computed(() =>
  markersStore.items.filter((m) => !m.categories?.length).length
)

const noCollectionCount = computed(() =>
  markersStore.items.filter((m) => !m.collections?.length).length
)

// ── Detail list ─────────────────────────────────────────────────────────────
const detailQuery = ref('')
const sortBy = ref('added')

const detailMarkers = computed(() => {
  let markers = markersStore.filtered
  const q = detailQuery.value.trim().toLowerCase()
  if (q) {
    markers = markers.filter((m) =>
      (m.label || '').toLowerCase().includes(q) ||
      (m.description || '').toLowerCase().includes(q)
    )
  }
  const copy = [...markers]
  if (sortBy.value === 'name') return copy.sort((a, b) => (a.label || '').localeCompare(b.label || ''))
  if (sortBy.value === 'visited') {
    return copy.sort((a, b) => {
      if (!a.visited_at && !b.visited_at) return 0
      if (!a.visited_at) return 1
      if (!b.visited_at) return -1
      return b.visited_at.localeCompare(a.visited_at)
    })
  }
  return copy
})

function effectiveColor(m) { return m.color || m.categories?.[0]?.color || '#6c757d' }
function coords(m) { return `(${m.lat.toFixed(4)}, ${m.lng.toFixed(4)})` }

function selectMarker(m) {
  emit('fly-to', m)
  emit('open-marker', m)
}

// ── Collection date range ───────────────────────────────────────────────────
function formatDateRange(item) {
  if (!item?.is_trip) return null
  const fmt = (d) => {
    if (!d) return null
    const [y, mo] = d.split('-')
    return new Date(+y, +mo - 1, 1).toLocaleDateString('default', { month: 'short', year: 'numeric' })
  }
  const start = fmt(item?.start_date)
  const end = fmt(item?.end_date)
  if (start && end) return `${start} – ${end}`
  if (start) return `From ${start}`
  if (end) return `Until ${end}`
  return null
}
</script>

<style scoped>
/* ── Sidebar shell ──────────────────────────────────────────────────────── */
.sidebar {
  width: 300px;
  flex-shrink: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-left: 1px solid var(--border);
  overflow: hidden;
}

/* ── Two-pane slide track ────────────────────────────────────────────────── */
.pane-track {
  display: flex;
  width: 200%;
  height: 100%;
  transition: transform 0.22s ease;
}
.pane-track.is-detail { transform: translateX(-50%); }

.pane {
  width: 50%;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Header ─────────────────────────────────────────────────────────────── */
.sidebar-header {
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}

.header-row1 {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 8px 6px 10px;
}

.header-row2 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 8px 10px;
  gap: 6px;
}

/* ── Tab row ─────────────────────────────────────────────────────────────── */
.tab-row {
  display: flex;
  border-bottom: 1px solid var(--border);
}

.tab-btn {
  flex: 1;
  padding: 8px 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s;
  margin-bottom: -1px;
}
.tab-btn:hover { color: var(--text); }
.tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }

/* ── Muted group row (Uncategorized / No collection) ─────────────────────── */
.group-row-muted .group-name { color: var(--text-2); font-style: italic; }

.header-search {
  padding: 0 8px 8px 10px;
}

/* ── Controls ────────────────────────────────────────────────────────────── */
.search-input {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  font-size: 13px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  width: 100%;
}
.search-input:focus { border-color: var(--accent); outline: none; }

.icon-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 6px;
  color: var(--text-2);
  font-size: 14px;
  flex-shrink: 0;
  padding: 0;
  transition: background 0.1s, color 0.1s;
}
.icon-btn:hover { background: var(--surface-2); color: var(--text); }

.back-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 6px;
  color: var(--text-2);
  flex-shrink: 0;
  padding: 0;
  transition: background 0.1s, color 0.1s;
}
.back-btn:hover { background: var(--surface-2); color: var(--text); }

.segmented {
  display: flex;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.seg-btn {
  padding: 3px 8px;
  font-size: 11px;
  background: none;
  border: none;
  border-right: 1px solid var(--border);
  color: var(--text-2);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.1s, color 0.1s;
}
.seg-btn:last-child { border-right: none; }
.seg-btn:hover { background: var(--surface-2); color: var(--text); }
.seg-btn.active { background: var(--accent); color: #fff; }

/* ── Detail header extras ────────────────────────────────────────────────── */
.detail-title {
  flex: 1;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0 4px;
}
.detail-count {
  font-size: 12px;
  color: var(--text-2);
  flex-shrink: 0;
}

/* ── Sidebar body ────────────────────────────────────────────────────────── */
.sidebar-body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding-bottom: 8px;
}

/* ── Overview sections ───────────────────────────────────────────────────── */
.section-header {
  display: flex;
  align-items: center;
  padding: 10px 12px 4px;
}
.section-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-2);
}

.group-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px 9px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  transition: background 0.1s;
}
.group-row:hover { background: var(--surface-2); }

.group-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.group-name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.group-dates {
  font-size: 10px;
  color: var(--text-2);
  white-space: nowrap;
  flex-shrink: 0;
}

.group-count {
  font-size: 11px;
  font-weight: 600;
  background: var(--border);
  color: var(--text-2);
  padding: 1px 6px;
  border-radius: 8px;
  min-width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.group-arrow {
  font-size: 16px;
  color: var(--text-2);
  flex-shrink: 0;
  line-height: 1;
}

.add-group-btn {
  margin: 8px 12px 4px;
  padding: 7px 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  border: 1px dashed color-mix(in srgb, var(--accent) 30%, var(--border));
  border-radius: var(--radius);
  cursor: pointer;
  text-align: left;
  flex-shrink: 0;
  transition: background 0.1s;
}
.add-group-btn:hover { background: color-mix(in srgb, var(--accent) 14%, var(--surface)); }

/* ── Marker rows ─────────────────────────────────────────────────────────── */
.marker-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  background: none;
  border: none;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  cursor: pointer;
  transition: background 0.1s;
}
.marker-row:last-of-type { border-bottom: none; }
.marker-row:hover { background: var(--surface-2); }

.color-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }

.row-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }

.row-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-meta { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }

.tag { font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 10px; }
.visited-dot { font-size: 11px; color: var(--text-2); }

/* ── Empty / hint states ─────────────────────────────────────────────────── */
.empty, .empty-hint {
  font-size: 13px;
  color: var(--text-2);
  padding: 10px 12px;
}
.empty { text-align: center; padding: 30px 16px; }

/* ── Collapse button: only visible on mobile ─────────────────────────────── */
.collapse-btn { display: none; }

/* ── Mobile ──────────────────────────────────────────────────────────────── */
@media (max-width: 640px) {
  .sidebar {
    position: fixed;
    right: 0;
    top: 0;
    bottom: 0;
    z-index: 2000;
    width: 100vw;
    max-width: 100vw;
    border-left: none;
  }
  .collapse-btn { display: flex; }
}
</style>
