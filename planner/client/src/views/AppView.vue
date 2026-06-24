<template>
  <div class="app-layout">
    <header :class="{ 'mobile-search-active': mobileSearchOpen }">
      <div class="header-left">
        <button class="hamburger" @click="sidebarCollapsed = !sidebarCollapsed">☰</button>
        <h1>{{ viewTitle }}</h1>
      </div>

      <div v-if="store.currentViewId !== 'trash'" class="search-wrap">
        <input
          ref="searchInput"
          v-model="searchQuery"
          class="search-input"
          type="search"
          placeholder="Search notes…"
          @keydown.escape="searchQuery = ''"
        />
        <span v-if="searchActive" class="search-count">
          {{ displayedNotes.length }} result{{ displayedNotes.length !== 1 ? 's' : '' }}
        </span>
        <button v-if="searchActive" class="search-clear" title="Clear search" @click="searchQuery = ''">×</button>
      </div>

      <div v-if="store.currentViewId !== 'trash'" class="view-toggle">
        <button class="vtb" :class="{ active: viewMode === 'masonry' }" title="Masonry" @click="setViewMode('masonry')">
          <AppIcon name="masonry-view" :size="16" />
        </button>
        <button class="vtb" :class="{ active: viewMode === 'list' }" title="List" @click="setViewMode('list')">
          <AppIcon name="list-view" :size="16" />
        </button>
        <button v-if="!isSmartView" class="vtb" :class="{ active: viewMode === 'trello' }" title="Trello" @click="setViewMode('trello')">
          <AppIcon name="trello-view" :size="16" />
        </button>
      </div>

      <!-- Tasks-only filter toggle -->
      <button
        v-if="store.currentViewId !== 'trash'"
        class="vtb vtb--task-filter"
        :class="{ active: showTasksOnly }"
        title="Tasks only"
        @click="showTasksOnly = !showTasksOnly"
      >
        <AppIcon name="task-check" :size="16" />
      </button>

      <div v-if="store.currentViewId !== 'trash' && !isSmartView" class="sort-dropdown-wrap">
        <select class="sort-select" :value="store.sortBy" @change="store.setSortBy($event.target.value)">
          <option value="default">Order</option>
          <option value="createdAt">Created</option>
          <option value="updatedAt">Modified</option>
          <option value="title">Title</option>
        </select>
      </div>

      <!-- Mobile: cancel search (shown only in search-active mode) -->
      <button class="search-cancel-btn" @click="closeMobileSearch">Cancel</button>

      <!-- Mobile: search icon + more-options menu (hidden on desktop) -->
      <div v-if="store.currentViewId !== 'trash'" class="mobile-header-actions">
        <button class="vtb" title="Search" @click="openMobileSearch">
          <AppIcon name="search" :size="16" />
        </button>
        <div class="mobile-more-wrap">
          <button class="vtb" title="More options" @click.stop="mobileMenuOpen = !mobileMenuOpen">
            <AppIcon name="more-vertical" :size="16" />
          </button>
          <div v-if="mobileMenuOpen" class="mobile-more-panel" @mousedown.stop @click.stop>
            <div class="mobile-more-row">
              <span class="mobile-more-label">View</span>
              <div class="view-toggle">
                <button class="vtb" :class="{ active: viewMode === 'masonry' }" title="Masonry" @click="setViewMode('masonry')">
                  <AppIcon name="masonry-view" :size="16" />
                </button>
                <button class="vtb" :class="{ active: viewMode === 'list' }" title="List" @click="setViewMode('list')">
                  <AppIcon name="list-view" :size="16" />
                </button>
                <button v-if="!isSmartView" class="vtb" :class="{ active: viewMode === 'trello' }" title="Trello" @click="setViewMode('trello')">
                  <AppIcon name="trello-view" :size="16" />
                </button>
              </div>
            </div>
            <div class="mobile-more-divider" />
            <button
              class="mobile-more-item"
              :class="{ 'mobile-more-item--active': showTasksOnly }"
              @click="showTasksOnly = !showTasksOnly"
            >
              <AppIcon name="task-check" :size="15" />
              Tasks only
            </button>
            <template v-if="!isSmartView">
              <div class="mobile-more-divider" />
              <div class="mobile-more-row">
                <span class="mobile-more-label">Sort</span>
                <select class="sort-select" :value="store.sortBy" @change="store.setSortBy($event.target.value)">
                  <option value="default">Default</option>
                  <option value="createdAt">Created</option>
                  <option value="updatedAt">Modified</option>
                  <option value="title">Title</option>
                </select>
              </div>
            </template>
          </div>
        </div>
      </div>

      <div class="header-end">
        <span
          class="sync-badge"
          :class="store.syncState"
          title="Click to sync now"
          @click="store.forceSync()"
        >
          <span v-if="store.syncState === 'active'" class="sync-spinner" />
          {{ syncLabel }}
        </span>
        <button class="vtb" title="Keyboard shortcuts (?)" @click.stop="showShortcuts = !showShortcuts">
          <AppIcon name="help" :size="16" />
        </button>
        <button class="vtb" title="Settings" @click.stop="showSettings = !showSettings">
          <AppIcon name="settings" :size="16" />
        </button>
        <SettingsModal v-if="showSettings" @close="showSettings = false" />
        <KeyboardShortcutsModal v-if="showShortcuts" @close="showShortcuts = false" />
      </div>
    </header>

    <div class="app-body">
      <SideMenu :collapsed="sidebarCollapsed" @navigate="onSideMenuNavigate" />

      <div class="app-main" @mousedown="onAppMainMousedown">
        <!-- Add note / task (not shown in trash) -->
        <AddNoteForm
          v-if="store.currentViewId !== 'trash'"
          ref="addNoteForm"
          :default-is-task="taskFilterActive"
          :default-due-date="store.currentViewId === 'smart:today' ? today : null"
          @add="addNote"
          @opened="mobileFormOpen = true"
          @closed="mobileFormOpen = false"
        />

        <!-- Trash info banner -->
        <div v-if="store.currentViewId === 'trash'" class="trash-info">
          <AppIcon name="info" :size="15" />
          Notes in trash are permanently deleted after 7 days.
        </div>

        <p v-if="store.error" class="error">{{ store.error }}</p>

        <!-- ── Masonry & List ─────────────────────────────────────────── -->
        <template v-if="effectiveViewMode !== 'trello'">
          <template v-if="pinnedNotes.length || activeNotes.length || doneNotes.length">

            <!-- Pinned notes section -->
            <section
              v-if="pinnedNotes.length"
              :class="effectiveViewMode === 'masonry' ? 'notes-masonry' : 'notes-list'"
            >
              <NoteCard
                v-for="note in pinnedNotes"
                :key="note._id"
                :note="note"
                :view-mode="effectiveViewMode"
                :draggable="!selectMode && store.sortBy === 'default'"
                :dragging="drag.noteId === note._id"
                :drop-before="drag.overId === note._id && drag.position === 'before'"
                :drop-after="drag.overId === note._id && drag.position === 'after'"
                :open="editingNote?._id === note._id"
                :in-trash="store.currentViewId === 'trash'"
                :rendered-content="renderedContentMap[note._id] || ''"
                :select-mode="selectMode"
                :selected="selectedIds.has(note._id)"
                @open="openNote"
                @select="onNoteSelect"
                @toggle-done="store.toggleDone"
                @checkbox-change="onCheckboxChange"
                @pin="onNotePin"
                @delete="onNoteDelete"
                @contextmenu="onNoteContextMenu"
                @dragstart="onDragStart"
                @dragover="onDragOver"
                @dragleave="onDragLeave"
                @drop="onDrop"
                @dragend="onDragEnd"
              />
            </section>

            <!-- Separator between pinned and regular notes -->
            <div v-if="pinnedNotes.length && activeNotes.length" class="notes-separator">
              <span class="notes-separator-text">Other notes</span>
            </div>

            <!-- Active (non-done) notes -->
            <section
              v-if="activeNotes.length"
              :class="effectiveViewMode === 'masonry' ? 'notes-masonry' : 'notes-list'"
            >
              <NoteCard
                v-for="note in activeNotes"
                :key="note._id"
                :note="note"
                :view-mode="effectiveViewMode"
                :draggable="!selectMode && store.sortBy === 'default'"
                :dragging="drag.noteId === note._id"
                :drop-before="drag.overId === note._id && drag.position === 'before'"
                :drop-after="drag.overId === note._id && drag.position === 'after'"
                :open="editingNote?._id === note._id"
                :in-trash="store.currentViewId === 'trash'"
                :rendered-content="renderedContentMap[note._id] || ''"
                :select-mode="selectMode"
                :selected="selectedIds.has(note._id)"
                @open="openNote"
                @select="onNoteSelect"
                @toggle-done="store.toggleDone"
                @checkbox-change="onCheckboxChange"
                @pin="onNotePin"
                @delete="onNoteDelete"
                @contextmenu="onNoteContextMenu"
                @dragstart="onDragStart"
                @dragover="onDragOver"
                @dragleave="onDragLeave"
                @drop="onDrop"
                @dragend="onDragEnd"
              />
            </section>

            <!-- Completed tasks collapse -->
            <div v-if="doneNotes.length" class="done-section">
              <button class="done-toggle" @click="showDone = !showDone">
                <AppIcon name="chevron-right" :size="12" :style="{ transform: showDone ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }" />
                {{ showDone ? 'Hide' : 'Show' }} {{ doneNotes.length }} completed
              </button>
              <section
                v-if="showDone"
                :class="effectiveViewMode === 'masonry' ? 'notes-masonry notes-masonry--done' : 'notes-list'"
              >
                <NoteCard
                  v-for="note in doneNotes"
                  :key="note._id"
                  :note="note"
                  :view-mode="effectiveViewMode"
                  :draggable="false"
                  :open="editingNote?._id === note._id"
                  :rendered-content="renderedContentMap[note._id] || ''"
                  :select-mode="selectMode"
                  :selected="selectedIds.has(note._id)"
                  @open="openNote"
                  @select="onNoteSelect"
                  @toggle-done="store.toggleDone"
                  @checkbox-change="onCheckboxChange"
                  @pin="onNotePin"
                  @delete="onNoteDelete"
                  @contextmenu="onNoteContextMenu"
                />
              </section>
            </div>
          </template>
          <p v-else class="empty">{{ emptyLabel }}</p>
        </template>

        <!-- ── Trello ─────────────────────────────────────────────────── -->
        <TrelloBoard
          v-else
          :view-id="store.currentViewId"
          :filtered-note-ids="searchActive ? displayedNotes.map(n => n._id) : null"
          :opened-note-id="editingNote?._id ?? null"
          @open-note="openNote"
        />
      </div>
    </div>

    <template v-if="isDev">
      <button class="debug-fab" :class="{ active: showDebug }" title="Debug panel" @click="showDebug = !showDebug">🛠</button>
      <DebugPanel v-if="showDebug" @close="showDebug = false" />
    </template>

    <NoteModal v-if="editingNote" :note="editingNote" @close="editingNote = null" />

    <Teleport to="body">
      <!-- Mobile sidebar backdrop -->
      <div v-if="!sidebarCollapsed" class="sidebar-backdrop" @click="sidebarCollapsed = true" />

      <!-- Mobile add-note bottom-sheet backdrop -->
      <div v-if="mobileFormOpen" class="mobile-form-backdrop" />

      <!-- Mobile FAB: add note -->
      <button
        v-if="store.currentViewId !== 'trash'"
        class="add-fab"
        @click="$refs.addNoteForm?.openAsNote()"
        title="Add note"
      ><AppIcon name="plus" :size="24" /></button>

      <div
        v-if="contextMenu"
        class="context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @mousedown.stop
      >
        <button class="context-menu-item" @click="contextMenuToggleTask">
          <AppIcon name="task-check" :size="15" />
          {{ isContextNoteTask ? 'Unmark as task' : 'Mark as task' }}
        </button>
        <button class="context-menu-item" :class="{ 'context-menu-item--active': contextMenu.reminderOpen }" @click="contextMenu.reminderOpen = !contextMenu.reminderOpen">
          <AppIcon name="bell" :size="15" />
          {{ contextMenu.note?.notificationAt ? 'Edit reminder' : 'Add reminder' }}
        </button>
        <div v-if="contextMenu.reminderOpen" class="context-menu-reminder-slots">
          <button
            v-for="slot in reminderQuickSlots"
            :key="slot.iso"
            class="context-menu-reminder-slot"
            :class="{ active: contextMenu.note?.notificationAt === slot.iso }"
            @click="contextMenuSetReminder(slot.iso)"
          >
            <span>{{ slot.dayLabel }}</span>
            <span class="context-menu-slot-time">{{ slot.timeLabel }}</span>
          </button>
          <button v-if="contextMenu.note?.notificationAt" class="context-menu-reminder-remove" @click="contextMenuSetReminder(null)">
            Remove reminder
          </button>
        </div>
        <button class="context-menu-item" @click="contextMenuPin">
          <AppIcon :name="contextMenu.note?.pinned ? 'pin-off' : 'pin'" :size="15" />
          {{ contextMenu.note?.pinned ? 'Unpin' : 'Pin' }}
        </button>
        <div class="context-menu-divider"></div>
        <button class="context-menu-item danger" @click="contextMenuDelete">
          <AppIcon name="trash" :size="15" />
          Move to trash
        </button>
      </div>

      <!-- Rubber-band selection rectangle -->
      <div v-if="selectionRectVisible" class="selection-rect" :style="selectionRectStyle" />

      <!-- Bulk selection action bar -->
      <Transition name="bulk-bar">
        <div v-if="selectedIds.size > 0" class="bulk-bar">
          <span class="bulk-count">{{ selectedIds.size }} selected</span>
          <button class="bulk-btn" @click="bulkSelectAll">Select all</button>
          <div class="bulk-move-wrap">
            <button class="bulk-btn" @click="bulkMoveOpen = !bulkMoveOpen">Move to…</button>
            <div v-if="bulkMoveOpen" class="bulk-move-panel">
              <button class="dropdown-item" @click="bulkMoveToHome">Home</button>
              <button
                v-for="v in store.flatViewTree"
                :key="v._id"
                class="dropdown-item"
                :style="{ paddingLeft: (1 + v.depth * 0.75) + 'rem' }"
                @click="bulkMoveToView(v._id)"
              >{{ v.name }}</button>
            </div>
          </div>
          <button class="bulk-btn bulk-btn--danger" @click="bulkDeleteSelected">Delete selected</button>
          <button class="bulk-btn bulk-btn--clear" @click="clearSelection">✕ Clear</button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script>
