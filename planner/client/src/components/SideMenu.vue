<template>
  <aside class="side-menu" :class="{ collapsed, resizing }" :style="collapsed ? null : { width: width + 'px' }">
    <nav>
      <ul class="nav-list">
        <!-- Labels section (Home + user labels) -->
        <li v-if="!collapsed" class="nav-section-li">
          <div class="nav-section-row">
            <button class="nav-section-header" @click="collapsedSections.labels = !collapsedSections.labels">
              <span class="nav-section-chevron" :class="{ expanded: !collapsedSections.labels }">
                <AppIcon name="chevron-right" :size="10" />
              </span>
              Labels
            </button>
            <button
              class="nav-edit-toggle"
              :class="{ active: editMode }"
              :title="editMode ? 'Done editing' : 'Edit labels'"
              @click="editMode = !editMode"
            >
              <AppIcon name="edit" :size="12" />
            </button>
          </div>
        </li>
        <template v-if="!collapsedSections.labels">
          <!-- Home (default / unlabeled) -->
          <li>
            <button
              class="nav-item nav-item--fixed"
              :class="{ active: store.currentViewId === 'home' }"
              :style="{ paddingLeft: '0.5rem' }"
              @click="store.setView('home')"
            >
              <span v-if="editMode" class="nav-grip nav-grip--spacer" aria-hidden="true">
                <AppIcon name="grip" :size="12" />
              </span>
              <span class="nav-chevron invisible" aria-hidden="true">
                <AppIcon name="chevron-right" :size="12" />
              </span>
              <span class="nav-icon"><AppIcon name="home" :size="16" /></span>
              <span class="nav-label">Home</span>
            </button>
          </li>
          <li
            v-for="view in visibleViews"
            :key="view._id"
            class="nav-view-li"
            :draggable="editMode"
            :class="{
              'drop-before': dropTarget?.id === view._id && dropTarget?.position === 'before',
              'drop-after':  dropTarget?.id === view._id && dropTarget?.position === 'after',
              'drop-inside': dropTarget?.id === view._id && dropTarget?.position === 'inside',
              'drop-note':   noteDropTarget === view._id,
              'is-dragging': draggedId === view._id,
            }"
            @dragstart="onDragStart($event, view)"
            @dragend="onDragEnd"
            @dragover="onDragOver($event, view)"
            @dragleave="onDragLeave($event)"
            @drop="onDrop($event, view)"
          >
            <button
              class="nav-item"
              :class="{ active: store.currentViewId === view._id }"
              :style="{ paddingLeft: (0.5 + view.depth * 1.25) + 'rem' }"
              @click="store.setView(view._id)"
            >
              <span v-if="editMode" class="nav-grip" title="Drag to reorder">
                <AppIcon name="grip" :size="12" />
              </span>
              <span
                class="nav-chevron"
                :class="{ expanded: !collapsedViews[view._id], invisible: !view.hasChildren }"
                @click.stop="view.hasChildren && toggleCollapse(view._id)"
              >
                <AppIcon name="chevron-right" :size="12" />
              </span>
              <span class="nav-icon"><AppIcon :name="view.icon || 'folder'" :size="16" /></span>
              <input
                v-if="renamingId === view._id"
                class="nav-rename-input"
                v-model="renameValue"
                @click.stop
                @keydown.enter="submitRename"
                @keydown.escape="cancelRename"
                @blur="submitRename"
              />
              <span
                v-else
                class="nav-label"
                @dblclick.stop="editMode && startRename(view)"
              >{{ view.name }}</span>
              <span v-if="!editMode && viewNoteCounts[view._id] > 0" class="nav-badge">{{ viewNoteCounts[view._id] }}</span>
              <span v-if="editMode && renamingId !== view._id" class="nav-actions">
                <span class="nav-action" title="Label options" @click.stop="toggleMenu(view, $event)">
                  <AppIcon name="more-vertical" :size="14" />
                </span>
              </span>
            </button>
            <!-- Inline add-subview form -->
            <div v-if="addingView && newViewParentId === view._id" class="add-view-form" :style="{ paddingLeft: (0.5 + (view.depth + 1) * 1.25 + 1.25) + 'rem' }">
              <input
                class="add-view-input"
                v-model="newViewName"
                placeholder="Subview name"
                @keydown.enter="submitView"
                @keydown.escape="cancelView"
                @blur="submitView"
              />
            </div>
          </li>

          <li v-if="!collapsed && editMode">
            <div v-if="addingView && newViewParentId === null" class="add-view-form">
              <input
                class="add-view-input"
                v-model="newViewName"
                placeholder="View name"
                @keydown.enter="submitView"
                @keydown.escape="cancelView"
                @blur="submitView"
              />
            </div>
            <button v-else class="nav-item nav-item--add" @click="startAddView(null)">
              <span class="nav-icon"><AppIcon name="plus" :size="16" /></span>
              <span class="nav-label">Add label</span>
            </button>
          </li>
        </template>
      </ul>

      <!-- Smart task views — pinned above trash -->
      <ul class="nav-list nav-list--tasks">
        <li v-if="!collapsed" class="nav-section-li">
          <button class="nav-section-header" @click="collapsedSections.tasks = !collapsedSections.tasks">
            <span class="nav-section-chevron" :class="{ expanded: !collapsedSections.tasks }">
              <AppIcon name="chevron-right" :size="10" />
            </span>
            Tasks
          </button>
        </li>
        <template v-if="!collapsedSections.tasks">
          <li v-for="sv in smartViews" :key="sv.id">
            <button
              class="nav-item nav-item--fixed"
              :class="{ active: store.currentViewId === sv.id }"
              :style="{ paddingLeft: '0.5rem' }"
              @click="store.setView(sv.id)"
            >
              <span class="nav-chevron invisible" aria-hidden="true">
                <AppIcon name="chevron-right" :size="12" />
              </span>
              <span class="nav-icon"><AppIcon :name="sv.icon" :size="16" /></span>
              <span class="nav-label">{{ sv.label }}</span>
              <span v-if="sv.count > 0" class="nav-badge" :class="sv.badgeClass">{{ sv.count }}</span>
            </button>
          </li>
        </template>
      </ul>

      <ul class="nav-list nav-list--bottom">
        <li>
          <button
            class="nav-item nav-item--fixed"
            :class="{ active: store.currentViewId === 'archive' }"
            :style="{ paddingLeft: '0.5rem' }"
            @click="store.setView('archive')"
          >
            <span class="nav-chevron invisible" aria-hidden="true">
              <AppIcon name="chevron-right" :size="12" />
            </span>
            <span class="nav-icon"><AppIcon name="archive" :size="16" /></span>
            <span class="nav-label">Archive</span>
          </button>
        </li>
        <li>
          <button
            class="nav-item nav-item--fixed"
            :class="{ active: store.currentViewId === 'trash' }"
            :style="{ paddingLeft: '0.5rem' }"
            @click="store.setView('trash')"
          >
            <span class="nav-chevron invisible" aria-hidden="true">
              <AppIcon name="chevron-right" :size="12" />
            </span>
            <span class="nav-icon"><AppIcon name="trash" :size="16" /></span>
            <span class="nav-label">Trash</span>
          </button>
        </li>
      </ul>
    </nav>
    <div v-if="!collapsed" class="resize-handle" @mousedown.prevent="startResize"></div>
  </aside>

  <Teleport to="body">
    <div
      v-if="menuOpenId && menuPos"
      class="label-menu-float"
      :style="{ top: menuPos.top + 'px', left: menuPos.left + 'px' }"
      @click.stop
    >
      <button class="label-menu-item" @click="onMenuRename">
        <AppIcon name="edit" :size="14" /> Rename
      </button>
      <button class="label-menu-item" @click="onMenuIcon">
        <AppIcon name="folder" :size="14" /> Change icon
      </button>
      <button v-if="menuView?.parentId" class="label-menu-item" @click="onMenuToggleRollup">
        <AppIcon name="check" :size="14" :class="{ invisible: !menuView?.rollUp }" /> Show in parent
      </button>
      <button class="label-menu-item" @click="onMenuAddSub">
        <AppIcon name="plus" :size="14" /> Add sub-label
      </button>
      <button class="label-menu-item label-menu-item--delete" @click="onMenuDelete">
        <AppIcon name="x" :size="14" /> Delete
      </button>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="iconPickerOpenId && iconPickerPos"
      class="icon-picker-float"
      :style="{ top: iconPickerPos.top + 'px', left: iconPickerPos.left + 'px' }"
      @click.stop
    >
      <div class="icon-picker-grid">
        <button
          v-for="iconName in LABEL_ICONS"
          :key="iconName"
          class="icon-picker-btn"
          :class="{ active: iconPickerCurrentIcon === iconName }"
          :title="iconName"
          @click="setViewIcon(iconName)"
        >
          <AppIcon :name="iconName" :size="16" />
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script>
import { useNotesStore, isTaskNote } from '../stores/notes.js'
import { useAuthStore } from '../stores/auth.js'

