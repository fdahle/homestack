<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { byName, countBy, errorText, gamePlatforms, STATUS_ICONS, STATUSES, gameChange, useShortcut } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import SplitView from '../kit/components/SplitView.vue';
import GameTile from '../components/GameTile.vue';

const route = useRoute();
const router = useRouter();
const games = ref(null);
const error = ref('');

// Filters live in the address, so "back" from a game returns to the same view
const status = ref(String(route.query.status || 'all'));
const platform = ref(String(route.query.platform || ''));
const genre = ref(String(route.query.genre || ''));
const sort = ref(String(route.query.sort || 'recent'));
const q = ref(String(route.query.q || ''));

watch([status, platform, genre, sort, q], () => {
  if (route.name !== 'library') return;
  const query = {};
  if (status.value !== 'all') query.status = status.value;
  if (platform.value) query.platform = platform.value;
  if (genre.value) query.genre = genre.value;
  if (sort.value !== 'recent') query.sort = sort.value;
  if (q.value.trim()) query.q = q.value.trim();
  router.replace({ query });
});

async function load() {
  try {
    games.value = (await api('/games')).games;
  } catch (err) {
    error.value = errorText(err);
  }
}
onMounted(load);

// A change on the game page (beside the list on a computer) shows in the list straight away
watch(gameChange, (change) => {
  if (!change || !games.value) return;
  const i = games.value.findIndex((g) => g.id === change.id);
  if (change.deleted) {
    if (i >= 0) games.value.splice(i, 1);
  } else if (i >= 0) games.value[i] = { ...games.value[i], ...change.game };
  else games.value.push(change.game);
});

// "/" jumps to the search
const searchInput = ref(null);
useShortcut('/', () => searchInput.value?.focus());

const playing = computed(() => (games.value || []).filter((g) => g.status === 'playing').sort(byName));
const counts = computed(() => Object.fromEntries(countBy(games.value || [], (g) => g.status)));
const statusChips = computed(() => ['all', ...STATUSES.filter((s) => counts.value[s])]);
const platforms = computed(() => countBy(games.value || [], gamePlatforms).map(([p]) => p));
const genres = computed(() => countBy(games.value || [], (g) => g.genres).map(([g]) => g).sort());

const SORTS = {
  recent: (a, b) => b.updated_at.localeCompare(a.updated_at),
  name: byName,
  rating: (a, b) => (b.rating || 0) - (a.rating || 0) || byName(a, b),
  finished: (a, b) => (b.finished_on || '').localeCompare(a.finished_on || '') || byName(a, b),
  released: (a, b) => (b.release_date || '').localeCompare(a.release_date || '') || byName(a, b),
  added: (a, b) => b.created_at.localeCompare(a.created_at),
};

const shown = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return (games.value || [])
    .filter((g) => status.value === 'all' || g.status === status.value)
    .filter((g) => !platform.value || gamePlatforms(g).includes(platform.value))
    .filter((g) => !genre.value || g.genres.includes(genre.value))
    .filter((g) => !needle || [g.name, g.developer, g.franchise].some((s) => s?.toLowerCase().includes(needle)))
    .sort(SORTS[sort.value] || SORTS.recent);
});

const filtered = computed(() => status.value !== 'all' || platform.value || genre.value || q.value.trim());

function resetFilters() {
  status.value = 'all';
  platform.value = '';
  genre.value = '';
  q.value = '';
}
</script>

<template>
  <SplitView>
    <TopBar :title="t('library.title')">
      <RouterLink to="/settings" class="icon-btn phone-only" :aria-label="t('nav.settings')"><Icon name="gear" /></RouterLink>
    </TopBar>
    <main class="wide">
      <p v-if="error" class="error">{{ error }}</p>
      <p v-else-if="!games" class="muted center">…</p>

      <div v-else-if="!games.length" class="empty">
        <img src="/icon.svg" alt="" width="72" height="72" />
        <p>{{ t('library.empty') }}</p>
        <div class="row-buttons"><RouterLink to="/add" class="btn primary"><Icon name="plus" />{{ t('library.addFirst') }}</RouterLink></div>
      </div>

      <template v-else>
        <section v-if="playing.length && !filtered">
          <h2 class="section">{{ t('library.playingNow') }}</h2>
          <div class="shelf">
            <GameTile v-for="g in playing" :key="g.id" :game="g" hide-status :selected="String(g.id) === route.params.id" />
          </div>
        </section>

        <h2 v-if="playing.length && !filtered" class="section">{{ t('library.all') }}</h2>
        <div class="toolbar">
          <input ref="searchInput" v-model="q" type="search" :placeholder="t('library.search')" :aria-label="t('library.search')" />
          <select v-model="sort" :aria-label="t('library.sort')">
            <option v-for="(fn, key) in SORTS" :key="key" :value="key">{{ t(`library.sorts.${key}`) }}</option>
          </select>
        </div>
        <div class="chips" role="group" :aria-label="t('library.status')">
          <button v-for="s in statusChips" :key="s" class="chip" :class="{ active: status === s }" @click="status = s">
            <Icon v-if="s !== 'all'" :name="STATUS_ICONS[s]" />
            {{ s === 'all' ? t('library.allStatuses') : t(`status.${s}`) }}
            <span class="chip-count">{{ s === 'all' ? games.length : counts[s] }}</span>
          </button>
        </div>
        <div v-if="platforms.length > 1 || genres.length > 1" class="toolbar">
          <select v-if="platforms.length > 1" v-model="platform" :aria-label="t('library.platform')">
            <option value="">{{ t('library.allPlatforms') }}</option>
            <option v-for="p in platforms" :key="p" :value="p">{{ p }}</option>
          </select>
          <select v-if="genres.length > 1" v-model="genre" :aria-label="t('library.genre')">
            <option value="">{{ t('library.allGenres') }}</option>
            <option v-for="g in genres" :key="g" :value="g">{{ g }}</option>
          </select>
        </div>

        <div v-if="shown.length" class="grid">
          <GameTile v-for="g in shown" :key="g.id" :game="g" :hide-status="status !== 'all'" :selected="String(g.id) === route.params.id" />
        </div>
        <div v-else class="empty">
          <p>{{ t('library.noMatch') }}</p>
          <button class="btn" @click="resetFilters">{{ t('library.reset') }}</button>
        </div>
      </template>
    </main>
  </SplitView>
</template>
