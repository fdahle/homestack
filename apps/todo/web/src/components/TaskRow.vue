<script setup>
import { computed, ref } from 'vue';
import { t } from '../i18n.js';
import { dayLabel, repeatLabel, timeLabel } from '../lib/labels.js';
import { reopenTask, store, tick, today, updateSubtask } from '../store/tasks.js';
import Icon from '../kit/components/Icon.vue';

// One task in a list: the circle to tick it off (its colour is the priority), the title,
// and a line with what else there is. Subtasks fold open right here.
const props = defineProps({
  task: { type: Object, required: true },
  to: { type: [String, Object], required: true },
  selected: Boolean,
  showList: Boolean,
  showDate: { type: Boolean, default: true },
});

const done = computed(() => Boolean(props.task.done_at));
const subtasksDone = computed(() => props.task.subtasks.filter((s) => s.done).length);
const overdue = computed(() => !done.value && props.task.due_date && props.task.due_date < today.value);
const list = computed(() => (props.showList && props.task.list_id ? store.lists.get(props.task.list_id) : null));
const open = ref(false);

function toggle() {
  if (done.value) reopenTask(props.task.id);
  else tick(props.task.id);
}
</script>

<template>
  <div class="task-row" :class="[`p${task.priority}`, { done, selected }]">
    <button
      class="check"
      role="checkbox"
      :aria-checked="done"
      :aria-label="done ? t('task.reopen') : t('task.complete')"
      :title="done ? t('task.reopen') : t('task.complete')"
      @click="toggle"
    >
      <Icon name="check" />
    </button>
    <RouterLink :to="to" class="task-main" :aria-current="selected ? 'page' : undefined">
      <span class="task-title">{{ task.title || '…' }}</span>
      <span v-if="(showDate && task.due_date) || task.due_time || task.repeat || task.note || list" class="task-meta">
        <span v-if="showDate && task.due_date" :class="{ overdue }"><Icon name="calendar" />{{ dayLabel(task.due_date, today) }}</span>
        <span v-if="task.due_time" :class="{ overdue: overdue && !showDate }"><Icon name="clock" />{{ timeLabel(task.due_time) }}</span>
        <span v-if="task.repeat" :title="repeatLabel(task.repeat)"><Icon name="repeat" /><span class="desktop-only">{{ repeatLabel(task.repeat) }}</span></span>
        <span v-if="task.note" :title="t('task.hasNote')"><Icon name="note" /></span>
        <span v-if="list" class="list-name" :class="list.color && `c-${list.color}`"><i class="dot"></i>{{ list.name }}</span>
      </span>
    </RouterLink>
    <button
      v-if="task.subtasks.length"
      class="sub-toggle"
      :class="{ open, complete: subtasksDone === task.subtasks.length }"
      :aria-expanded="open"
      :aria-label="t('task.showSubtasks')"
      @click="open = !open"
    >
      {{ subtasksDone }}/{{ task.subtasks.length }}<Icon name="chevron-down" />
    </button>
  </div>
  <ul v-if="open && task.subtasks.length" class="subtasks-inline">
    <li v-for="s in task.subtasks" :key="s.id" :class="{ done: s.done }">
      <label>
        <input type="checkbox" :checked="s.done" @change="updateSubtask(task.id, s.id, { done: $event.target.checked })" />
        <span>{{ s.title }}</span>
      </label>
    </li>
  </ul>
</template>
