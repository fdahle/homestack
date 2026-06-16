<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="close">
      <div
        class="modal"
        :style="editColor ? { background: editColor } : {}"
        @keydown.escape="close"
        @click="closePopups"
      >

        <!-- Title row with three-dot menu -->
        <div class="modal-title-row" @click.stop>
          <span v-if="effectiveIsTask" class="task-status-icon" :class="{ done: editDone }" @click="toggleDone" title="Toggle done">
            <AppIcon :name="editDone ? 'circle-check' : 'circle'" :size="16" />
          </span>
          <input
            v-model="editTitle"
            class="modal-title-input"
            :class="{ 'title-done': effectiveIsTask && editDone }"
            placeholder="Title"
            :readonly="inTrash"
          />
          <div v-if="!inTrash" class="toolbar-dropdown-wrap">
            <button class="toolbar-btn" title="More options" @click.stop="toggleDropdown('moreMenuOpen')">
              <AppIcon name="more-vertical" :size="18" />
            </button>
            <div v-if="moreMenuOpen" class="dropdown-panel dropdown-panel-right">
              <button class="dropdown-item" @click="togglePin">{{ note.pinned ? 'Unpin' : 'Pin' }}</button>
              <button class="dropdown-item" @click="duplicateNote">Duplicate</button>
              <button class="dropdown-item" :disabled="editContentType === 'markdown'" @click="toggleCheckboxMode">{{ editContentType === 'checklist' ? 'Disable checkboxes' : 'Enable checkboxes' }}</button>
              <button class="dropdown-item" :disabled="editContentType === 'checklist'" @click="toggleMarkdownMode">{{ editContentType === 'markdown'  ? 'Disable markdown'  : 'Enable markdown'  }}</button>
              <button class="dropdown-item danger" @click="deleteNote">Move to trash</button>
            </div>
          </div>
        </div>

        <!-- Editor / preview with timestamp overlay -->
        <div class="editor-wrap" @paste="handleEditorPaste">
          <div v-if="pasteImageWarning" class="paste-warn">Images are not supported in checkbox mode.</div>
          <template v-if="!inTrash">
            <MarkdownEditor
              v-if="editContentType === 'markdown'"
              ref="mdEditor"
              v-model="editContent"
            />
            <ChecklistEditor
              v-else-if="editContentType === 'checklist'"
              v-model="editContent"
            />
            <textarea
              v-else
              v-model="editContent"
              class="plain-editor"
              placeholder="Note…"
            />
          </template>
          <div v-else class="modal-preview" v-html="renderedContent" />
          <span
            v-if="timestampLabel"
            class="note-timestamp"
            :title="timestampTitle"
          >{{ timestampLabel }}</span>
        </div>

        <!-- Bottom bar -->
        <div class="modal-bottom-bar">
          <template v-if="!inTrash">
            <!-- Task toggle -->
            <button
              class="toolbar-btn"
              :class="{ 'toolbar-btn--active': effectiveIsTask }"
              :title="effectiveIsTask ? (editIsTask ? 'Remove task flag' : 'Task (auto-detected via due date)') : 'Mark as task'"
              @click.stop="toggleTaskFlag"
            >
              <AppIcon name="task-check" :size="18" />
            </button>

            <!-- Color -->
            <div class="toolbar-dropdown-wrap">
              <button
                class="toolbar-btn"
                :class="{ 'toolbar-btn--tinted': editColor }"
                title="Color"
                @click.stop="toggleDropdown('colorOpen')"
              >
                <AppIcon name="palette" :size="18" />
              </button>
              <ColorPicker
                v-if="colorOpen"
                :model-value="editColor"
                @update:model-value="onColorChange"
              />
            </div>

            <!-- Notification / reminder -->
            <div class="toolbar-dropdown-wrap">
              <button
                class="toolbar-btn"
                :class="{ 'toolbar-btn--active': editNotification }"
                title="Reminder"
                @click.stop="toggleDropdown('notifOpen')"
              >
                <AppIcon name="bell" :size="18" />
                <span v-if="editNotification" class="toolbar-notif-dot" />
              </button>
              <template v-if="notifOpen">
                <div v-if="store.notificationPermission === 'denied'" class="dropdown-panel dropdown-panel-up np-panel" @click.stop>
                  <p class="np-blocked">Notifications blocked. Enable them in your browser settings.</p>
                </div>
                <NotificationPicker
                  v-else
                  :model-value="editNotification"
                  @update:model-value="onNotifChange"
                />
              </template>
            </div>

            <!-- View assignment -->
            <div class="toolbar-dropdown-wrap">
              <button class="toolbar-btn" :class="{ active: viewDropdownOpen }" title="Move to view" @click.stop="toggleDropdown('viewDropdownOpen')">
                <AppIcon name="layers" :size="18" />
              </button>
              <div v-if="viewDropdownOpen" class="dropdown-panel dropdown-panel-up">
                <p class="np-label dropdown-title">Move to</p>
                <button class="dropdown-item" :class="{ selected: editViewId === null && editLabels.length === 0 }" @click="setHome()">Home</button>
                <button
                  v-for="v in store.flatViewTree"
                  :key="v._id"
                  class="dropdown-item"
                  :class="{ selected: isViewAssigned(v._id) }"
                  :style="{ paddingLeft: (1 + v.depth * 0.75) + 'rem' }"
                  @click="toggleViewAssignment(v._id)"
                >{{ v.name }}</button>
              </div>
            </div>

            <!-- Task-specific icons -->
            <template v-if="effectiveIsTask">
              <span class="toolbar-sep" />

              <!-- Due date -->
              <div class="toolbar-dropdown-wrap">
                <button
                  class="toolbar-btn"
                  :class="{ 'toolbar-btn--active': editDueDate }"
                  title="Due date"
                  @click.stop="toggleDropdown('dueDateOpen')"
                >
                  <AppIcon name="calendar" :size="18" />
                  <span v-if="editDueDate" class="toolbar-notif-dot" />
                </button>
                <div v-if="dueDateOpen" class="dropdown-panel dropdown-panel-up np-panel" @click.stop>
                  <p class="np-label">Due date</p>
                  <input type="date" v-model="editDueDate" class="np-input" />
                  <div class="np-actions">
                    <button v-if="editDueDate" class="np-btn np-btn--remove" @click="editDueDate = null; dueDateOpen = false">Remove</button>
                    <button class="np-btn np-btn--set" @click="dueDateOpen = false">Done</button>
                  </div>
                </div>
              </div>

              <!-- Priority -->
              <div class="toolbar-dropdown-wrap">
                <button
                  class="toolbar-btn"
                  :class="{ 'toolbar-btn--active': editPriority }"
                  :title="editPriority ? `Priority: ${editPriority}` : 'Set priority'"
                  @click.stop="toggleDropdown('priorityOpen')"
                >
                  <AppIcon name="flag" :size="18" />
                  <span v-if="editPriority" class="priority-dot" :class="`priority-dot--${editPriority}`" />
                </button>
                <div v-if="priorityOpen" class="dropdown-panel dropdown-panel-up" @click.stop>
                  <p class="np-label dropdown-title">Priority</p>
                  <button class="dropdown-item priority-item" :class="{ selected: editPriority === 'high' }" @click="setPriority('high')">
                    <span class="priority-dot priority-dot--high" /> High
                  </button>
                  <button class="dropdown-item priority-item" :class="{ selected: editPriority === 'medium' }" @click="setPriority('medium')">
                    <span class="priority-dot priority-dot--medium" /> Medium
                  </button>
                  <button class="dropdown-item priority-item" :class="{ selected: editPriority === 'low' }" @click="setPriority('low')">
                    <span class="priority-dot priority-dot--low" /> Low
                  </button>
                  <button v-if="editPriority" class="dropdown-item danger" @click="setPriority(null)">Remove priority</button>
                </div>
              </div>

              <!-- Recurrence -->
              <div class="toolbar-dropdown-wrap">
                <button
                  class="toolbar-btn"
                  :class="{ 'toolbar-btn--active': editRecurrence }"
                  :title="editRecurrence ? `Repeats ${editRecurrence}` : 'Set recurrence'"
                  @click.stop="toggleDropdown('recurrenceOpen')"
                >
                  <AppIcon name="refresh" :size="18" />
                  <span v-if="editRecurrence" class="toolbar-notif-dot" />
                </button>
                <div v-if="recurrenceOpen" class="dropdown-panel dropdown-panel-up" @click.stop>
                  <p class="np-label dropdown-title">Repeat</p>
                  <button class="dropdown-item" :class="{ selected: editRecurrence === 'daily' }"   @click="editRecurrence = 'daily';   recurrenceOpen = false">Daily</button>
                  <button class="dropdown-item" :class="{ selected: editRecurrence === 'weekly' }"  @click="editRecurrence = 'weekly';  recurrenceOpen = false">Weekly</button>
                  <button class="dropdown-item" :class="{ selected: editRecurrence === 'monthly' }" @click="editRecurrence = 'monthly'; recurrenceOpen = false">Monthly</button>
                  <button v-if="editRecurrence" class="dropdown-item danger" @click="editRecurrence = null; recurrenceOpen = false">Remove</button>
                </div>
              </div>
            </template>
          </template>
          <template v-else>
            <button class="btn-restore" @click="restore">Restore</button>
            <button class="btn-danger" @click="permanentlyDelete">Delete forever</button>
          </template>
          <button class="btn-close" @click="close">Close</button>
        </div>

      </div>
    </div>
  </Teleport>
