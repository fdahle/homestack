<template>
  <div
    class="debug-panel"
    :style="panelStyle"
    @mousedown.self="startDrag"
  >
    <div class="debug-header" @mousedown="startDrag">
      <span class="debug-title">🛠 Debug</span>
      <button class="debug-close" @click="$emit('close')" title="Close">✕</button>
    </div>

    <div class="debug-body">
      <div class="debug-row">
        <label>Add notes:</label>
        <input v-model.number="count" type="number" min="1" max="100" class="debug-count" />
        <button class="debug-btn primary" @click="addRandomNotes" :disabled="adding">
          {{ adding ? 'Adding…' : 'Add' }}
        </button>
      </div>

      <div class="debug-row">
        <button class="debug-btn danger" @click="confirmDeleteAll">Delete all notes</button>
      </div>

      <div class="debug-divider" />

      <div class="debug-row">
        <label>Slow network:</label>
        <select :value="store.networkDelay" @change="store.setNetworkDelay(+$event.target.value)" class="debug-select">
          <option :value="0">Off</option>
          <option :value="300">300 ms</option>
          <option :value="1000">1 s</option>
          <option :value="3000">3 s</option>
          <option :value="5000">5 s</option>
        </select>
      </div>

      <div v-if="lastAction" class="debug-status">{{ lastAction }}</div>
    </div>
  </div>
</template>

<script>
import { useNotesStore } from '../stores/notes.js'

const TITLES = [
  'Meeting notes',
  'Ideas for the weekend',
  'Shopping list',
  'Project roadmap',
  'Book recommendations',
  'Bug report',
  'Feature request',
  'Daily standup',
  'Travel plans',
  'Random thoughts',
  'TODO',
  'Recipes to try',
  'Workout log',
  'Reading list',
  'Goals for Q2',
]

const BODIES = [
  'This is a short note.',
  'Remember to follow up on this later.',
  'Need to check with the team before deciding.',
  `- Item one\n- Item two\n- Item three`,
  `## Heading\n\nSome content here with **bold** and _italic_ text.`,
  `Milk\nEggs\nBread\nCoffee\nOrange juice`,
  `Call dentist\nPick up package\nReply to emails`,
  `Long note: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.`,
  `Very long note:\n\nDuis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.\n\nSed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.`,
  `**Action items:**\n1. Review PR\n2. Update docs\n3. Deploy to staging`,
  '',
  'Just a quick reminder.',
  `\`\`\`js\nconst x = 42\nconsole.log(x)\n\`\`\``,
  `> This is a blockquote\n\nSome text after.`,
  `Talk to Alice about the budget.\nSlack Bob the updated figures.\nSchedule review for Friday.`,
]

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomTitle(existingTitles) {
  // 40% chance of reusing an existing note title
  if (existingTitles.length && Math.random() < 0.4) {
    return pickRandom(existingTitles)
  }
  return pickRandom(TITLES)
}

export default {
  name: 'DebugPanel',
  emits: ['close'],

  setup() {
    return { store: useNotesStore() }
  },

  data() {
    return {
      count: 5,
      adding: false,
      lastAction: '',
      // position
      x: window.innerWidth  - 280,
      y: window.innerHeight - 220,
      // drag state
      dragging: false,
      dragOffsetX: 0,
      dragOffsetY: 0,
    }
  },

  computed: {
    panelStyle() {
      return {
        transform: `translate(${this.x}px, ${this.y}px)`,
      }
    },
  },

  beforeUnmount() {
    this.stopDrag()
  },

  methods: {
    // ── Drag ────────────────────────────────────────────────────────
    startDrag(e) {
      if (e.button !== 0) return
      this.dragging = true
      this.dragOffsetX = e.clientX - this.x
      this.dragOffsetY = e.clientY - this.y
      window.addEventListener('mousemove', this.onMouseMove)
      window.addEventListener('mouseup',   this.stopDrag)
    },

    onMouseMove(e) {
      if (!this.dragging) return
      this.x = e.clientX - this.dragOffsetX
      this.y = e.clientY - this.dragOffsetY
    },

    stopDrag() {
      this.dragging = false
      window.removeEventListener('mousemove', this.onMouseMove)
      window.removeEventListener('mouseup',   this.stopDrag)
    },

    // ── Actions ─────────────────────────────────────────────────────
    async addRandomNotes() {
      if (this.adding) return
      this.adding = true
      this.lastAction = ''

      const existingTitles = this.store.notes
        .map(n => n.title)
        .filter(Boolean)

      for (let i = 0; i < this.count; i++) {
        await this.store.addNote({
          title:   randomTitle(existingTitles),
          content: pickRandom(BODIES),
        })
      }

      this.lastAction = `Added ${this.count} note${this.count !== 1 ? 's' : ''}.`
      this.adding = false
    },

    async confirmDeleteAll() {
      const total = this.store.notes.length
      if (!total) { this.lastAction = 'No notes to delete.'; return }
      if (!confirm(`Delete all ${total} notes permanently? This cannot be undone.`)) return
      // Soft-delete then permanently remove all notes
      for (const note of [...this.store.notes]) {
        if (!note.deletedAt) await this.store.deleteNote(note)
        await this.store.permanentlyDelete(note)
      }
      this.lastAction = `Deleted ${total} note${total !== 1 ? 's' : ''}.`
    },
  },
}
</script>

<style scoped>
.debug-panel {
  position: fixed;
  top: 0;
  left: 0;
  width: 260px;
  background: #1e1e2e;
  color: #cdd6f4;
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,.45);
  z-index: 9999;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 0.85rem;
  user-select: none;
  border: 1px solid #45475a;
}

.debug-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  background: #181825;
  border-radius: 10px 10px 0 0;
  cursor: grab;
  border-bottom: 1px solid #45475a;
}
.debug-header:active { cursor: grabbing; }

.debug-title {
  font-weight: 600;
  font-size: 0.82rem;
  letter-spacing: 0.02em;
  color: #89b4fa;
}

.debug-close {
  background: none;
  border: none;
  color: #6c7086;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 4px;
}
.debug-close:hover { background: #313244; color: #f38ba8; }

.debug-body {
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.debug-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.debug-row label {
  color: #a6adc8;
  white-space: nowrap;
}

.debug-count {
  width: 52px;
  background: #313244;
  border: 1px solid #45475a;
  border-radius: 5px;
  color: #cdd6f4;
  padding: 0.2rem 0.4rem;
  font-size: 0.85rem;
  text-align: center;
}

.debug-btn {
  border: none;
  border-radius: 5px;
  padding: 0.25rem 0.7rem;
  font-size: 0.82rem;
  cursor: pointer;
  font-family: inherit;
  font-weight: 500;
  transition: opacity 0.12s;
}
.debug-btn:disabled { opacity: 0.45; cursor: default; }

.debug-btn.primary {
  background: #89b4fa;
  color: #1e1e2e;
}
.debug-btn.primary:hover:not(:disabled) { background: #74c7ec; }

.debug-btn.danger {
  background: #f38ba8;
  color: #1e1e2e;
}
.debug-btn.danger:hover { background: #eba0ac; }

.debug-status {
  color: #a6e3a1;
  font-size: 0.78rem;
  padding-top: 0.1rem;
}

.debug-divider {
  border-top: 1px solid #45475a;
  margin: 0.1rem 0;
}

.debug-select {
  background: #313244;
  border: 1px solid #45475a;
  border-radius: 5px;
  color: #cdd6f4;
  padding: 0.2rem 0.4rem;
  font-size: 0.82rem;
  font-family: inherit;
  cursor: pointer;
}
</style>
