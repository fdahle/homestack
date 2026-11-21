// The tasks and lists, offline first: the kit's engine (kit/offline.js) keeps them on the
// device and in step with the server; this file is what Haken does with them.

import { computed, ref } from 'vue';
import { t } from '../i18n.js';
import { showToast } from '../util.js';
import { createOffline } from '../kit/offline.js';
import { isoDate } from '../lib/dates.js';
import { anchored, nextDue } from '../lib/repeat.js';

const off = createOffline({ name: 'haken', kinds: { task: 'tasks', list: 'lists' } });

// What the pages read (reactive through off.state)
export const store = {
  get ready() { return off.state.ready; },
  get tasks() { return off.state.items.task; },
  get lists() { return off.state.items.list; },
  get pending() { return off.state.pending; },
  get status() { return off.state.status; },
  get lastSync() { return off.state.lastSync; },
  get settings() { return off.state.settings || { trashDays: 7 }; },
};

export const { sync, whenReady, loadSettings } = off;

// Today, kept current (the app may stay open past midnight)
export const today = ref(isoDate());
setInterval(() => (today.value = isoDate()), 60_000);

const now = () => new Date().toISOString();

// --- tasks ---

const TASK_DEFAULTS = {
  list_id: null, title: '', note: '', due_date: null, due_time: null, repeat: null,
  priority: 0, subtasks: [], remind: true, done_at: null, deleted_at: null,
};

export function addTask(fields = {}) {
  const at = now();
  const task = { ...TASK_DEFAULTS, ...fields, id: crypto.randomUUID(), created_at: at, updated_at: at };
  if (task.repeat) task.repeat = anchored(task.repeat, task.due_date);
  store.tasks.set(task.id, { ...task, seq: 0 });
  const { id, ...patch } = task;
  off.queue('task', store.tasks.get(id), patch);
  return store.tasks.get(id);
}

export function updateTask(id, changes) {
  const task = store.tasks.get(id);
  if (!task) return;
  const patch = { ...changes, updated_at: now() };
  // A repeat set (or set again, when you move the date by hand) takes its day of the month from
  // the due date. Ticking off doesn't: "monthly on the 31st" stays on the 31st after February.
  if ('repeat' in patch) patch.repeat = anchored(patch.repeat, patch.due_date ?? task.due_date);
  Object.assign(task, patch);
  off.queue('task', task, patch);
}

// Ticks a task off. A repeating one moves to its next date, with its subtasks open again,
// and a done copy stays behind (so "done today" shows it). Returns the undo.
export function completeTask(id) {
  const task = store.tasks.get(id);
  if (!task || task.done_at) return () => {};
  if (task.repeat && task.due_date) {
    const before = { due_date: task.due_date, subtasks: JSON.parse(JSON.stringify(task.subtasks)) };
    const { id: _, seq: __, created_at, updated_at, ...fields } = JSON.parse(JSON.stringify(task));
    const copy = addTask({ ...fields, repeat: null, remind: false, done_at: now() });
    updateTask(id, { due_date: nextDue(task.repeat, task.due_date, today.value), subtasks: task.subtasks.map((s) => ({ ...s, done: false })) });
    return () => {
      updateTask(copy.id, { deleted_at: now() });
      updateTask(id, before);
    };
  }
  updateTask(id, { done_at: now() });
  return () => updateTask(id, { done_at: null });
}

export const reopenTask = (id) => updateTask(id, { done_at: null });

export function deleteTask(id) {
  updateTask(id, { deleted_at: now() });
  return () => updateTask(id, { deleted_at: null });
}

// --- subtasks (one level, inside the task) ---

const newSubId = () => crypto.randomUUID().slice(0, 8);

export function addSubtask(taskId, title, after = null) {
  const task = store.tasks.get(taskId);
  if (!task) return null;
  const sub = { id: newSubId(), title, done: false };
  const list = [...task.subtasks];
  const i = after ? list.findIndex((s) => s.id === after) : -1;
  list.splice(i >= 0 ? i + 1 : list.length, 0, sub);
  updateTask(taskId, { subtasks: list });
  return sub;
}

export function updateSubtask(taskId, subId, changes) {
  const task = store.tasks.get(taskId);
  if (!task) return;
  updateTask(taskId, { subtasks: task.subtasks.map((s) => (s.id === subId ? { ...s, ...changes } : s)) });
}

export function removeSubtask(taskId, subId) {
  const task = store.tasks.get(taskId);
  if (task) updateTask(taskId, { subtasks: task.subtasks.filter((s) => s.id !== subId) });
}

// --- lists ---

export function addList(name, color = null) {
  const at = now();
  const position = Math.max(0, ...[...store.lists.values()].map((l) => l.position || 0)) + 1;
  const list = { id: crypto.randomUUID(), name: name.trim().slice(0, 60), color, position, created_at: at, updated_at: at, deleted_at: null };
  store.lists.set(list.id, { ...list, seq: 0 });
  const { id, ...patch } = list;
  off.queue('list', store.lists.get(id), patch);
  return store.lists.get(id);
}

export function updateList(id, changes) {
  const list = store.lists.get(id);
  if (!list) return;
  const patch = { ...changes, updated_at: now() };
  Object.assign(list, patch);
  off.queue('list', list, patch);
}

// A list goes with its tasks
export function deleteList(id) {
  updateList(id, { deleted_at: now() });
  for (const task of store.tasks.values()) if (task.list_id === id && !task.deleted_at) updateTask(task.id, { deleted_at: now() });
}

// --- reading ---

export const liveTasks = computed(() => [...store.tasks.values()].filter((x) => !x.deleted_at));
export const openTasks = computed(() => liveTasks.value.filter((x) => !x.done_at));

export const lists = computed(() =>
  [...store.lists.values()].filter((l) => !l.deleted_at).sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name)));

export const openCount = computed(() => {
  const counts = new Map();
  for (const task of openTasks.value) counts.set(task.list_id, (counts.get(task.list_id) || 0) + 1);
  return counts;
});

// The order inside a day or a list: most important first, then by date and time, then oldest first
export function byUrgency(a, b) {
  return (b.priority - a.priority)
    || (a.due_date || '9999').localeCompare(b.due_date || '9999')
    || (a.due_time || '99').localeCompare(b.due_time || '99')
    || a.created_at.localeCompare(b.created_at);
}

// Done most recently first
export const byDone = (a, b) => (b.done_at || '').localeCompare(a.done_at || '');

// Tick off with an undo in the toast
export function tick(id) {
  const task = store.tasks.get(id);
  const undo = completeTask(id);
  showToast(task?.repeat ? t('task.doneRepeat') : t('task.done'), { label: t('undo'), run: undo });
}

export function remove(id) {
  const undo = deleteTask(id);
  showToast(t('task.deleted'), { label: t('undo'), run: undo });
}
