<template>
  <div class="checklist-editor">

    <!-- Active (unchecked) items -->
    <div
      v-for="(item, localIdx) in uncheckedItems"
      :key="item.id"
      class="checklist-row"
    >
      <input
        type="checkbox"
        class="checklist-checkbox"
        @change="toggleItem(item.id, true)"
      />
      <textarea
        :value="item.label"
        rows="1"
        class="checklist-label"
        placeholder="List item"
        :ref="el => setRef(item.id, el)"
        @input="onLabelInput(item.id, $event)"
        @keydown.enter.prevent="addAfterUnchecked(localIdx)"
        @keydown.backspace="onBackspace(item.id, $event)"
        @keydown.up.prevent="onArrowKey(item.id, -1)"
        @keydown.down.prevent="onArrowKey(item.id, 1)"
      />
    </div>

    <!-- Finished section — only visible when there are checked items -->
    <template v-if="checkedItems.length">
      <div v-if="uncheckedItems.length" class="checklist-finished-header"></div>
      <div
        v-for="item in checkedItems"
        :key="item.id"
        class="checklist-row checklist-row--checked"
      >
        <input
          type="checkbox"
          checked
          class="checklist-checkbox"
          @change="toggleItem(item.id, false)"
        />
        <textarea
          :value="item.label"
          rows="1"
          class="checklist-label checklist-label--checked"
          :ref="el => setRef(item.id, el)"
          @input="onLabelInput(item.id, $event)"
          @keydown.enter.prevent="addItemAtEnd"
          @keydown.backspace="onBackspace(item.id, $event)"
          @keydown.up.prevent="onArrowKey(item.id, -1)"
          @keydown.down.prevent="onArrowKey(item.id, 1)"
        />
      </div>
    </template>

    <button class="checklist-add" @click="addItemAtEnd">+ Add item</button>
  </div>
</template>

<script>
const CHECKBOX_RE = /^\s*[-*+] \[( |x|X)\] (.*)$/
let _nextId = 0

function parseMarkdown(markdown) {
  const items = []
  for (const line of (markdown || '').split('\n')) {
    const m = line.match(CHECKBOX_RE)
    if (m) items.push({ id: _nextId++, checked: m[1] !== ' ', label: m[2] })
  }
  return items.length ? items : [{ id: _nextId++, checked: false, label: '' }]
}

function toMarkdown(items) {
  const unchecked = items.filter(i => !i.checked)
  const checked   = items.filter(i =>  i.checked)
  return [...unchecked, ...checked].map(i => `- [${i.checked ? 'x' : ' '}] ${i.label}`).join('\n')
}

export default {
  name: 'ChecklistEditor',

  props: {
    modelValue: { type: String, default: '' },
  },

  emits: ['update:modelValue'],

  data() {
    return {
      items: parseMarkdown(this.modelValue),
      inputRefs: {},
      _internalUpdate: false,
    }
  },

  computed: {
    uncheckedItems() { return this.items.filter(i => !i.checked) },
    checkedItems()   { return this.items.filter(i =>  i.checked) },
    visibleItems()   { return [...this.uncheckedItems, ...this.checkedItems] },
  },

  watch: {
    modelValue(value) {
      if (this._internalUpdate) {
        this._internalUpdate = false
        return
      }
      if (value !== toMarkdown(this.items)) {
        this.items = parseMarkdown(value)
      }
    },
  },

  mounted() {
    this.$nextTick(() => this.growAll())
  },

  updated() {
    // Keep every row sized to its (possibly wrapped) content after re-renders.
    this.growAll()
  },

  methods: {
    setRef(id, el) {
      if (el) this.inputRefs[id] = el
      else delete this.inputRefs[id]
    },

    grow(el) {
      if (!el) return
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    },

    growAll() {
      Object.values(this.inputRefs).forEach(el => this.grow(el))
    },

    onLabelInput(id, event) {
      this.grow(event.target)
      this.updateLabel(id, event.target.value)
    },

    // Focus the last visible row (used when clicking empty editor space).
    focusLast() {
      const last = this.visibleItems[this.visibleItems.length - 1]
      const el = last && this.inputRefs[last.id]
      if (el) {
        el.focus()
        const len = el.value.length
        try { el.setSelectionRange(len, len) } catch { /* noop */ }
      }
    },

    emit() {
      this._internalUpdate = true
      this.$emit('update:modelValue', toMarkdown(this.items))
    },

    toggleItem(id, checked) {
      const item = this.items.find(i => i.id === id)
      if (item) item.checked = checked
      this.emit()
    },

    updateLabel(id, label) {
      const item = this.items.find(i => i.id === id)
      if (item) item.label = label
      this.emit()
    },

    addAfterUnchecked(localIdx) {
      const target  = this.uncheckedItems[localIdx]
      const fullIdx = this.items.indexOf(target)
      const newItem = { id: _nextId++, checked: false, label: '' }
      this.items.splice(fullIdx + 1, 0, newItem)
      this.emit()
      this.$nextTick(() => this.inputRefs[newItem.id]?.focus())
    },

    addItemAtEnd() {
      const newItem = { id: _nextId++, checked: false, label: '' }
      // Insert at the end of the unchecked group (before any checked items)
      const lastUncheckedIdx = this.items.reduce((acc, item, idx) => !item.checked ? idx : acc, -1)
      this.items.splice(lastUncheckedIdx + 1, 0, newItem)
      this.emit()
      this.$nextTick(() => this.inputRefs[newItem.id]?.focus())
    },

    onArrowKey(id, direction) {
      const idx = this.visibleItems.findIndex(i => i.id === id)
      const target = this.visibleItems[idx + direction]
      if (target) this.inputRefs[target.id]?.focus()
    },

    onBackspace(id, event) {
      const item = this.items.find(i => i.id === id)
      if (!item || item.label !== '' || this.items.length <= 1) return
      event.preventDefault()
      const idx = this.items.indexOf(item)
      this.items.splice(idx, 1)
      this.emit()
      this.$nextTick(() => {
        const prev = this.items[Math.max(0, idx - 1)]
        if (prev) this.inputRefs[prev.id]?.focus()
      })
    },
  },
}
</script>

<style scoped>
.checklist-editor {
  display: flex;
  flex-direction: column;
  padding: 0.25rem 0;
  min-height: 8rem;
}

.checklist-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.1rem 0;
}

.checklist-checkbox {
  flex-shrink: 0;
  width: 1rem;
  height: 1rem;
  cursor: pointer;
  accent-color: var(--accent);
  /* Nudge down so it lines up with the first line of (possibly wrapped) text. */
  margin: 0.3rem 0 0;
}

.checklist-label {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  resize: none;
  overflow: hidden;
  font-size: 0.95rem;
  line-height: 1.7;
  color: var(--text-2);
  font-family: inherit;
  background: transparent;
  padding: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.checklist-label--checked {
  text-decoration: line-through;
  color: var(--text-muted);
}

.checklist-finished-header {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-top: 1px dashed var(--border-2);
  padding-top: 0.5rem;
  margin-top: 0.35rem;
  margin-bottom: 0.1rem;
}

.checklist-add {
  align-self: flex-start;
  margin-top: 0.4rem;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--text-muted);
  padding: 0.2rem 0;
  font-family: inherit;
}

.checklist-add:hover {
  color: var(--accent);
}
</style>
