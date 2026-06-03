<template>
  <div
    class="sidebar"
    ref="sidebarEl"
    :style="dragOffset > 0 ? { transform: `translateY(${dragOffset}px)`, transition: 'none' } : {}"
  >
    <div
      class="drag-handle"
      aria-hidden="true"
      @touchstart.passive="onDragStart"
      @touchmove.passive="onDragMove"
      @touchend="onDragEnd"
    ></div>
    <div class="mobile-mode-row">
      <button
        v-for="m in COLOR_MODES"
        :key="m.value"
        class="mobile-mode-btn"
        :class="{ active: styleStore.colorMode === m.value }"
        @click="styleStore.setColorMode(m.value)"
      >{{ m.label }}</button>
    </div>
    <div class="pane-track" :class="{ 'is-detail': pane === 'detail' }">

      <!-- ── Overview pane ── -->
      <div class="pane">

        <div class="sidebar-header">
          <div class="header-row1">
            <div class="search-wrap">
              <input
                v-model="overviewQuery"
                type="search"
                :placeholder="activeTab === 'category' ? 'Filter categories…' : 'Filter collections…'"
                class="search-input"
                autocomplete="off"
              />
              <button v-if="overviewQuery" class="search-clear" type="button" @click="overviewQuery = ''" title="Clear">✕</button>
            </div>
            <div class="sort-wrap" ref="sortBtnRef">
              <button class="icon-btn sort-btn" :class="{ active: sortOverview !== 'default' }" @click.stop="toggleSortMenu" title="Sort">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M1 3h12M3 7h8M5 11h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </button>
              <div v-if="sortMenuOpen" class="sort-menu">
                <button
                  v-for="opt in sortOptions"
                  :key="opt.value"
                  class="sort-option"
                  :class="{ selected: sortOverview === opt.value || sortOverview.startsWith(opt.value + '-') }"
                  @click="setSortOverview(opt.value)"
                >
                  {{ opt.label }}
                  <span v-if="sortOverview.startsWith(opt.value + '-')" class="sort-dir">
                    {{ sortOverview.endsWith('-asc') ? '↑' : '↓' }}
                  </span>
                </button>
              </div>
            </div>
            <button class="icon-btn collapse-btn" @click="$emit('close')" title="Close">✕</button>
          </div>
          <div class="tab-row">
            <button class="tab-btn" :class="{ active: activeTab === 'collection' }" @click="activeTab = 'collection'; overviewQuery = ''">Collections</button>
            <button class="tab-btn" :class="{ active: activeTab === 'category' }" @click="activeTab = 'category'; overviewQuery = ''">Categories</button>
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
              <svg v-if="col.is_trip" class="trip-icon" width="10" height="14" viewBox="0 0 10 14" fill="none" title="Trip">
                <circle cx="5" cy="2" r="2" fill="currentColor"/>
                <line x1="5" y1="4.5" x2="5" y2="9.5" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 1.5" stroke-linecap="round"/>
                <rect x="3" y="10" width="4" height="4" rx="1" fill="currentColor"/>
              </svg>
              <span v-if="formatDateRange(col)" class="group-dates">{{ formatDateRange(col) }}</span>
              <span class="group-count">{{ collectionCount(col.id) }}</span>
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
          </template>

        </div>

        <div class="sidebar-footer">
          <button class="add-group-btn footer-add-btn" @click="activeTab === 'category' ? $emit('new-category') : $emit('new-collection')">
            {{ activeTab === 'category' ? '+ New category' : '+ New collection' }}
          </button>
          <div class="footer-actions">
            <button class="footer-action-btn" @click="$emit('open-stats')" title="Statistics">
              <svg width="15" height="15" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="7" width="3" height="6" rx="1" fill="currentColor"/>
                <rect x="5.5" y="4" width="3" height="9" rx="1" fill="currentColor"/>
                <rect x="10" y="1" width="3" height="12" rx="1" fill="currentColor"/>
              </svg>
              Stats
            </button>
            <button class="footer-action-btn" @click="$emit('open-settings')" title="Settings">
              <span>⚙</span>
              Settings
            </button>
          </div>
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
            <div class="sort-wrap" ref="detailSortBtnRef">
              <button class="icon-btn sort-btn" :class="{ active: sortBy !== 'added' }" @click.stop="toggleDetailSortMenu" title="Sort">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M1 3h12M3 7h8M5 11h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </button>
              <div v-if="detailSortMenuOpen" class="sort-menu">
                <button
                  v-for="opt in detailSortOptions"
                  :key="opt.value"
                  class="sort-option"
                  :class="{ selected: sortBy === opt.value }"
                  @click="sortBy = opt.value; detailSortMenuOpen = false"
                >{{ opt.label }}</button>
              </div>
            </div>
            <button v-if="detailGroup?.item" class="icon-btn" @click="editDetailGroup" title="Edit">✎</button>
            <button class="icon-btn collapse-btn" @click="$emit('close')" title="Collapse">◀</button>
          </div>
          <div v-if="detailGroup?.type === 'category'" class="header-row2">
            <div class="segmented">
              <button class="seg-btn" :class="{ active: markersStore.visitedFilter === 'all' }"       @click="markersStore.setVisitedFilter('all')">All</button>
              <button class="seg-btn" :class="{ active: markersStore.visitedFilter === 'visited' }"   @click="markersStore.setVisitedFilter('visited')">✓</button>
              <button class="seg-btn" :class="{ active: markersStore.visitedFilter === 'unvisited' }" @click="markersStore.setVisitedFilter('unvisited')">○</button>
            </div>
          </div>
          <div class="header-search">
            <div class="search-wrap">
              <input
                v-model="detailQuery"
                type="search"
                placeholder="Search markers…"
                class="search-input"
                autocomplete="off"
              />
              <button v-if="detailQuery" class="search-clear" type="button" @click="detailQuery = ''" title="Clear">✕</button>
            </div>
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
              <span class="row-label">
                <span v-if="detailGroup?.item?.is_trip && tripPosition(m) != null" class="stop-badge">#{{ tripPosition(m) }}</span>
                {{ m.label || coords(m) }}
                <span v-if="m.visited_at" class="visited-dot" title="Visited">✓</span>
              </span>
              <span
                class="row-meta"
                v-if="m.categories.filter(c => !(detailGroup?.type === 'category' && c.id === detailGroup.id)).length || m.collections.filter(c => !(detailGroup?.type === 'collection' && c.id === detailGroup.id)).length"
              >
                <span v-for="c in m.categories.filter(c => !(detailGroup?.type === 'category' && c.id === detailGroup.id))" :key="'cat-'+c.id" class="tag" :style="{ background: c.color + '22', color: c.color }">{{ c.name }}</span>
                <span v-for="c in m.collections.filter(c => !(detailGroup?.type === 'collection' && c.id === detailGroup.id))" :key="'col-'+c.id" class="tag" :style="{ background: c.color + '22', color: c.color }">{{ c.name }}</span>
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
import { ref, computed, watch, onUnmounted } from 'vue'
import { useMarkersStore } from '../stores/markers.js'
import { useCategoriesStore } from '../stores/categories.js'
import { useCollectionsStore } from '../stores/collections.js'
import { useStyleStore } from '../stores/style.js'

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
const styleStore = useStyleStore()