</template>

<script>
import { useNotesStore } from '../stores/notes.js'
import { renderPlain, renderChecklist, renderCheckableMarkdown, sortCheckboxItems } from '../utils/markdown.js'
import MarkdownEditor from './MarkdownEditor.vue'
import ChecklistEditor from './ChecklistEditor.vue'

function hasCheckboxSyntax(text) {
  return /^\s*- \[[ xX]\] /m.test(text || '')
}
import ColorPicker from './ColorPicker.vue'
import NotificationPicker from './NotificationPicker.vue'

export default {
  name: 'NoteModal',

  components: { MarkdownEditor, ChecklistEditor, ColorPicker, NotificationPicker },

  props: {
    note: { type: Object, required: true },
  },

  emits: ['close'],

  setup() {
    return { store: useNotesStore() }
  },

  data() {
    return {
      editTitle:        this.note.title          ?? '',
      editContent:      this.note.content        ?? '',
      editViewId:       this.note.viewId         ?? null,
      editLabels:       Array.isArray(this.note.labels) ? [...this.note.labels] : [],
      editColor:        this.note.color          ?? null,
      editNotification: this.note.notificationAt ?? null,
      editIsTask:       this.note.isTask         ?? false,
      editDueDate:      this.note.dueDate        ?? null,
      editPriority:     this.note.priority       ?? null,
      editDone:         this.note.done           ?? false,
      editContentType:  this.note.contentType    ?? (hasCheckboxSyntax(this.note.content) ? 'checklist' : 'plain'),
      editRecurrence:   this.note.recurrence     ?? null,
      viewDropdownOpen: false,
      moreMenuOpen:     false,
      colorOpen:        false,
      notifOpen:        false,
      dueDateOpen:      false,
      priorityOpen:     false,
      recurrenceOpen:   false,
      pasteImageWarning: false,
    }
  },

  mounted() {
    this._globalClose = () => {
      this.viewDropdownOpen = false
      this.moreMenuOpen     = false
      this.colorOpen        = false
      this.notifOpen        = false
      this.dueDateOpen      = false
      this.priorityOpen     = false
      this.recurrenceOpen   = false
    }
    window.addEventListener('click', this._globalClose)
  },

  beforeUnmount() {
    window.removeEventListener('click', this._globalClose)
  },

  computed: {
    inTrash() {
      return !!this.note.deletedAt
    },
    effectiveIsTask() {
      return this.editIsTask || !!this.editDueDate
    },
    renderedContent() {
      return this.editContentType === 'checklist' ? renderChecklist(this.editContent)
           : this.editContentType === 'markdown'  ? renderCheckableMarkdown(this.editContent)
           : renderPlain(this.editContent)
    },
    timestampLabel() {
      const isEdited = !!this.note.updatedAt
      const ts = this.note.updatedAt || this.note.createdAt
      if (!ts) return null
      const date = new Date(ts)
      const today = new Date()
      const isToday = date.toDateString() === today.toDateString()
      const prefix = isEdited ? 'Edited' : 'Created'
      if (isToday) {
        return `${prefix} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      }
      return `${prefix} ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
    },
    timestampTitle() {
      const ts = this.note.updatedAt || this.note.createdAt
      if (!ts) return ''
      const date = new Date(ts)
      const isToday = date.toDateString() === new Date().toDateString()
      if (isToday) return ''
      return date.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    },
  },

  methods: {
    async close() {
      if (!this.inTrash) {
        const titleChanged       = this.editTitle.trim()    !== (this.note.title       ?? '')
        const contentChanged     = this.editContent.trim()  !== (this.note.content     ?? '')
        const viewChanged        = this.editViewId          !== (this.note.viewId      ?? null)
        const origLabels         = Array.isArray(this.note.labels) ? [...this.note.labels].sort() : []
        const labelsChanged      = JSON.stringify(origLabels) !== JSON.stringify([...this.editLabels].sort())
        const taskChanged        = this.editIsTask          !== (this.note.isTask      ?? false)
        const dueDateChanged     = this.editDueDate         !== (this.note.dueDate     ?? null)
        const priorityChanged    = this.editPriority        !== (this.note.priority    ?? null)
        const doneChanged        = this.editDone            !== (this.note.done        ?? false)
        const contentTypeChanged = this.editContentType     !== (this.note.contentType ?? 'plain')
        const recurrenceChanged  = this.editRecurrence      !== (this.note.recurrence  ?? null)

        if (titleChanged || contentChanged || viewChanged || labelsChanged || taskChanged || dueDateChanged || priorityChanged || doneChanged || contentTypeChanged || recurrenceChanged) {
          await this.store.updateNote(this.note, {
            title:       this.editTitle,
            content:     this.editContentType === 'checklist' ? sortCheckboxItems(this.editContent) : this.editContent,
            viewId:      this.editViewId,
            labels:      this.editLabels,
            isTask:      this.editIsTask,
            dueDate:     this.editDueDate,
            priority:    this.editPriority,
            done:        this.editDone,
            contentType: this.editContentType,
            recurrence:  this.editRecurrence,
          })
        }
      }
      this.$emit('close')
    },

    closePopups() {
      this.colorOpen        = false
      this.notifOpen        = false
      this.viewDropdownOpen = false
      this.moreMenuOpen     = false
      this.dueDateOpen      = false
      this.priorityOpen     = false
      this.recurrenceOpen   = false
    },

    toggleDropdown(name) {
      const was = this[name]
      this.closePopups()
      this[name] = !was
    },

    toggleTaskFlag() {
      // Only toggle the explicit flag; if auto-detected via dueDate, clear dueDate too
      if (this.effectiveIsTask && !this.editIsTask) {
        // Auto-detected: clearing the due date removes task status
        this.editDueDate = null
      } else {
        this.editIsTask = !this.editIsTask
      }
    },

    toggleDone() {
      this.editDone = !this.editDone
    },

    setPriority(value) {
      this.editPriority = value
      this.priorityOpen = false
    },

    async onColorChange(color) {
      this.editColor = color
      this.colorOpen = false
      await this.store.updateNoteColor(this.note, color)
    },

    async onNotifChange(iso) {
      this.editNotification = iso
      if (iso) this.notifOpen = false   // keep open when removing so user sees result
      await this.store.updateNoteNotification(this.note, iso)
    },

    async deleteNote() {
      await this.store.deleteNote(this.note)
      this.$emit('close')
    },

    async restore() {
      await this.store.restoreNote(this.note)
      this.$emit('close')
    },

    async permanentlyDelete() {
      await this.store.permanentlyDelete(this.note)
      this.$emit('close')
    },

    setHome() {
      this.editViewId = null
      this.editLabels = []
      this.viewDropdownOpen = false
    },

    isViewAssigned(viewId) {
      return this.editViewId === viewId || this.editLabels.includes(viewId)
    },

    toggleViewAssignment(viewId) {
      if (this.editViewId === viewId) {
        // Remove primary; promote first extra label, if any
        const [first, ...rest] = this.editLabels
        this.editViewId = first ?? null
        this.editLabels = rest
      } else if (this.editLabels.includes(viewId)) {
        this.editLabels = this.editLabels.filter(id => id !== viewId)
      } else {
        if (!this.editViewId) {
          this.editViewId = viewId
        } else {
          this.editLabels = [...this.editLabels, viewId]
        }
      }
    },

    async togglePin() {
      await this.store.pinNote(this.note)
    },

    async duplicateNote() {
      await this.store.duplicateNote(this.note)
      this.$emit('close')
    },

    toggleCheckboxMode() {
      if (this.editContentType === 'checklist') {
        // Strip checkbox prefixes from every line
        this.editContent = (this.editContent || '').replace(/^(\s*)- \[[ xX]\] /gm, '$1')
        this.editContentType = 'plain'
      } else {
        const lines = (this.editContent || '').split('\n')
        this.editContent = lines.map(line => {
          if (/^- \[[ xX]\] /.test(line)) return line
          const ulMatch = line.match(/^(\s*)[\-\*\+] (.*)$/)
          if (ulMatch) return `${ulMatch[1]}- [ ] ${ulMatch[2]}`
          const olMatch = line.match(/^(\s*)\d+\.\s+(.*)$/)
          if (olMatch) return `${olMatch[1]}- [ ] ${olMatch[2]}`
          if (line.trim() !== '') return `- [ ] ${line}`
          return line
        }).join('\n')
        this.editContentType = 'checklist'
      }
      this.moreMenuOpen = false
    },

    toggleMarkdownMode() {
      this.editContentType = this.editContentType === 'markdown' ? 'plain' : 'markdown'
      this.moreMenuOpen = false
    },

    handleEditorPaste(event) {
      if (this.editContentType === 'markdown') return
      const items = event.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          event.preventDefault()
          if (this.editContentType === 'checklist') {
            this.pasteImageWarning = true
            setTimeout(() => { this.pasteImageWarning = false }, 3000)
            return
          }
          const file = item.getAsFile()
          this.editContentType = 'markdown'
          this.$nextTick(() => { this.$refs.mdEditor?.insertImage(file) })
          return
        }
      }
    },
  },
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  animation: backdrop-in 0.2s ease forwards;
}

