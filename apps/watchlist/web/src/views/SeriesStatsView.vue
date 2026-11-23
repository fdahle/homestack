<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { countBy, countryName, yearRows, errorText, formatHours, formatNumber, PATHS, SEEN, SERIES_STATUSES, starValue } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import BarList from '../kit/components/BarList.vue';
import ModeSwitch from '../components/ModeSwitch.vue';
import TitleTile from '../components/TitleTile.vue';

const series = ref(null);
const error = ref('');

onMounted(async () => {
  try {
    series.value = (await api('/series')).series;
  } catch (err) {
    error.value = errorText(err);
  }
});

const all = computed(() => series.value || []);
const started = computed(() => all.value.filter((s) => SEEN.series.includes(s.status) || s.watched));
const rated = computed(() => all.value.filter((s) => s.rating));
const count = (status) => all.value.filter((s) => s.status === status).length;

const tiles = computed(() => {
  const episodes = all.value.reduce((n, s) => n + s.watched, 0);
  const minutes = all.value.reduce((n, s) => n + s.minutes, 0);
  const avg = rated.value.length ? rated.value.reduce((sum, s) => sum + s.rating, 0) / rated.value.length : null;
  return [
    { label: t('stats.seriesStarted'), value: formatNumber(started.value.length), icon: 'tv', sub: t('stats.finishedSub', { n: count('finished') }) },
    { label: t('stats.episodes'), value: formatNumber(episodes), icon: 'check', sub: t('stats.watchingSub', { n: count('watching') }) },
    { label: t('stats.hours'), value: formatHours(minutes), icon: 'clock', sub: minutes ? t('stats.days', { n: formatNumber(minutes / 1440, 1) }) : '' },
    { label: t('stats.avgRating'), value: avg ? `${starValue(Math.round(avg * 2) / 2)} ★` : '–', icon: 'heart', sub: t('stats.ratedSub', { n: rated.value.length }) },
  ];
});

// Episodes per year, from the newest year back to the first
const perYear = computed(() => {
  const counts = new Map();
  for (const s of all.value) for (const [y, n] of Object.entries(s.years)) counts.set(Number(y), (counts.get(Number(y)) || 0) + n);
  if (!counts.size) return [];
  return yearRows(counts);
});
const withoutDate = computed(() => all.value.reduce((n, s) => n + s.watched - Object.values(s.years).reduce((a, b) => a + b, 0), 0));

const statusRows = computed(() => SERIES_STATUSES.map((s) => [t(`status.${s}`), count(s), s]).filter(([, n]) => n));
const statusLink = (label) => `${PATHS.series.library}?status=${statusRows.value.find(([l]) => l === label)?.[2]}`;
const genreRows = computed(() => countBy(started.value, (s) => s.genres).slice(0, 10));
// Countries by name, each linking to the library filtered by its code
const countryRows = computed(() => countBy(started.value, (x) => x.countries).slice(0, 10).map(([code, n]) => [countryName(code), n, code]));
const countryLink = (name) => `${PATHS.series.library}?country=${countryRows.value.find(([l]) => l === name)?.[2]}`;
const networkRows = computed(() => countBy(started.value, (s) => s.networks).slice(0, 8));
// Where the hours went: the shows you spent the most time with
const timeRows = computed(() => [...all.value].filter((s) => s.minutes).sort((a, b) => b.minutes - a.minutes).slice(0, 8)
  .map((s) => [s.title, Math.round(s.minutes / 60)]));
const ratingRows = computed(() => {
  const counts = new Map(countBy(rated.value, (s) => s.rating));
  const ratings = [...counts.keys()];
  const rows = [];
  for (let r = Math.max(...ratings); r >= Math.min(...ratings); r--) rows.push([`${starValue(r)} ★`, counts.get(r) || 0]);
  return rows;
});
const favourites = computed(() => [...rated.value].sort((a, b) => b.rating - a.rating || (b.last_watched || '').localeCompare(a.last_watched || '')).slice(0, 8));
</script>

<template>
  <TopBar :title="t('stats.title.series')" />
  <main class="wide">
    <ModeSwitch class="phone-only page-mode" />
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="!series" class="muted center">…</p>
    <div v-else-if="!series.length" class="empty"><p>{{ t('stats.empty.series') }}</p></div>

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
          <h2 class="card-title">{{ t('stats.episodesPerYear') }}</h2>
          <BarList :rows="perYear" />
          <p v-if="withoutDate" class="muted small">{{ t('stats.episodesWithoutDate', { n: withoutDate }) }}</p>
        </section>

        <section class="card">
          <h2 class="card-title">{{ t('stats.byStatus') }}</h2>
          <BarList :rows="statusRows.map(([l, n]) => [l, n])" :to="statusLink" />
        </section>

        <section v-if="timeRows.length" class="card">
          <h2 class="card-title">{{ t('stats.mostTime') }}</h2>
          <BarList :rows="timeRows" :unit="(h) => t('time.hoursShort', { h: formatNumber(h) })" />
        </section>

        <section v-if="genreRows.length" class="card">
          <h2 class="card-title">{{ t('stats.genres') }}</h2>
          <BarList :rows="genreRows" :to="(g) => `${PATHS.series.library}?genre=${encodeURIComponent(g)}`" />
        </section>

        <section v-if="countryRows.length" class="card">
          <h2 class="card-title">{{ t('stats.countries') }}</h2>
          <BarList :rows="countryRows.map(([l, n]) => [l, n])" :to="countryLink" />
        </section>

        <section v-if="networkRows.length" class="card">
          <h2 class="card-title">{{ t('stats.networks') }}</h2>
          <BarList :rows="networkRows" />
        </section>

        <section v-if="rated.length" class="card">
          <h2 class="card-title">{{ t('stats.ratings') }}</h2>
          <BarList :rows="ratingRows" />
        </section>
      </div>

      <section v-if="favourites.length">
        <h2 class="section">{{ t('stats.favourites') }}</h2>
        <div class="shelf">
          <TitleTile v-for="s in favourites" :key="s.id" :item="s" mode="series" hide-status />
        </div>
      </section>
    </template>
  </main>
</template>