const COLOR_MODES = [
  { value: 'marker', label: 'Marker' },
  { value: 'collection', label: 'Collection' },
  { value: 'category', label: 'Category' },
]

// ── Drag-to-close ───────────────────────────────────────────────────────────
const sidebarEl = ref(null)
const dragOffset = ref(0)
let touchStartY = 0
let dragging = false

function onDragStart(e) {
  touchStartY = e.touches[0].clientY
  dragging = true
  dragOffset.value = 0
}

function onDragMove(e) {
  if (!dragging) return
  const dy = e.touches[0].clientY - touchStartY
  dragOffset.value = Math.max(0, dy)
}

function onDragEnd() {
  if (!dragging) return
  dragging = false
  const offset = dragOffset.value
  dragOffset.value = 0
  if (offset > 80) emit('close')
}

// ── Navigation state ────────────────────────────────────────────────────────
const pane = ref('overview')      // 'overview' | 'detail'
const detailGroup = ref(null)     // { type, id, name, color, item }
const activeTab = ref('collection') // 'category' | 'collection'

function drillInto(group) {
  detailGroup.value = group
  pane.value = 'detail'
  detailQuery.value = ''
  if (group.type === 'collection') markersStore.setVisitedFilter('all')
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

const BASE_SORT_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'name',    label: 'Name' },
  { value: 'count',   label: 'Count' },
]
const COLLECTION_SORT_OPTIONS = [
  ...BASE_SORT_OPTIONS,
  { value: 'start', label: 'Start date' },
  { value: 'end',   label: 'End date' },
]
const sortOptions = computed(() => activeTab.value === 'collection' ? COLLECTION_SORT_OPTIONS : BASE_SORT_OPTIONS)

