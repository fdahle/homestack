<template>
  <section class="add-note">
    <div ref="box" class="add-note-box" :class="{ expanded }">
      <input
        v-if="expanded"
        v-model="title"
        class="note-title-input"
        placeholder="Title"
        @keydown.escape="close"
        @keydown.tab.prevent="focusContent"
        @keydown.ctrl.enter="submit"
        @keydown.meta.enter="submit"
      />
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
        @keydown.escape="close"
        @keydown.ctrl.enter="submit"
        @keydown.meta.enter="submit"
        @paste="handlePaste"
      />
      <div v-if="expanded" class="form-actions">
        <label class="form-task-toggle">
          <input type="checkbox" v-model="isTask" />
          Task
        </label>
        <input
          v-if="isTask || dueDate"
          v-model="dueDate"
          type="date"
          class="form-due-date"
          title="Due date"
          @keydown.escape.stop
        />
        <div class="form-mode-btns">
          <button
            type="button"
            class="form-mode-btn"
            :class="{ active: contentType === 'markdown' }"
            title="Markdown"
            @click="setMode('markdown')"
          >M↓</button>
          <button
            type="button"
            class="form-mode-btn"
            :class="{ active: contentType === 'checklist' }"
            title="Checklist"
            @click="setMode('checklist')"
          >☑</button>
        </div>
        <button class="btn-close" @click="close">Close</button>
        <button class="btn-add" :disabled="!canAdd" @click="submit">Add</button>
      </div>
    </div>
  </section>
</template>

<script>
import MarkdownEditor from './MarkdownEditor.vue'
import ChecklistEditor from './ChecklistEditor.vue'

export default {
  name: 'AddNoteForm',

  components: { MarkdownEditor, ChecklistEditor },

  props: {
    defaultIsTask:  { type: Boolean, default: false },
    defaultDueDate: { type: String,  default: null },
  },

  emits: ['add', 'opened', 'closed'],

  beforeUnmount() {
    document.removeEventListener('mousedown', this._onOutsideClick)
  },

  data() {
    return {
      expanded:    false,
      isTask:      this.defaultIsTask,
      title:       '',
      content:     '',
      dueDate:     this.defaultDueDate || '',
      contentType: 'plain',
    }
  },

  computed: {
    canAdd() {
      return this.title.trim() || this.content.trim()
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
        document.addEventListener('mousedown', this._onOutsideClick)
        this.$emit('opened')
      } else {
        document.removeEventListener('mousedown', this._onOutsideClick)
        this.$emit('closed')
      }
    },
  },

  methods: {
    _onOutsideClick(e) {
      if (!this.$refs.box.contains(e.target)) this.close()
    },

    focusContent() {
      this.$nextTick(() => this.$refs.contentInput?.focus())
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

    setMode(mode) {
      this.contentType = this.contentType === mode ? 'plain' : mode
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

    close() {
      this.expanded    = false
      this.isTask      = this.defaultIsTask
      this.title       = ''
      this.content     = ''
      this.dueDate     = this.defaultDueDate || ''
      this.contentType = 'plain'
    },

    submit() {
      if (!this.canAdd) return
      this.$emit('add', {
        title:       this.title,
        content:     this.content,
        isTask:      this.isTask,
        dueDate:     this.dueDate || null,
        contentType: this.contentType,
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

.form-mode-btns {
  display: flex;
  gap: 0.2rem;
  margin-left: 0.25rem;
}

.form-mode-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.15rem 0.4rem;
  font-size: 0.75rem;
  font-family: inherit;
  cursor: pointer;
  color: var(--text-3);
  line-height: 1.4;
  transition: background 0.1s, color 0.1s;
}
.form-mode-btn:hover { background: var(--surface-3); color: var(--text-1); }
.form-mode-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }

.form-due-date {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.2rem 0.5rem;
  font-size: 0.8rem;
  font-family: inherit;
  color: var(--text-2);
  background: var(--surface-3);
  outline: none;
  height: 28px;
  cursor: pointer;
}
.form-due-date:focus { border-color: var(--accent); background: var(--surface); }
</style>