const LABEL_ICONS = [
  'folder', 'heart',     'book',      'coffee',
  'hash',   'star',      'tag',       'bookmark',
  'archive','briefcase', 'globe',     'zap',
]

const MIN_WIDTH = 150
const MAX_WIDTH = 420

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback }
  catch { return fallback }
}

export default {
  name: 'SideMenu',

  props: {
    collapsed: { type: Boolean, default: false },
  },

  emits: ['navigate'],

  setup() {
    return { store: useNotesStore(), authStore: useAuthStore(), LABEL_ICONS }
  },

  data() {
    return {
      editMode:          false,
      addingView:        false,
      newViewParentId:   null,
      newViewName:       '',
      collapsedViews:    loadJson('sidebarCollapsedViews', {}),
      collapsedSections: loadJson('sidebarCollapsedSections', { tasks: false, labels: false }),
      draggedId:         null,
      dropTarget:        null,  // { id, position: 'before'|'after'|'inside' }
      noteDropTarget:    null,  // viewId string | null
      iconPickerOpenId:  null,
      iconPickerPos:     null,  // { top, left } in px (fixed coords)
      width:             parseInt(localStorage.getItem('sidebarWidth')) || 180,
      resizing:          false,
      renamingId:        null,
      renameValue:       '',
      menuOpenId:        null,
      menuPos:           null,  // { top, left } in px (fixed coords)
    }
  },

  mounted() {
    this._closePickerBound = () => {
      this.iconPickerOpenId = null
      this.iconPickerPos = null
      this.menuOpenId = null
      this.menuPos = null
    }
    document.addEventListener('dragend', this.onExternalDragEnd)
    document.addEventListener('keydown', this.onKeydown)
  },

  beforeUnmount() {
    document.removeEventListener('dragend', this.onExternalDragEnd)
    document.removeEventListener('keydown', this.onKeydown)
    document.removeEventListener('click', this._closePickerBound)
    document.removeEventListener('mousemove', this.onResizeMove)
    document.removeEventListener('mouseup', this.stopResize)
  },

  watch: {
    'store.currentViewId'() {
      this.$emit('navigate')
    },

    collapsed(val) {
      // Leaving label edit mode open while the menu is closed (e.g. on mobile)
      // is confusing — turn it off whenever the menu collapses.
      if (val) this.editMode = false
    },

    editMode(val) {
      if (!val) {
        this.cancelView()
        this.closeIconPicker()
        this.closeMenu()
        this.cancelRename()
      }
    },

    collapsedViews: {
      deep: true,
      handler(val) { localStorage.setItem('sidebarCollapsedViews', JSON.stringify(val)) },
    },

    collapsedSections: {
      deep: true,
      handler(val) { localStorage.setItem('sidebarCollapsedSections', JSON.stringify(val)) },
    },
  },

  computed: {
    iconPickerCurrentIcon() {
      if (!this.iconPickerOpenId) return 'folder'
      const view = this.store.views.find(v => v._id === this.iconPickerOpenId)
      return view?.icon || 'folder'
    },

    menuView() {
      return this.menuOpenId ? this.store.views.find(v => v._id === this.menuOpenId) : null
    },

    smartViews() {
      const today = new Date().toISOString().slice(0, 10)
      const tasks = this.store.notes.filter(n => !n.deletedAt && isTaskNote(n))
      return [
        { id: 'smart:today',     label: 'Today',     count: tasks.filter(n => n.dueDate === today && !n.done).length,                    icon: 'calendar'   },
        { id: 'smart:upcoming',  label: 'Upcoming',  count: tasks.filter(n => n.dueDate && n.dueDate > today && !n.done).length,          icon: 'refresh'    },
        { id: 'smart:overdue',   label: 'Overdue',   count: tasks.filter(n => n.dueDate && n.dueDate < today && !n.done).length, badgeClass: 'nav-badge--danger', icon: 'info' },
        { id: 'smart:all-tasks', label: 'All Tasks', count: tasks.filter(n => !n.done).length,                                            icon: 'task-check' },
      ]
    },

    viewNoteCounts() {
      // Direct counts per view (own notes + notes labelled with it).
      const direct = {}
      for (const note of this.store.notes) {
        if (note.deletedAt) continue
        if (note.viewId) direct[note.viewId] = (direct[note.viewId] || 0) + 1
        for (const label of (note.labels || [])) {
          direct[label] = (direct[label] || 0) + 1
        }
      }
      // Roll rolled-up children into their ancestors so the badge matches the list.
      const counts = {}
      for (const view of this.store.views) {
        let total = 0
        for (const id of this.store.includedViewIds(view._id)) total += direct[id] || 0
        counts[view._id] = total
      }
      return counts
    },

    visibleViews() {
      const hidden = new Set()
      return this.store.flatViewTree.filter(v => {
        if (v.parentId && hidden.has(v.parentId)) { hidden.add(v._id); return false }
        if (this.collapsedViews[v._id] && v.hasChildren) hidden.add(v._id)
        return true
      })
    },
  },

  methods: {
    toggleIconPicker(view, event) {
      if (this.iconPickerOpenId === view._id) {
        this.closeIconPicker()
        return
      }
      const rect = event.currentTarget.getBoundingClientRect()
      this.iconPickerOpenId = view._id
      this.iconPickerPos = { top: rect.top + rect.height / 2, left: rect.right + 10 }
      document.removeEventListener('click', this._closePickerBound)
      this.$nextTick(() => document.addEventListener('click', this._closePickerBound))
    },

    closeIconPicker() {
      this.iconPickerOpenId = null
      this.iconPickerPos = null
      document.removeEventListener('click', this._closePickerBound)
    },

    async setViewIcon(iconName) {
      if (!this.iconPickerOpenId) return
      await this.store.updateView(this.iconPickerOpenId, { icon: iconName })
      this.closeIconPicker()
    },

    // ── Resize ──────────────────────────────────────────────────────────────────

    startResize(e) {
      const aside = e.currentTarget.closest('.side-menu')
      this._resizeLeft = aside ? aside.getBoundingClientRect().left : 0
      this.resizing = true
      document.addEventListener('mousemove', this.onResizeMove)
      document.addEventListener('mouseup', this.stopResize)
    },

    onResizeMove(e) {
      const w = e.clientX - this._resizeLeft
      this.width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w))
    },

    stopResize() {
      this.resizing = false
      localStorage.setItem('sidebarWidth', String(this.width))
      document.removeEventListener('mousemove', this.onResizeMove)
      document.removeEventListener('mouseup', this.stopResize)
    },

    // ── Rename ──────────────────────────────────────────────────────────────────

    startRename(view) {
      this.closeMenu()
      this.renamingId = view._id
      this.renameValue = view.name
      this.$nextTick(() => {
        const input = this.$el.querySelector('.nav-rename-input')
        if (input) { input.focus(); input.select() }
      })
    },

    async submitRename() {
      if (!this.renamingId) return
      const id = this.renamingId
      const name = this.renameValue.trim()
      const view = this.store.views.find(v => v._id === id)
      this.renamingId = null
      this.renameValue = ''
      if (name && view && name !== view.name) {
        await this.store.updateView(id, { name })
      }
    },

    cancelRename() {
      this.renamingId = null
      this.renameValue = ''
    },

    onKeydown(e) {
      if (e.key !== 'F2' || !this.editMode) return
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const view = this.store.views.find(v => v._id === this.store.currentViewId)
      if (view) { e.preventDefault(); this.startRename(view) }
    },

    // ── Label menu ──────────────────────────────────────────────────────────────

    toggleMenu(view, event) {
      if (this.menuOpenId === view._id) { this.closeMenu(); return }
      this.closeIconPicker()
      const rect = event.currentTarget.getBoundingClientRect()
      this.menuOpenId = view._id
      this.menuPos = { top: rect.bottom + 4, left: Math.max(8, rect.right - 160) }
      document.removeEventListener('click', this._closePickerBound)
      this.$nextTick(() => document.addEventListener('click', this._closePickerBound))
    },

    closeMenu() {
      this.menuOpenId = null
      this.menuPos = null
    },

    onMenuRename() {
      const view = this.menuView
      this.closeMenu()
      if (view) this.startRename(view)
    },

    onMenuIcon(event) {
      const view = this.menuView
      this.closeMenu()
      if (view) this.toggleIconPicker(view, event)
    },

    async onMenuToggleRollup() {
      const view = this.menuView
      this.closeMenu()
      if (view) await this.store.updateView(view._id, { rollUp: !view.rollUp })
    },

    onMenuAddSub() {
      const view = this.menuView
      this.closeMenu()
      if (view) this.startAddView(view._id)
    },

    async onMenuDelete() {
      const view = this.menuView
      this.closeMenu()
      if (!view) return
      if (!confirm(`Delete "${view.name}" and its sub-labels? Notes will be moved to Home.`)) return
      await this.store.deleteView(view)
    },

    toggleCollapse(viewId) {
      if (this.collapsedViews[viewId]) delete this.collapsedViews[viewId]
      else this.collapsedViews[viewId] = true
    },

    startAddView(parentId) {
      this.addingView = true
      this.newViewParentId = parentId
      if (parentId && this.collapsedViews[parentId]) delete this.collapsedViews[parentId]
      this.$nextTick(() => document.querySelector('.add-view-input')?.focus())
    },

    async submitView() {
      if (!this.newViewName.trim()) return
      await this.store.addView(this.newViewName, this.newViewParentId)
      this.cancelView()
    },

    cancelView() {
      this.addingView = false
      this.newViewParentId = null
      this.newViewName = ''
    },

    // ── Drag & drop ────────────────────────────────────────────────────────────

    onExternalDragEnd() {
      this.noteDropTarget = null
    },

    onDragStart(e, view) {
      this.draggedId = view._id
      e.dataTransfer.effectAllowed = 'move'
      // Use a transparent 1px image so the default ghost doesn't show a huge element
      const ghost = document.createElement('div')
      ghost.style.cssText = 'position:fixed;top:-999px;left:-999px;background:#fff;padding:4px 8px;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.2);font-size:0.875rem;white-space:nowrap'
      ghost.textContent = view.name
      document.body.appendChild(ghost)
      e.dataTransfer.setDragImage(ghost, 0, 0)
      requestAnimationFrame(() => document.body.removeChild(ghost))
    },

    onDragEnd() {
      this.draggedId = null
      this.dropTarget = null
      this.noteDropTarget = null
    },

    onDragOver(e, view) {
      // If this is a note being dragged (not a view reorder), handle separately
      if (e.dataTransfer.types.includes('text/note-id')) {
        e.preventDefault()
        this.noteDropTarget = view._id
        return
      }
      // View reorder drag — ignore if not in edit mode
      if (!this.draggedId) return
      e.preventDefault()
      if (view._id === this.draggedId || this.isDescendant(view._id, this.draggedId)) return
      const btn = e.currentTarget.querySelector('.nav-item')
      const rect = btn.getBoundingClientRect()
      const y = e.clientY - rect.top
      const h = rect.height
      let targetId = view._id
      let position = y < h * 0.3 ? 'before' : y > h * 0.7 ? 'after' : 'inside'
      // Convert 'before' into 'after' on the previous item to avoid two lines
      // appearing simultaneously between adjacent views.
      if (position === 'before') {
        const idx = this.visibleViews.findIndex(v => v._id === view._id)
        if (idx > 0) {
          const prev = this.visibleViews[idx - 1]
          if (prev._id !== this.draggedId && !this.isDescendant(prev._id, this.draggedId)) {
            targetId = prev._id
            position = 'after'
          }
        }
      }
      this.dropTarget = { id: targetId, position }
    },

    onDragLeave(e) {
      if (!e.currentTarget.contains(e.relatedTarget)) {
        this.dropTarget = null
        this.noteDropTarget = null
      }
    },

    async onDrop(e, view) {
      e.preventDefault()
      // Always clear indicators first
      const noteId = e.dataTransfer.getData('text/note-id')
      this.noteDropTarget = null
      this.dropTarget = null

      if (noteId) {
        // Note drag dropped onto a label/view
        if (this.store.dragLabelBehavior === 'add') {
          await this.store.addNoteLabel(noteId, view._id)
        } else {
          await this.store.moveNoteToView(noteId, view._id)
        }
        return
      }

      // View reorder drop
      if (!this.draggedId || view._id === this.draggedId) {
        this.draggedId = null
        return
      }
      if (!this.dropTarget) { this.draggedId = null; return }
      await this.store.moveView(this.draggedId, view._id, this.dropTarget.position)
      this.draggedId = null
    },

    async logout() {
      const { useNotesStore } = await import('../stores/notes.js')
      const notesStore = useNotesStore()
      if (!(await notesStore.confirmLogout())) return
      await notesStore.reset({ keepUnsynced: true })
      await this.authStore.logout()
      this.$router.push('/login')
    },

    isDescendant(viewId, ancestorId) {
      let v = this.store.views.find(v => v._id === viewId)
      while (v?.parentId) {
        if (v.parentId === ancestorId) return true
        v = this.store.views.find(v2 => v2._id === v.parentId)
      }
      return false
    },
  },
}
</script>

