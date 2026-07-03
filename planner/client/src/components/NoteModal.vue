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
          <button class="modal-back-btn" title="Back" @click="close">
            <AppIcon name="chevron-right" :size="20" />
          </button>
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
              <button class="dropdown-item" :disabled="editContentType !== 'plain'" @click="splitNote">{{ effectiveIsTask ? 'Split into tasks' : 'Split into notes' }}</button>
              <button class="dropdown-item" :disabled="editContentType === 'markdown'" @click="toggleCheckboxMode">{{ editContentType === 'checklist' ? 'Disable checkboxes' : 'Enable checkboxes' }}</button>
              <button class="dropdown-item" :disabled="editContentType === 'checklist'" @click="toggleMarkdownMode">{{ editContentType === 'markdown'  ? 'Disable markdown'  : 'Enable markdown'  }}</button>
              <button class="dropdown-item danger" @click="deleteNote">Move to trash</button>
            </div>
          </div>
        </div>

        <!-- Scrollable content area -->
        <div class="modal-scroll" @click="onEditorAreaClick">

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
                ref="checklistEditor"
                v-model="editContent"
              />
              <textarea
                v-else
                ref="plainEditor"
                v-model="editContent"
                class="plain-editor"
                placeholder="Note…"
                @input="growPlainEditor"
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

        </div><!-- /.modal-scroll -->

        <!-- Bottom bar -->
        <div class="modal-bottom-bar">
          <template v-if="!inTrash">
            <NoteToolbar
              v-model:is-task="editIsTask"
              v-model:due-date="editDueDate"
              v-model:due-time="editDueTime"
              v-model:priority="editPriority"
              v-model:recurrence="editRecurrence"
              v-model:view-id="editViewId"
              v-model:labels="editLabels"
              :color="editColor"
              :notification-at="editNotification"
              :scratch-open="scratchOpen"
              :scratch-has-text="!!editScratch.trim()"
              @update:color="onColorChange"
              @update:notification-at="onNotifChange"
              @update:scratch-open="scratchOpen = $event"
              @attach-files="addFiles"
            />
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
import { renderPlain, renderChecklist, renderCheckableMarkdown, sortCheckboxItems, textToChecklist, checklistToText } from '../utils/markdown.js'
import { isImageType } from '../utils/attachments.js'
import MarkdownEditor from './MarkdownEditor.vue'
import ChecklistEditor from './ChecklistEditor.vue'
import FileTypeIcon from './FileTypeIcon.vue'

function hasCheckboxSyntax(text) {
  return /^\s*- \[[ xX]\] /m.test(text || '')
}
import NoteToolbar from './NoteToolbar.vue'

