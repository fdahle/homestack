<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { lang, t } from '../i18n.js';
import { byDailyRandom, compareText, countBy, languageTag, rememberedRef, yearRange } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import CoverImage from '../components/CoverImage.vue';

const route = useRoute();
const router = useRouter();
const series = ref(null);
const query = ref('');
// The chip and the sort order are remembered on this device
const FILTERS = ['all', 'incomplete', 'complete', 'unread'];
const filter = rememberedRef('stapel.collection.filter', 'all', { allowed: FILTERS });
const sort = rememberedRef('stapel.collection.sort', 'name', { allowed: ['name', 'recent', 'progress', 'random'] });

// Publisher, language and format sit behind the filter button. They live in the address,
// so "back" from a series returns to the same view; the panel opens when one is set.
const publisher = ref(String(route.query.publisher || ''));
const language = ref(String(route.query.language || ''));
const format = ref(String(route.query.format || ''));
const filterCount = computed(() => [publisher.value, language.value, format.value].filter(Boolean).length);
const showFilters = ref(filterCount.value > 0);

watch([publisher, language, format], () => {
  const q = {};
  if (publisher.value) q.publisher = publisher.value;
  if (language.value) q.language = language.value;
  if (format.value) q.format = format.value;
  router.replace({ query: q });
});

onMounted(async () => {
  series.value = await api('/collection');
});

const all = computed(() => series.value || []);
// The values your collection has, most used first would hide the rest: alphabetical
const valuesOf = (key, label = (v) => v) => countBy(all.value, (s) => s[key])
  .map(([value, n]) => ({ value, n, label: label(value) }))
  .sort((a, b) => compareText(a.label, b.label));
function languageName(code) {
  try {
    return new Intl.DisplayNames([lang.value], { type: 'language' }).of(code) || languageTag(code);
  } catch {
    return languageTag(code);
  }
}
const publishers = computed(() => valuesOf('publisher_name'));
const languages = computed(() => valuesOf('language', languageName));
const formats = computed(() => valuesOf('format'));
const canFilter = computed(() => publishers.value.length > 1 || languages.value.length > 1 || formats.value.length > 1);

const MATCHES = {
  all: () => true,
  incomplete: (s) => s.owned > 0 && s.owned < s.total,
  complete: (s) => s.total > 0 && s.owned === s.total,
  unread: (s) => s.unread_owned > 0,
};

// Everything but the chip, so the chips can count what they would show
const narrowed = computed(() => {
  const q = query.value.trim().toLowerCase();
  return all.value
    .filter((s) => !q || s.name.toLowerCase().includes(q) || (s.publisher_name || '').toLowerCase().includes(q))
    .filter((s) => !publisher.value || s.publisher_name === publisher.value)
    .filter((s) => !language.value || s.language === language.value)
    .filter((s) => !format.value || s.format === format.value);
});
const counts = computed(() => Object.fromEntries(FILTERS.map((f) => [f, narrowed.value.filter(MATCHES[f]).length])));

const shown = computed(() => {
  let list = narrowed.value.filter(MATCHES[filter.value] || MATCHES.all);
  if (sort.value === 'recent') list = [...list].sort((a, b) => b.added_at.localeCompare(a.added_at));
  if (sort.value === 'progress') list = [...list].sort((a, b) => b.owned / (b.total || 1) - a.owned / (a.total || 1));
  // Shuffled once a day, at 04:00
  if (sort.value === 'random') list = [...list].sort(byDailyRandom((s) => s.id));
  return list;
});

function clearFilters() {
  publisher.value = '';
  language.value = '';
  format.value = '';
}

const pct = (part, total) => (total ? Math.round((part / total) * 100) : 0);
</script>

<template>
  <TopBar :title="t('nav.collection')">
    <button
      v-if="canFilter" class="icon-btn filter-btn phone-only" :class="{ active: showFilters }" :aria-label="t('collection.filters')"
      :aria-expanded="showFilters" @click="showFilters = !showFilters"
    >
      <Icon name="filter" /><span v-if="filterCount" class="filter-dot"></span>
    </button>
    <RouterLink class="icon-btn phone-only" to="/scan" :aria-label="t('home.scan')"><Icon name="scan" /></RouterLink>
    <RouterLink class="icon-btn" to="/add" :aria-label="t('nav.add')"><Icon name="plus" /></RouterLink>
  </TopBar>
  <main v-if="series">
    <div v-if="!series.length" class="empty">
      <p>{{ t('home.empty') }}</p>
      <RouterLink class="btn primary" to="/add">{{ t('home.addSeries') }}</RouterLink>
    </div>
    <template v-else>
      <div class="toolbar">
        <input
          v-model="query" type="search" enterkeyhint="search" :placeholder="t('collection.filterPlaceholder')" :aria-label="t('collection.filterPlaceholder')"
          @keydown.enter="$event.target.blur()"
        />
        <select v-model="sort" :aria-label="t('collection.sort')">
          <option value="name">{{ t('collection.sortName') }}</option>
          <option value="recent">{{ t('collection.sortRecent') }}</option>
          <option value="progress">{{ t('collection.sortProgress') }}</option>
          <option value="random">{{ t('collection.sortRandom') }}</option>
        </select>
        <button
          v-if="canFilter" class="btn filter-toggle desktop-only" :class="{ active: showFilters }"
          :aria-expanded="showFilters" @click="showFilters = !showFilters"
        >
          <Icon name="filter" />{{ t('collection.filters') }}<span v-if="filterCount" class="chip-count">{{ filterCount }}</span>
        </button>
      </div>
      <div v-if="showFilters && canFilter" class="filters">
        <select v-if="publishers.length > 1" v-model="publisher" :aria-label="t('collection.publisher')">
          <option value="">{{ t('collection.allPublishers') }}</option>
          <option v-for="o in publishers" :key="o.value" :value="o.value">{{ o.label }} ({{ o.n }})</option>
        </select>
        <select v-if="languages.length > 1" v-model="language" :aria-label="t('collection.language')">
          <option value="">{{ t('collection.allLanguages') }}</option>
          <option v-for="o in languages" :key="o.value" :value="o.value">{{ o.label }} ({{ o.n }})</option>
        </select>
        <select v-if="formats.length > 1" v-model="format" :aria-label="t('collection.format')">
          <option value="">{{ t('collection.allFormats') }}</option>
          <option v-for="o in formats" :key="o.value" :value="o.value">{{ o.label }} ({{ o.n }})</option>
        </select>
        <button v-if="filterCount" class="link-btn small" @click="clearFilters"><Icon name="close" />{{ t('collection.reset') }}</button>
      </div>
      <div class="chips" role="group">
        <button v-for="f in FILTERS" :key="f" class="chip" :class="{ active: filter === f }" @click="filter = f">
          {{ t(`collection.filter.${f}`) }}<span class="chip-count">{{ counts[f] }}</span>
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
