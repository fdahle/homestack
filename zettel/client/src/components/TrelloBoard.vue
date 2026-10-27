<template>
  <div class="trello-board">
    <!-- ── Columns ── -->
    <div
      v-for="col in columns"
      :key="col.id ?? '__uncategorized__'"
      class="trello-col"
      :class="{ 'trello-col--drag-over': dropTarget?.columnId === col.id && !dropTarget.noteId }"
      @dragover.prevent="onColumnDragOver($event, col.id)"
      @drop.prevent="onDrop(col.id)"
    >
      <!-- Column header -->
      <div class="trello-col-header">
        <!-- Rename input -->
        <input
          v-if="editingColId === col.id"
          ref="renameInput"
          v-model="editingColName"
          class="trello-col-name-input"
          @keydown.enter="commitRename"
          @keydown.escape="cancelRename"
          @blur="commitRename"
        />
        <!-- Static name (Uncategorized is not editable) -->
        <span
          v-else
          class="trello-col-name"
          :class="{ editable: !col.isDefault }"
          @click="col.isDefault ? null : startRename(col)"
        >{{ col.name }}</span>

        <button
          v-if="!col.isDefault"
          class="trello-col-delete"
          title="Delete column"
          @click="deleteColumn(col.id)"
        >
          <AppIcon name="x" :size="14" />
        </button>
      </div>

      <!-- Cards -->
      <div class="trello-cards">
        <article
          v-for="note in col.notes"
          :key="note._id"
          class="note-card"
          :class="{
            'note-card--dragging':    drag.note?._id === note._id,
            'note-card--drop-before': dropTarget?.noteId === note._id && dropTarget.position === 'before',
            'note-card--drop-after':  dropTarget?.noteId === note._id && dropTarget.position === 'after',
            'note-card--open':        openedNoteId === note._id,
          }"
          :style="note.color ? { background: note.color, borderColor: 'transparent' } : {}"
          draggable="true"
          @click="$event.target.type !== 'checkbox' && $emit('open-note', note)"
          @dragstart="onCardDragStart($event, note, col.id)"
          @dragover.prevent.stop="onCardDragOver($event, note, col.id)"
          @dragleave.stop="onCardDragLeave"
          @dragend="onDragEnd"
        >
          <span v-if="note.pinned" class="note-card-pin" title="Pinned">
            <AppIcon name="pin" :size="13" />
          </span>
          <h2 v-if="note.title" class="note-card-title">{{ note.title }}</h2>
          <div class="note-card-content prose"
               v-html="renderNoteContent(note)"
               @change.stop="onCheckboxChange($event, note)" />
        </article>

        <!-- Empty-column drop zone -->
        <div
          v-if="!col.notes.length"
          class="trello-col-empty"
          @dragover.prevent="onColumnDragOver($event, col.id)"
        >
          <span>No notes</span>
        </div>
      </div>
    </div>

    <!-- ── Add column ── -->
    <div class="trello-col trello-col--add">
      <template v-if="addingCol">
        <input
          ref="addInput"
          v-model="newColName"
          class="trello-col-name-input"
          placeholder="Column name…"
          @keydown.enter="commitAddColumn"
          @keydown.escape="cancelAddColumn"
          @blur="commitAddColumn"
        />
        <div class="trello-add-actions">
          <button class="btn-add-col" @click="commitAddColumn">Add</button>
          <button class="btn-cancel-col" @click="cancelAddColumn">✕</button>
        </div>
      </template>
      <button v-else class="trello-add-col-btn" @click="startAddColumn">
        <AppIcon name="plus" :size="14" />
        Add column
      </button>
    </div>
  </div>
</template>

<script>
import { useNotesStore } from '../stores/notes.js'
import { renderNoteContent, toggleCheckbox } from '../utils/markdown.js'

