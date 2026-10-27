<template>
  <section class="add-note">
    <div ref="box" class="add-note-box" :class="{ expanded }">
      <div v-if="expanded" class="add-note-title-row">
        <input
          v-model="title"
          class="note-title-input"
          placeholder="Title"
          @keydown.escape="close"
          @keydown.tab.prevent="focusContent"
          @keydown.ctrl.enter="submit"
          @keydown.meta.enter="submit"
        />
        <div class="toolbar-dropdown-wrap">
          <button type="button" class="toolbar-btn" title="More options" @click.stop="menuOpen = !menuOpen">
            <AppIcon name="more-vertical" :size="18" />
          </button>
          <div v-if="menuOpen" class="dropdown-panel dropdown-panel-right">
            <button type="button" class="dropdown-item" @click="setMode('markdown'); menuOpen = false">
              {{ contentType === 'markdown' ? 'Disable markdown' : 'Enable markdown' }}
            </button>
            <button type="button" class="dropdown-item" @click="setMode('checklist'); menuOpen = false">
              {{ contentType === 'checklist' ? 'Disable checkboxes' : 'Enable checkboxes' }}
            </button>
          </div>
        </div>
      </div>
      <div v-if="expanded && contentType === 'markdown'" class="add-note-editor-wrap" @paste="handlePaste">
        <MarkdownEditor ref="mdEditor" v-model="content" />
      </div>
      <div v-else-if="expanded && contentType === 'checklist'" class="add-note-editor-wrap" @paste="handlePaste">
        <ChecklistEditor v-model="content" />
      </div>
      <textarea
        v-else
        ref="contentInput"
        v-model="content"
        class="note-content-input"
        :placeholder="isTask ? 'Add a task…' : 'Take a note…'"
        rows="1"
        @focus="expanded = true"
        @input="growContent"
        @keydown.escape="close"
        @keydown.ctrl.enter="submit"
        @keydown.meta.enter="submit"
        @paste="handlePaste"
      />

      <!-- Scratch pad — toggled from the toolbar -->
      <div v-if="expanded && scratchOpen" class="add-note-scratch">
        <textarea
          v-model="scratch"
          class="add-note-scratch-input"
          placeholder="Working notes, links, sub-steps…"
        />
      </div>

      <!-- Pending attachments (staged in memory until the note is created) -->
      <div v-if="expanded && (pendingFiles.length || attachError)" class="attach-bar">
        <div v-if="attachError" class="attach-error">{{ attachError }}</div>
        <div v-if="pendingFiles.length" class="attach-row">
          <div
            v-for="(p, i) in pendingFiles"
            :key="i"
            class="attach-item"
            :title="p.file.name"
          >
            <img v-if="p.isImage" class="attach-thumb" :src="p.url" :alt="p.file.name" />
            <FileTypeIcon v-else :name="p.file.name" :type="p.file.type" :size="44" />
            <button class="attach-remove" title="Remove" @click.stop="removePending(i)">
              <AppIcon name="x" :size="12" />
            </button>
          </div>
        </div>
      </div>

      <div v-if="expanded" class="form-actions">
        <NoteToolbar
          v-model:is-task="isTask"
          v-model:due-date="dueDate"
          v-model:due-time="dueTime"
          v-model:priority="priority"
          v-model:recurrence="recurrence"
          v-model:view-id="viewId"
          v-model:labels="labels"
          v-model:color="color"
          v-model:notification-at="notification"
          :scratch-open="scratchOpen"
          :scratch-has-text="!!scratch.trim()"
          @update:scratch-open="scratchOpen = $event"
          @attach-files="addPendingFiles"
        />

        <div class="form-action-btns">
          <button class="btn-close" @click="close">Close</button>
          <button class="btn-add" :disabled="!canAdd" @click="submit">Add</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script>