import { useNotesStore, isTaskNote } from '../stores/notes.js'
import { useAuthStore } from '../stores/auth.js'
import { renderNoteContent, toggleCheckbox, sortCheckboxItems } from '../utils/markdown.js'
import { useKeyboardShortcuts } from '../composables/useKeyboardShortcuts.js'
import SideMenu from '../components/SideMenu.vue'
import NoteCard from '../components/NoteCard.vue'
import AddNoteForm from '../components/AddNoteForm.vue'
import NoteModal from '../components/NoteModal.vue'
import TrelloBoard from '../components/TrelloBoard.vue'
import DebugPanel from '../components/DebugPanel.vue'
import SettingsModal from '../components/SettingsModal.vue'
import NotificationPicker from '../components/NotificationPicker.vue'
import KeyboardShortcutsModal from '../components/KeyboardShortcutsModal.vue'

export default {
  name: 'AppView',

  components: { SideMenu, NoteCard, AddNoteForm, NoteModal, TrelloBoard, DebugPanel, SettingsModal, NotificationPicker, KeyboardShortcutsModal },

  setup() {
    const store     = useNotesStore()
    const authStore = useAuthStore()
    store.init(authStore.username, authStore.dbId)

    // Mutable container so we can wire up Options API methods after mount
    const shortcuts = { closeModal: null, newNote: null, newTask: null, focusSearch: null, openShortcuts: null }

    useKeyboardShortcuts({
      closeModal:    () => shortcuts.closeModal?.(),
      newNote:       () => shortcuts.newNote?.(),
      newTask:       () => shortcuts.newTask?.(),
      focusSearch:   () => shortcuts.focusSearch?.(),
      openShortcuts: () => shortcuts.openShortcuts?.(),
    })

    return { store, authStore, shortcuts, isTaskNote }
  },

  data() {
    return {
      isDev:          import.meta.env.DEV,
      showDebug:      false,
      showSettings:   false,
      showShortcuts:  false,
      sidebarCollapsed: window.matchMedia?.('(max-width: 640px)').matches ?? false,
      mobileFormOpen:   false,
      mobileSearchOpen: false,
      mobileMenuOpen:   false,
      editingNote:      null,
      viewMode:         localStorage.getItem('notesViewMode') || 'masonry',
      searchQuery:      '',
      showTasksOnly:    false,
      showDone:         false,
      drag: { noteId: null, overId: null, position: 'after' },
      contextMenu:   null,
      selectedIds:   new Set(),
      bulkMoveOpen:  false,
      selectionDrag: null,
    }
  },

  mounted() {
    this.shortcuts.closeModal    = () => { this.editingNote = null; this.showShortcuts = false }
    this.shortcuts.newNote       = () => { this.$refs.addNoteForm?.openAsNote() }
    this.shortcuts.newTask       = () => { this.$refs.addNoteForm?.openAsTask() }
    this.shortcuts.focusSearch   = () => { this.$refs.searchInput?.focus() }
    this.shortcuts.openShortcuts = () => { this.showShortcuts = true }
    document.addEventListener('mousedown', this._closeContextMenu)
    document.addEventListener('keydown',   this._closeContextMenuOnEscape)
  },

  beforeUnmount() {
    document.removeEventListener('mousedown', this._closeContextMenu)
    document.removeEventListener('keydown',   this._closeContextMenuOnEscape)
    document.removeEventListener('mousemove', this._onSelectionDragMove)
    document.removeEventListener('mouseup',   this._onSelectionDragEnd)
  },

  watch: {
    'store.currentViewId'() {
      this.showDone = false
      this.selectedIds = new Set()
      this.bulkMoveOpen = false
      this.mobileSearchOpen = false
      this.mobileMenuOpen = false
    },
  },

  computed: {
    today() {
      return new Date().toISOString().slice(0, 10)
    },
    selectMode() {
      return this.selectedIds.size > 0
    },
    selectionRectVisible() {
      if (!this.selectionDrag) return false
      const { startX, startY, currentX, currentY } = this.selectionDrag
      return Math.abs(currentX - startX) > 5 || Math.abs(currentY - startY) > 5
    },
    selectionRectStyle() {
      if (!this.selectionDrag) return {}
      const { startX, startY, currentX, currentY } = this.selectionDrag
      return {
        left:   Math.min(startX, currentX) + 'px',
        top:    Math.min(startY, currentY) + 'px',
        width:  Math.abs(currentX - startX) + 'px',
        height: Math.abs(currentY - startY) + 'px',
      }
    },
    isSmartView() {
      return this.store.currentViewId.startsWith('smart:')
    },
    // True whenever the visible list is restricted to tasks — either a smart
    // task view or the "Tasks only" filter toggle. Drives the add-form default,
    // placeholder and empty-state copy.
    taskFilterActive() {
      return this.isSmartView || this.showTasksOnly
    },
    isContextNoteTask() {
      return this.contextMenu ? isTaskNote(this.contextMenu.note) : false
    },
    reminderQuickSlots() {
      const now = new Date()
      const SLOT_HOURS = [8, 12, 16, 20]
      const results = []
      for (let day = 0; day <= 2 && results.length < 3; day++) {
        for (const h of SLOT_HOURS) {
          if (results.length >= 3) break
          const d = new Date(now)
          d.setDate(d.getDate() + day)
          d.setHours(h, 0, 0, 0)
          if (d > now) results.push(d)
        }
      }
      const today    = new Date()
      const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
      return results.map(d => ({
        iso:       d.toISOString(),
        dayLabel:  d.toDateString() === today.toDateString()    ? 'Today'
                 : d.toDateString() === tomorrow.toDateString() ? 'Tomorrow'
                 : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
        timeLabel: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      }))
    },
    syncLabel() {
      return { local: 'Local only', active: 'Syncing…', synced: 'Synced', error: 'Sync error' }[this.store.syncState]
    },
    viewTitle() {
      const smartTitles = { 'smart:today': 'Today', 'smart:upcoming': 'Upcoming', 'smart:all-tasks': 'All Tasks', 'smart:overdue': 'Overdue' }
      if (smartTitles[this.store.currentViewId]) return smartTitles[this.store.currentViewId]
      if (this.store.currentViewId === 'home')  return 'Home'
      if (this.store.currentViewId === 'trash') return 'Trash'
      return this.store.views.find(v => v._id === this.store.currentViewId)?.name ?? ''
    },
    searchActive() {
      return this.searchQuery.trim().length > 0
    },
    displayedNotes() {
      let notes
      if (!this.searchActive) {
        notes = this.store.filteredNotes
      } else {
        const q = this.searchQuery.trim().toLowerCase()
        notes = this.store.filteredNotes.filter(n =>
          (n.title || '').toLowerCase().includes(q) ||
          (n.content || '').toLowerCase().includes(q)
        )
      }
      if (this.showTasksOnly) {
        notes = notes.filter(n => this.isTaskNote(n))
      }
      return notes
    },
    pinnedNotes() {
      if (this.store.currentViewId === 'trash') return []
      return this.displayedNotes.filter(n => n.pinned)
    },
    activeNotes() {
      if (this.store.currentViewId === 'trash') return this.displayedNotes
      return this.displayedNotes.filter(n => !n.pinned && !n.done)
    },
    doneNotes() {
      if (this.store.currentViewId === 'trash') return []
      return this.displayedNotes.filter(n => !n.pinned && n.done)
    },
    emptyLabel() {
      if (this.searchActive) return 'No notes match your search.'
      if (this.store.currentViewId === 'trash') return 'Trash is empty.'
      if (this.store.currentViewId === 'smart:today')     return 'No tasks due today.'
      if (this.store.currentViewId === 'smart:upcoming')  return 'No upcoming tasks.'
      if (this.store.currentViewId === 'smart:all-tasks') return 'No tasks yet. Mark a note as a task to see it here.'
      if (this.store.currentViewId === 'smart:overdue')   return 'No overdue tasks.'
      if (this.showTasksOnly) return 'No tasks yet.'
      return 'No notes yet. Add one above.'
    },
    // Trello doesn't make sense in trash or smart views — fall back to list
    effectiveViewMode() {
      if ((this.store.currentViewId === 'trash' || this.isSmartView) && this.viewMode === 'trello') return 'list'
      return this.viewMode
    },

    renderedContentMap() {
      const map = {}
      for (const note of this.displayedNotes) {
        map[note._id] = renderNoteContent(note)
      }
      return map
    },
  },

  methods: {
    onSideMenuNavigate() {
      if (window.innerWidth <= 640) this.sidebarCollapsed = true
    },

    openMobileSearch() {
      this.mobileSearchOpen = true
      this.$nextTick(() => this.$refs.searchInput?.focus())
    },

    closeMobileSearch() {
      this.mobileSearchOpen = false
      this.searchQuery = ''
    },

    async addNote({ title, content, isTask, dueDate, contentType }) {
      await this.store.addNote({ title, content, isTask, dueDate, contentType })
    },

    openNote(note) {
      if (this.selectMode) return
      this.editingNote = note
    },

    onNotePin(note) {
      this.store.pinNote(note)
    },

    onNoteDelete(note) {
      this.store.deleteNote(note)
    },

    onNoteContextMenu(event, note) {
      this.contextMenu = { x: event.clientX, y: event.clientY, note, reminderOpen: false }
    },

    contextMenuDelete() {
      if (this.contextMenu) {
        this.store.deleteNote(this.contextMenu.note)
        this.contextMenu = null
      }
    },

    contextMenuPin() {
      if (this.contextMenu) {
        this.store.pinNote(this.contextMenu.note)
        this.contextMenu = null
      }
    },

    contextMenuToggleTask() {
      if (!this.contextMenu) return
      const note      = this.contextMenu.note
      const makeTask  = !isTaskNote(note)
      this.store.updateNoteTaskFields(note, { isTask: makeTask, ...(makeTask ? {} : { dueDate: null }) })
      this.contextMenu = null
    },

    contextMenuSetReminder(iso) {
      if (!this.contextMenu) return
      this.store.updateNoteNotification(this.contextMenu.note, iso)
      this.contextMenu = null
    },

    // ── Select mode ─────────────────────────────────────────────────

    onNoteSelect(note) {
      const next = new Set(this.selectedIds)
      if (next.has(note._id)) next.delete(note._id)
      else next.add(note._id)
      this.selectedIds = next
    },

    clearSelection() {
      this.selectedIds = new Set()
      this.bulkMoveOpen = false
    },

    onAppMainMousedown(event) {
      if (!event.shiftKey || event.button !== 0) return
      if (event.target.closest('button, input, textarea, a, select')) return
      event.preventDefault()
      this.selectionDrag = {
        startX:   event.clientX,
        startY:   event.clientY,
        currentX: event.clientX,
        currentY: event.clientY,
      }
      document.addEventListener('mousemove', this._onSelectionDragMove)
      document.addEventListener('mouseup',   this._onSelectionDragEnd)
    },

    _onSelectionDragMove(event) {
      if (!this.selectionDrag) return
      this.selectionDrag = { ...this.selectionDrag, currentX: event.clientX, currentY: event.clientY }
    },

    _onSelectionDragEnd() {
      document.removeEventListener('mousemove', this._onSelectionDragMove)
      document.removeEventListener('mouseup',   this._onSelectionDragEnd)
      if (!this.selectionDrag) return
      const { startX, startY, currentX, currentY } = this.selectionDrag
      const minX = Math.min(startX, currentX)
      const maxX = Math.max(startX, currentX)
      const minY = Math.min(startY, currentY)
      const maxY = Math.max(startY, currentY)
      this.selectionDrag = null
      if (maxX - minX < 5 && maxY - minY < 5) return
      const next = new Set(this.selectedIds)
      document.querySelectorAll('.note-card[data-note-id]').forEach(card => {
        const r = card.getBoundingClientRect()
        if (r.left < maxX && r.right > minX && r.top < maxY && r.bottom > minY) {
          next.add(card.dataset.noteId)
        }
      })
      this.selectedIds = next
    },

    bulkSelectAll() {
      this.selectedIds = new Set(this.displayedNotes.map(n => n._id))
    },

    async bulkDeleteSelected() {
      const ids = [...this.selectedIds]
      this.clearSelection()
      await this.store.bulkDelete(ids)
    },

    async bulkMoveToView(viewId) {
      const ids = [...this.selectedIds]
      this.clearSelection()
      await this.store.bulkMove(ids, viewId)
    },

    async bulkMoveToHome() {
      await this.bulkMoveToView(null)
    },

    _closeContextMenu() {
      this.contextMenu = null
      this.bulkMoveOpen = false
      this.mobileMenuOpen = false
    },

    _closeContextMenuOnEscape(e) {
      if (e.key === 'Escape') this.contextMenu = null
    },

    async onCheckboxChange(event, note) {
      if (event.target.type !== 'checkbox') return
      const idx = parseInt(event.target.dataset.checkboxIdx)
      const newContent = toggleCheckbox(note.content || '', idx, event.target.checked)
      await this.store.updateNote(note, {
        title:       note.title       || '',
        content:     newContent,
        viewId:      note.viewId,
        contentType: note.contentType ?? 'plain',
      })
    },

    setViewMode(mode) {
      this.viewMode = mode
      localStorage.setItem('notesViewMode', mode)
    },

    // ── Drag & drop (masonry / list) ────────────────────────────────

    onDragStart(event, note) {
      this.drag.noteId = note._id
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/note-id', note._id)
    },

    onDragOver(event, note) {
      if (!this.drag.noteId || this.drag.noteId === note._id) return
      const rect = event.currentTarget.getBoundingClientRect()
      this.drag.overId    = note._id
      this.drag.position  = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    },

    onDragLeave(event) {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        this.drag.overId = null
      }
    },

    async onDrop(targetNote) {
      const { noteId, position } = this.drag
      this.onDragEnd()

      if (!noteId || noteId === targetNote._id) return

      // Operate only on the currently visible notes so a filtered view
      // doesn't accidentally drop invisible notes out of the order array.
      const notes     = this.displayedNotes
      const others    = notes.filter(n => n._id !== noteId)
      const targetIdx = others.findIndex(n => n._id === targetNote._id)
      const insertAt  = position === 'before' ? targetIdx : targetIdx + 1
      const dragged   = notes.find(n => n._id === noteId)

      const newOrder = [...others]
      newOrder.splice(insertAt, 0, dragged)

      await this.store.reorderNotes(newOrder.map(n => n._id))
    },

    onDragEnd() {
      this.drag = { noteId: null, overId: null, position: 'after' }
    },
  },
}
</script>