<style scoped>
.side-menu {
  position: relative;
  width: 180px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  transition: width 0.2s ease;
  overflow: hidden;
  flex-shrink: 0;
}
.side-menu.collapsed { width: 0; border-right: none; }
.side-menu.resizing { transition: none; user-select: none; }

.resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 5px;
  height: 100%;
  cursor: col-resize;
  z-index: 2;
}
.resize-handle:hover,
.side-menu.resizing .resize-handle { background: var(--accent); opacity: 0.4; }

.nav-rename-input {
  flex: 1;
  min-width: 0;
  border: none;
  border-bottom: 2px solid var(--accent);
  outline: none;
  font-family: inherit;
  font-size: 0.9rem;
  padding: 0.1rem 0;
  background: transparent;
  color: var(--text-1);
}

nav { display: flex; flex-direction: column; height: 100%; padding: 0.5rem 0; overflow: hidden; }

.nav-list { list-style: none; margin: 0; padding: 0; }
.nav-list:not(.nav-list--bottom):not(.nav-list--tasks) { flex: 1; overflow-y: auto; min-height: 0; }
.nav-list--bottom { border-top: 1px solid var(--border); padding-top: 0.5rem; }

/* Drop indicators */
.nav-view-li { position: relative; }
.nav-view-li.drop-before::before,
.nav-view-li.drop-after::after {
  content: '';
  position: absolute;
  left: 8px; right: 8px;
  height: 2px;
  background: var(--accent);
  border-radius: 1px;
  z-index: 1;
  pointer-events: none;
}
.nav-view-li.drop-before::before { top: -1px; }
.nav-view-li.drop-after::after   { bottom: -1px; }
.nav-view-li.drop-inside > .nav-item { background: var(--accent-bg); }
.nav-view-li.drop-note > .nav-item  { background: var(--accent-bg); outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 4px; }
.nav-view-li.is-dragging { opacity: 0.4; }

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  width: 100%;
  padding: 0.6rem 0.75rem 0.6rem 0.5rem;
  border: none;
  background: none;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.9rem;
  color: var(--text-2);
  border-radius: 0 999px 999px 0;
  text-align: left;
  white-space: nowrap;
}
.nav-item:hover { background: var(--surface-3); }
.nav-item.active { background: var(--warning-bg); color: var(--warning); font-weight: 500; }
.nav-item--add { color: var(--text-3); }

