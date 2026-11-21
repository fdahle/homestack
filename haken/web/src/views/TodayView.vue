<script setup>
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { lang, t } from '../i18n.js';
import { isoDate, toDate } from '../lib/dates.js';
import { byDone, byUrgency, liveTasks, openTasks, store, today, updateTask } from '../store/tasks.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import SplitView from '../kit/components/SplitView.vue';
import QuickAdd from '../components/QuickAdd.vue';
import TaskRow from '../components/TaskRow.vue';
import SyncState from '../components/SyncState.vue';

// Today: what's overdue, what's due today (most important first), and what you did today
const route = useRoute();

const overdue = computed(() => openTasks.value.filter((x) => x.due_date && x.due_date < today.value).sort(byUrgency));
const todays = computed(() => openTasks.value.filter((x) => x.due_date === today.value).sort(byUrgency));
const doneToday = computed(() => liveTasks.value.filter((x) => x.done_at && isoDate(new Date(x.done_at)) === today.value).sort(byDone));
const showDone = ref(false);

const dateLine = computed(() => new Intl.DateTimeFormat(lang.value, { weekday: 'long', day: 'numeric', month: 'long' }).format(toDate(today.value)));
const link = (task) => ({ name: 'today-task', params: { id: task.id } });
const visible = (task) => task.due_date && task.due_date <= today.value;

function allToToday() {
  for (const task of overdue.value) updateTask(task.id, { due_date: today.value });
}
</script>

<template>
  <SplitView>
    <TopBar :title="t('today.title')">
      <SyncState />
      <RouterLink to="/settings" class="icon-btn phone-only" :aria-label="t('nav.settings')"><Icon name="gear" /></RouterLink>
    </TopBar>
    <main>
      <p class="date-line muted">{{ dateLine }}</p>
      <QuickAdd :defaults="{ due_date: today }" :visible="visible" />

      <p v-if="!store.ready" class="muted center">{{ t('task.loading') }}</p>
      <template v-else>
        <section v-if="overdue.length" class="task-section">
          <h2 class="section overdue-title">
            {{ t('today.overdue') }} <span class="count">{{ overdue.length }}</span>
            <button class="link-btn small section-link" @click="allToToday"><Icon name="sun" />{{ t('when.today') }}</button>
          </h2>
          <div class="tasks">
            <TaskRow v-for="task in overdue" :key="task.id" :task="task" :to="link(task)" :selected="route.params.id === task.id" show-list />
          </div>
        </section>

        <section class="task-section">
          <h2 v-if="overdue.length" class="section">{{ t('when.today') }} <span class="count">{{ todays.length }}</span></h2>
          <div v-if="todays.length" class="tasks">
            <TaskRow v-for="task in todays" :key="task.id" :task="task" :to="link(task)" :selected="route.params.id === task.id" :show-date="false" show-list />
          </div>
          <div v-else-if="!overdue.length" class="empty small-empty">
            <img src="/icon.svg" alt="" width="56" height="56" />
            <p>{{ store.tasks.size ? t('today.empty') : t('today.emptyFirst') }}</p>
          </div>
        </section>

        <section v-if="doneToday.length" class="task-section">
          <button class="section done-toggle" :aria-expanded="showDone" @click="showDone = !showDone">
            <Icon :name="showDone ? 'chevron-down' : 'chevron-right'" />{{ t('today.doneToday', { n: doneToday.length }) }}
          </button>
          <div v-if="showDone" class="tasks">
            <TaskRow v-for="task in doneToday" :key="task.id" :task="task" :to="link(task)" :selected="route.params.id === task.id" :show-date="false" />
          </div>
        </section>
      </template>
    </main>
  </SplitView>
</template>
