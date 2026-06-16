<template>
  <article
    :data-note-id="note._id"
    class="note-card"
    :class="{
      'note-card--list':        viewMode === 'list',
      'note-card--task':        isTask,
      'note-card--done':        note.done,
      'note-card--dragging':    dragging,
      'note-card--drop-before': dropBefore,
      'note-card--drop-after':  dropAfter,
      'note-card--open':        open,
      'note-card--selected':    selected,
      [`note-card--priority-${note.priority}`]: isTask && note.priority,
    }"
    :style="note.color ? { background: note.color, borderColor: 'transparent' } : {}"
    :draggable="draggable"
    @click="handleClick"
    @contextmenu.prevent="$emit('contextmenu', $event, note)"
    @dragstart="$emit('dragstart', $event, note)"
    @dragover.prevent="$emit('dragover', $event, note)"
    @dragleave="$emit('dragleave', $event)"
    @drop.prevent="$emit('drop', note)"
    @dragend="$emit('dragend')"
  >
    <!-- Select mode checkbox overlay -->
    <span v-if="selectMode" class="note-card-select-check" :class="{ checked: selected }">
      <AppIcon v-if="selected" name="check" :size="14" />
    </span>

    <div v-if="!inTrash && !selectMode" class="note-card-actions">
      <button class="note-card-action-btn" :title="note.pinned ? 'Unpin' : 'Pin'" @click.stop="$emit('pin', note)">
        <AppIcon name="pin" :size="13" />
      </button>
      <button class="note-card-action-btn note-card-action-btn--danger" title="Move to trash" @click.stop="$emit('delete', note)">
        <AppIcon name="trash" :size="13" />
      </button>
    </div>

    <span v-if="note.pinned && !selectMode" class="note-card-pin" title="Pinned">
      <AppIcon name="pin" :size="13" />
    </span>

    <!-- ── List layout ── -->
    <template v-if="viewMode === 'list'">
      <div class="note-card-list-meta">
        <span v-if="isTask && !selectMode" class="note-card-task-check" :class="{ done: note.done }" @click.stop="$emit('toggle-done', note)">
          <AppIcon :name="note.done ? 'circle-check' : 'circle'" :size="14" />
        </span>
        <h2 class="note-card-title" :class="{ 'note-card-title--untitled': !note.title, 'note-card-title--done': note.done }">
          {{ note.title || 'Untitled' }}
        </h2>
        <span v-if="note.dueDate" class="note-card-due" :class="{ overdue: isOverdue }">{{ formattedDueDate }}</span>
        <span v-if="note.priority" class="note-card-priority" :class="`priority--${note.priority}`">{{ note.priority }}</span>
        <span v-if="note.recurrence" class="note-card-recurrence" :title="`Repeats ${note.recurrence}`">
          <AppIcon name="refresh" :size="10" />
          {{ note.recurrence }}
        </span>
        <span v-if="checklistProgress" class="note-card-recurrence" :title="`${checklistProgress.done} of ${checklistProgress.total} items done`">
          {{ checklistProgress.done }} / {{ checklistProgress.total }}
        </span>
        <time class="note-card-date">{{ formattedDate }}</time>
      </div>
    </template>

    <!-- ── Masonry / Trello layout ── -->
    <template v-else>
      <h2 v-if="note.title" class="note-card-title" :class="{ 'note-card-title--done': isTask && note.done }">{{ note.title }}</h2>
      <div v-if="note.dueDate || note.priority || note.recurrence || checklistProgress" class="note-card-chips">
        <span v-if="note.dueDate" class="note-card-due" :class="{ overdue: isOverdue }">{{ formattedDueDate }}</span>
        <span v-if="note.priority" class="note-card-priority" :class="`priority--${note.priority}`">{{ note.priority }}</span>
        <span v-if="note.recurrence" class="note-card-recurrence" :title="`Repeats ${note.recurrence}`">
          <AppIcon name="refresh" :size="10" />
          {{ note.recurrence }}
        </span>
        <span v-if="checklistProgress" class="note-card-recurrence" :title="`${checklistProgress.done} of ${checklistProgress.total} items done`">
          {{ checklistProgress.done }} / {{ checklistProgress.total }}
        </span>
      </div>
    </template>

    <div class="note-card-content prose"
         v-html="renderedContent"
         @change.stop="$emit('checkbox-change', $event, note)" />

    <div v-if="expiryLabel" class="note-card-expiry">{{ expiryLabel }}</div>

    <!-- Check button overlaid top-left (masonry / trello only) -->
    <span v-if="isTask && viewMode !== 'list' && !selectMode" class="note-card-task-check note-card-task-check--overlay" :class="{ done: note.done }" @click.stop="$emit('toggle-done', note)" title="Toggle done">
      <AppIcon :name="note.done ? 'circle-check' : 'circle'" :size="15" />
    </span>
  </article>