import MarkdownEditor from './MarkdownEditor.vue'
import ChecklistEditor from './ChecklistEditor.vue'
import NoteToolbar from './NoteToolbar.vue'
import FileTypeIcon from './FileTypeIcon.vue'
import { useNotesStore } from '../stores/notes.js'
import { useAuthStore } from '../stores/auth.js'
import { isImageType } from '../utils/attachments.js'
import { textToChecklist, checklistToText } from '../utils/markdown.js'

export default {
  name: 'AddNoteForm',

  components: { MarkdownEditor, ChecklistEditor, NoteToolbar, FileTypeIcon },

  props: {
    defaultIsTask:  { type: Boolean, default: false },
    defaultDueDate: { type: String,  default: null },
  },

  emits: ['add', 'opened', 'closed'],

  setup() {
    return { notesStore: useNotesStore(), authStore: useAuthStore() }
  },

  beforeUnmount() {
    document.removeEventListener('mousedown', this._onOutsideClick)
    window.removeEventListener('click', this._closeMenu)
    window.removeEventListener('popstate', this._onPopState)
    this.revokePendingUrls()
  },

  data() {
    return {
      expanded:     false,
      isTask:       this.defaultIsTask,
      title:        '',
      content:      '',
      dueDate:      this.defaultDueDate || '',
      dueTime:      null,
      priority:     null,
      recurrence:   null,
      color:        null,
      notification: null,
      scratch:      '',
      scratchOpen:  false,
      viewId:       null,
      labels:       [],
      pendingFiles: [],
      attachError:  null,
      contentType:  'plain',
      menuOpen:     false,
    }
  },

  computed: {
    canAdd() {
      return !!(this.title.trim() || this.content.trim() || this.pendingFiles.length)
    },
  },

  watch: {
    defaultIsTask(val) {
      if (!this.expanded) this.isTask = val
    },
    defaultDueDate(val) {
      if (!this.expanded) this.dueDate = val || ''
    },
    expanded(val) {
      if (val) {
        // A new note lands in the current view by default; the toolbar can move it.
        this.viewId = this.notesStore.defaultNoteViewId
        this.labels = []
        document.addEventListener('mousedown', this._onOutsideClick)
        window.addEventListener('click', this._closeMenu)
        // Push a history entry so the Android back button closes the form
        // (asking to keep an unsaved note) instead of leaving the app.
        history.pushState({ addNote: true }, '')
        this._historyPushed = true
        window.addEventListener('popstate', this._onPopState)
        this.$emit('opened')
      } else {
        document.removeEventListener('mousedown', this._onOutsideClick)
        window.removeEventListener('click', this._closeMenu)
        window.removeEventListener('popstate', this._onPopState)
        // Collapsed via button rather than the back action — drop our entry.
        if (this._historyPushed) { this._historyPushed = false; history.back() }
        this.menuOpen = false
        this.$emit('closed')
      }
    },
  },

  methods: {
    _onOutsideClick(e) {
      if (!this.$refs.box.contains(e.target)) this.close()
    },

    _closeMenu() {
      this.menuOpen = false
    },

    // Android back button (or browser back) while the form is open. The pushed
    // history entry is already gone, so just collapse — keeping the note if it
    // has content the user might not want to lose.
    _onPopState() {
      this._historyPushed = false
      if (this.canAdd && window.confirm('Keep this note?')) this.submit()
      else this.close()
    },

    focusContent() {
      this.$nextTick(() => {
        this.$refs.contentInput?.focus()
        this.growContent()
      })
    },

    // The plain textarea starts at one row; grow it to fit so newlines (Enter)
    // don't scroll earlier text out of the single visible row.
    growContent() {
      const el = this.$refs.contentInput
      if (!el) return
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    },

    openAsTask() {
      this.isTask   = true
      this.expanded = true
      this.focusContent()
    },

    openAsNote() {
      this.isTask   = false
      this.expanded = true
      this.focusContent()
    },

    // Open the form pre-filled (used by the PWA share target & calendar day-click).
    prefill({ title = '', content = '', isTask = false, dueDate = '' } = {}) {
      this.title    = title
      this.content  = content
      this.isTask   = isTask
      this.dueDate  = dueDate || ''
      this.expanded = true
      this.focusContent()
    },

    setMode(mode) {
      const next = this.contentType === mode ? 'plain' : mode
      // Convert the existing text so nothing is lost, and so leaving checklist
      // mode drops the raw "- [ ]" prefixes.
      if (mode === 'checklist') {
        this.content = next === 'checklist' ? textToChecklist(this.content) : checklistToText(this.content)
      }
      this.contentType = next
    },

    handlePaste(event) {
      if (this.contentType === 'markdown') return
      const items = event.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          event.preventDefault()
          const file = item.getAsFile()
          this.contentType = 'markdown'
          this.$nextTick(() => { this.$refs.mdEditor?.insertImage(file) })
          return
        }
      }
    },

    addPendingFiles(files) {
      this.attachError = null
      const maxMb = this.authStore.maxAttachmentMb || 10
      for (const file of files) {
        const isImage = isImageType(file.type)
        // Images get compressed on save; only guard the raw size of other files.
        if (!isImage && file.size > maxMb * 1024 * 1024) {
          this.attachError = `File is too large (max ${maxMb} MB).`
          continue
        }
        this.pendingFiles.push({
          file,
          isImage,
          url: isImage ? URL.createObjectURL(file) : null,
        })
      }
    },

    removePending(i) {
      const [removed] = this.pendingFiles.splice(i, 1)
      if (removed?.url) URL.revokeObjectURL(removed.url)
    },

    revokePendingUrls() {
      this.pendingFiles.forEach(p => { if (p.url) URL.revokeObjectURL(p.url) })
    },

    close() {
      this.revokePendingUrls()
      this.expanded     = false
      this.isTask       = this.defaultIsTask
      this.title        = ''
      this.content      = ''
      this.dueDate      = this.defaultDueDate || ''
      this.dueTime      = null
      this.priority     = null
      this.recurrence   = null
      this.color        = null
      this.notification = null
      this.scratch      = ''
      this.scratchOpen  = false
      this.viewId       = null
      this.labels       = []
      this.pendingFiles = []
      this.attachError  = null
      this.contentType  = 'plain'
      this.menuOpen     = false
      if (this.$refs.contentInput) this.$refs.contentInput.style.height = 'auto'
    },

    submit() {
      if (!this.canAdd) return
      this.$emit('add', {
        title:          this.title,
        content:        this.content,
        isTask:         this.isTask,
        dueDate:        this.dueDate || null,
        dueTime:        this.dueDate ? (this.dueTime || null) : null,
        priority:       this.priority,
        recurrence:     this.recurrence,
        color:          this.color,
        notificationAt: this.notification,
        scratch:        this.scratch,
        viewId:         this.viewId,
        labels:         this.labels,
        contentType:    this.contentType,
        attachments:    this.pendingFiles.map(p => p.file),
      })
      this.close()
    },
  },
}
</script>

<style scoped>
.add-note-editor-wrap {
  padding: 0.25rem 0;
}

/* Title row with the top-right overflow menu (matches the note modal) */
.add-note-title-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.add-note-title-row .note-title-input {
  flex: 1;
  width: auto;
  min-width: 0;
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
.toolbar-btn:hover { background: var(--surface-3); }

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

/* Let the toolbar wrap instead of pushing Close/Add off-screen on narrow widths */
.form-actions {
  flex-wrap: wrap;
  row-gap: 0.5rem;
}

/* Keep Close + Add together, pinned to the right even when the bar wraps */
.form-action-btns {
  display: flex;
  gap: 0.5rem;
  margin-left: auto;
}

/* Scratch pad in the create form */
.add-note-scratch {
  border-top: 1px solid var(--border);
  padding-top: 0.3rem;
  margin-top: 0.25rem;
}
.add-note-scratch-input {
  width: 100%;
  min-height: 4rem;
  max-height: 12rem;
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

/* Staged attachment thumbnails */
.attach-bar { padding-top: 0.4rem; }
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
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--surface-3);
}
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
</style>
