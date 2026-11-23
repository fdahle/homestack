<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { byName, countBy, errorText, formatHours, gamePlatforms, relativeDay, showToast, yearOf } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import GameCover from '../components/GameCover.vue';

const router = useRouter();
const games = ref(null);
const error = ref('');
const platform = ref('');
const length = ref('any');
const genre = ref('');
const pick = ref(null);
const rolling = ref(false);
const starting = ref(false);

// Lengths by IGDB's time for the main story
const LENGTHS = {
  any: () => true,
  short: (h) => h != null && h < 10,
  medium: (h) => h != null && h >= 10 && h <= 30,
  long: (h) => h != null && h > 30,
};

onMounted(async () => {
  try {
    games.value = (await api('/games')).games;
    roll();
  } catch (err) {
    error.value = errorText(err);
  }
});

const backlog = computed(() => (games.value || []).filter((g) => g.status === 'backlog'));
const playing = computed(() => (games.value || []).filter((g) => g.status === 'playing').sort(byName));
const platforms = computed(() => countBy(backlog.value, gamePlatforms).map(([p]) => p));
const genres = computed(() => countBy(backlog.value, (g) => g.genres).map(([g]) => g).sort());

const candidates = computed(() => backlog.value
  .filter((g) => !platform.value || gamePlatforms(g).includes(platform.value))
  .filter((g) => !genre.value || g.genres.includes(genre.value))
  .filter((g) => LENGTHS[length.value](g.hours_main)));

// Recently shown games come last, so "another one" goes through all of them before repeating
const recent = [];

function roll() {
  const list = candidates.value;
  if (!list.length) {
    pick.value = null;
    return;
  }
  let pool = list.filter((g) => !recent.includes(g.id));
  if (!pool.length) {
    // All shown once: start over, but not with the one on screen
    recent.length = 0;
    pool = list.length > 1 ? list.filter((g) => g.id !== pick.value?.id) : list;
  }
  const next = pool[Math.floor(Math.random() * pool.length)];
  recent.push(next.id);
  pick.value = next;
  rolling.value = true;
  setTimeout(() => (rolling.value = false), 250);
}

watch([platform, length, genre], () => {
  recent.length = 0;
  roll();
});

async function startPlaying() {
  starting.value = true;
  try {
    await api(`/games/${pick.value.id}`, { method: 'PATCH', body: { status: 'playing' } });
    showToast(t('next.started', { name: pick.value.name }));
    router.push(`/game/${pick.value.id}`);
  } catch (err) {
    showToast(errorText(err));
  } finally {
    starting.value = false;
  }
}
</script>

<template>
  <TopBar :title="t('next.title')" />
  <main>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="!games" class="muted center">…</p>

    <div v-else-if="!backlog.length" class="empty">
      <p>{{ t('next.emptyBacklog') }}</p>
      <div class="row-buttons"><RouterLink to="/add" class="btn primary"><Icon name="plus" />{{ t('nav.add') }}</RouterLink></div>
    </div>

    <template v-else>
      <p v-if="playing.length" class="info playing-note">
        <Icon name="gamepad" />
        <span>{{ t('next.alreadyPlaying') }} <template v-for="(g, i) in playing" :key="g.id"><RouterLink :to="`/game/${g.id}`">{{ g.name }}</RouterLink>{{ i < playing.length - 1 ? ', ' : '' }}</template></span>
      </p>

      <div class="next-filters">
        <div v-if="platforms.length > 1" class="chips" role="group" :aria-label="t('library.platform')">
          <button class="chip" :class="{ active: !platform }" @click="platform = ''">{{ t('library.allPlatforms') }}</button>
          <button v-for="p in platforms" :key="p" class="chip" :class="{ active: platform === p }" @click="platform = p">{{ p }}</button>
        </div>
        <div class="segmented wide" role="group" :aria-label="t('next.length')">
          <button v-for="(fn, key) in LENGTHS" :key="key" :class="{ active: length === key }" @click="length = key">{{ t(`next.lengths.${key}`) }}</button>
        </div>
        <select v-if="genres.length > 1" v-model="genre" :aria-label="t('library.genre')">
          <option value="">{{ t('library.allGenres') }}</option>
          <option v-for="g in genres" :key="g" :value="g">{{ g }}</option>
        </select>
      </div>

      <section v-if="pick" class="pick card" :class="{ rolling }" aria-live="polite">
        <RouterLink :to="`/game/${pick.id}`" class="pick-cover"><GameCover :game="pick" eager /></RouterLink>
        <div class="pick-body">
          <p class="muted small">{{ t('next.howAbout') }}</p>
          <h2><RouterLink :to="`/game/${pick.id}`">{{ pick.name }}</RouterLink></h2>
          <p class="meta">
            <span v-if="pick.release_date">{{ yearOf(pick.release_date) }}</span>
            <span v-if="pick.hours_main">{{ t('game.hoursMain', { h: formatHours(pick.hours_main) }) }}</span>
          </p>
          <div v-if="pick.genres.length" class="tags"><span v-for="g in pick.genres.slice(0, 4)" :key="g" class="tag">{{ g }}</span></div>
          <p class="muted small">{{ t('next.waiting', { when: relativeDay(pick.created_at) }) }}</p>
          <div class="row-buttons">
            <button class="btn primary" :disabled="starting" @click="startPlaying"><Icon name="play" />{{ t('next.play') }}</button>
            <button class="btn" :disabled="candidates.length < 2" @click="roll"><Icon name="dice" />{{ t('next.another') }}</button>
          </div>
        </div>
      </section>
      <div v-else class="empty"><p>{{ t('next.noMatch') }}</p></div>

      <p class="muted small center">{{ t('next.count', { n: candidates.length, total: backlog.length }) }}</p>
    </template>
  </main>
</template>
