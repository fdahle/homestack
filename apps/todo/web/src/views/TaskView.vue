<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { t } from '../i18n.js';
import { relativeDay } from '../util.js';
import { addDays, nextWeekday } from '../lib/dates.js';
import { firstDue } from '../lib/repeat.js';
import {
  addSubtask, lists, remove, removeSubtask, reopenTask, store, tick, today, updateSubtask, updateTask,
} from '../store/tasks.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import RepeatPicker from '../components/RepeatPicker.vue';

// One task, everything editable in place and saved as you go. Subtasks work like a
// checklist: Enter makes the next one, Backspace in an empty one removes it.
const props = defineProps({ id: { type: String, required: true } });
const route = useRoute();
const router = useRouter();

const task = computed(() => store.tasks.get(props.id));
const done = computed(() => Boolean(task.value?.done_at));
const gone = computed(() => store.ready && (!task.value || task.value.deleted_at));
const listPath = computed(() => route.path.replace(/\/task\/[^/]+$/, '') || '/');

// --- typing: title and note are saved a moment after you stop ---

const draft = reactive({ title: task.value?.title ?? '', note: task.value?.note ?? '' });
let timer = null;
function changed() {
  clearTimeout(timer);
  timer = setTimeout(flush, 350);
}
function flush() {
  clearTimeout(timer);
  timer = null;
  const x = task.value;
  if (!x) return;
  const patch = {};
  if (draft.title !== x.title) patch.title = draft.title;
  if (draft.note !== x.note) patch.note = draft.note;
  if (Object.keys(patch).length) updateTask(x.id, patch);
}
watch(() => task.value?.title, (v) => v !== undefined && !timer && (draft.title = v));
watch(() => task.value?.note, (v) => v !== undefined && !timer && (draft.note = v));
onBeforeUnmount(flush);

// --- subtasks ---

const subInputs = ref({});
const newSub = ref('');
const newSubInput = ref(null);

async function focusSub(id) {
  await nextTick();
  if (id) subInputs.value[id]?.focus();
  else newSubInput.value?.focus();
}

function addNewSub() {
  const title = newSub.value.trim();
  if (!title) return;
  addSubtask(props.id, title);
  newSub.value = '';
}

function onSubKey(event, sub, index) {
  if (event.key === 'Enter') {
    event.preventDefault();
    const next = addSubtask(props.id, '', sub.id);
    focusSub(next?.id);
  } else if (event.key === 'Backspace' && !event.target.value) {
    event.preventDefault();
    const prev = task.value.subtasks[index - 1];
    removeSubtask(props.id, sub.id);
    focusSub(prev?.id);
  }
}

// --- date, time, repeat ---

function setDate(value) {
  const x = task.value;
  const patch = { due_date: value || null };
  if (!value) {
    patch.due_time = null;
    patch.repeat = null;
  } else if (x.repeat) {
    patch.repeat = x.repeat; // takes its day of the month from the new date
  }
  updateTask(x.id, patch);
}

function setRepeat(rule) {
  const x = task.value;
  const patch = { repeat: rule };
  if (rule && !x.due_date) patch.due_date = firstDue(rule, today.value);
  updateTask(x.id, patch);
}

const QUICK_DATES = computed(() => [
  { key: 'today', date: today.value },
  { key: 'tomorrow', date: addDays(today.value, 1) },
  { key: 'weekend', date: nextWeekday(today.value, 6, true) },
  { key: 'nextWeek', date: nextWeekday(today.value, 1) },
]);

// --- the rest ---

function toggleDone() {
  flush();
  if (done.value) reopenTask(props.id);
  else {
    const repeating = task.value.repeat && task.value.due_date;
    tick(props.id);
    if (!repeating) close();
  }
}

function del() {
  flush();
  remove(props.id);
  close();
}

function close() {
  const previous = window.history.state?.back;
  if (previous && previous === listPath.value) router.back();
  else router.push(listPath.value);
}

