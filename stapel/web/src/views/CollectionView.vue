<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { languageTag, yearRange } from '../util.js';
import TopBar from '../components/TopBar.vue';
import Icon from '../components/Icon.vue';
import CoverImage from '../components/CoverImage.vue';

const series = ref(null);
const query = ref('');
const readPref = (key, fallback) => {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};
const filter = ref(readPref('stapel.collection.filter', 'all'));
const sort = ref(readPref('stapel.collection.sort', 'name'));
watch([filter, sort], () => {
  try {
    localStorage.setItem('stapel.collection.filter', filter.value);
    localStorage.setItem('stapel.collection.sort', sort.value);
  } catch {
    // only a convenience
  }
});

onMounted(async () => {
  series.value = await api('/collection');
});

const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  let list = (series.value || []).filter((s) => !q || s.name.toLowerCase().includes(q) || (s.publisher_name || '').toLowerCase().includes(q));
  if (filter.value === 'incomplete') list = list.filter((s) => s.owned > 0 && s.owned < s.total);
  if (filter.value === 'complete') list = list.filter((s) => s.total > 0 && s.owned === s.total);
  if (filter.value === 'unread') list = list.filter((s) => s.unread_owned > 0);
  if (sort.value === 'recent') list = [...list].sort((a, b) => b.added_at.localeCompare(a.added_at));
  if (sort.value === 'progress') list = [...list].sort((a, b) => b.owned / (b.total || 1) - a.owned / (a.total || 1));
  return list;
});

const pct = (part, total) => (total ? Math.round((part / total) * 100) : 0);
</script>

<template>
  <TopBar :title="t('nav.collection')">
    <RouterLink class="icon-btn" to="/add" :aria-label="t('nav.add')"><Icon name="plus" /></RouterLink>
  </TopBar>
  <main v-if="series">
    <div v-if="!series.length" class="empty">
      <p>{{ t('home.empty') }}</p>
      <RouterLink class="btn primary" to="/add">{{ t('home.addSeries') }}</RouterLink>
    </div>
    <template v-else>
      <div class="toolbar">
        <input v-model="query" type="search" :placeholder="t('collection.filterPlaceholder')" />
        <select v-model="sort" :aria-label="t('collection.sort')">
          <option value="name">{{ t('collection.sortName') }}</option>
          <option value="recent">{{ t('collection.sortRecent') }}</option>
          <option value="progress">{{ t('collection.sortProgress') }}</option>
        </select>
      </div>
      <div class="chips">
        <button v-for="f in ['all', 'incomplete', 'complete', 'unread']" :key="f" class="chip" :class="{ active: filter === f }" @click="filter = f">
          {{ t(`collection.filter.${f}`) }}
        </button>
      </div>

      <ul class="series-list">
        <li v-for="s in shown" :key="s.id">
          <RouterLink :to="`/series/${s.id}`" class="series-row">
            <CoverImage class="thumb" :issue="{ cover_file: s.cover_file, cover_url: s.cover_url, number: '' }" :series-name="s.name" />
            <div class="series-body">
              <div class="series-name">{{ s.name }}</div>
              <div class="meta">
                <span v-if="s.publisher_name">{{ s.publisher_name }}</span>
                <span v-if="s.year_began">{{ yearRange(s) }}</span>
                <span v-if="s.language" class="tag">{{ languageTag(s.language) }}</span>
              </div>
              <div class="bar" :title="t('collection.ownedOf', { owned: s.owned, total: s.total })">
                <span class="owned" :style="{ width: `${pct(s.owned, s.total)}%` }"></span>
                <span class="read" :style="{ width: `${pct(s.read, s.total)}%` }"></span>
              </div>
              <div class="meta">
                <span>{{ t('collection.ownedOf', { owned: s.owned, total: s.total }) }}</span>
                <span v-if="s.read">{{ t('collection.readCount', { n: s.read }) }}</span>
                <span v-if="s.total && s.owned === s.total" class="ok">{{ t('collection.complete') }}</span>
              </div>
            </div>
          </RouterLink>
        </li>
      </ul>
      <p v-if="!shown.length" class="muted center">{{ t('collection.noMatch') }}</p>
    </template>
  </main>
</template>