<style>
/* ── Layout ──────────────────────────────────────────────────────── */

.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.app-body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.app-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  /* Always reserve the scrollbar gutter so expanding the add-note form (which
     can introduce a scrollbar) doesn't change the content width / re-center it. */
  scrollbar-gutter: stable;
}

/* ── Header ──────────────────────────────────────────────────────── */

header {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 0.75rem 1.5rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-shrink: 0;
  z-index: 10;
  /* Fixed height so the bar is identical across views. Without this, Trash (which
     hides the 32px search input) is a few px shorter than other views, whose
     height is driven by that input. = 32px input + 0.75rem*2 padding + 1px border. */
  height: 57px;
  box-sizing: border-box;
}

.hamburger {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  color: var(--text-3);
  line-height: 1;
}
.hamburger:hover { background: var(--surface-3); }

.header-left {
  flex: 0 0 calc(180px - 2.5rem); /* sidebar width minus (header-padding-left + gap) */
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.header-end {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

header h1 {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 500;
  color: var(--text-3);
  white-space: nowrap;
}

/* ── Search ──────────────────────────────────────────────────────── */

.search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  max-width: 300px;
}

.search-input {
  width: 100%;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 2rem 0 0.75rem;
  font-size: 0.875rem;
  font-family: inherit;
  color: var(--text-1);
  background: var(--surface-3);
  outline: none;
  transition: border-color 0.12s, background 0.12s;
}
.search-input:focus { border-color: var(--accent); background: var(--surface); }
.search-input::-webkit-search-cancel-button { display: none; }

.search-count {
  position: absolute;
  right: 1.75rem;
  font-size: 0.72rem;
  color: var(--text-muted);
  pointer-events: none;
  white-space: nowrap;
}

.search-clear {
  position: absolute;
  right: 0.375rem;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
}
.search-clear:hover { background: var(--surface-3); color: var(--text-3); }

/* ── Sort dropdown ───────────────────────────────────────────────── */

.sort-dropdown-wrap { display: flex; align-items: center; }

.sort-select {
  appearance: none;
  -webkit-appearance: none;
  background: var(--surface-3);
  border: none;
  border-radius: 8px;
  padding: 0.3rem 0.75rem;
  font-size: 0.8rem;
  font-family: inherit;
  color: var(--text-3);
  cursor: pointer;
  height: 28px;
}
.sort-select:focus { outline: 2px solid var(--accent); }

/* ── View-mode toggle ────────────────────────────────────────────── */

.view-toggle {
  display: flex;
  gap: 2px;
  background: var(--surface-3);
  border-radius: 8px;
  padding: 3px;
}

.vtb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-3);
  transition: background 0.12s, color 0.12s;
}
.vtb:hover  { background: var(--border); color: var(--text-1); }
.vtb.active { background: var(--surface); color: var(--accent); box-shadow: 0 1px 3px rgba(0,0,0,.15); }