const stamp = (iso) => {
  const d = new Date(iso);
  return `${relativeDay(iso)}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};
</script>

<template>
  <TopBar :title="''" :back="listPath">
    <button v-if="task && !gone" class="icon-btn danger" :aria-label="t('task.delete')" :title="t('task.delete')" @click="del"><Icon name="trash" /></button>
  </TopBar>

  <main class="task-page">
    <p v-if="!store.ready" class="muted center">{{ t('task.loading') }}</p>
    <div v-else-if="gone" class="empty">
      <p>{{ t('task.notFound') }}</p>
      <RouterLink :to="listPath" class="btn">{{ t('back') }}</RouterLink>
    </div>

    <template v-else>
      <div class="task-head" :class="[`p${task.priority}`, { done }]">
        <button class="check big" role="checkbox" :aria-checked="done" :aria-label="done ? t('task.reopen') : t('task.complete')" @click="toggleDone"><Icon name="check" /></button>
        <textarea
          v-model="draft.title"
          class="task-title-input"
          rows="1"
          :placeholder="t('task.title')"
          :aria-label="t('task.title')"
          maxlength="500"
          enterkeyhint="done"
          @input="changed(); $event.target.style.height = 'auto'; $event.target.style.height = `${$event.target.scrollHeight}px`"
          @keydown.enter.prevent="flush(); focusSub(null)"
        ></textarea>
      </div>

      <!-- Subtasks -->
      <ul class="subtask-list">
        <li v-for="(s, i) in task.subtasks" :key="s.id" :class="{ done: s.done }">
          <input type="checkbox" :checked="s.done" :aria-label="s.title" @change="updateSubtask(task.id, s.id, { done: $event.target.checked })" />
          <input
            :ref="(el) => (subInputs[s.id] = el)"
            class="subtask-input"
            :value="s.title"
            maxlength="500"
            enterkeyhint="next"
            @change="updateSubtask(task.id, s.id, { title: $event.target.value })"
            @keydown="onSubKey($event, s, i)"
          />
          <button class="icon-btn small-btn" :aria-label="t('task.removeSubtask')" @click="removeSubtask(task.id, s.id)"><Icon name="close" /></button>
        </li>
        <li class="add-sub">
          <Icon name="plus" />
          <input ref="newSubInput" v-model="newSub" class="subtask-input" :placeholder="t('task.addSubtask')" :aria-label="t('task.addSubtask')" maxlength="500" enterkeyhint="next" @keydown.enter.prevent="addNewSub" @blur="addNewSub" />
        </li>
      </ul>

      <!-- Date, time, repeat, priority, list, note -->
      <div class="fields">
        <div class="field">
          <Icon name="calendar" />
          <div class="field-body">
            <div class="date-chips">
              <button v-for="q in QUICK_DATES" :key="q.key" class="chip" :class="{ active: task.due_date === q.date }" @click="setDate(q.date)">{{ t(`when.${q.key}`) }}</button>
            </div>
            <div class="date-row">
              <input type="date" :value="task.due_date || ''" :aria-label="t('task.date')" @change="setDate($event.target.value)" />
              <input v-if="task.due_date" type="time" :value="task.due_time || ''" :aria-label="t('task.time')" @change="updateTask(task.id, { due_time: $event.target.value || null })" />
              <button v-if="task.due_date" class="icon-btn" :aria-label="t('task.clear')" :title="t('when.none')" @click="setDate(null)"><Icon name="close" /></button>
            </div>
            <label v-if="task.due_time" class="check-label small">
              <input type="checkbox" :checked="task.remind" @change="updateTask(task.id, { remind: $event.target.checked })" />
              <Icon name="bell" />{{ t('task.remind') }}
            </label>
          </div>
        </div>

        <div class="field">
          <Icon name="repeat" />
          <div class="field-body"><RepeatPicker :model-value="task.repeat" :due="task.due_date" @update:model-value="setRepeat" /></div>
        </div>

        <div class="field">
          <Icon name="priority" :class="`p${task.priority}`" />
          <div class="field-body">
            <div class="segmented wide priority-picker" role="radiogroup" :aria-label="t('quick.priority')">
              <button v-for="p in [0, 1, 2, 3]" :key="p" role="radio" :class="[`p${p}`, { active: task.priority === p }]" :aria-checked="task.priority === p" @click="updateTask(task.id, { priority: p })">
                {{ t(`priority.${p}`) }}
              </button>
            </div>
          </div>
        </div>

        <div class="field">
          <Icon name="lists" />
          <div class="field-body">
            <select :value="task.list_id || ''" :aria-label="t('task.list')" @change="updateTask(task.id, { list_id: $event.target.value || null })">
              <option value="">{{ t('lists.inbox') }}</option>
              <option v-for="l in lists" :key="l.id" :value="l.id">{{ l.name }}</option>
            </select>
          </div>
        </div>

        <div class="field">
          <Icon name="note" />
          <div class="field-body">
            <textarea v-model="draft.note" class="note-input" rows="3" :placeholder="t('task.notePlaceholder')" :aria-label="t('task.note')" @input="changed" @blur="flush"></textarea>
          </div>
        </div>
      </div>

      <p class="task-dates muted small">
        <span>{{ t('task.created', { when: stamp(task.created_at) }) }}</span>
        <span v-if="task.done_at">{{ t('task.doneAt', { when: stamp(task.done_at) }) }}</span>
      </p>
    </template>
  </main>
</template>
