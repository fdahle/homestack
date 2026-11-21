<script setup>
import { onMounted, provide, ref, watch } from 'vue';
import { api, loadFriends } from '../api.js';
import { t } from '../i18n.js';
import { eventChange, KIND_ICONS, KINDS, useShortcut } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import SplitView from '../kit/components/SplitView.vue';
import TimelineList from '../components/TimelineList.vue';

// Everything with everyone. An event opens beside the list on a computer (where the plans
// get a column of their own), in its place on the phone.
const filters = ref({ q: '', friend: '', circle: '', kind: '' });
const friends = ref([]);
const circles = ref([]);
const data = ref(null);
const loadingMore = ref(false);

provide('eventPath', (id) => `/timeline/event/${id}`);

async function load() {
  const params = new URLSearchParams(Object.entries(filters.value).filter(([, v]) => v));
  data.value = await api(`/timeline?${params}`);
}

async function more() {
  loadingMore.value = true;
  const params = new URLSearchParams(Object.entries(filters.value).filter(([, v]) => v));
  params.set('offset', data.value.items.length);
  const next = await api(`/timeline?${params}`);
  data.value.items.push(...next.items);
  data.value.more = next.more;
  loadingMore.value = false;
}

onMounted(async () => {
  load();
  [friends.value, circles.value] = await Promise.all([loadFriends(), api('/circles')]);
});

let timer = null;
watch(() => filters.value.q, () => {
  clearTimeout(timer);
  timer = setTimeout(load, 300);
});
watch(() => [filters.value.friend, filters.value.circle, filters.value.kind], load);
// Saved or deleted beside the list
watch(eventChange, load);

// "/" jumps to the search
const searchInput = ref(null);
useShortcut('/', () => searchInput.value?.focus());
</script>

<template>
  <SplitView>
    <TopBar :title="t('nav.timeline')" />
    <main class="wide">
      <div class="toolbar">
        <input ref="searchInput" v-model="filters.q" type="search" :placeholder="t('timeline.search')" :aria-label="t('timeline.search')" />
        <select v-model="filters.friend" :aria-label="t('timeline.friend')">
          <option value="">{{ t('timeline.allFriends') }}</option>
          <option v-for="f in friends" :key="f.id" :value="f.id">{{ f.name }}</option>
        </select>
      </div>
      <div class="chips">
        <button class="chip" :class="{ active: !filters.kind && !filters.circle }" @click="filters.kind = ''; filters.circle = ''">{{ t('friends.all') }}</button>
        <button v-for="k in KINDS" :key="k" class="chip" :class="{ active: filters.kind === k }" @click="filters.kind = filters.kind === k ? '' : k">
          <Icon :name="KIND_ICONS[k]" /> {{ t(`kind.${k}`) }}
        </button>
        <button v-for="c in circles" :key="c.id" class="chip" :class="{ active: filters.circle === c.id }" @click="filters.circle = filters.circle === c.id ? '' : c.id">{{ c.name }}</button>
      </div>

      <div v-if="data" class="timeline-cols" :class="{ 'has-plans': data.upcoming.length }">
        <section v-if="data.upcoming.length" class="timeline-plans">
          <h2 class="section">{{ t('timeline.upcoming') }}</h2>
          <TimelineList :events="data.upcoming" />
        </section>
        <section class="timeline-past">
          <h2 v-if="data.upcoming.length" class="section">{{ t('timeline.past') }}</h2>
          <TimelineList v-if="data.items.length" :events="data.items" group />
          <div v-else-if="!data.upcoming.length" class="empty">
            <p>{{ Object.values(filters).some(Boolean) ? t('timeline.noMatch') : t('timeline.empty') }}</p>
            <RouterLink class="btn primary" to="/event/new"><Icon name="plus" /> {{ t('home.addEvent') }}</RouterLink>
          </div>
          <button v-if="data.more" class="btn wide" :disabled="loadingMore" @click="more">{{ t('timeline.more') }}</button>
        </section>
      </div>
    </main>
  </SplitView>
</template>