/* ── Sync badge ──────────────────────────────────────────────────── */

.sync-badge {
  font-size: 0.75rem;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}
.debug-fab {
  position: fixed;
  bottom: 1.5rem;
  right: 1.5rem;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--surface);
  font-size: 1.1rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0,0,0,.15);
  opacity: 0.55;
  transition: opacity 0.15s, box-shadow 0.15s;
  z-index: 50;
  line-height: 1;
}
.debug-fab:hover  { opacity: 1; box-shadow: 0 4px 12px rgba(0,0,0,.2); }
.debug-fab.active { background: var(--accent-bg); opacity: 1; border-color: var(--accent); }

.sync-badge.local   { background: var(--surface-3); color: var(--text-3); }
.sync-badge.active  { background: var(--warning-bg); color: var(--warning); }
.sync-badge.synced  { background: var(--success-bg); color: var(--success); }
.sync-badge.error   { background: var(--danger-bg); color: var(--danger); }

.sync-spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  vertical-align: middle;
  margin-right: 4px;
  opacity: 0.8;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── Add-note form ───────────────────────────────────────────────── */

.add-note {
  display: flex;
  justify-content: center;
  padding: 2rem 1rem 1rem;
}

.add-note-box {
  width: 100%;
  max-width: 560px;
  background: var(--surface);
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,.2), 0 2px 8px rgba(0,0,0,.1);
  padding: 0.75rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.note-title-input,
