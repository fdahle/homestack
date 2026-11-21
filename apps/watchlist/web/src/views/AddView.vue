<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { errorText, isoDate, itemPath, serverSettings, showToast, STATUS_ICONS, STATUSES, tmdbImage } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import PartialDate from '../kit/components/PartialDate.vue';
import ModeSwitch from '../components/ModeSwitch.vue';
import Poster from '../components/Poster.vue';

// Adding a film or a series: TMDB search, or by hand
const props = defineProps({ mode: { type: String, required: true } });
const router = useRouter();
const isSeries = computed(() => props.mode === 'series');
const tmdb = ref(true);
const q = ref('');
const results = ref(null);
const searching = ref(false);
const error = ref('');
const picked = ref(null); // tmdbId whose status buttons are open
const adding = ref(false);
const manual = ref(null);

// Quick choices when adding; the rest is on the title's page.
// A film you saw tonight gets today's date; one you saw long ago gets none.
const QUICK = computed(() => (isSeries.value
  ? [{ key: 'watchlist', status: 'watchlist' }, { key: 'watching', status: 'watching' }, { key: 'finished', status: 'finished' }]
  : [{ key: 'watchlist', status: 'watchlist' }, { key: 'watchedToday', status: 'watched', watchedOn: isoDate() }, { key: 'watchedBefore', status: 'watched', watchedOn: null }]));
const quickLabel = (choice) => (choice.key === choice.status ? t(`status.${choice.status}`) : t(`add.${choice.key}`));

onMounted(async () => {
  try {
    tmdb.value = (await serverSettings()).tmdb;
    if (!tmdb.value) openManual();
  } catch {
    // search still tries
  }
});

let timer = null;
let seq = 0;
watch(q, () => {
  clearTimeout(timer);
  timer = setTimeout(runSearch, 400);
});

async function runSearch() {
  clearTimeout(timer);
  const query = q.value.trim();
  const mine = ++seq;
  picked.value = null;
  if (query.length < 2) {
    results.value = null;
    error.value = '';
    return;
  }
  searching.value = true;
  try {
    const hits = await api(`/tmdb/search?mode=${props.mode}&q=${encodeURIComponent(query)}`);
    if (mine !== seq) return; // an older search answering late
    results.value = hits;
    error.value = '';
  } catch (err) {
    if (mine === seq) error.value = errorText(err);
  } finally {
    if (mine === seq) searching.value = false;
  }
}

const path = computed(() => `/${props.mode}`);

async function add(hit, choice) {
  adding.value = true;
  try {
    const { id } = await api(path.value, { method: 'POST', body: { tmdbId: hit.tmdbId, status: choice.status, watchedOn: choice.watchedOn } });
    showToast(t('add.added', { title: hit.title }));
    router.push(itemPath(props.mode, id));
  } catch (err) {
    if (err.code === 'already_added') return router.push(itemPath(props.mode, err.data.id));
    showToast(errorText(err));
  } finally {
    adding.value = false;
  }
}

function openManual() {
  manual.value = { title: q.value.trim(), date: '', runtime: '', episodes: '', status: 'watchlist', watchedOn: '' };
}

async function addManual() {
  adding.value = true;
  try {
    const m = manual.value;
    const body = isSeries.value
      ? { title: m.title, firstAirDate: m.date || null, episodeRuntime: m.runtime || null, episodes: Number(m.episodes) || 0, status: m.status }
      : { title: m.title, releaseDate: m.date || null, runtime: m.runtime || null, status: m.status, watchedOn: m.status === 'watched' ? m.watchedOn || null : undefined };
    const { id } = await api(path.value, { method: 'POST', body });
    router.push(itemPath(props.mode, id));
  } catch (err) {
    showToast(errorText(err));
  } finally {
    adding.value = false;
  }
}
</script>

