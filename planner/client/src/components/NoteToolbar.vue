<template>
  <div class="note-toolbar" @click.stop>
    <!-- Task toggle -->
    <button
      class="toolbar-btn"
      :class="{ 'toolbar-btn--active': effectiveIsTask }"
      :title="effectiveIsTask ? (isTask ? 'Remove task flag' : 'Task (auto-detected via due date)') : 'Mark as task'"
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

    <!-- Color -->
    <div class="toolbar-dropdown-wrap">
      <button
        class="toolbar-btn"
        :class="{ 'toolbar-btn--tinted': color }"
        title="Color"
        @click.stop="toggle('colorOpen')"
      >
        <AppIcon name="palette" :size="18" />
      </button>
      <ColorPicker
        v-if="colorOpen"
        :model-value="color"
        @update:model-value="onColorChange"
      />
    </div>

    <!-- Notification / reminder -->
    <div class="toolbar-dropdown-wrap">
      <button
        class="toolbar-btn"
        :class="{ 'toolbar-btn--active': notificationAt }"
        title="Reminder"
        @click.stop="toggle('notifOpen')"
      >
        <AppIcon name="bell" :size="18" />
        <span v-if="notificationAt" class="toolbar-notif-dot" />
      </button>
      <template v-if="notifOpen">
        <div v-if="store.notificationPermission === 'denied'" class="dropdown-panel dropdown-panel-up np-panel" @click.stop>
          <p class="np-blocked">Notifications blocked. Enable them in your browser settings.</p>
        </div>
        <NotificationPicker
          v-else
          :model-value="notificationAt"
          @update:model-value="onNotifChange"
        />
      </template>
    </div>

    <!-- More button — collapses the overflow group on mobile -->
    <button
      class="toolbar-btn toolbar-more-btn"
      :class="{ active: moreOpen }"
      title="More"
      @click.stop="toggleMore"
    >
      <AppIcon name="more-horizontal" :size="18" />
    </button>

    <!-- Overflow group: inline on desktop, a bottom sheet on mobile -->
    <div class="toolbar-overflow" :class="{ 'toolbar-overflow--open': moreOpen }" @click.stop>
      <!-- Scratch pad toggle -->
      <button
        class="toolbar-btn"
        :class="{ 'toolbar-btn--active': scratchOpen }"
        title="Scratch pad"
        @click.stop="$emit('update:scratchOpen', !scratchOpen)"
      >
        <AppIcon name="edit" :size="18" />
        <span class="tb-label">Scratch pad</span>
        <span v-if="scratchHasText" class="toolbar-notif-dot" />
      </button>

      <!-- View assignment -->
      <div v-if="showView" class="toolbar-dropdown-wrap">
        <button class="toolbar-btn" :class="{ active: viewDropdownOpen }" title="Move to view" @click.stop="toggle('viewDropdownOpen')">
          <AppIcon name="layers" :size="18" />
          <span class="tb-label">Move to view</span>
        </button>
        <div v-if="viewDropdownOpen" class="dropdown-panel dropdown-panel-up">
          <p class="np-label dropdown-title">Move to</p>
          <button class="dropdown-item" :class="{ selected: viewId === null && labels.length === 0 }" @click="setHome">Home</button>
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
            :class="{ 'toolbar-btn--active': dueDate }"
            title="Due date"
            @click.stop="toggle('dueDateOpen')"
          >
            <AppIcon name="calendar" :size="18" />
            <span class="tb-label">Due date</span>
            <span v-if="dueDate" class="toolbar-notif-dot" />
          </button>
          <div v-if="dueDateOpen" class="dropdown-panel dropdown-panel-up np-panel" @click.stop>
            <p class="np-label">Due date</p>
            <input type="date" :value="dueDate" class="np-input" @input="$emit('update:dueDate', $event.target.value || null)" />
            <template v-if="dueDate">
              <p class="np-label">Time (optional)</p>
              <input type="time" :value="dueTime" class="np-input" @input="$emit('update:dueTime', $event.target.value || null)" />
            </template>
            <div class="np-actions">
              <button v-if="dueDate" class="np-btn np-btn--remove" @click="clearDueDate">Remove</button>
              <button class="np-btn np-btn--set" @click="dueDateOpen = false">Done</button>
            </div>
          </div>
        </div>

        <!-- Priority -->
        <div class="toolbar-dropdown-wrap">
          <button
            class="toolbar-btn"
            :class="{ 'toolbar-btn--active': priority }"
            :title="priority ? `Priority: ${priority}` : 'Set priority'"
            @click.stop="toggle('priorityOpen')"
          >
            <AppIcon name="flag" :size="18" />
            <span class="tb-label">Priority</span>
            <span v-if="priority" class="priority-dot" :class="`priority-dot--${priority}`" />
          </button>
          <div v-if="priorityOpen" class="dropdown-panel dropdown-panel-up" @click.stop>
            <p class="np-label dropdown-title">Priority</p>
            <button class="dropdown-item priority-item" :class="{ selected: priority === 'high' }" @click="setPriority('high')">
              <span class="priority-dot priority-dot--high" /> High
            </button>
            <button class="dropdown-item priority-item" :class="{ selected: priority === 'medium' }" @click="setPriority('medium')">
              <span class="priority-dot priority-dot--medium" /> Medium
            </button>
            <button class="dropdown-item priority-item" :class="{ selected: priority === 'low' }" @click="setPriority('low')">
              <span class="priority-dot priority-dot--low" /> Low
            </button>
            <button v-if="priority" class="dropdown-item danger" @click="setPriority(null)">Remove priority</button>
          </div>
        </div>

        <!-- Recurrence -->
        <div class="toolbar-dropdown-wrap">
          <button
            class="toolbar-btn"
            :class="{ 'toolbar-btn--active': recurrence }"
            :title="recurrence ? `Repeats ${recurrence}` : 'Set recurrence'"
            @click.stop="toggle('recurrenceOpen')"
          >
            <AppIcon name="refresh" :size="18" />
            <span class="tb-label">Repeat</span>
            <span v-if="recurrence" class="toolbar-notif-dot" />
          </button>
          <div v-if="recurrenceOpen" class="dropdown-panel dropdown-panel-up" @click.stop>
            <p class="np-label dropdown-title">Repeat</p>
            <button class="dropdown-item" :class="{ selected: recurrence === 'daily' }"   @click="setRecurrence('daily')">Daily</button>
            <button class="dropdown-item" :class="{ selected: recurrence === 'weekly' }"  @click="setRecurrence('weekly')">Weekly</button>
            <button class="dropdown-item" :class="{ selected: recurrence === 'monthly' }" @click="setRecurrence('monthly')">Monthly</button>
            <button v-if="recurrence" class="dropdown-item danger" @click="setRecurrence(null)">Remove</button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script>