const SORT_STORAGE_KEY = 'mapper_sort'
const sortOverview = ref(localStorage.getItem(SORT_STORAGE_KEY) || 'default')
const sortMenuOpen = ref(false)
const sortBtnRef   = ref(null)

function toggleSortMenu() { sortMenuOpen.value = !sortMenuOpen.value }
function setSortOverview(base) {
  if (base === 'default') {
    sortOverview.value = 'default'
  } else if (sortOverview.value === `${base}-asc`) {
    sortOverview.value = `${base}-desc`
  } else if (sortOverview.value === `${base}-desc`) {
    sortOverview.value = `${base}-asc`
  } else {
    sortOverview.value = `${base}-${base === 'count' ? 'desc' : 'asc'}`
  }
  sortMenuOpen.value = false
}

function onDocClick(e) {
  if (sortBtnRef.value && !sortBtnRef.value.contains(e.target)) sortMenuOpen.value = false
}
watch(sortOverview, (v) => localStorage.setItem(SORT_STORAGE_KEY, v))
watch(sortMenuOpen, (open) => {
  if (open) document.addEventListener('click', onDocClick)
  else document.removeEventListener('click', onDocClick)
})
watch(activeTab, (tab) => {
  if (tab === 'category' && (sortOverview.value.startsWith('start-') || sortOverview.value.startsWith('end-'))) {
    sortOverview.value = 'default'
  }
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('click', onDetailDocClick)
})

// ── Detail sort ──────────────────────────────────────────────────────────────
const detailSortMenuOpen = ref(false)
const detailSortBtnRef   = ref(null)

const detailSortOptions = computed(() => {
  const opts = [
    { value: 'added',   label: 'Added' },
    { value: 'name',    label: 'Name' },
    { value: 'visited', label: 'Visited' },
  ]
  if (detailGroup.value?.item?.is_trip) opts.push({ value: 'stop', label: 'Stop #' })
  return opts
})

function toggleDetailSortMenu() { detailSortMenuOpen.value = !detailSortMenuOpen.value }

function onDetailDocClick(e) {
  if (detailSortBtnRef.value && !detailSortBtnRef.value.contains(e.target)) detailSortMenuOpen.value = false
}

watch(detailSortMenuOpen, (open) => {
  if (open) document.addEventListener('click', onDetailDocClick)
  else document.removeEventListener('click', onDetailDocClick)
})

function cmpDate(a, b, desc) {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return desc ? b.localeCompare(a) : a.localeCompare(b)
}

function applySortOverview(items, countFn) {
  const copy = [...items]
  if (sortOverview.value === 'name-asc')   return copy.sort((a, b) => a.name.localeCompare(b.name))
  if (sortOverview.value === 'name-desc')  return copy.sort((a, b) => b.name.localeCompare(a.name))
  if (sortOverview.value === 'count-desc') return copy.sort((a, b) => countFn(b.id) - countFn(a.id))
  if (sortOverview.value === 'count-asc')  return copy.sort((a, b) => countFn(a.id) - countFn(b.id))
  if (sortOverview.value === 'start-asc')  return copy.sort((a, b) => cmpDate(a.start_date, b.start_date, false))
  if (sortOverview.value === 'start-desc') return copy.sort((a, b) => cmpDate(a.start_date, b.start_date, true))
  if (sortOverview.value === 'end-asc')    return copy.sort((a, b) => cmpDate(a.end_date, b.end_date, false))
  if (sortOverview.value === 'end-desc')   return copy.sort((a, b) => cmpDate(a.end_date, b.end_date, true))
  return copy
}

const filteredCategories = computed(() => {
  const q = overviewQuery.value.trim().toLowerCase()
  const items = q ? categoriesStore.items.filter((c) => c.name.toLowerCase().includes(q)) : categoriesStore.items
  return applySortOverview(items, categoryCount)
})

