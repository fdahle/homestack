<template>
  <div class="calendar" @wheel="onWheel">
    <header class="cal-header">
      <div class="cal-nav-group">
        <button class="cal-nav" title="Previous month" @click="shiftMonth(-1)">‹</button>
        <span class="cal-title">{{ monthLabel }}</span>
        <button class="cal-nav" title="Next month" @click="shiftMonth(1)">›</button>
      </div>
      <button class="cal-today" @click="goToday">Today</button>
    </header>

    <div class="cal-weekdays">
      <span
        v-for="(d, i) in weekdayLabels"
        :key="d"
        class="cal-weekday"
        :class="{ 'cal-weekday--weekend': i >= 5 }"
      >{{ d }}</span>
    </div>

    <div class="cal-grid">
      <div
        v-for="cell in cells"
        :key="cell.iso"
        class="cal-cell"
        :class="{ 'cal-cell--out': !cell.inMonth, 'cal-cell--today': cell.isToday, 'cal-cell--weekend': cell.isWeekend }"
        @click="$emit('create-on-day', cell.iso)"
      >
        <span class="cal-daynum">{{ cell.day }}</span>
        <div class="cal-tasks">
          <button
            v-for="task in cell.tasks"
            :key="task._id"
            class="cal-task"
            :class="{ 'cal-task--done': task.done, 'cal-task--overdue': cell.isPast && !task.done }"
            :title="task.title || '(untitled)'"
            @click.stop="$emit('open', task)"
          >
            <span v-if="task.dueTime" class="cal-task-time">{{ task.dueTime }}</span>
            {{ task.title || '(untitled)' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { isTaskNote, localDateStr } from '../utils/dates.js'

export default {
  name: 'CalendarView',

  props: {
    notes: { type: Array, default: () => [] },
  },

  emits: ['open', 'create-on-day'],

  data() {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() } // month: 0-11
  },

  computed: {
    weekdayLabels() {
      return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    },

    monthLabel() {
      return new Date(this.year, this.month, 1)
        .toLocaleDateString([], { month: 'long', year: 'numeric' })
    },

    // Tasks grouped by their dueDate (YYYY-MM-DD), sorted by time then title.
    tasksByDate() {
      const map = {}
      for (const n of this.notes) {
        if (n.deletedAt || !isTaskNote(n) || !n.dueDate) continue
        ;(map[n.dueDate] ||= []).push(n)
      }
      for (const list of Object.values(map)) {
        list.sort((a, b) =>
          (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99') ||
          (a.title || '').localeCompare(b.title || ''))
      }
      return map
    },

    // Weeks × 7 days starting on the Monday on/before the 1st of the month.
    // Render only as many rows as the month needs, so a trailing row that
    // belongs entirely to the next month is skipped (usually 5 rows, 6 when
    // the month spills over, 4 for a February that starts on a Monday).
    cells() {
      const today = localDateStr()
      const first = new Date(this.year, this.month, 1)
      const offset = (first.getDay() + 6) % 7 // days since Monday
      const start = new Date(this.year, this.month, 1 - offset)
      const daysInMonth = new Date(this.year, this.month + 1, 0).getDate()
      const rows = Math.ceil((offset + daysInMonth) / 7)
      const out = []
      for (let i = 0; i < rows * 7; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
        const iso = localDateStr(d)
        const dow = d.getDay() // 0 = Sun, 6 = Sat
        out.push({
          iso,
          day:       d.getDate(),
          inMonth:   d.getMonth() === this.month,
          isToday:   iso === today,
          isPast:    iso < today,
          isWeekend: dow === 0 || dow === 6,
          tasks:     this.tasksByDate[iso] || [],
        })
      }
      return out
    },
  },

  methods: {
    shiftMonth(delta) {
      const d = new Date(this.year, this.month + delta, 1)
      this.year = d.getFullYear()
      this.month = d.getMonth()
    },
    goToday() {
      const now = new Date()
      this.year = now.getFullYear()
      this.month = now.getMonth()
    },
    // Scroll the wheel anywhere over the calendar to page through months.
    // Cooldown + threshold keep trackpads from flipping several months at once.
    onWheel(e) {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (Math.abs(delta) < 8) return
      e.preventDefault()
      const now = Date.now()
      if (now - (this._lastWheel || 0) < 250) return
      this._lastWheel = now
      this.shiftMonth(delta > 0 ? 1 : -1)
    },
  },
}
</script>

<style scoped>
.calendar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.cal-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.5rem;
}

.cal-nav-group {
  grid-column: 2;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
}

.cal-title {
  font-weight: 600;
  font-size: 1.05rem;
  min-width: 9rem;
  text-align: center;
}

.cal-nav,
.cal-today {
  background: var(--surface, #fff);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 0.4rem;
  cursor: pointer;
  color: var(--text, #1e293b);
}

.cal-nav {
  width: 2rem;
  height: 2rem;
  font-size: 1.2rem;
  line-height: 1;
}

.cal-today {
  grid-column: 3;
  justify-self: end;
  padding: 0.35rem 0.7rem;
  font-size: 0.85rem;
}

.cal-weekdays,
.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.cal-weekday {
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-muted, #94a3b8);
  padding: 0.25rem 0;
}
.cal-weekday--weekend { color: var(--accent, #6366f1); font-weight: 600; }

.cal-cell {
  min-height: 6.5rem;
  background: var(--surface, #fff);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 0.4rem;
  padding: 0.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  overflow: hidden;
  cursor: pointer;
}

/* Subtle shading so weekends read differently from weekdays. */
.cal-cell--weekend {
  background: var(--surface-3, #f1f5f9);
}

.cal-cell--out {
  opacity: 0.45;
}

.cal-cell--today {
  border-color: var(--accent, #6366f1);
  box-shadow: inset 0 0 0 1px var(--accent, #6366f1);
}

.cal-daynum {
  font-size: 0.8rem;
  color: var(--text-muted, #64748b);
  align-self: flex-end;
}

.cal-tasks {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.cal-task {
  text-align: left;
  font-size: 0.75rem;
  padding: 0.15rem 0.3rem;
  border: none;
  border-radius: 0.3rem;
  background: var(--accent-soft, #e0e7ff);
  color: var(--text, #1e293b);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cal-task-time {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  margin-right: 0.2rem;
}

.cal-task--done {
  text-decoration: line-through;
  opacity: 0.6;
}

.cal-task--overdue {
  background: var(--danger-soft, #fee2e2);
}

/* ── Mobile: compact grid so the month isn't squeezed ───────────────── */
@media (max-width: 640px) {
  .calendar { gap: 0.4rem; }

  .cal-header { gap: 0.25rem; }

  .cal-title {
    font-size: 0.9rem;
    min-width: 0;
  }

  .cal-nav {
    width: 1.75rem;
    height: 1.75rem;
    font-size: 1rem;
  }

  .cal-today {
    padding: 0.3rem 0.55rem;
    font-size: 0.78rem;
  }

  .cal-weekdays,
  .cal-grid { gap: 1px; }

  .cal-weekday {
    font-size: 0.62rem;
    padding: 0.15rem 0;
  }

  .cal-cell {
    min-height: 3.75rem;
    padding: 0.15rem;
    border-radius: 0.3rem;
  }

  .cal-daynum { font-size: 0.7rem; }

  .cal-task {
    font-size: 0.62rem;
    padding: 0.1rem 0.2rem;
    border-radius: 0.25rem;
  }

  /* Time prefix eats too much width in a narrow cell — drop it. */
  .cal-task-time { display: none; }
}
</style>