export default {
  name: 'NoteModal',

  components: { MarkdownEditor, ChecklistEditor, NoteToolbar, FileTypeIcon },

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
      editDueTime:      this.note.dueTime        ?? null,
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
      moreMenuOpen:     false,
    }
  },

  watch: {
    editContent() {
      if (this.editContentType === 'plain') this.$nextTick(() => this.growPlainEditor())
    },
  },

  mounted() {
    this.$nextTick(() => this.growPlainEditor())

    this._globalClose = () => {
      this.moreMenuOpen = false
    }
    window.addEventListener('click', this._globalClose)

    this._globalKeydown = (e) => {
      if (e.key === 'Escape') this.onEscape()
    }
    window.addEventListener('keydown', this._globalKeydown)

    // Push a history entry so the Android hardware back button closes the modal
    // (and auto-saves) instead of navigating away from the app.
    history.pushState({ noteModal: true }, '')
    this._historyPushed = true
    this._onPopState = () => {
      // The pushed entry is already gone — don't pop it again on unmount.
      this._historyPushed = false
      this.close()
    }
    window.addEventListener('popstate', this._onPopState)
  },

  beforeUnmount() {
    window.removeEventListener('click', this._globalClose)
    window.removeEventListener('keydown', this._globalKeydown)
    window.removeEventListener('popstate', this._onPopState)
    // Closed via button/Escape rather than the back action — drop our entry so
    // the history stack stays balanced.
    if (this._historyPushed) history.back()
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
    growPlainEditor() {
      const el = this.$refs.plainEditor
      if (!el) return
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    },

    // Clicking anywhere in the (often mostly empty) editor area should drop the
    // caret into the editor, not just a precise click on the text line itself.
    onEditorAreaClick(event) {
      if (this.inTrash) return
      if (this.editContentType === 'plain') {
        const el = this.$refs.plainEditor
        if (!el || event.target === el) return
        el.focus()
        const len = el.value.length
        try { el.setSelectionRange(len, len) } catch { /* noop */ }
      } else if (this.editContentType === 'markdown') {
        // Let clicks that land on the text position the caret themselves.
        if (event.target.closest?.('.ProseMirror')) return
        this.$refs.mdEditor?.focusEnd()
      } else if (this.editContentType === 'checklist') {
        if (event.target.tagName === 'TEXTAREA' || event.target.tagName === 'INPUT') return
        if (event.target.closest?.('.checklist-add')) return
        this.$refs.checklistEditor?.focusLast()
      }
    },

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
        const dueTimeChanged     = (this.editDueTime || null) !== (this.note.dueTime   ?? null)
        const priorityChanged    = this.editPriority        !== (this.note.priority    ?? null)
        const doneChanged        = this.editDone            !== (this.note.done        ?? false)
        const contentTypeChanged = this.editContentType     !== (this.note.contentType ?? 'plain')
        const recurrenceChanged  = this.editRecurrence      !== (this.note.recurrence  ?? null)

        if (titleChanged || contentChanged || scratchChanged || viewChanged || labelsChanged || taskChanged || dueDateChanged || dueTimeChanged || priorityChanged || doneChanged || contentTypeChanged || recurrenceChanged) {
          await this.store.updateNote(this.note, {
            title:       this.editTitle,
            content:     this.editContentType === 'checklist' ? sortCheckboxItems(this.editContent) : this.editContent,
            scratch:     this.editScratch,
            viewId:      this.editViewId,
            labels:      this.editLabels,
            isTask:      this.editIsTask,
            dueDate:     this.editDueDate,
            dueTime:     this.editDueDate ? (this.editDueTime || null) : null,
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
      this.moreMenuOpen = false
    },

    toggleDropdown(name) {
      const was = this[name]
      this.closePopups()
      this[name] = !was
    },

    toggleDone() {
      this.editDone = !this.editDone
    },

    async onColorChange(color) {
      this.editColor = color
      await this.store.updateNoteColor(this.note, color)
    },

    async onNotifChange(iso) {
      this.editNotification = iso
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

    async togglePin() {
      await this.store.pinNote(this.note)
    },

    async duplicateNote() {
      await this.store.duplicateNote(this.note)
      this.$emit('close')
    },

    async splitNote() {
      const lines = (this.editContent || '').split('\n').map(l => l.trim()).filter(Boolean)
      if (lines.length < 2) return
      const type = this.effectiveIsTask ? 'tasks' : 'notes'
      if (!window.confirm(`Split into ${lines.length} ${type}? The original will be permanently deleted.`)) return
      this.moreMenuOpen = false
      for (const line of lines) {
        await this.store.addNote({ title: '', content: line, isTask: this.effectiveIsTask, contentType: 'plain' })
      }
      await this.store.permanentlyDelete(this.note)
      this.$emit('close')
    },

    toggleCheckboxMode() {
      if (this.editContentType === 'checklist') {
        this.editContent = checklistToText(this.editContent)
        this.editContentType = 'plain'
      } else {
        this.editContent = textToChecklist(this.editContent)
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
  max-width: 740px;
  min-height: 10rem;
  max-height: 90vh;
  overflow: visible;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  transition: background 0.15s;
  animation: modal-expand 0.22s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.modal-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.modal-title-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.4rem;
}

.modal-back-btn {
  /* Only shown on mobile (see the max-width media query); the desktop modal has
     Close/Escape/backdrop-click, so a back button is redundant there. */
  display: none;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.25rem;
  margin-left: -0.25rem;
  border-radius: 4px;
  color: var(--text-3);
}
.modal-back-btn:hover { background: var(--surface-3); }
/* Back-pointing chevron (no dedicated left-arrow icon); rotate the icon only so
   the flex box itself stays centered with the title. */
.modal-back-btn :deep(svg) {
  display: block;
  transform: rotate(180deg);
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
  min-height: 4rem;
  border: none;
  outline: none;
  resize: none;
  overflow-y: hidden;
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
  flex-wrap: wrap;
  gap: 0.25rem;
  row-gap: 0.4rem;
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
.toolbar-btn.active { background: var(--surface-3); }

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
.dropdown-item.danger { color: var(--danger); }
.dropdown-item.danger:hover { background: var(--danger-bg); }


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

  .modal-scroll {
    flex: 1;
  }

  .modal-back-btn {
    display: flex;
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
