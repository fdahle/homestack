<template>
  <div class="np-panel" @click.stop>
    <!-- Quick time slots -->
    <p class="np-label">Quick pick</p>
    <button
      v-for="slot in quickSlots"
      :key="slot.iso"
      class="np-slot"
      :class="{ 'np-slot--active': modelValue === slot.iso }"
      @click="pick(slot.iso)"
    >
      <span class="np-slot-day">{{ slot.dayLabel }}</span>
      <span class="np-slot-time">{{ slot.timeLabel }}</span>
    </button>

    <div class="np-divider" />

    <!-- Custom date + time -->
    <p class="np-label">Custom</p>
    <div class="np-row">
      <input type="date" v-model="customDate" class="np-input np-input--date" :min="todayStr" />
      <input type="time" v-model="customTime" class="np-input np-input--time" />
    </div>

    <div class="np-actions">
      <button v-if="modelValue" class="np-btn np-btn--remove" @click="pick(null)">Remove</button>
      <button
        class="np-btn np-btn--set"
        :disabled="!customDate || !customTime"
        @click="applyCustom"
      >Set</button>
    </div>
  </div>
</template>

<script>
const SLOT_HOURS = [8, 12, 16, 20]

function getQuickSlots() {
  const now = new Date()
  const results = []
  for (let day = 0; day <= 1 && results.length < 2; day++) {
    for (const h of SLOT_HOURS) {
      if (results.length >= 2) break
      const d = new Date(now)
      d.setDate(d.getDate() + day)
      d.setHours(h, 0, 0, 0)
      if (d > now) results.push(d)
    }
  }
  return results
}

function dayLabel(d) {
  const today    = new Date()
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  if (d.toDateString() === today.toDateString())    return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function timeLabel(d) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function toDateStr(d) { return d.toISOString().slice(0, 10) }
function toTimeStr(d) { return d.toTimeString().slice(0, 5) }

export default {
  name: 'NotificationPicker',

  props: {
    modelValue: { type: String, default: null },
  },

  emits: ['update:modelValue'],

  data() {
    const now     = new Date()
    const initDt  = this.modelValue ? new Date(this.modelValue) : null
    return {
      quickSlots: getQuickSlots().map(d => ({
        iso:       d.toISOString(),
        dayLabel:  dayLabel(d),
        timeLabel: timeLabel(d),
      })),
      todayStr:   toDateStr(now),
      customDate: initDt ? toDateStr(initDt) : toDateStr(now),
      customTime: initDt ? toTimeStr(initDt) : toTimeStr(now),
    }
  },

  methods: {
    pick(iso) {
      this.$emit('update:modelValue', iso)
    },
    applyCustom() {
      if (!this.customDate || !this.customTime) return
      const dt = new Date(`${this.customDate}T${this.customTime}:00`)
      this.$emit('update:modelValue', dt.toISOString())
    },
  },
}
</script>

<style scoped>
.np-panel {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 300;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0,0,0,.14);
  padding: 10px 12px 12px;
  width: 210px;
}

.np-label {
  margin: 0 0 4px;
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.np-slot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  border: none;
  background: none;
  border-radius: 5px;
  padding: 5px 6px;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.85rem;
  color: var(--text-1);
  text-align: left;
  transition: background 0.1s;
}
.np-slot:hover { background: var(--surface-3); }
.np-slot--active { background: var(--accent-bg); color: var(--accent); }

.np-slot-day  { font-weight: 500; }
.np-slot-time { font-size: 0.78rem; color: var(--text-3); }
.np-slot--active .np-slot-time { color: var(--accent); }

.np-divider {
  height: 1px;
  background: var(--border);
  margin: 8px 0;
}

.np-row {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}

.np-input {
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 4px 5px;
  font-size: 0.78rem;
  font-family: inherit;
  color: var(--text-1);
  outline: none;
  background: var(--surface);
  min-width: 0;
}
.np-input:focus { border-color: var(--accent); }
.np-input--date { flex: 1.4; }
.np-input--time { flex: 1; }

.np-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}

.np-btn {
  border: none;
  border-radius: 5px;
  padding: 4px 12px;
  font-size: 0.8rem;
  font-family: inherit;
  cursor: pointer;
  font-weight: 500;
  transition: background 0.1s;
}

.np-btn--set {
  background: var(--accent);
  color: #fff;
}
.np-btn--set:hover:not(:disabled) { background: var(--accent-h); }
.np-btn--set:disabled { opacity: 0.45; cursor: default; }

.np-btn--remove {
  background: none;
  color: var(--danger);
}
.np-btn--remove:hover { background: var(--danger-bg); }

/* On mobile the picker becomes a bottom sheet so it never overflows the edge. */
@media (max-width: 640px) {
  .np-panel {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    top: auto;
    width: auto;
    max-width: 100%;
    border-radius: 16px 16px 0 0;
    max-height: 70vh;
    overflow-y: auto;
    padding: 16px;
    z-index: 320;
  }
}
</style>