import { useNotesStore } from '../stores/notes.js'
import ColorPicker from './ColorPicker.vue'
import NotificationPicker from './NotificationPicker.vue'

export default {
  name: 'NoteToolbar',

  components: { ColorPicker, NotificationPicker },

  props: {
    isTask:         { type: Boolean, default: false },
    dueDate:        { type: String,  default: null },
    dueTime:        { type: String,  default: null },
    priority:       { type: String,  default: null },
    recurrence:     { type: String,  default: null },
    color:          { type: String,  default: null },
    notificationAt: { type: String,  default: null },
    viewId:         { type: String,  default: null },
    labels:         { type: Array,   default: () => [] },
    scratchOpen:    { type: Boolean, default: false },
    scratchHasText: { type: Boolean, default: false },
    showView:       { type: Boolean, default: true },
  },

  emits: [
    'update:isTask', 'update:dueDate', 'update:dueTime', 'update:priority',
    'update:recurrence', 'update:color', 'update:notificationAt',
    'update:viewId', 'update:labels', 'update:scratchOpen', 'attach-files',
  ],

  setup() {
    return { store: useNotesStore() }
  },

  data() {
    return {
      colorOpen:        false,
      notifOpen:        false,
      viewDropdownOpen: false,
      dueDateOpen:      false,
      priorityOpen:     false,
      recurrenceOpen:   false,
      moreOpen:         false,
    }
  },

  mounted() {
    // Close any open dropdown when clicking outside the toolbar.
    // Use the capture phase so the click still reaches us even when an
    // ancestor (e.g. the note modal's title row) stops propagation.
    this._globalClose = (e) => {
      if (this.$el.contains?.(e.target)) return
      this.closeAll()
    }
    window.addEventListener('click', this._globalClose, true)
  },

  beforeUnmount() {
    window.removeEventListener('click', this._globalClose, true)
  },

  computed: {
    effectiveIsTask() {
      return this.isTask || !!this.dueDate
    },
  },

  methods: {
    closeAll() {
      this.colorOpen        = false
      this.notifOpen        = false
      this.viewDropdownOpen = false
      this.dueDateOpen      = false
      this.priorityOpen     = false
      this.recurrenceOpen   = false
      this.moreOpen         = false
    },

    toggle(name) {
      const was = this[name]
      // Preserve the more sheet: overflow pickers (view/due/priority/recurrence)
      // render inline inside it on mobile, so it must stay open underneath them.
      const more = this.moreOpen
      this.closeAll()
      this.moreOpen = more
      this[name] = !was
    },

    // The more button toggles the overflow sheet (mobile only) and closes any
    // open picker so the two never stack.
    toggleMore() {
      const was = this.moreOpen
      this.closeAll()
      this.moreOpen = !was
    },

    toggleTaskFlag() {
      // Only toggle the explicit flag; if auto-detected via dueDate, clear dueDate too
      if (this.effectiveIsTask && !this.isTask) {
        this.$emit('update:dueDate', null)
      } else {
        this.$emit('update:isTask', !this.isTask)
      }
    },

    clearDueDate() {
      this.$emit('update:dueDate', null)
      this.$emit('update:dueTime', null)
      this.dueDateOpen = false
    },

    onColorChange(color) {
      this.$emit('update:color', color)
      this.colorOpen = false
    },

    onNotifChange(iso) {
      this.$emit('update:notificationAt', iso)
      if (iso) this.notifOpen = false   // keep open when removing so user sees result
    },

    setPriority(value) {
      this.$emit('update:priority', value)
      this.priorityOpen = false
    },

    setRecurrence(value) {
      this.$emit('update:recurrence', value)
      this.recurrenceOpen = false
    },

    setHome() {
      this.$emit('update:viewId', null)
      this.$emit('update:labels', [])
      this.viewDropdownOpen = false
    },

    isViewAssigned(viewId) {
      return this.viewId === viewId || this.labels.includes(viewId)
    },

    toggleViewAssignment(viewId) {
      if (this.viewId === viewId) {
        // Remove primary; promote first extra label, if any
        const [first, ...rest] = this.labels
        this.$emit('update:viewId', first ?? null)
        this.$emit('update:labels', rest)
      } else if (this.labels.includes(viewId)) {
        this.$emit('update:labels', this.labels.filter(id => id !== viewId))
      } else if (!this.viewId) {
        this.$emit('update:viewId', viewId)
      } else {
        this.$emit('update:labels', [...this.labels, viewId])
      }
    },

    triggerAttachInput() {
      this.$refs.attachInput?.click()
    },

    onAttachFilesSelected(event) {
      const files = Array.from(event.target.files || [])
      if (files.length) this.$emit('attach-files', files)
      event.target.value = ''
    },
  },
}
</script>

