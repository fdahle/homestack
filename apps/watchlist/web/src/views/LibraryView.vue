<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { byDailyRandom, byTitle, compareText, countBy, countryName, errorText, itemChange, PATHS, rememberedRef, STATUS_ICONS, STATUSES, useShortcut } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import SplitView from '../kit/components/SplitView.vue';
import ModeSwitch from '../components/ModeSwitch.vue';
import TitleTile from '../components/TitleTile.vue';

// The library of one mode: films or series, never both
const props = defineProps({ mode: { type: String, required: true } });
const route = useRoute();
const router = useRouter();
const items = ref(null);
const error = ref('');
const isSeries = computed(() => props.mode === 'series');

// Filters live in the address, so "back" from a title returns to the same view.
// The sort order is also remembered on this device, per mode.
const SORT_KEYS = ['recent', 'title', 'rating', 'watched', 'released', 'added', 'random', ...(isSeries.value ? ['left'] : [])];
const status = ref(String(route.query.status || 'all'));
const genre = ref(String(route.query.genre || ''));
const country = ref(String(route.query.country || ''));
const sort = rememberedRef(`watchlist.sort.${props.mode}`, 'recent', { allowed: SORT_KEYS, initial: route.query.sort && String(route.query.sort) });
const q = ref(String(route.query.q || ''));

// Genre and country sit behind the filter button; open when one of them is set
const filterCount = computed(() => [genre.value, country.value].filter(Boolean).length);
const showFilters = ref(filterCount.value > 0);

watch([status, genre, country, sort, q], () => {
  if (route.matched.length > 1) return;
  const query = {};
  if (status.value !== 'all') query.status = status.value;
  if (genre.value) query.genre = genre.value;
  if (country.value) query.country = country.value;
  if (sort.value !== 'recent') query.sort = sort.value;
  if (q.value.trim()) query.q = q.value.trim();
  router.replace({ query });
});

// Links like ?genre=… from the stats, while the list is already open
watch(() => route.query, (query) => {
  if (route.matched.length > 1) return;
  if (query.genre !== undefined) genre.value = String(query.genre);
  if (query.country !== undefined) country.value = String(query.country);
  if (query.status !== undefined) status.value = String(query.status);
  if (query.genre || query.country) showFilters.value = true;
});

onMounted(async () => {
  try {
    const data = await api(isSeries.value ? '/series' : '/films');
    items.value = isSeries.value ? data.series : data.films;
  } catch (err) {
    error.value = errorText(err);
  }
});

// A change on the title's page (beside the list on a computer) shows in the list straight away
watch(itemChange, (change) => {
  if (!change || change.mode !== props.mode || !items.value) return;
  const i = items.value.findIndex((x) => x.id === change.id);
  if (change.deleted) {
    if (i >= 0) items.value.splice(i, 1);
  } else if (i >= 0) items.value[i] = { ...items.value[i], ...change.item };
  else items.value.push(change.item);
});

// "/" jumps to the search; Enter puts the phone's keyboard away
const searchInput = ref(null);
useShortcut('/', () => searchInput.value?.focus());

const statuses = computed(() => STATUSES[props.mode]);
const watching = computed(() => (isSeries.value ? (items.value || []).filter((s) => s.status === 'watching') : [])
  .sort((a, b) => (b.last_watched || '').localeCompare(a.last_watched || '') || byTitle(a, b)));
const counts = computed(() => Object.fromEntries(countBy(items.value || [], (x) => x.status)));
const statusChips = computed(() => ['all', ...statuses.value.filter((s) => counts.value[s])]);
const genres = computed(() => countBy(items.value || [], (x) => x.genres).map(([g]) => g).sort());
const countries = computed(() => countBy(items.value || [], (x) => x.countries)
  .map(([code]) => ({ code, name: countryName(code) }))
  .sort((a, b) => compareText(a.name, b.name)));
const canFilter = computed(() => genres.value.length > 1 || countries.value.length > 1);

const released = (x) => x.release_date || x.first_air_date || '';
const SORTS = computed(() => ({
  recent: (a, b) => b.updated_at.localeCompare(a.updated_at),
  title: byTitle,
  rating: (a, b) => (b.rating || 0) - (a.rating || 0) || byTitle(a, b),
  watched: (a, b) => (b.last_watched || '').localeCompare(a.last_watched || '') || byTitle(a, b),
  released: (a, b) => released(b).localeCompare(released(a)) || byTitle(a, b),
  added: (a, b) => b.created_at.localeCompare(a.created_at),
  ...(isSeries.value ? { left: (a, b) => (a.left || 1e9) - (b.left || 1e9) || byTitle(a, b) } : {}),
  // Shuffled once a day, at 04:00
  random: byDailyRandom((x) => x.id),
}));