.note-content-input {
  border: none;
  outline: none;
  width: 100%;
  font-size: 1rem;
  font-family: inherit;
  resize: none;
  background: transparent;
}

.note-title-input { font-weight: 600; }
.note-content-input { color: var(--text-2); }

.form-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.5rem;
  padding-top: 0.25rem;
}

.form-task-toggle {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.8rem;
  color: var(--text-3);
  cursor: pointer;
  margin-right: auto;
}

.btn-close,
.btn-add {
  border: none;
  border-radius: 4px;
  padding: 0.4rem 1rem;
  font-size: 0.875rem;
  cursor: pointer;
  font-family: inherit;
  font-weight: 500;
}

.btn-close { background: transparent; color: var(--text-3); }
.btn-close:hover { background: var(--surface-3); }

.btn-add { background: var(--accent); color: #fff; }
.btn-add:hover:not(:disabled) { background: var(--accent-h); }
.btn-add:disabled { opacity: 0.5; cursor: default; }

/* ── Note card (shared across all views) ─────────────────────────── */

.note-card {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem;
  word-break: break-word;
  cursor: pointer;
  transition: box-shadow 0.15s, opacity 0.2s ease, transform 0.2s ease;
  user-select: none;
}
.note-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,.15); }
.note-card--task { border-left: 3px solid var(--accent); }
.note-card--task:not(.note-card--list) { padding-left: 2rem; }
.note-card--priority-high   { border-left-color: var(--danger); }
.note-card--priority-medium { border-left-color: var(--warning); }
.note-card--priority-low    { border-left-color: var(--success); }
.note-card--done { opacity: 0.65; }