.nav-grip {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--border-2);
  padding: 0.1rem 0.2rem;
  opacity: 0;
  cursor: grab;
  transition: opacity 0.15s;
}
.nav-item:hover .nav-grip { opacity: 1; }
.nav-grip--spacer { visibility: hidden; cursor: default; }

.nav-chevron {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--text-muted);
  padding: 0.1rem;
  border-radius: 3px;
}
.nav-chevron:not(.invisible):hover { background: var(--surface-3); color: var(--text-2); }
.nav-chevron.invisible { visibility: hidden; pointer-events: none; }
.nav-chevron svg { transition: transform 0.15s; transform: rotate(0deg); }
.nav-chevron.expanded svg { transform: rotate(90deg); }

.nav-icon { display: flex; align-items: center; flex-shrink: 0; color: var(--text-3); }
.nav-icon--editable { cursor: pointer; border-radius: 4px; padding: 1px; }
.nav-icon--editable:hover { background: var(--surface-3); color: var(--text-1); }
.nav-label { flex: 1; overflow: hidden; text-overflow: ellipsis; }

.nav-actions {
  display: flex;
  align-items: center;
  gap: 0.1rem;
  opacity: 0;
  transition: opacity 0.15s;
  flex-shrink: 0;
}
.nav-item:hover .nav-actions { opacity: 1; }