@keyframes backdrop-in {
  from { background: rgba(0,0,0,0); }
  to   { background: rgba(0,0,0,.45); }
}

@keyframes modal-expand {
  from {
    opacity: 0;
    transform: scale(0.82);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.modal {
  background: var(--surface);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,.25);
  padding: 1rem;
  width: 100%;
  max-width: 620px;
  min-height: 16rem;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  transition: background 0.15s;
  animation: modal-expand 0.22s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.modal-title-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.4rem;
}

.task-status-icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0.1rem;
  border-radius: 50%;
  transition: color 0.12s;
}
.task-status-icon:hover { color: var(--accent); }
.task-status-icon.done  { color: var(--success); }

.modal-title-input {
  border: none;
  outline: none;
  flex: 1;
  font-size: 1.1rem;
  font-weight: 600;
  font-family: inherit;
  background: transparent;
  color: var(--text-1);
}
.title-done {
  text-decoration: line-through;
  color: var(--text-muted);
}

.editor-wrap {
  position: relative;
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.paste-warn {
  font-size: 0.8rem;
  color: var(--warning, #e09000);
  background: var(--warning-bg, rgba(224,144,0,.12));
  border-radius: 4px;
  padding: 0.3rem 0.6rem;
  margin-bottom: 0.4rem;
}

.plain-editor {
  width: 100%;
  min-height: 8rem;
  border: none;
  outline: none;
  resize: none;
  font-size: 0.95rem;
  line-height: 1.7;
  color: var(--text-2);
  font-family: inherit;
  background: transparent;
  padding: 0.25rem 0;
  box-sizing: border-box;
}

.modal-preview {
  min-height: 6rem;
  font-size: 0.95rem;
  line-height: 1.7;
  color: var(--text-muted);
}

/* Task list styling inside trash preview */
.modal-preview :deep(.task-item) {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
}
.modal-preview :deep(.task-item input[type="checkbox"]) {
  flex-shrink: 0;
  pointer-events: none;
}
.modal-preview :deep(.task-item--first-checked) {
  border-top: 1px dashed var(--border-2);
  margin-top: 0.4rem;
  padding-top: 0.4rem;
}
.modal-preview :deep(.task-item--checked) {
  color: var(--text-muted);
}
.modal-preview :deep(.task-item--checked input[type="checkbox"]) {
  opacity: 0.5;
}
.modal-preview :deep(.task-item--checked) > *:not(input),
.modal-preview :deep(.task-item--checked) > p {
  text-decoration: line-through;
  text-decoration-color: var(--text-muted);
}

.note-timestamp {
  position: absolute;
  bottom: 0.4rem;
  right: 0.5rem;
  font-size: 0.72rem;
  color: var(--text-muted);
  pointer-events: auto;
  cursor: default;
  user-select: none;
}

.modal-bottom-bar {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding-top: 0.25rem;
  border-top: 1px solid var(--border);
}

.toolbar-btn {
  position: relative;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.4rem;
  border-radius: 4px;
  color: var(--text-3);
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
.toolbar-btn:hover,
.toolbar-btn.active      { background: var(--surface-3); }
.toolbar-btn--tinted     { color: var(--text-1); }
.toolbar-btn--active svg { stroke: var(--accent); }

/* Blue dot on the bell when a notification is active */
.toolbar-notif-dot {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  border: 1.5px solid var(--surface);
}

/* Colored dot on the priority flag */
.priority-dot {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: 1.5px solid var(--surface);
}
.priority-dot--high   { background: var(--danger); }
.priority-dot--medium { background: var(--warning); }
.priority-dot--low    { background: var(--success); }

/* Inline priority dot in dropdown */
.priority-item { display: flex; align-items: center; gap: 0.5rem; }
.priority-item .priority-dot {
  position: static;
  border: none;
  flex-shrink: 0;
}

.toolbar-dropdown-wrap {
  position: relative;
}

.dropdown-panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0,0,0,.14);
  min-width: 140px;
  z-index: 200;
  padding: 0.25rem 0;
}

.dropdown-panel-right {
  left: auto;
  right: 0;
}

.dropdown-panel-up {
  top: auto;
  bottom: calc(100% + 4px);
}

.dropdown-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: 0.45rem 1rem;
  font-size: 0.875rem;
  font-family: inherit;
  cursor: pointer;
  color: var(--text-1);
}
.dropdown-item:hover { background: var(--surface-3); }
.dropdown-item:disabled { opacity: 0.4; cursor: default; }
.dropdown-item:disabled:hover { background: none; }
.dropdown-item.selected { font-weight: 600; }
.dropdown-item.danger { color: var(--danger); }
.dropdown-item.danger:hover { background: var(--danger-bg); }