/* Drag states */
.note-card--dragging { opacity: 0.35; }
.note-card--open {
  opacity: 0;
  transform: scale(1.04);
  pointer-events: none;
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.note-card--drop-before::before,
.note-card--drop-after::after {
  content: '';
  position: absolute;
  left: 4px; right: 4px;
  height: 2px;
  background: var(--accent);
  border-radius: 1px;
  pointer-events: none;
}
.note-card--drop-before::before { top: -3px; }
.note-card--drop-after::after   { bottom: -3px; }

.note-card-title {
  margin: 0 0 0.5rem;
  font-size: 1rem;
  font-weight: 600;
}
.note-card-title--done {
  text-decoration: line-through;
  color: var(--text-muted);
}

.note-card-content {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-2);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 10;
  line-clamp: 10;
  -webkit-box-orient: vertical;
}

.note-card-content p  { margin: 0.2rem 0; }
.note-card-content h1,
.note-card-content h2,
.note-card-content h3 { font-size: 0.95rem; margin: 0.3rem 0 0.1rem; }
.note-card-content ul,
.note-card-content ol { margin: 0.2rem 0; padding-left: 1.25rem; }
/* Checkbox / task list */
.note-card-content .task-item {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
}
.note-card-content .task-item input {
  flex-shrink: 0;
  cursor: pointer;
  accent-color: var(--accent);
  margin-top: 0.15rem;
}
.note-card-content .task-item--first-checked {
  border-top: 1px dashed var(--border-2);
  margin-top: 0.4rem;
  padding-top: 0.4rem;
}
.note-card-content .task-item--checked {
  color: var(--text-muted);
}
.note-card-content .task-item--checked input[type="checkbox"] {
  opacity: 0.5;
}
.note-card-content .task-item--checked > *:not(input) {
  text-decoration: line-through;
  text-decoration-color: var(--text-muted);
}
.note-card-content code {
  background: var(--surface-3);
  padding: 0.1em 0.3em;
  border-radius: 3px;
  font-size: 0.8em;
}
.note-card-content pre {
  background: var(--surface-3);
  padding: 0.5rem;
  border-radius: 4px;
  overflow: hidden;
  font-size: 0.8em;
}
.note-card-content blockquote {
  border-left: 3px solid var(--border);
  margin: 0.3rem 0;
  padding-left: 0.6rem;
  color: var(--text-3);
}
.note-card-content img {
  max-width: 100%;
  max-height: 120px;
  object-fit: cover;
  object-position: top;
  border-radius: 3px;
  display: block;
  margin: 0.2rem 0;
}

/* ── Hover quick-actions ─────────────────────────────────────────── */

.note-card-actions {
  position: absolute;
  top: 0.35rem;
  right: 0.35rem;
  display: flex;
  gap: 0.2rem;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s;
}
.note-card:hover .note-card-actions {
  opacity: 1;
  pointer-events: auto;
}

