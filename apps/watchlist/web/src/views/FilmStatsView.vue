<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { countBy, countryName, yearRows, errorText, FILM_STATUSES, formatHours, formatNumber, PATHS, starValue, yearOf } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import BarList from '../kit/components/BarList.vue';
import ModeSwitch from '../components/ModeSwitch.vue';
import TitleTile from '../components/TitleTile.vue';

const films = ref(null);
const error = ref('');

onMounted(async () => {
  try {
    films.value = (await api('/films')).films;
  } catch (err) {
    error.value = errorText(err);
  }
});

const all = computed(() => films.value || []);
const watched = computed(() => all.value.filter((f) => f.status === 'watched'));
const rated = computed(() => all.value.filter((f) => f.rating));
const count = (status) => all.value.filter((f) => f.status === status).length;
// A film marked as watched counts once even when its watch log is empty
const timesWatched = (f) => f.watch_count || (f.status === 'watched' ? 1 : 0);

const tiles = computed(() => {
  const watches = all.value.reduce((n, f) => n + timesWatched(f), 0);
  const minutes = all.value.reduce((n, f) => n + (f.runtime || 0) * timesWatched(f), 0);
  const rewatched = all.value.filter((f) => f.watch_count > 1).length;
  const avg = rated.value.length ? rated.value.reduce((s, f) => s + f.rating, 0) / rated.value.length : null;
  const watchlist = all.value.filter((f) => f.status === 'watchlist');
  const watchlistMinutes = watchlist.reduce((n, f) => n + (f.runtime || 0), 0);
  return [
    { label: t('stats.filmsWatched'), value: formatNumber(watched.value.length), icon: 'eye', sub: t('stats.watchesSub', { n: watches }) },
    { label: t('stats.hours'), value: formatHours(minutes), icon: 'clock', sub: rewatched ? t('stats.rewatchedSub', { n: rewatched }) : '' },
    { label: t('stats.avgRating'), value: avg ? `${starValue(Math.round(avg * 2) / 2)} ★` : '–', icon: 'heart', sub: t('stats.ratedSub', { n: rated.value.length }) },
    { label: t('status.watchlist'), value: formatNumber(watchlist.length), icon: 'bookmark', sub: watchlistMinutes ? t('stats.watchlistHours', { h: formatHours(watchlistMinutes) }) : '' },
  ];
});

// Watches per year, from the newest year back to the first, years without any included
const perYear = computed(() => {
  const counts = new Map();
  for (const f of all.value) for (const d of f.watch_dates) counts.set(yearOf(d), (counts.get(yearOf(d)) || 0) + 1);
  if (!counts.size) return [];
  return yearRows(counts);
});
const withoutDate = computed(() => all.value.reduce((n, f) => n + Math.max(0, timesWatched(f) - f.watch_dates.length), 0));

const statusRows = computed(() => FILM_STATUSES.map((s) => [t(`status.${s}`), count(s), s]).filter(([, n]) => n));
const statusLink = (label) => `${PATHS.films.library}?status=${statusRows.value.find(([l]) => l === label)?.[2]}`;
const genreRows = computed(() => countBy(watched.value, (f) => f.genres).slice(0, 10));
// Countries by name, each linking to the library filtered by its code
const countryRows = computed(() => countBy(watched.value, (x) => x.countries).slice(0, 10).map(([code, n]) => [countryName(code), n, code]));
const countryLink = (name) => `${PATHS.films.library}?country=${countryRows.value.find(([l]) => l === name)?.[2]}`;
const directorRows = computed(() => countBy(watched.value, (f) => (f.director ? f.director.split(', ') : [])).filter(([, n]) => n > 1).slice(0, 8));
const decadeRows = computed(() => countBy(watched.value, (f) => (f.release_date ? t('stats.decade', { d: Math.floor(yearOf(f.release_date) / 10) * 10 }) : null))
  .sort((a, b) => b[0].localeCompare(a[0])));
const ratingRows = computed(() => {
  const counts = new Map(countBy(rated.value, (f) => f.rating));
  const ratings = [...counts.keys()];
  const rows = [];
  for (let r = Math.max(...ratings); r >= Math.min(...ratings); r--) rows.push([`${starValue(r)} ★`, counts.get(r) || 0]);
  return rows;
});
const favourites = computed(() => [...rated.value].sort((a, b) => b.rating - a.rating || (b.last_watched || '').localeCompare(a.last_watched || '')).slice(0, 8));
</script>

<template>
  <TopBar :title="t('stats.title.films')" />
  <main class="wide">
    <ModeSwitch class="phone-only page-mode" />
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="!films" class="muted center">…</p>
    <div v-else-if="!films.length" class="empty"><p>{{ t('stats.empty.films') }}</p></div>

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
          <h2 class="card-title">{{ t('stats.watchesPerYear') }}</h2>
          <BarList :rows="perYear" />
          <p v-if="withoutDate" class="muted small">{{ t('stats.withoutDate', { n: withoutDate }) }}</p>
        </section>

        <section class="card">
          <h2 class="card-title">{{ t('stats.byStatus') }}</h2>
          <BarList :rows="statusRows.map(([l, n]) => [l, n])" :to="statusLink" />
        </section>

        <section v-if="genreRows.length" class="card">
          <h2 class="card-title">{{ t('stats.genres') }}</h2>
          <BarList :rows="genreRows" :to="(g) => `${PATHS.films.library}?genre=${encodeURIComponent(g)}`" />
        </section>

        <section v-if="countryRows.length" class="card">
          <h2 class="card-title">{{ t('stats.countries') }}</h2>
          <BarList :rows="countryRows.map(([l, n]) => [l, n])" :to="countryLink" />
        </section>

        <section v-if="decadeRows.length > 1" class="card">
          <h2 class="card-title">{{ t('stats.decades') }}</h2>
          <BarList :rows="decadeRows" />
        </section>

        <section v-if="directorRows.length" class="card">
          <h2 class="card-title">{{ t('stats.directors') }}</h2>
          <BarList :rows="directorRows" :to="(d) => `${PATHS.films.library}?q=${encodeURIComponent(d)}`" />
        </section>

        <section v-if="rated.length" class="card">
          <h2 class="card-title">{{ t('stats.ratings') }}</h2>
          <BarList :rows="ratingRows" />
        </section>
      </div>

      <section v-if="favourites.length">
        <h2 class="section">{{ t('stats.favourites') }}</h2>
        <div class="shelf">
          <TitleTile v-for="f in favourites" :key="f.id" :item="f" mode="films" hide-status />
        </div>
      </section>
    </template>
  </main>
</template>