<template>
  <TopBar :title="t(`add.heading.${mode}`)" />
  <main>
    <ModeSwitch class="phone-only page-mode" />
    <template v-if="tmdb">
      <form class="search-box" role="search" @submit.prevent="runSearch">
        <Icon name="search" />
        <input v-model="q" type="search" :placeholder="t(`add.search.${mode}`)" :aria-label="t(`add.search.${mode}`)" autofocus enterkeyhint="search" />
      </form>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-else-if="searching && !results" class="muted center">{{ t('add.searching') }}</p>
      <p v-else-if="!results" class="muted small hint">{{ t(`add.searchHint.${mode}`) }}</p>
      <p v-else-if="!results.length" class="muted center">{{ t('add.noResults') }}</p>

      <ul v-if="results?.length" class="card-list results" :class="{ stale: searching }">
        <li v-for="hit in results" :key="hit.tmdbId">
          <component
            :is="hit.id ? 'RouterLink' : 'button'" :to="hit.id ? itemPath(mode, hit.id) : undefined" type="button"
            class="result-row" :aria-expanded="hit.id ? undefined : picked === hit.tmdbId" @click="!hit.id && (picked = picked === hit.tmdbId ? null : hit.tmdbId)"
          >
            <Poster class="thumb" :src="tmdbImage(hit.poster, 'w92')" :title="hit.title" />
            <span class="result-body">
              <strong>{{ hit.title }}</strong>
              <span class="meta">
                <span v-if="hit.year">{{ hit.year }}</span>
                <span v-if="hit.originalTitle">{{ hit.originalTitle }}</span>
              </span>
              <span v-if="hit.overview" class="result-overview muted small">{{ hit.overview }}</span>
              <span v-if="hit.id" class="tags"><span class="tag in-library"><Icon name="check" />{{ t('add.inLibrary') }}</span></span>
            </span>
            <Icon v-if="!hit.id" :name="picked === hit.tmdbId ? 'close' : 'plus'" class="row-icon" />
          </component>
          <div v-if="picked === hit.tmdbId" class="quick-status">
            <button v-for="c in QUICK" :key="c.key" class="btn small" :class="`st-${c.status}`" :disabled="adding" @click="add(hit, c)">
              <Icon :name="STATUS_ICONS[c.status]" />{{ quickLabel(c) }}
            </button>
          </div>
        </li>
      </ul>

      <p v-if="results && !manual" class="center hint">
        <button class="link-btn" @click="openManual">{{ t('add.notFound') }}</button>
      </p>
    </template>
    <p v-else class="info warn-box">{{ t('add.noTmdb') }}</p>

    <form v-if="manual" class="card form manual" @submit.prevent="addManual">
      <h2><Icon name="edit" />{{ t('add.manualTitle') }}</h2>
      <label><span>{{ t('add.title') }}</span><input v-model="manual.title" required maxlength="200" /></label>
      <label><span>{{ isSeries ? t('series.firstAired') : t('film.released') }}</span><PartialDate v-model="manual.date" /></label>
      <div class="two">
        <label><span>{{ isSeries ? t('series.episodeMinutes') : t('film.runtimeMinutes') }}</span><input v-model="manual.runtime" type="number" min="1" max="1500" inputmode="numeric" /></label>
        <label v-if="isSeries"><span>{{ t('add.episodes') }}</span><input v-model="manual.episodes" type="number" min="0" max="200" inputmode="numeric" /></label>
      </div>
      <label>
        <span>{{ t('library.status') }}</span>
        <select v-model="manual.status">
          <option v-for="s in STATUSES[mode]" :key="s" :value="s">{{ t(`status.${s}`) }}</option>
        </select>
      </label>
      <label v-if="!isSeries && manual.status === 'watched'"><span>{{ t('add.watchedOn') }}</span><PartialDate v-model="manual.watchedOn" /></label>
      <button class="btn primary" :disabled="adding">{{ t('add.addButton') }}</button>
    </form>
  </main>
</template>