.note-card-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.6rem;
  height: 1.6rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  color: var(--text-3);
  padding: 0;
  transition: background 0.1s, color 0.1s;
}
.note-card-action-btn:hover { background: var(--surface-3); color: var(--text-1); }
.note-card-action-btn--danger:hover { background: var(--danger-bg); color: var(--danger); border-color: var(--danger); }

/* ── Task card elements ──────────────────────────────────────────── */

.note-card-task-check {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0.1rem;
  border-radius: 50%;
  transition: color 0.12s;
}
.note-card-task-check:hover { color: var(--accent); }
.note-card-task-check.done  { color: var(--success); }
.note-card-task-check--overlay {
  position: absolute;
  top: 0.45rem;
  left: 0.45rem;
}

/* ── Recurrence chip ─────────────────────────────────────────────── */

.note-card-recurrence {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-size: 0.68rem;
  color: var(--text-muted);
  white-space: nowrap;
}

/* ── Done tasks section ──────────────────────────────────────────── */

.done-section { padding: 0 1.5rem 0.5rem; }

.done-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.78rem;
  color: var(--text-muted);
  padding: 0.4rem 0;
  border-radius: 4px;
}
.done-toggle:hover { color: var(--text-3); }

.notes-masonry--done { opacity: 0.7; }

.note-card-chips {
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
  margin-bottom: 0.3rem;
}

.note-card-due {
  display: inline-block;
  font-size: 0.7rem;
  background: var(--accent-bg);
  color: var(--accent-text);
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  white-space: nowrap;
}
.note-card-due.overdue { background: var(--danger-bg); color: var(--danger); }

.note-card-priority {
  display: inline-block;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  text-transform: capitalize;
}
.priority--high   { background: var(--danger-bg);  color: var(--danger); }
.priority--medium { background: var(--warning-bg); color: var(--warning); }
.priority--low    { background: var(--success-bg); color: var(--success); }

/* ── Masonry layout ──────────────────────────────────────────────── */

.notes-masonry {
  columns: 180px;
  column-gap: 1rem;
  padding: 1rem 1.5rem 2rem;
  width: 100%;
}

.notes-masonry .note-card {
  break-inside: avoid;
  margin-bottom: 1rem;
  display: block;
}

/* ── List layout ─────────────────────────────────────────────────── */

.notes-list {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0.75rem 1.5rem 2rem;
  max-width: 720px;
  margin: 0 auto;
  width: 100%;
}

.note-card--list { padding: 0.625rem 1rem; }

.note-card-list-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
  flex-wrap: wrap;
}

.note-card-list-meta .note-card-title {
  flex: 1;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.note-card-title--untitled { color: var(--text-muted); font-style: italic; }

.note-card-date {
  font-size: 0.72rem;
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
  margin-left: auto;
}

.notes-list .note-card-content {
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

/* ── Pin icon ────────────────────────────────────────────────────── */

.note-card-pin {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  color: var(--text-muted);
  line-height: 0;
  pointer-events: none;
}

/* ── Pinned / regular separator ──────────────────────────────────── */

.notes-separator {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.25rem 1.5rem 0.5rem;
}
.notes-separator::after {
  content: '';
  height: 1px;
  background: var(--border);
  flex: 1;
  max-width: 280px;
}
.notes-separator-text {
  font-size: 0.7rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

/* ── Trash info banner ───────────────────────────────────────────── */

.trash-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 1rem 1.5rem 0;
  padding: 0.5rem 0.75rem;
  background: var(--warning-bg);
  border-radius: 8px;
  font-size: 0.8rem;
  color: var(--warning);
}

.note-card-expiry {
  margin-top: 0.5rem;
  font-size: 0.7rem;
  color: var(--text-muted);
}

/* ── Context menu ────────────────────────────────────────────────── */

.context-menu {
  position: fixed;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,.14), 0 2px 6px rgba(0,0,0,.08);
  min-width: 180px;
  z-index: 9999;
  padding: 0.3rem 0;
  overflow: hidden;
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.55rem 1rem;
  background: none;
  border: none;
  font-family: inherit;
  font-size: 0.875rem;
  color: var(--text-1);
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
  white-space: nowrap;
}
.context-menu-item:hover { background: var(--surface-3); }
.context-menu-item.danger { color: var(--danger); }
.context-menu-item.danger:hover { background: var(--danger-bg); }
.context-menu-item--active { background: var(--accent-bg); color: var(--accent-text); }
.context-menu-item--active:hover { background: var(--accent-bg); opacity: 0.85; }

.context-menu-reminder-slots {
  border-top: 1px solid var(--surface-3);
  border-bottom: 1px solid var(--surface-3);
  padding: 0.2rem 0;
}
.context-menu-reminder-slot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 0.4rem 1rem;
  background: none;
  border: none;
  font-family: inherit;
  font-size: 0.82rem;
  color: var(--text-1);
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}
.context-menu-reminder-slot:hover { background: var(--surface-3); }
.context-menu-reminder-slot.active { color: var(--accent); }
.context-menu-slot-time { font-size: 0.75rem; color: var(--text-muted); margin-left: 0.5rem; }
.context-menu-reminder-slot.active .context-menu-slot-time { color: var(--accent); }
.context-menu-reminder-remove {
  display: block;
  width: 100%;
  padding: 0.35rem 1rem;
  background: none;
  border: none;
  font-family: inherit;
  font-size: 0.78rem;
  color: var(--danger);
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}
.context-menu-reminder-remove:hover { background: var(--danger-bg); }

.context-menu-divider {
  height: 1px;
  background: var(--border);
  margin: 0.3rem 0;
}

/* ── Misc ────────────────────────────────────────────────────────── */

.empty {
  text-align: center;
  color: var(--text-muted);
  margin-top: 3rem;
}

.error {
  text-align: center;
  color: var(--danger);
  margin: 0.5rem 1rem;
}

/* ── Bulk selection bar ──────────────────────────────────────────── */

.bulk-bar {
  position: fixed;
  bottom: 1.5rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--bulk-bg);
  color: var(--bulk-text);
  border-radius: 0.6rem;
  padding: 0.6rem 1rem;
  box-shadow: 0 4px 24px rgba(0,0,0,.35);
  z-index: 500;
  white-space: nowrap;
  flex-wrap: nowrap;
}