.nav-action {
  display: flex;
  align-items: center;
  color: var(--text-muted);
  padding: 0.2rem 0.3rem;
  border-radius: 50%;
}
.nav-action:hover { background: var(--surface-3); color: var(--text-1); }
.nav-action--delete:hover { background: var(--danger-bg); color: var(--danger); }

.nav-section-row {
  display: flex;
  align-items: center;
  padding-right: 0.5rem;
}
.nav-section-row .nav-section-header { flex: 1; }

.nav-list--tasks { border-top: 1px solid var(--border); padding-top: 0.5rem; }

.nav-edit-toggle {
  display: flex;
  align-items: center;
  border: none;
  background: none;
  cursor: pointer;
  padding: 0.2rem 0.3rem;
  border-radius: 4px;
  color: var(--border-2);
  transition: color 0.15s, background 0.15s;
}
.nav-edit-toggle:hover { background: var(--surface-3); color: var(--text-3); }
.nav-edit-toggle.active { color: var(--accent); }

.add-view-form { padding: 0.4rem 1rem; }
.add-view-input {
  width: 100%;
  border: none;
  border-bottom: 2px solid var(--accent);
  outline: none;
  font-family: inherit;
  font-size: 0.9rem;
  padding: 0.3rem 0;
  background: transparent;
  color: var(--text-1);
}

