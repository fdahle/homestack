<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="close">
      <div
        class="modal"
        :class="{ 'modal--drag': dragOver }"
        :style="editColor ? { background: editColor } : {}"
        @click="closePopups"
        @dragstart="onContentDragStart"
        @dragenter.prevent="onDragEnter"
        @dragover.prevent
        @dragleave="onDragLeave"
        @drop.prevent="onDrop"
      >
        <!-- Drag-to-attach overlay -->
        <div v-if="dragOver && !inTrash" class="modal-drop-overlay">
          <AppIcon name="paperclip" :size="28" />
          <span>Drop files to attach</span>
        </div>


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
        </div>

        <!-- Scratch pad — hidden until toggled from the toolbar -->
        <div v-if="scratchOpen" class="scratch-section" @click.stop>
          <div class="scratch-label-row">
            <AppIcon name="edit" :size="12" />
            <span class="scratch-title">Scratch pad</span>
          </div>
          <textarea
            v-model="editScratch"
            class="scratch-editor"
            placeholder="Working notes, links, sub-steps…"
            :readonly="inTrash"
          />
        </div>

        <!-- Attachment bar -->
        <div v-if="editAttachments.length || attachError" class="attach-bar" @click.stop>
          <div v-if="attachError" class="attach-error">{{ attachError }}</div>
          <div v-if="editAttachments.length" class="attach-row">
            <div
              v-for="att in editAttachments"
              :key="att.id"
              class="attach-item"
              :title="att.name"
              @click="openAttachment(att)"
            >
              <img
                v-if="isImage(att) && attachmentUrl(att)"
                class="attach-thumb"
                :src="attachmentUrl(att)"
                :alt="att.name"
              />
              <FileTypeIcon v-else-if="!isImage(att)" :name="att.name" :type="att.type" :size="44" />
              <button
                v-if="!inTrash"
                class="attach-remove"
                title="Remove"
                @click.stop="removeAttachment(att)"
              >
                <AppIcon name="x" :size="12" />
              </button>
            </div>
          </div>
        </div>

        <!-- Timestamp row (below attachments) -->
        <div v-if="timestampLabel" class="note-timestamp-row">
          <span class="note-timestamp" :title="timestampTitle">{{ timestampLabel }}</span>
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

            <!-- Attach file -->
            <button
              class="toolbar-btn"
              title="Attach image or file"
              @click.stop="triggerAttachInput"
            >
              <AppIcon name="paperclip" :size="18" />
            </button>
            <input
              ref="attachInput"
              type="file"
              multiple
              style="display: none"
              @change="onAttachFilesSelected"
            />

            <!-- Scratch pad toggle -->
            <button
              class="toolbar-btn"
              :class="{ 'toolbar-btn--active': scratchOpen }"
              title="Scratch pad"
              @click.stop="scratchOpen = !scratchOpen"
            >
              <AppIcon name="edit" :size="18" />
              <span v-if="editScratch.trim()" class="toolbar-notif-dot" />
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

  <!-- Image lightbox (in-app preview) -->
  <Teleport to="body">
    <div v-if="lightboxUrl" class="lightbox-backdrop" @click="closeLightbox">
      <button class="lightbox-close" title="Close" @click.stop="closeLightbox">
        <AppIcon name="x" :size="22" />
      </button>
      <img class="lightbox-img" :src="lightboxUrl" :alt="lightboxAlt" @click.stop />
    </div>
  </Teleport>
</template>

<script>
import { useNotesStore } from '../stores/notes.js'
import { renderPlain, renderChecklist, renderCheckableMarkdown, sortCheckboxItems } from '../utils/markdown.js'
import { isImageType } from '../utils/attachments.js'
import MarkdownEditor from './MarkdownEditor.vue'
import ChecklistEditor from './ChecklistEditor.vue'
import FileTypeIcon from './FileTypeIcon.vue'

function hasCheckboxSyntax(text) {
  return /^\s*- \[[ xX]\] /m.test(text || '')
}
import ColorPicker from './ColorPicker.vue'
import NotificationPicker from './NotificationPicker.vue'