</template>

<script>
import { isTaskNote } from '../stores/notes.js'

export default {
  name: 'NoteCard',

  props: {
    note:       { type: Object,  required: true },
    viewMode:   { type: String,  default: 'masonry' }, // 'masonry' | 'list'
    draggable:  { type: Boolean, default: false },
    dragging:   { type: Boolean, default: false },
    dropBefore: { type: Boolean, default: false },
    dropAfter:  { type: Boolean, default: false },
    open:       { type: Boolean, default: false },
    inTrash:    { type: Boolean, default: false },
    renderedContent: { type: String, default: '' },
    selectMode: { type: Boolean, default: false },
    selected:   { type: Boolean, default: false },
  },

  emits: ['open', 'select', 'toggle-done', 'checkbox-change', 'pin', 'delete', 'contextmenu', 'dragstart', 'dragover', 'dragleave', 'drop', 'dragend'],

  computed: {
    isTask() {
      return isTaskNote(this.note)
    },

    today() {
      return new Date().toISOString().slice(0, 10)
    },

    isOverdue() {
      return this.note.dueDate < this.today && !this.note.done
    },

    formattedDueDate() {
      const iso = this.note.dueDate
      if (!iso) return ''
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
      if (iso === this.today)    return 'Today'
      if (iso === tomorrow)      return 'Tomorrow'
      return new Date(iso + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })
    },

    formattedDate() {
      const iso = this.note.updatedAt || this.note.createdAt
      if (!iso) return ''
      const d = new Date(iso)
      const isToday = d.toDateString() === new Date().toDateString()
      return isToday
        ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    },

    expiryLabel() {
      if (!this.inTrash || !this.note.deletedAt) return null
      const expiresAt = new Date(new Date(this.note.deletedAt).getTime() + 7 * 24 * 60 * 60 * 1000)
      const msLeft = expiresAt - Date.now()
      if (msLeft <= 0) return 'Deleting…'
      const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000))
      if (daysLeft === 1) return 'Expires today'
      return `Expires in ${daysLeft} days`
    },

    checklistProgress() {
      const content = this.note.content || ''
      const ct = this.note.contentType
      // Only parse if content looks like it has checkbox syntax
      if (ct !== 'checklist' && ct !== 'markdown' && !/^\s*- \[[ xX]\] /m.test(content)) return null
      const total = (content.match(/^\s*- \[[ xX]\] /gm) || []).length
      if (total < 2) return null
      const done  = (content.match(/^\s*- \[[xX]\] /gm) || []).length
      return { done, total }
    },
  },

  methods: {
    handleClick(event) {
      if (event.target.type === 'checkbox') return
      if (event.shiftKey) {
        this.$emit('select', this.note)
      } else {
        this.$emit('open', this.note)
      }
    },
  },
}
</script>

<style scoped>
.note-card-select-check {
  position: absolute;
  top: 0.45rem;
  left: 0.45rem;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 50%;
  border: 2px solid var(--border-2);
  background: var(--surface);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  z-index: 2;
  transition: border-color 0.1s, background 0.1s;
}
.note-card-select-check.checked {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.note-card--selected {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
</style>