/* Notification / due-date picker panel */
.np-panel { padding: 0.75rem; min-width: 220px; }
.np-label {
  margin: 0 0 4px;
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.np-input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.35rem 0.6rem;
  font-size: 0.875rem;
  font-family: inherit;
  outline: none;
  background: var(--surface);
  color: var(--text-1);
}
.np-input:focus { border-color: var(--accent); }
.np-actions { display: flex; gap: 0.4rem; margin-top: 0.5rem; justify-content: flex-end; }
.np-btn {
  border: none;
  border-radius: 4px;
  padding: 0.3rem 0.75rem;
  font-size: 0.8rem;
  font-family: inherit;
  cursor: pointer;
  font-weight: 500;
}
.np-btn--remove { background: transparent; color: var(--danger); }
.np-btn--remove:hover { background: var(--danger-bg); }
.np-btn--set { background: var(--accent); color: #fff; }
.np-btn--set:hover { background: var(--accent-h); }

.np-blocked {
  font-size: 0.8rem;
  color: var(--danger);
  padding: 0.25rem 0;
  margin: 0;
}

.dropdown-title {
  padding: 0.3rem 1rem 0;
  margin: 0 0 4px;
}

.toolbar-sep {
  width: 1px;
  height: 18px;
  background: rgba(0,0,0,.12);
  margin: 0 0.1rem;
  align-self: center;
  flex-shrink: 0;
}


.btn-close,
.btn-restore,
.btn-danger {
  border: none;
  border-radius: 4px;
  padding: 0.4rem 1rem;
  font-size: 0.875rem;
  cursor: pointer;
  font-family: inherit;
  font-weight: 500;
}

.btn-close   { background: transparent; color: var(--text-3); margin-left: auto; }
.btn-close:hover { background: var(--surface-3); }

.btn-restore { background: var(--success-bg); color: var(--success); }
.btn-restore:hover { filter: brightness(0.92); }

.btn-danger  { background: transparent; color: var(--danger); }
.btn-danger:hover { background: var(--danger-bg); }

@media (max-width: 640px) {
  .modal-backdrop {
    align-items: flex-start;
    padding: 0;
  }

  .modal {
    max-width: 100%;
    min-height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
    animation: none;
  }

  .editor-wrap {
    flex: 1;
  }

  .plain-editor {
    min-height: 0;
    height: 100%;
  }
}
</style>
