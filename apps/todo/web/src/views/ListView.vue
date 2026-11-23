<script setup>
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { t } from '../i18n.js';
import { showToast } from '../util.js';
import { LIST_COLORS } from '../lib/labels.js';
import { byDone, byUrgency, deleteList, liveTasks, store, updateList } from '../store/tasks.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import SplitView from '../kit/components/SplitView.vue';
import QuickAdd from '../components/QuickAdd.vue';
import TaskRow from '../components/TaskRow.vue';
import SyncState from '../components/SyncState.vue';
import ListNav from '../components/ListNav.vue';

// One list (or the inbox): its open tasks, most important first, and the done ones folded away
const route = useRoute();
const router = useRouter();

const listId = computed(() => (route.params.listId === 'inbox' ? null : String(route.params.listId)));
const list = computed(() => (listId.value ? store.lists.get(listId.value) : null));
const missing = computed(() => store.ready && listId.value && (!list.value || list.value.deleted_at));
const name = computed(() => (listId.value ? list.value?.name ?? '' : t('lists.inbox')));

const mine = computed(() => liveTasks.value.filter((x) => x.list_id === listId.value));
const open = computed(() => mine.value.filter((x) => !x.done_at).sort(byUrgency));
const done = computed(() => mine.value.filter((x) => x.done_at).sort(byDone));
const showDone = ref(false);
const editing = ref(false);

const link = (task) => ({ name: 'list-task', params: { listId: route.params.listId, id: task.id } });
const visible = (task) => task.list_id === listId.value;

function rename(event) {
  const value = event.target.value.trim();
  if (value && value !== list.value.name) updateList(list.value.id, { name: value.slice(0, 60) });
}

function remove() {
  if (!confirm(t('lists.deleteConfirm', { name: list.value.name, n: mine.value.length }))) return;
  deleteList(list.value.id);
  showToast(t('lists.deleted'));
  router.push('/lists');
}
</script>

<template>
  <SplitView>
    <TopBar :title="name" back="/lists">
      <SyncState />
      <button v-if="list" class="icon-btn" :class="{ on: editing }" :aria-label="t('lists.edit')" :title="t('lists.edit')" :aria-pressed="editing" @click="editing = !editing"><Icon name="edit" /></button>
    </TopBar>
    <main>
      <ListNav class="desktop-only" />
      <div v-if="missing" class="empty">
        <p>{{ t('errors.not_found') }}</p>
        <RouterLink to="/lists" class="btn">{{ t('back') }}</RouterLink>
      </div>
      <template v-else>
        <section v-if="editing && list" class="card form list-edit">
          <label>
            <span>{{ t('lists.name') }}</span>
            <input :value="list.name" maxlength="60" @change="rename" />
          </label>
          <div>
            <span class="field-label">{{ t('lists.color') }}</span>
            <div class="color-picker">
              <button :class="{ active: !list.color }" class="swatch none" :aria-label="t('task.clear')" @click="updateList(list.id, { color: null })"></button>
              <button v-for="c in LIST_COLORS" :key="c" class="swatch" :class="[`c-${c}`, { active: list.color === c }]" :aria-label="c" @click="updateList(list.id, { color: c })"><i class="dot"></i></button>
            </div>
          </div>
          <button class="btn danger small" @click="remove"><Icon name="trash" />{{ t('lists.delete') }}</button>
        </section>

        <QuickAdd :key="route.params.listId" :defaults="{ list_id: listId }" :visible="visible" />

        <p v-if="!store.ready" class="muted center">{{ t('task.loading') }}</p>
        <template v-else>
          <div v-if="open.length" class="tasks">
            <TaskRow v-for="task in open" :key="task.id" :task="task" :to="link(task)" :selected="route.params.id === task.id" />
          </div>
          <p v-else class="empty">{{ t('lists.empty') }}</p>

          <section v-if="done.length" class="task-section">
            <button class="section done-toggle" :aria-expanded="showDone" @click="showDone = !showDone">
              <Icon :name="showDone ? 'chevron-down' : 'chevron-right'" />{{ t('lists.done', { n: done.length }) }}
            </button>
            <div v-if="showDone" class="tasks">
              <TaskRow v-for="task in done.slice(0, 100)" :key="task.id" :task="task" :to="link(task)" :selected="route.params.id === task.id" />
            </div>
          </section>
        </template>
      </template>
    </main>
  </SplitView>
</template>