const shown = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return (items.value || [])
    .filter((x) => status.value === 'all' || x.status === status.value)
    .filter((x) => !genre.value || x.genres.includes(genre.value))
    .filter((x) => !country.value || x.countries.includes(country.value))
    .filter((x) => !needle || [x.title, x.original_title, x.director, x.creators, ...(x.cast_names || []), ...x.countries.map(countryName)]
      .some((s) => s?.toLowerCase().includes(needle)))
    .sort(SORTS.value[sort.value] || SORTS.value.recent);
});

const filtered = computed(() => status.value !== 'all' || filterCount.value > 0 || q.value.trim());
const selected = (x) => String(x.id) === route.params.id;

function clearFilters() {
  genre.value = '';
  country.value = '';
}

function resetFilters() {
  status.value = 'all';
  q.value = '';
  clearFilters();
}
</script>

<template>
  <SplitView>
    <!-- On a computer the bar across the top has the name and the films/series switch -->
    <TopBar :title="t(`library.title.${mode}`)" class="phone-only">
      <button
        v-if="canFilter" class="icon-btn filter-btn" :class="{ active: showFilters }" :aria-label="t('library.filters')"
        :aria-expanded="showFilters" @click="showFilters = !showFilters"
      >
        <Icon name="filter" /><span v-if="filterCount" class="filter-dot"></span>
      </button>
      <RouterLink to="/einstellungen" class="icon-btn" :aria-label="t('nav.settings')"><Icon name="gear" /></RouterLink>
    </TopBar>
    <main class="wide">
      <ModeSwitch class="phone-only page-mode" />
      <p v-if="error" class="error">{{ error }}</p>
      <p v-else-if="!items" class="muted center">…</p>

      <div v-else-if="!items.length" class="empty">
        <img src="/icon.svg" alt="" width="72" height="72" />
        <p>{{ t(`library.empty.${mode}`) }}</p>
        <div class="row-buttons"><RouterLink :to="PATHS[mode].add" class="btn primary"><Icon name="plus" />{{ t(`library.addFirst.${mode}`) }}</RouterLink></div>
      </div>

      <template v-else>
        <section v-if="watching.length && !filtered">
          <h2 class="section">{{ t('library.watchingNow') }}<RouterLink :to="PATHS.series.upnext" class="section-link">{{ t('nav.upnext') }}</RouterLink></h2>
          <div class="shelf">
            <TitleTile v-for="s in watching" :key="s.id" :item="s" mode="series" hide-status show-progress :selected="selected(s)" />
          </div>
          <h2 class="section">{{ t(`library.all.${mode}`) }}</h2>
        </section>

        <div class="toolbar">
          <input
            ref="searchInput" v-model="q" type="search" enterkeyhint="search" :placeholder="t(`library.search.${mode}`)" :aria-label="t(`library.search.${mode}`)"
            @keydown.enter="$event.target.blur()"
          />
          <select v-model="sort" :aria-label="t('library.sort')">
            <option v-for="(fn, key) in SORTS" :key="key" :value="key">{{ t(`library.sorts.${key}`) }}</option>
          </select>
          <button
            v-if="canFilter" class="btn filter-toggle desktop-only" :class="{ active: showFilters }"
            :aria-expanded="showFilters" @click="showFilters = !showFilters"
          >
            <Icon name="filter" />{{ t('library.filters') }}<span v-if="filterCount" class="chip-count">{{ filterCount }}</span>
          </button>
        </div>
        <div v-if="showFilters && canFilter" class="filters">
          <select v-if="genres.length > 1" v-model="genre" :aria-label="t('library.genre')">
            <option value="">{{ t('library.allGenres') }}</option>
            <option v-for="g in genres" :key="g" :value="g">{{ g }}</option>
          </select>
          <select v-if="countries.length > 1" v-model="country" :aria-label="t('library.country')">
            <option value="">{{ t('library.allCountries') }}</option>
            <option v-for="c in countries" :key="c.code" :value="c.code">{{ c.name }}</option>
          </select>
          <button v-if="filterCount" class="link-btn small" @click="clearFilters"><Icon name="close" />{{ t('library.reset') }}</button>
        </div>
        <div class="chips" role="group" :aria-label="t('library.status')">
          <button v-for="s in statusChips" :key="s" class="chip" :class="{ active: status === s }" @click="status = s">
            <Icon v-if="s !== 'all'" :name="STATUS_ICONS[s]" />
            {{ s === 'all' ? t('library.allStatuses') : t(`status.${s}`) }}
            <span class="chip-count">{{ s === 'all' ? items.length : counts[s] }}</span>
          </button>
        </div>

        <div v-if="shown.length" class="grid">
          <TitleTile
            v-for="x in shown" :key="x.id" :item="x" :mode="mode" :hide-status="status !== 'all'" :selected="selected(x)"
            :show-progress="isSeries && ['watching', 'paused'].includes(x.status)"
          />
        </div>
        <div v-else class="empty">
          <p>{{ t(`library.noMatch.${mode}`) }}</p>
          <button class="btn" @click="resetFilters">{{ t('library.reset') }}</button>
        </div>
      </template>
    </main>
  </SplitView>
</template>