.nav-section-li { list-style: none; }

.nav-section-header {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  width: 100%;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.6rem 0.75rem 0.1rem;
  color: var(--text-muted);
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-family: inherit;
  font-weight: inherit;
  white-space: nowrap;
  border-radius: 4px;
}
.nav-section-header:hover { color: var(--text-3); }

.nav-section-chevron {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.nav-section-chevron svg { transition: transform 0.15s; transform: rotate(0deg); }
.nav-section-chevron.expanded svg { transform: rotate(90deg); }


.nav-badge {
  font-size: 0.68rem;
  background: var(--accent-bg);
  color: var(--accent-text);
  border-radius: 999px;
  padding: 0.05rem 0.4rem;
  min-width: 1.25rem;
  text-align: center;
  flex-shrink: 0;
}
.nav-badge--danger { background: var(--danger-bg); color: var(--danger); }

@media (max-width: 640px) {
  .side-menu {
    position: fixed !important;
    top: 0;
    left: 0;
    height: 100dvh;
    /* Above in-page content (calendar header, FAB, etc.) and its backdrop (199). */
    z-index: 250;
    width: 280px !important;
    transform: translateX(-100%);
    transition: transform 0.25s ease, box-shadow 0.25s ease;
    box-shadow: none;
  }

  .side-menu:not(.collapsed) {
    transform: translateX(0);
    box-shadow: 4px 0 24px rgba(0,0,0,.18);
  }

  .resize-handle { display: none; }

  /* No hover on touch — reveal the drag grip and the label-options (⋮) button
     whenever they're rendered (edit mode) so they're tappable. */
  .nav-grip,
  .nav-actions { opacity: 1; }
}
</style>

<style>
.label-menu-float {
  position: fixed;
  z-index: 9999;
  min-width: 160px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.13);
  padding: 4px;
}
.label-menu-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  border: none;
  background: none;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.85rem;
  color: var(--text-2);
  text-align: left;
  padding: 0.45rem 0.5rem;
  border-radius: 5px;
}
.label-menu-item:hover { background: var(--surface-3); color: var(--text-1); }
.label-menu-item--delete:hover { background: var(--danger-bg); color: var(--danger); }
.label-menu-item .invisible { visibility: hidden; }

.icon-picker-float {
  position: fixed;
  z-index: 9999;
  transform: translateY(-50%);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.13);
  padding: 6px;
}
.icon-picker-float::before {
  content: '';
  position: absolute;
  left: -5px;
  top: 50%;
  transform: translateY(-50%) rotate(45deg);
  width: 9px;
  height: 9px;
  background: var(--surface);
  border-left: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.icon-picker-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 3px;
}
.icon-picker-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-3);
  transition: background 0.1s, color 0.1s;
}
.icon-picker-btn:hover { background: var(--surface-3); color: var(--text-1); }
.icon-picker-btn.active { background: var(--accent-bg); color: var(--accent-text); }
</style>