export default {
  name: 'TrelloBoard',

  props: {
    viewId: { type: String, required: true },
    filteredNoteIds: { type: Array, default: null },
    openedNoteId: { type: String, default: null },
  },

  emits: ['open-note'],

  setup() {
    return { store: useNotesStore(), renderNoteContent }
  },

  data() {
    return {
      // drag state
      drag: {
        note: null,           // the note being dragged
        sourceColumnId: null, // null = Uncategorized, string = board_column _id
      },
      dropTarget: null, // { columnId, noteId?, position? } | null

      // column editing
      editingColId:   null,
      editingColName: '',

      // column adding
      addingCol:  false,
      newColName: '',
    }
  },

  computed: {
    columns() {
      const custom = this.store.boardColumnsForView(this.viewId)
      return [
        {
          id:        null,
          name:      'Uncategorized',
          isDefault: true,
          notes:     this.notesForColumn(null),
        },
        ...custom.map(c => ({
          id:        c._id,
          name:      c.name,
          isDefault: false,
          notes:     this.notesForColumn(c._id),
        })),
      ]
    },
  },

  methods: {
    async onCheckboxChange(event, note) {
      if (event.target.type !== 'checkbox') return
      const idx = parseInt(event.target.dataset.checkboxIdx)
      const newContent = toggleCheckbox(note.content || '', idx, event.target.checked)
      await this.store.updateNote(note, {
        title:   note.title  || '',
        content: newContent,
        viewId:  note.viewId,
      })
    },

    // Returns notes that belong to this view AND this column, sorted by order
    notesForColumn(columnId) {
      let viewNotes = this.store.notes.filter(n => {
        if (n.deletedAt) return false
        if (this.viewId === 'home') return !n.viewId
        return n.viewId === this.viewId
      })
      if (this.filteredNoteIds) {
        const idSet = new Set(this.filteredNoteIds)
        viewNotes = viewNotes.filter(n => idSet.has(n._id))
      }
      return viewNotes
        .filter(n => (n.columnId ?? null) === (columnId ?? null))
        .sort((a, b) => {
          const ap = a.pinned ? 0 : 1
          const bp = b.pinned ? 0 : 1
          if (ap !== bp) return ap - bp
          const sortBy = this.store.sortBy
          if (sortBy === 'title') {
            const cmp = (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase())
            if (cmp !== 0) return cmp
          } else if (sortBy === 'createdAt') {
            return b.createdAt.localeCompare(a.createdAt)
          } else if (sortBy === 'updatedAt') {
            return (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)
          } else {
            const ao = a.order ?? -Infinity
            const bo = b.order ?? -Infinity
            if (ao !== bo) return ao - bo
          }
          return b.createdAt.localeCompare(a.createdAt)
        })
    },

    // ── Drag & drop ─────────────────────────────────────────────────

    onCardDragStart(event, note, columnId) {
      this.drag = { note, sourceColumnId: columnId }
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/note-id', note._id)
    },

    onCardDragOver(event, note, columnId) {
      if (!this.drag.note || this.drag.note._id === note._id) return
      const rect = event.currentTarget.getBoundingClientRect()
      this.dropTarget = {
        columnId,
        noteId:   note._id,
        position: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after',
      }
    },

    onCardDragLeave(event) {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        // don't clear dropTarget here — let column's dragover keep it fresh
      }
    },

    onColumnDragOver(_event, columnId) {
      if (!this.drag.note) return
      // Only set the column-level target when not already over a specific card
      if (!this.dropTarget || this.dropTarget.columnId !== columnId) {
        this.dropTarget = { columnId, noteId: null }
      }
    },

    async onDrop(columnId) {
      if (!this.drag.note || !this.dropTarget) {
        this.onDragEnd()
        return
      }

      const { note, sourceColumnId } = this.drag
      const { noteId: targetNoteId, position } = this.dropTarget
      const targetColId = columnId // null = Uncategorized

      // Build new note order for both source and target columns
      const sourceNotes = this.notesForColumn(sourceColumnId)
        .filter(n => n._id !== note._id)

      const targetNotes = this.notesForColumn(targetColId)
        .filter(n => n._id !== note._id)

      // Insert dragged note at the correct position
      if (!targetNoteId) {
        // Dropped on empty column or column background → append
        targetNotes.push(note)
      } else {
        const idx = targetNotes.findIndex(n => n._id === targetNoteId)
        const insertAt = position === 'before' ? idx : idx + 1
        targetNotes.splice(Math.max(0, insertAt), 0, note)
      }

      const sameColumn = sourceColumnId === targetColId

      if (sameColumn) {
        await this.store.reorderNotes(targetNotes.map(n => n._id))
      } else {
        if (sourceNotes.length) {
          await this.store.reorderNotes(sourceNotes.map(n => n._id))
        }
        await this.store.reorderNotes(targetNotes.map(n => n._id), targetColId)
      }

      this.onDragEnd()
    },

    onDragEnd() {
      this.drag       = { note: null, sourceColumnId: null }
      this.dropTarget = null
    },

    // ── Column management ────────────────────────────────────────────

    startRename(col) {
      this.editingColId   = col.id
      this.editingColName = col.name
      this.$nextTick(() => {
        const inputs = this.$refs.renameInput
        const input  = Array.isArray(inputs) ? inputs[0] : inputs
        input?.focus()
        input?.select()
      })
    },

    commitRename() {
      if (this.editingColId && this.editingColName.trim()) {
        this.store.renameBoardColumn(this.editingColId, this.editingColName)
      }
      this.cancelRename()
    },

    cancelRename() {
      this.editingColId   = null
      this.editingColName = ''
    },

    deleteColumn(id) {
      this.store.deleteBoardColumn(id)
    },

    startAddColumn() {
      this.addingCol  = true
      this.newColName = ''
      this.$nextTick(() => this.$refs.addInput?.focus())
    },

    commitAddColumn() {
      if (this.newColName.trim()) {
        this.store.addBoardColumn(this.viewId, this.newColName)
      }
      this.cancelAddColumn()
    },

    cancelAddColumn() {
      this.addingCol  = false
      this.newColName = ''
    },
  },
}
</script>