<style scoped>
.note-toolbar {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex: 1;
  min-width: 0;
}

/* Overflow group is inline on desktop; the more button is hidden. */
.toolbar-overflow { display: contents; }
.toolbar-more-btn { display: none; }
.tb-label { display: none; }

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

/* Blue dot indicator (notification, due date, recurrence, scratch) */
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
.dropdown-item.selected { font-weight: 600; }
.dropdown-item.danger { color: var(--danger); }
.dropdown-item.danger:hover { background: var(--danger-bg); }

.dropdown-title {
  padding: 0.3rem 1rem 0;
  margin: 0 0 4px;
}

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

.toolbar-sep {
  width: 1px;
  height: 18px;
  background: rgba(0,0,0,.12);
  margin: 0 0.1rem;
  align-self: center;
  flex-shrink: 0;
}

@media (max-width: 640px) {
  /* Show the more button; the overflow group becomes a bottom sheet. */
  .toolbar-more-btn { display: flex; }

  .toolbar-overflow { display: none; }

  .toolbar-overflow--open {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.1rem;
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--surface);
    border-top: 1px solid var(--border);
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -4px 24px rgba(0,0,0,.18);
    padding: 0.5rem;
    max-height: 75vh;
    overflow-y: auto;
    z-index: 310;
  }

  /* Labeled, full-width rows inside the sheet. */
  .toolbar-overflow--open .tb-label { display: inline; font-size: 0.95rem; }
  .toolbar-overflow--open .toolbar-dropdown-wrap { width: 100%; }
  .toolbar-overflow--open .toolbar-btn {
    width: 100%;
    justify-content: flex-start;
    gap: 0.7rem;
    padding: 0.7rem 0.6rem;
    border-radius: 8px;
    color: var(--text-1);
  }

  /* Move the small indicator dots to the right edge of each row. */
  .toolbar-overflow--open .toolbar-notif-dot,
  .toolbar-overflow--open .priority-dot {
    position: static;
    margin-left: auto;
    border: none;
  }

  /* Overflow pickers flow inline within the sheet instead of floating. */
  .toolbar-overflow .dropdown-panel,
  .toolbar-overflow .np-panel {
    position: static;
    box-shadow: none;
    border: none;
    border-radius: 0;
    min-width: 0;
    width: 100%;
    padding: 0.25rem 0.6rem 0.5rem;
  }

  /* Separator becomes a full-width divider in the column layout. */
  .toolbar-overflow--open .toolbar-sep {
    width: 100%;
    height: 1px;
    margin: 0.3rem 0;
    align-self: stretch;
  }
}
</style>
