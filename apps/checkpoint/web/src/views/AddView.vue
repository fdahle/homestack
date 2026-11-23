<script setup>
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { errorText, showToast, STATUS_ICONS } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import GameCover from '../components/GameCover.vue';
import PartialDate from '../kit/components/PartialDate.vue';

const router = useRouter();
const igdb = ref(true);
const q = ref('');
const results = ref(null);
const searching = ref(false);
const error = ref('');
const picked = ref(null); // igdbId whose status buttons are open
const adding = ref(false);
const manual = ref(null);
const usedPlatforms = ref([]);

// Quick choices when adding; the rest can be set on the game's page
const QUICK = ['playing', 'finished', 'backlog', 'wishlist'];
const steam = ref(null); // { configured, waiting }

onMounted(async () => {
  try {
    const settings = await api('/settings');
    steam.value = settings.steam;
    igdb.value = settings.igdb;
    if (!igdb.value) openManual();
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
    const hits = await api(`/igdb/search?q=${encodeURIComponent(query)}`);
    if (mine !== seq) return; // an older search answering late
    results.value = hits;
    error.value = '';
  } catch (err) {
    if (mine === seq) error.value = errorText(err);
  } finally {
    if (mine === seq) searching.value = false;
  }
}

const thumb = (hit) => (hit.coverId ? `/api/igdb/thumb/${hit.coverId}` : null);
const isMainGame = (hit) => !hit.type || hit.type === 'Main Game';

async function add(hit, status) {
  adding.value = true;
  try {
    const { id } = await api('/games', { method: 'POST', body: { igdbId: hit.igdbId, status } });
    showToast(t('add.added', { name: hit.name }));
    router.push(`/game/${id}`);
  } catch (err) {
    if (err.code === 'already_added') return router.push(`/game/${err.data.id}`);
    showToast(errorText(err));
  } finally {
    adding.value = false;
  }
}

async function openManual() {
  manual.value = { name: q.value.trim(), releaseDate: '', playedOn: '', status: 'backlog' };
  try {
    usedPlatforms.value = (await api('/games')).platforms;
  } catch {
    // only the suggestions are missing
  }
}

async function addManual() {
  adding.value = true;
  try {
    const m = manual.value;
    const { id } = await api('/games', { method: 'POST', body: { name: m.name, releaseDate: m.releaseDate || null, playedOn: m.playedOn, status: m.status } });
    router.push(`/game/${id}`);
  } catch (err) {
    showToast(errorText(err));
  } finally {
    adding.value = false;
  }
}
</script>

<template>
  <TopBar :title="t('add.title')" />
  <main>
    <RouterLink v-if="steam?.configured && steam.waiting" to="/steam" class="steam-cta">
      <Icon name="download" />
      <span class="grow"><strong>{{ t('steam.fromSteam') }}</strong><small>{{ t('steam.waiting', { n: steam.waiting }) }}</small></span>
      <Icon name="forward" />
    </RouterLink>
    <template v-if="igdb">
      <form class="search-box" role="search" @submit.prevent="runSearch">
        <Icon name="search" />
        <input v-model="q" type="search" :placeholder="t('add.search')" :aria-label="t('add.search')" autofocus enterkeyhint="search" />
      </form>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-else-if="searching && !results" class="muted center">{{ t('add.searching') }}</p>
      <p v-else-if="!results" class="muted small hint">{{ t('add.searchHint') }}</p>
      <p v-else-if="!results.length" class="muted center">{{ t('add.noResults') }}</p>

      <ul v-if="results?.length" class="card-list results" :class="{ stale: searching }">
        <li v-for="hit in results" :key="hit.igdbId">
          <component
            :is="hit.gameId ? 'RouterLink' : 'button'" :to="hit.gameId ? `/game/${hit.gameId}` : undefined" type="button"
            class="result-row" :aria-expanded="hit.gameId ? undefined : picked === hit.igdbId" @click="!hit.gameId && (picked = picked === hit.igdbId ? null : hit.igdbId)"
          >
            <GameCover class="thumb" :src="thumb(hit)" :name="hit.name" />
            <span class="result-body">
              <strong>{{ hit.name }}</strong>
              <span class="meta">
                <span v-if="hit.year">{{ hit.year }}</span>
                <span v-if="hit.platforms.length">{{ hit.platforms.slice(0, 5).join(', ') }}{{ hit.platforms.length > 5 ? ' …' : '' }}</span>
              </span>
              <span v-if="!isMainGame(hit) || hit.gameId" class="tags">
                <span v-if="!isMainGame(hit)" class="tag">{{ hit.type }}</span>
                <span v-if="hit.gameId" class="tag in-library"><Icon name="check" />{{ t('add.inLibrary') }}</span>
              </span>
            </span>
            <Icon v-if="!hit.gameId" :name="picked === hit.igdbId ? 'close' : 'plus'" class="row-icon" />
          </component>
          <div v-if="picked === hit.igdbId" class="quick-status">
            <button v-for="s in QUICK" :key="s" class="btn small" :class="`st-${s}`" :disabled="adding" @click="add(hit, s)">
              <Icon :name="STATUS_ICONS[s]" />{{ t(`status.${s}`) }}
            </button>
          </div>
        </li>
      </ul>

      <p v-if="results && !manual" class="center hint">
        <button class="link-btn" @click="openManual">{{ t('add.notFound') }}</button>
      </p>
    </template>
    <p v-else class="info warn-box">{{ t('add.noIgdb') }}</p>

    <form v-if="manual" class="card form manual" @submit.prevent="addManual">
      <h2><Icon name="edit" />{{ t('add.manualTitle') }}</h2>
      <label><span>{{ t('add.name') }}</span><input v-model="manual.name" required maxlength="200" /></label>
      <label><span>{{ t('game.released') }}</span><PartialDate v-model="manual.releaseDate" /></label>
      <label>
        <span>{{ t('game.playedOn') }}</span>
        <input v-model="manual.playedOn" list="manual-platforms" maxlength="60" />
        <datalist id="manual-platforms"><option v-for="p in usedPlatforms" :key="p" :value="p" /></datalist>
      </label>
      <label>
        <span>{{ t('library.status') }}</span>
        <select v-model="manual.status">
          <option v-for="s in ['playing', 'finished', 'completed', 'dropped', 'backlog', 'wishlist']" :key="s" :value="s">{{ t(`status.${s}`) }}</option>
        </select>
      </label>
      <button class="btn primary" :disabled="adding">{{ t('add.addButton') }}</button>
    </form>
  </main>
</template>