const filteredCollections = computed(() => {
  const q = overviewQuery.value.trim().toLowerCase()
  const items = q ? collectionsStore.items.filter((c) => c.name.toLowerCase().includes(q)) : collectionsStore.items
  return applySortOverview(items, collectionCount)
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

function tripPosition(m) {
  const colId = detailGroup.value?.id
  return m.collections?.find((c) => c.id === colId)?.position ?? null
}

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
  if (sortBy.value === 'stop') {
    return copy.sort((a, b) => {
      const pa = tripPosition(a) ?? Infinity
      const pb = tripPosition(b) ?? Infinity
      return pa - pb
    })
  }
  return copy
})

watch(detailGroup, (group) => {
  if (sortBy.value === 'stop' && !group?.item?.is_trip) sortBy.value = 'added'
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
    const parts = d.split('-')
    if (parts.length === 1) return parts[0]
    const [y, mo, day] = parts
    if (day) return new Date(+y, +mo - 1, +day).toLocaleDateString('default', { day: 'numeric', month: 'short', year: 'numeric' })
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
  border-radius: 0;
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
.search-wrap {
  flex: 1;
  min-width: 0;
  position: relative;
}

.search-input {
  padding: 6px 28px 6px 10px;
  font-size: 13px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  width: 100%;
}
.search-input:focus { border-color: var(--accent); outline: none; }

.search-clear {
  position: absolute;
  right: 5px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  padding: 2px 5px;
  font-size: 11px;
  color: var(--text-2);
  cursor: pointer;
  border-radius: 3px;
  line-height: 1;
}
.search-clear:hover { color: var(--text); background: var(--border); }

.sort-wrap {
  position: relative;
  flex-shrink: 0;
}

.sort-btn.active {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
}

.sort-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  z-index: 100;
  min-width: 120px;
  overflow: hidden;
}

.sort-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 7px 10px;
  font-size: 12px;
  background: none;
  border: none;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}
.sort-option:last-child { border-bottom: none; }
.sort-option:hover { background: var(--surface-2); }
.sort-option.selected { color: var(--accent); font-weight: 600; }
.sort-dir { font-size: 11px; }

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
  min-height: 46px;
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

.trip-icon {
  color: var(--text-2);
  flex-shrink: 0;
}

.stop-badge {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-2);
  margin-right: 3px;
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

.sidebar-footer {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

.footer-add-btn { margin: 6px 12px; }

.footer-actions {
  display: flex;
  gap: 6px;
  padding: 4px 12px 10px;
}

.footer-action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 10px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-2);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.footer-action-btn:hover { background: var(--border); color: var(--text); }

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

/* ── Drag handle: only visible on mobile ─────────────────────────────────── */
.drag-handle { display: none; }

/* ── Color mode row: only visible on mobile (replaces floating map control) ── */
.mobile-mode-row { display: none; }

/* ── Collapse button: only visible on mobile ─────────────────────────────── */
.collapse-btn { display: none; }

/* ── Mobile: bottom sheet ────────────────────────────────────────────────── */
@media (max-width: 640px) {
  .sidebar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    top: auto;
    height: auto;
    z-index: 2000;
    width: 100vw;
    max-width: 100vw;
    max-height: 82vh;
    border-left: none;
    border-top: 1px solid var(--border);
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.15);
    padding-bottom: var(--sab, 0px);
  }

  .drag-handle {
    display: block;
    width: 100%;
    padding: 12px 0 8px;
    flex-shrink: 0;
    cursor: grab;
  }
  .drag-handle::after {
    content: '';
    display: block;
    width: 36px;
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    margin: 0 auto;
  }

  .mobile-mode-row {
    display: flex;
    flex-shrink: 0;
    border-bottom: 1px solid var(--border);
  }
  .mobile-mode-btn {
    flex: 1;
    padding: 8px 4px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-2);
    background: none;
    border: none;
    border-radius: 0;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    min-height: unset;
    transition: color 0.12s, border-color 0.12s;
  }
  .mobile-mode-btn:hover { color: var(--text); }
  .mobile-mode-btn.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  /* Fix flex chain so sidebar-body scrolls within max-height */
  .pane-track {
    flex: 1;
    height: auto;
    min-height: 0;
  }
  .pane { min-height: 0; }
  .sidebar-body { min-height: 0; }

  .collapse-btn { display: flex; }
}
</style>
