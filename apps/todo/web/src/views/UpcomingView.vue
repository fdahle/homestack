<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '../i18n.js';
import { addDays } from '../lib/dates.js';
import { dayHeading } from '../lib/labels.js';
import { byUrgency, openTasks, store, today } from '../store/tasks.js';
import TopBar from '../kit/components/TopBar.vue';
import SplitView from '../kit/components/SplitView.vue';
import QuickAdd from '../components/QuickAdd.vue';
import TaskRow from '../components/TaskRow.vue';
import MonthView from '../components/MonthView.vue';
import SyncState from '../components/SyncState.vue';

// What's coming: day by day, or a month to look ahead. In the month, the day you pick is
// where a new task goes.
const route = useRoute();

const stored = (() => {
  try {
    return localStorage.getItem('todo-upcoming') || 'list';
  } catch {
    return 'list';
  }
})();
const mode = ref(stored);
watch(mode, (value) => {
  try {
    localStorage.setItem('todo-upcoming', value);
  } catch {
    // remembered for this visit only
  }
});

const days = computed(() => {
  const map = new Map();
  for (const task of openTasks.value) {
    if (!task.due_date || task.due_date <= today.value) continue;
    if (!map.has(task.due_date)) map.set(task.due_date, []);
    map.get(task.due_date).push(task);
  }
  return [...map].sort((a, b) => a[0].localeCompare(b[0])).map(([date, tasks]) => ({ date, tasks: tasks.sort(byUrgency) }));
});

const month = ref(`${today.value.slice(0, 7)}-01`);
const selected = ref(today.value);
const dayTasks = computed(() =>
  openTasks.value
    .filter((x) => x.due_date === selected.value || (selected.value === today.value && x.due_date && x.due_date < today.value))
    .sort(byUrgency));

const defaults = computed(() => ({ due_date: mode.value === 'month' ? selected.value : addDays(today.value, 1) }));
const visible = (task) => (mode.value === 'month' ? task.due_date === selected.value : task.due_date > today.value);
const link = (task) => ({ name: 'upcoming-task', params: { id: task.id } });
</script>

<template>
  <SplitView>
    <TopBar :title="t('upcoming.title')">
      <SyncState />
    </TopBar>
    <main>
      <div class="segmented wide view-switch" role="tablist">
        <button role="tab" :class="{ active: mode === 'list' }" :aria-selected="mode === 'list'" @click="mode = 'list'">{{ t('upcoming.asList') }}</button>
        <button role="tab" :class="{ active: mode === 'month' }" :aria-selected="mode === 'month'" @click="mode = 'month'">{{ t('upcoming.asMonth') }}</button>
      </div>

      <template v-if="mode === 'month'">
        <MonthView v-model:month="month" :selected="selected" @select="selected = $event" />
        <h2 class="section">{{ dayHeading(selected, today) }}</h2>
      </template>

      <QuickAdd :defaults="defaults" :visible="visible" />

      <p v-if="!store.ready" class="muted center">{{ t('task.loading') }}</p>
      <template v-else-if="mode === 'month'">
        <div v-if="dayTasks.length" class="tasks">
          <TaskRow v-for="task in dayTasks" :key="task.id" :task="task" :to="link(task)" :selected="route.params.id === task.id" :show-date="task.due_date !== selected" show-list />
        </div>
        <p v-else class="muted center">{{ t('upcoming.nothingThatDay') }}</p>
      </template>
      <template v-else>
        <p v-if="!days.length" class="empty">{{ t('upcoming.empty') }}</p>
        <section v-for="day in days" :key="day.date" class="task-section">
          <h2 class="section">{{ dayHeading(day.date, today) }} <span class="count">{{ day.tasks.length }}</span></h2>
          <div class="tasks">
            <TaskRow v-for="task in day.tasks" :key="task.id" :task="task" :to="link(task)" :selected="route.params.id === task.id" :show-date="false" show-list />
          </div>
        </section>
      </template>
    </main>
  </SplitView>
</template>
