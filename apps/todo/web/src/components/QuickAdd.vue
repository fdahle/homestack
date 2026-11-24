<script setup>
import { computed, ref, watch } from 'vue';
import { t } from '../i18n.js';
import { showToast, useShortcut } from '../util.js';
import { addDays, nextWeekday } from '../lib/dates.js';
import { dayLabel, repeatLabel, timeLabel } from '../lib/labels.js';
import { parseQuick } from '../lib/quick.js';
import { addTask, areaListId, lists, today } from '../store/tasks.js';
import Icon from '../kit/components/Icon.vue';
import DropMenu from './DropMenu.vue';

// The one field to add a task: type, Enter, done, and the field is ready for the next one.
// Dates, times, priority, list and repeats can be typed into the text ("morgen 9 Uhr !! #Haushalt")
// or set with the three buttons. `defaults` come from the page (Today: today; a list: that list);
// with an area shown, a task goes to the area's first list unless the page names one.
// `visible(task)`: whether the page shows the new task; if not, a toast says where it went.
const props = defineProps({
  defaults: { type: Object, default: () => ({}) },
  visible: { type: Function, default: () => true },
});
const emit = defineEmits(['added']);

const text = ref('');
const skip = ref([]);
const manual = ref({}); // set with the buttons; wins over the text
const input = ref(null);
const dateInput = ref(null);

const parsed = computed(() => parseQuick(text.value, { today: today.value, lists: lists.value, skip: skip.value }));
const fields = computed(() => ({ ...(areaListId.value && { list_id: areaListId.value }), ...props.defaults, ...parsed.value.fields, ...manual.value }));

watch(text, (value) => {
  if (!value.trim()) skip.value = [];
});

function add() {
  const title = parsed.value.title;
  if (!title) return;
  const task = addTask({ ...fields.value, title });
  emit('added', task);
  if (!props.visible(task)) {
    const when = task.due_date ? dayLabel(task.due_date, today.value) : lists.value.find((l) => l.id === task.list_id)?.name || t('lists.inbox');
    showToast(t('quick.addedFor', { when }));
  }
  text.value = '';
  manual.value = {};
  skip.value = [];
  input.value?.focus();
}

function set(key, value, close) {
  manual.value = { ...manual.value, [key]: value };
  close?.();
  input.value?.focus();
}

function pickDate(event, close) {
  if (event.target.value) set('due_date', event.target.value, close);
}

// The chips: what the text says, plus what the buttons set
const dateText = computed(() => {
  const f = fields.value;
  if (!f.due_date) return '';
  return [dayLabel(f.due_date, today.value), f.due_time && timeLabel(f.due_time)].filter(Boolean).join(' ');
});
const listName = computed(() => lists.value.find((l) => l.id === fields.value.list_id)?.name);

const CHIP_TEXT = {
  date: (c) => dayLabel(c.due_date, today.value),
  time: (c) => timeLabel(c.due_time),
  priority: (c) => t(`priority.${c.priority}`),
  list: (c) => c.listName,
  repeat: (c) => repeatLabel(c.repeat),
};
const CHIP_ICON = { date: 'calendar', time: 'clock', priority: 'priority', list: 'lists', repeat: 'repeat' };

useShortcut('n', () => input.value?.focus());
defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <form class="quick-add" :class="{ typing: text }" @submit.prevent="add">
    <div class="quick-line">
      <Icon name="plus" class="quick-plus" />
      <input
        ref="input"
        v-model="text"
        :placeholder="t('quick.placeholder')"
        :aria-label="t('quick.placeholder')"
        enterkeyhint="done"
        autocomplete="off"
        maxlength="500"
        @keydown.esc="text = ''; $event.target.blur()"
      />
      <kbd v-if="!text" class="desktop-only">N</kbd>
      <button v-else class="btn small primary">{{ t('quick.add') }}</button>
    </div>

    <div v-if="text" class="quick-tools">
      <button
        v-for="chip in parsed.chips"
        :key="chip.kind"
        type="button"
        class="chip parsed"
        :class="chip.kind === 'priority' && `p${chip.priority}`"
        :title="t('quick.keepText', { text: chip.text })"
        @mousedown.prevent
        @click="skip = [...skip, chip.kind]"
      >
        <Icon :name="CHIP_ICON[chip.kind]" />{{ CHIP_TEXT[chip.kind](chip) }}<Icon name="close" class="x" />
      </button>

      <DropMenu v-if="!parsed.chips.some((c) => c.kind === 'date')" :label="t('quick.date')" :active="Boolean(fields.due_date)">
        <template #button><Icon name="calendar" />{{ dateText || t('quick.date') }}</template>
        <template #default="{ close }">
          <button type="button" @click="set('due_date', today, close)"><Icon name="sun" />{{ t('when.today') }}</button>
          <button type="button" @click="set('due_date', addDays(today, 1), close)"><Icon name="forward" />{{ t('when.tomorrow') }}</button>
          <button type="button" @click="set('due_date', nextWeekday(today, 6, true), close)"><Icon name="calendar" />{{ t('when.weekend') }}</button>
          <button type="button" @click="set('due_date', nextWeekday(today, 1), close)"><Icon name="calendar" />{{ t('when.nextWeek') }}</button>
          <label class="menu-date"><span>{{ t('when.pick') }}</span><input ref="dateInput" type="date" :value="fields.due_date || ''" @change="pickDate($event, close)" /></label>
          <button type="button" @click="set('due_date', null, close)"><Icon name="close" />{{ t('when.none') }}</button>
        </template>
      </DropMenu>

      <DropMenu v-if="!parsed.chips.some((c) => c.kind === 'priority')" :label="t('quick.priority')" :active="Boolean(fields.priority)">
        <template #button><Icon name="priority" :class="`p${fields.priority || 0}`" />{{ fields.priority ? t(`priority.${fields.priority}`) : t('quick.priority') }}</template>
        <template #default="{ close }">
          <button v-for="p in [3, 2, 1, 0]" :key="p" type="button" @click="set('priority', p, close)"><Icon name="priority" :class="`p${p}`" />{{ t(`priority.${p}`) }}</button>
        </template>
      </DropMenu>

      <DropMenu v-if="!parsed.chips.some((c) => c.kind === 'list')" :label="t('quick.list')" :active="Boolean(fields.list_id)">
        <template #button><Icon name="lists" />{{ listName || t('lists.inbox') }}</template>
        <template #default="{ close }">
          <button type="button" @click="set('list_id', null, close)"><Icon name="inbox" />{{ t('lists.inbox') }}</button>
          <button v-for="l in lists" :key="l.id" type="button" :class="l.color && `c-${l.color}`" @click="set('list_id', l.id, close)"><i class="dot"></i>{{ l.name }}</button>
        </template>
      </DropMenu>
    </div>
  </form>
</template>