export default {
  name: 'NoteModal',

  components: { MarkdownEditor, ChecklistEditor, ColorPicker, NotificationPicker, FileTypeIcon },

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
      editScratch:      this.note.scratch        ?? '',
      scratchOpen:      !!(this.note.scratch || '').trim(),
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
      editAttachments:  Array.isArray(this.note.attachments) ? [...this.note.attachments] : [],
      attachError:      null,
      dragOver:         false,
      dragDepth:        0,
      lightboxUrl:      null,
      lightboxAlt:      '',
      viewDropdownOpen: false,
      moreMenuOpen:     false,
      colorOpen:        false,
      notifOpen:        false,
      dueDateOpen:      false,
      priorityOpen:     false,
      recurrenceOpen:   false,
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

    this._globalKeydown = (e) => {
      if (e.key === 'Escape') this.onEscape()
    }
    window.addEventListener('keydown', this._globalKeydown)
  },

  beforeUnmount() {
    window.removeEventListener('click', this._globalClose)
    window.removeEventListener('keydown', this._globalKeydown)
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
        const scratchChanged     = this.editScratch.trim()  !== (this.note.scratch     ?? '')
        const viewChanged        = this.editViewId          !== (this.note.viewId      ?? null)
        const origLabels         = Array.isArray(this.note.labels) ? [...this.note.labels].sort() : []
        const labelsChanged      = JSON.stringify(origLabels) !== JSON.stringify([...this.editLabels].sort())
        const taskChanged        = this.editIsTask          !== (this.note.isTask      ?? false)
        const dueDateChanged     = this.editDueDate         !== (this.note.dueDate     ?? null)
        const priorityChanged    = this.editPriority        !== (this.note.priority    ?? null)
        const doneChanged        = this.editDone            !== (this.note.done        ?? false)
        const contentTypeChanged = this.editContentType     !== (this.note.contentType ?? 'plain')
        const recurrenceChanged  = this.editRecurrence      !== (this.note.recurrence  ?? null)

        if (titleChanged || contentChanged || scratchChanged || viewChanged || labelsChanged || taskChanged || dueDateChanged || priorityChanged || doneChanged || contentTypeChanged || recurrenceChanged) {
          await this.store.updateNote(this.note, {
            title:       this.editTitle,
            content:     this.editContentType === 'checklist' ? sortCheckboxItems(this.editContent) : this.editContent,
            scratch:     this.editScratch,
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
      // In markdown mode the editor handles image paste inline itself.
      if (this.editContentType === 'markdown' || this.inTrash) return
      const items = event.clipboardData?.items
      if (!items) return
      const files = []
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
      if (files.length) {
        event.preventDefault()
        this.addFiles(files)
      }
    },

    // Block dragging any image that's already in the note (attachment thumbnail,
    // editor image, or preview image). Otherwise it can be dragged and dropped
    // back into the editor, duplicating it.
    onContentDragStart(event) {
      if (event.target instanceof HTMLImageElement) event.preventDefault()
    },

    onDragEnter(event) {
      if (this.inTrash) return
      // Only react to file drags, not text/element drags within the modal.
      if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return
      this.dragDepth++
      this.dragOver = true
    },

    onDragLeave() {
      if (this.dragDepth > 0) this.dragDepth--
      if (this.dragDepth === 0) this.dragOver = false
    },

    onDrop(event) {
      this.dragDepth = 0
      this.dragOver = false
      if (this.inTrash) return
      const files = Array.from(event.dataTransfer?.files || [])
      if (!files.length) return
      // In markdown mode, images go inline in the text; everything else attaches.
      if (this.editContentType === 'markdown') {
        const images = files.filter(f => f.type.startsWith('image/'))
        const others = files.filter(f => !f.type.startsWith('image/'))
        images.forEach(f => this.$refs.mdEditor?.insertImage(f))
        if (others.length) this.addFiles(others)
      } else {
        this.addFiles(files)
      }
    },

    onEscape() {
      if (this.lightboxUrl) { this.closeLightbox(); return }
      this.close()
    },

    openLightbox(url, alt) {
      this.lightboxUrl = url
      this.lightboxAlt = alt || ''
    },

    closeLightbox() {
      this.lightboxUrl = null
      this.lightboxAlt = ''
    },

    triggerAttachInput() {
      this.$refs.attachInput?.click()
    },

    onAttachFilesSelected(event) {
      const files = Array.from(event.target.files || [])
      if (files.length) this.addFiles(files)
      event.target.value = ''
    },

    async addFiles(files) {
      this.attachError = null
      for (const file of files) {
        try {
          const meta = await this.store.addAttachment(this.note, file)
          this.editAttachments.push(meta)
        } catch (err) {
          this.attachError = err?.message || 'Could not attach file.'
        }
      }
    },

    async removeAttachment(att) {
      this.editAttachments = this.editAttachments.filter(a => a.id !== att.id)
      try {
        await this.store.removeAttachment(this.note, att.id)
      } catch (err) {
        this.attachError = err?.message || 'Could not remove attachment.'
      }
    },

    isImage(att) {
      return isImageType(att.type)
    },

    attachmentUrl(att) {
      return this.store.getAttachmentUrl(this.note._id, att.id)
    },

    async openAttachment(att) {
      const url = this.store.getAttachmentUrl(this.note._id, att.id)
        || await this.store.loadAttachmentUrl(this.note._id, att.id)
      if (!url) return
      if (this.isImage(att)) {
        this.openLightbox(url, att.name)
      } else {
        const a = document.createElement('a')
        a.href = url
        a.download = att.name || 'attachment'
        document.body.appendChild(a)
        a.click()
        a.remove()
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

/* Drag-to-attach overlay covering the whole modal */
.modal--drag { position: relative; }
.modal-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 300;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border-radius: 8px;
  border: 2px dashed var(--accent);
  background: var(--accent-bg, rgba(0,120,255,.10));
  color: var(--accent);
  font-size: 0.95rem;
  font-weight: 600;
  pointer-events: none;
}

/* Attachment bar — no hard top border (toolbar already has one); just spacing */
.attach-bar {
  flex-shrink: 0;
  padding-top: 0.25rem;
}

.attach-error {
  font-size: 0.8rem;
  color: var(--danger);
  background: var(--danger-bg);
  border-radius: 4px;
  padding: 0.3rem 0.6rem;
  margin-bottom: 0.4rem;
}

.attach-row {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.5rem;
  padding-bottom: 0.25rem;
  overflow-x: auto;
  scrollbar-width: thin;
}

.attach-item {
  position: relative;
  flex-shrink: 0;
  width: 4rem;
  height: 4rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--surface-3);
  transition: border-color 0.12s, transform 0.08s;
}
.attach-item:hover { border-color: var(--accent); }
.attach-item:active { transform: scale(0.97); }

.attach-thumb {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.attach-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.05rem;
  height: 1.05rem;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(0,0,0,.55);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s;
}
.attach-item:hover .attach-remove { opacity: 1; }
.attach-remove:hover { background: var(--danger); }

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

/* Scratch pad — hidden until toggled from the toolbar */
.scratch-section {
  flex-shrink: 0;
  border-top: 1px solid var(--border);
  padding-top: 0.3rem;
}
.scratch-label-row {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.scratch-editor {
  width: 100%;
  min-height: 5rem;
  max-height: 14rem;
  border: none;
  outline: none;
  resize: vertical;
  font-size: 0.9rem;
  line-height: 1.6;
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

.note-timestamp-row {
  display: flex;
  justify-content: flex-end;
  flex-shrink: 0;
  padding: 0.1rem 0.1rem 0.05rem;
}
.note-timestamp {
  font-size: 0.72rem;
  color: var(--text-muted);
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

/* Image lightbox */
.lightbox-backdrop {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,.85);
  padding: 2rem;
  animation: backdrop-in 0.15s ease forwards;
}
.lightbox-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 8px 40px rgba(0,0,0,.5);
}
.lightbox-close {
  position: fixed;
  top: 1rem;
  right: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.4rem;
  height: 2.4rem;
  border: none;
  border-radius: 50%;
  background: rgba(255,255,255,.12);
  color: #fff;
  cursor: pointer;
  transition: background 0.12s;
}
.lightbox-close:hover { background: rgba(255,255,255,.25); }

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
