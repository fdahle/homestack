<script setup>
import { computed } from 'vue';
import { lang, t, weekdayNames } from '../i18n.js';
import { addDays, addMonths, toDate, weekStart } from '../lib/dates.js';
import { areaOpenTasks, today } from '../store/tasks.js';
import Icon from '../kit/components/Icon.vue';

// A month to see which days have tasks. Each day shows up to three dots (in the colour of
// the most important tasks) and a number when there are more. A tap picks the day. The area shown.
const props = defineProps({ month: { type: String, required: true }, selected: String }); // month: 'YYYY-MM-01'
const emit = defineEmits(['update:month', 'select']);

const title = computed(() => new Intl.DateTimeFormat(lang.value, { month: 'long', year: 'numeric' }).format(toDate(props.month)));

const byDay = computed(() => {
  const map = new Map();
  for (const task of areaOpenTasks.value) {
    if (!task.due_date) continue;
    // Overdue tasks count on today
    const day = task.due_date < today.value ? today.value : task.due_date;
    if (!map.has(day)) map.set(day, []);
    map.get(day).push(task);
  }
  for (const list of map.values()) list.sort((a, b) => b.priority - a.priority);
  return map;
});

const weeks = computed(() => {
  const first = weekStart(props.month);
  const last = addDays(addMonths(props.month, 1), -1);
  const out = [];
  for (let start = first; start <= last; start = addDays(start, 7)) {
    out.push(Array.from({ length: 7 }, (_, i) => {
      const date = addDays(start, i);
      return { date, day: Number(date.slice(8)), inMonth: date.slice(0, 7) === props.month.slice(0, 7), tasks: byDay.value.get(date) || [] };
    }));
  }
  return out;
});
</script>

<template>
  <div class="month">
    <div class="month-head">
      <button class="icon-btn" :aria-label="t('upcoming.prevMonth')" @click="emit('update:month', addMonths(month, -1, 1))"><Icon name="back" /></button>
      <h2>{{ title }}</h2>
      <button class="icon-btn" :aria-label="t('upcoming.nextMonth')" @click="emit('update:month', addMonths(month, 1, 1))"><Icon name="forward" /></button>
    </div>
    <div class="month-grid" role="grid">
      <span v-for="name in weekdayNames()" :key="name" class="wd">{{ name }}</span>
      <template v-for="week in weeks" :key="week[0].date">
        <button
          v-for="d in week"
          :key="d.date"
          class="day"
          :class="{ out: !d.inMonth, today: d.date === today, selected: d.date === selected, past: d.date < today }"
          :aria-label="d.date"
          :aria-pressed="d.date === selected"
          @click="emit('select', d.date)"
        >
          <span class="num">{{ d.day }}</span>
          <span v-if="d.tasks.length" class="dots">
            <i v-for="task in d.tasks.slice(0, 3)" :key="task.id" :class="`p${task.priority}`"></i>
            <small v-if="d.tasks.length > 3">+{{ d.tasks.length - 3 }}</small>
          </span>
        </button>
      </template>
    </div>
  </div>
</template>