<style scoped>
/* ── Board layout ────────────────────────────────────────────────── */

.trello-board {
  display: flex;
  gap: 1rem;
  padding: 1rem 1.5rem 2rem;
  overflow-x: auto;
  align-items: flex-start;
  min-height: calc(100vh - 140px);
}

/* ── Column ──────────────────────────────────────────────────────── */

.trello-col {
  flex: 0 0 272px;
  background: var(--panel);
  border-radius: 10px;
  padding: 0.625rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  transition: background 0.12s;
}

.trello-col--drag-over { background: var(--panel-h); }

.trello-col-header {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.1rem 0.25rem 0.25rem;
  min-height: 32px;
}

.trello-col-name {
  flex: 1;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-2);
  border-radius: 4px;
  padding: 0.2rem 0.25rem;
  line-height: 1.4;
}

.trello-col-name.editable {
  cursor: pointer;
}
.trello-col-name.editable:hover {
  background: rgba(0,0,0,.06);
}

.trello-col-name-input {
  flex: 1;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-1);
  background: var(--surface);
  border: 2px solid var(--accent);
  border-radius: 4px;
  padding: 0.2rem 0.4rem;
  outline: none;
  font-family: inherit;
  width: 100%;
}

.trello-col-delete {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--text-muted);
  opacity: 0;
  transition: opacity 0.12s, background 0.12s, color 0.12s;
}
.trello-col:hover .trello-col-delete { opacity: 1; }
.trello-col-delete:hover { background: rgba(0,0,0,.08); color: var(--danger); }

/* ── Cards ───────────────────────────────────────────────────────── */

.trello-cards {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 2rem; /* always a drop surface even if empty */
}

/* note-card styles are global (defined in App.vue) */

.trello-cards .note-card {
  box-shadow: 0 1px 2px rgba(0,0,0,.12);
}

.trello-cards .note-card--open {
  opacity: 0;
  transform: scale(1.04);
  pointer-events: none;
  transition: opacity 0.2s ease, transform 0.2s ease;
}

/* Checkbox list items in trello cards */
.trello-cards .note-card-content :deep(li.task-item) {
  list-style: none;
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
}
.trello-cards .note-card-content :deep(li.task-item input) {
  flex-shrink: 0;
  cursor: pointer;
  accent-color: var(--accent);
  margin-top: 0.15rem;
}
.trello-cards .note-card-content :deep(li.task-item--first-checked) {
  border-top: 1px dashed var(--border-2);
  margin-top: 0.4rem;
  padding-top: 0.4rem;
}
.trello-cards .note-card-content :deep(li.task-item--checked) {
  color: var(--text-muted);
}
.trello-cards .note-card-content :deep(li.task-item--checked input[type="checkbox"]) {
  opacity: 0.5;
}
.trello-cards .note-card-content :deep(li.task-item--checked) > *:not(input),
.trello-cards .note-card-content :deep(li.task-item--checked) > p {
  text-decoration: line-through;
  text-decoration-color: var(--text-muted);
}

.trello-cards .note-card-content {
  -webkit-line-clamp: 6;
  line-clamp: 6;
}

.trello-col-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60px;
  border-radius: 6px;
  border: 2px dashed var(--border-2);
  color: var(--text-muted);
  font-size: 0.8rem;
}

/* ── Add-column panel ────────────────────────────────────────────── */

.trello-col--add {
  background: rgba(0,0,0,.08);
  border: none;
  min-height: auto;
  gap: 0.5rem;
}

.trello-add-col-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  background: none;
  border: none;
  border-radius: 6px;
  padding: 0.5rem 0.6rem;
  font-size: 0.875rem;
  font-family: inherit;
  color: var(--text-3);
  cursor: pointer;
  text-align: left;
  transition: background 0.12s, color 0.12s;
}
.trello-add-col-btn:hover { background: rgba(0,0,0,.08); color: var(--text-1); }

.trello-add-actions {
  display: flex;
  gap: 0.4rem;
}

.btn-add-col {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 0.35rem 0.8rem;
  font-size: 0.8rem;
  font-family: inherit;
  cursor: pointer;
  font-weight: 500;
}
.btn-add-col:hover { background: var(--accent-h); }

.btn-cancel-col {
  background: none;
  border: none;
  border-radius: 4px;
  padding: 0.35rem 0.5rem;
  font-size: 0.875rem;
  color: var(--text-3);
  cursor: pointer;
}
.btn-cancel-col:hover { background: rgba(0,0,0,.08); }
</style>
