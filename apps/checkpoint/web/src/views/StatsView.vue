<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { BEATEN, countBy, errorText, formatHours, formatNumber, PLAYED, starValue, STATUSES, yearOf } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import BarList from '../kit/components/BarList.vue';
import GameTile from '../components/GameTile.vue';

const games = ref(null);
const error = ref('');

onMounted(async () => {
  try {
    games.value = (await api('/games')).games;
  } catch (err) {
    error.value = errorText(err);
  }
});

const all = computed(() => games.value || []);
const played = computed(() => all.value.filter((g) => PLAYED.includes(g.status)));
const beaten = computed(() => all.value.filter((g) => BEATEN.includes(g.status)));
const backlog = computed(() => all.value.filter((g) => g.status === 'backlog'));
const rated = computed(() => all.value.filter((g) => g.rating));
const count = (status) => all.value.filter((g) => g.status === status).length;

const tiles = computed(() => {
  const dropped = count('dropped');
  const avg = rated.value.length ? rated.value.reduce((s, g) => s + g.rating, 0) / rated.value.length : null;
  return [
    { label: t('stats.played'), value: formatNumber(played.value.length), icon: 'gamepad' },
    { label: t('stats.beaten'), value: formatNumber(beaten.value.length), icon: 'flag', sub: t('stats.completedSub', { n: count('completed') }) },
    { label: t('stats.finishRate'), value: beaten.value.length + dropped ? `${formatNumber((beaten.value.length / (beaten.value.length + dropped)) * 100)} %` : '–', icon: 'stop', sub: t('stats.droppedSub', { n: dropped }) },
    { label: t('stats.avgRating'), value: avg ? `${starValue(Math.round(avg * 2) / 2)} ★` : '–', icon: 'trophy', sub: t('stats.ratedSub', { n: rated.value.length }) },
  ];
});

// Beaten per year, from the newest year back to the first, years without any included
const perYear = computed(() => {
  const counts = new Map(countBy(beaten.value, (g) => yearOf(g.finished_on)));
  if (!counts.size) return [];
  const years = [...counts.keys()];
  const rows = [];
  for (let y = Math.max(...years); y >= Math.min(...years); y--) rows.push([String(y), counts.get(y) || 0]);
  return rows;
});
const beatenWithoutDate = computed(() => beaten.value.filter((g) => !g.finished_on).length);

const statusRows = computed(() => STATUSES.map((s) => [t(`status.${s}`), count(s), s]).filter(([, n]) => n));
const statusLink = (label) => `/?status=${statusRows.value.find(([l]) => l === label)?.[2]}`;

const platformRows = computed(() => countBy(played.value, (g) => g.played_on).slice(0, 10));
const withoutPlatform = computed(() => played.value.filter((g) => !g.played_on).length);
const genreRows = computed(() => countBy(played.value, (g) => g.genres).slice(0, 10));
const ratingRows = computed(() => {
  // From your best to your worst rating, the steps in between included
  const counts = new Map(countBy(rated.value, (g) => g.rating));
  const ratings = [...counts.keys()];
  const rows = [];
  for (let r = Math.max(...ratings); r >= Math.min(...ratings); r--) rows.push([`${starValue(r)} ★`, counts.get(r) || 0]);
  return rows;
});
const favourites = computed(() => [...rated.value].sort((a, b) => b.rating - a.rating || (b.finished_on || '').localeCompare(a.finished_on || '')).slice(0, 6));

const backlogHours = computed(() => {
  const known = backlog.value.filter((g) => g.hours_main);
  return { hours: known.reduce((s, g) => s + g.hours_main, 0), known: known.length };
});
</script>

<template>
  <TopBar :title="t('stats.title')" />
  <main class="wide">
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="!games" class="muted center">…</p>
    <div v-else-if="!games.length" class="empty"><p>{{ t('stats.empty') }}</p></div>

    <template v-else>
      <div class="stat-tiles">
        <div v-for="tile in tiles" :key="tile.label" class="stat-tile">
          <span class="stat-label"><Icon :name="tile.icon" />{{ tile.label }}</span>
          <strong>{{ tile.value }}</strong>
          <small v-if="tile.sub" class="muted">{{ tile.sub }}</small>
        </div>
      </div>

      <div class="stat-cards">
        <section v-if="perYear.length" class="card">
          <h2 class="card-title">{{ t('stats.perYear') }}</h2>
          <BarList :rows="perYear" />
          <p v-if="beatenWithoutDate" class="muted small">{{ t('stats.withoutDate', { n: beatenWithoutDate }) }}</p>
        </section>

        <section class="card">
          <h2 class="card-title">{{ t('stats.byStatus') }}</h2>
          <BarList :rows="statusRows.map(([l, n]) => [l, n])" :to="statusLink" />
          <p v-if="backlog.length" class="muted small backlog-note">
            <Icon name="clock" />
            <span v-if="backlogHours.known">{{ t('stats.backlogHours', { h: formatHours(Math.round(backlogHours.hours)), known: backlogHours.known, total: backlog.length }) }}</span>
            <span v-else>{{ t('stats.backlogNoHours', { n: backlog.length }) }}</span>
          </p>
        </section>

        <section v-if="platformRows.length" class="card">
          <h2 class="card-title">{{ t('stats.platforms') }}</h2>
          <BarList :rows="platformRows" :to="(p) => `/?platform=${encodeURIComponent(p)}`" />
          <p v-if="withoutPlatform" class="muted small">{{ t('stats.withoutPlatform', { n: withoutPlatform }) }}</p>
        </section>

        <section v-if="genreRows.length" class="card">
          <h2 class="card-title">{{ t('stats.genres') }}</h2>
          <BarList :rows="genreRows" :to="(g) => `/?genre=${encodeURIComponent(g)}`" />
        </section>

        <section v-if="rated.length" class="card">
          <h2 class="card-title">{{ t('stats.ratings') }}</h2>
          <BarList :rows="ratingRows" />
        </section>
      </div>

      <section v-if="favourites.length">
        <h2 class="section">{{ t('stats.favourites') }}</h2>
        <div class="shelf">
          <GameTile v-for="g in favourites" :key="g.id" :game="g" hide-status />
        </div>
      </section>
    </template>
  </main>
</template>