.bulk-count {
  font-size: 0.875rem;
  font-weight: 500;
  margin-right: 0.25rem;
}

.bulk-btn {
  background: rgba(128,128,128,.15);
  border: none;
  border-radius: 4px;
  color: var(--bulk-text);
  font-family: inherit;
  font-size: 0.8rem;
  padding: 0.3rem 0.7rem;
  cursor: pointer;
  white-space: nowrap;
}
.bulk-btn:hover { background: rgba(128,128,128,.25); }
.bulk-btn--danger { color: var(--danger); }
.bulk-btn--danger:hover { background: var(--danger-bg); }
.bulk-btn--clear { background: transparent; color: var(--text-muted); }
.bulk-btn--clear:hover { background: rgba(128,128,128,.1); color: var(--bulk-text); }

.bulk-move-wrap { position: relative; }

.bulk-move-panel {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,.2);
  min-width: 160px;
  max-height: 240px;
  overflow-y: auto;
  z-index: 600;
  padding: 0.25rem 0;
}

/* Transition */
.bulk-bar-enter-active, .bulk-bar-leave-active { transition: opacity 0.18s, transform 0.18s; }
.bulk-bar-enter-from, .bulk-bar-leave-to { opacity: 0; transform: translateX(-50%) translateY(0.5rem); }

/* ── Rubber-band selection rect ──────────────────────────────────── */

.selection-rect {
  position: fixed;
  background: var(--accent-bg);
  border: 1.5px solid var(--accent);
  border-radius: 2px;
  pointer-events: none;
  z-index: 9998;
  opacity: 0.5;
}

/* ── Sidebar backdrop (mobile) ───────────────────────────────────── */

.sidebar-backdrop {
  display: none;
}

/* ── Mobile form backdrop ────────────────────────────────────────── */

.mobile-form-backdrop {
  display: none;
}

/* ── Mobile FAB ──────────────────────────────────────────────────── */

.add-fab {
  display: none;
  position: fixed;
  bottom: 1.5rem;
  right: 1.5rem;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(0,0,0,.3);
  z-index: 100;
  transition: background 0.15s, box-shadow 0.15s;
}
.add-fab:hover { background: var(--accent-h); box-shadow: 0 6px 20px rgba(0,0,0,.4); }

/* ── Mobile-only base styles (hidden on desktop) ─────────────────── */

.mobile-header-actions { display: none; }
.search-cancel-btn     { display: none; }

/* ── Mobile responsive ───────────────────────────────────────────── */

@media (max-width: 640px) {
  /* Header: single row — [☰ Title] ........... [🔍 ⋮ ⚙] */
  header {
    padding: 0.5rem 0.75rem;
    gap: 0.35rem;
    position: relative;
    /* Reset the desktop fixed height — mobile header is shorter by design. */
    height: auto;
  }

  .header-left {
    flex: 0 0 auto;
  }

  header h1 {
    font-size: 1.05rem;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Desktop controls hidden on mobile */
  .search-wrap,
  .view-toggle,
  .vtb--task-filter,
  .sort-dropdown-wrap,
  .sync-badge {
    display: none;
  }

  /* Mobile actions cluster: pushed to the right */
  .mobile-header-actions {
    display: flex;
    align-items: center;
    gap: 0.1rem;
    margin-left: auto;
  }

  /* header-end no longer needs to auto-push */
  .header-end {
    margin-left: 0;
  }

  /* More menu panel */
  .mobile-more-wrap {
    position: relative;
  }

  .mobile-more-panel {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,.15);
    min-width: 230px;
    z-index: 500;
    overflow: hidden;
  }

  .mobile-more-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 0.9rem;
  }

  .mobile-more-label {
    font-size: 0.72rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink: 0;
    min-width: 30px;
  }

  .mobile-more-row .view-toggle {
    display: flex; /* override the hidden rule above */
  }

  .mobile-more-row .sort-select {
    flex: 1;
  }

  .mobile-more-divider {
    height: 1px;
    background: var(--surface-3);
    margin: 0;
  }

  .mobile-more-item {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    padding: 0.6rem 0.9rem;
    background: none;
    border: none;
    font-family: inherit;
    font-size: 0.875rem;
    color: var(--text-2);
    cursor: pointer;
    text-align: left;
  }
  .mobile-more-item:hover { background: var(--surface-3); }
  .mobile-more-item--active { color: var(--accent); }
  .mobile-more-item--active:hover { background: var(--accent-bg); }

  /* Search active mode: show full-width search + cancel */
  header.mobile-search-active .header-left,
  header.mobile-search-active .mobile-header-actions,
  header.mobile-search-active .header-end {
    display: none;
  }

  header.mobile-search-active .search-wrap {
    display: flex;
    flex: 1;
    max-width: none;
  }

  header.mobile-search-active .search-cancel-btn {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    background: none;
    color: var(--accent);
    border: none;
    font-family: inherit;
    font-size: 0.9rem;
    cursor: pointer;
    padding: 0.25rem 0.25rem 0.25rem 0.5rem;
    white-space: nowrap;
  }

  /* Sidebar backdrop */
  .sidebar-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,.35);
    z-index: 199;
  }

  /* Mobile form backdrop */
  .mobile-form-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,.35);
    z-index: 299;
  }

  /* FAB */
  .add-fab {
    display: flex;
  }

  /* Add-note: takes no space; form goes full-screen when expanded */
  .add-note {
    padding: 0;
  }

  .add-note-box:not(.expanded) {
    display: none;
  }

  .add-note-box.expanded {
    position: fixed !important;
    inset: 0 !important;
    width: auto !important;
    max-width: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    padding: 1.25rem !important;
    z-index: 300;
    overflow-y: auto;
  }

  /* Notes: 2-column masonry on mobile */
  .notes-masonry {
    columns: 2;
    column-gap: 0.5rem;
    padding: 0.75rem 0.75rem 5rem;
  }

  .notes-masonry .note-card {
    margin-bottom: 0.5rem;
  }

  /* Extra bottom padding in list view too (FAB) */
  .notes-list {
    padding-bottom: 5rem;
  }

  /* Bulk bar: full-width on mobile */
  .bulk-bar {
    left: 0.75rem;
    right: 0.75rem;
    transform: none;
    bottom: 0.75rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  .bulk-bar-enter-from,
  .bulk-bar-leave-to {
    transform: translateY(0.5rem);
  }
}
</style>
