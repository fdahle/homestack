<script setup>
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { t } from '../i18n.js';
import { useShortcut, wide } from '../util.js';
import { addList, areaLists as lists, areas, areaTasks, byUrgency, openCount, store } from '../store/tasks.js';
import TopBar from '../kit/components/TopBar.vue';
import AreaSwitch from '../kit/components/AreaSwitch.vue';
import Icon from '../kit/components/Icon.vue';
import SplitView from '../kit/components/SplitView.vue';
import TaskRow from '../components/TaskRow.vue';
import SyncState from '../components/SyncState.vue';

// The inbox and your lists, a field for a new list, and a search across every task.
// With an area shown: its lists and tasks (a new list joins it).
const route = useRoute();
const router = useRouter();
const q = ref('');
const newName = ref('');
const search = ref(null);
useShortcut('/', () => search.value?.focus());

const results = computed(() => {
  const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return areaTasks.value
    .filter((x) => {
      const text = [x.title, x.note, ...x.subtasks.map((s) => s.title)].join('\n').toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .sort((a, b) => Boolean(a.done_at) - Boolean(b.done_at) || byUrgency(a, b))
    .slice(0, 100);
});

function create() {
  const name = newName.value.trim();
  if (!name) return;
  const list = addList(name);
  const area = areas.current.value;
  if (area) areas.update(area.id, { members: [...area.members, list.id] });
  newName.value = '';
  router.push(`/list/${list.id}`);
}

const link = (task) => ({ name: 'lists-task', params: { id: task.id } });
</script>

<template>
  <SplitView>
    <TopBar :title="t('lists.title')">
      <SyncState />
      <RouterLink to="/settings" class="icon-btn phone-only" :aria-label="t('nav.settings')"><Icon name="gear" /></RouterLink>
    </TopBar>
    <main>
      <AreaSwitch v-if="!wide" class="page-areas" :areas="areas" />
      <div class="search-box">
        <Icon name="search" />
        <input ref="search" v-model="q" type="search" :placeholder="t('lists.search')" :aria-label="t('lists.search')" />
        <kbd v-if="!q" class="desktop-only">/</kbd>
      </div>

      <template v-if="q.trim()">
        <div v-if="results.length" class="tasks">
          <TaskRow v-for="task in results" :key="task.id" :task="task" :to="link(task)" :selected="route.params.id === task.id" show-list />
        </div>
        <p v-else class="empty">{{ t('lists.noMatch') }}</p>
      </template>

      <template v-else-if="store.ready">
        <nav class="list-cards">
          <RouterLink to="/list/inbox" class="list-card">
            <Icon name="inbox" />
            <span class="grow"><strong>{{ t('lists.inbox') }}</strong><small class="muted">{{ t('lists.inboxHint') }}</small></span>
            <span class="count">{{ openCount.get(null) || '' }}</span>
            <Icon name="forward" class="muted" />
          </RouterLink>
          <RouterLink v-for="l in lists" :key="l.id" :to="`/list/${l.id}`" class="list-card" :class="l.color && `c-${l.color}`">
            <i class="dot big"></i>
            <span class="grow"><strong>{{ l.name }}</strong></span>
            <span class="count">{{ openCount.get(l.id) || '' }}</span>
            <Icon name="forward" class="muted" />
          </RouterLink>
        </nav>
        <form class="new-list" @submit.prevent="create">
          <Icon name="plus" />
          <input v-model="newName" :placeholder="t('lists.newList')" :aria-label="t('lists.newListName')" maxlength="60" enterkeyhint="done" />
          <button v-if="newName.trim()" class="btn small primary">{{ t('save') }}</button>
        </form>
      </template>
    </main>
  </SplitView>
</template>
