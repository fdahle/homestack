<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { countBy, errorText, formatNumber, starValue, STATUSES, yearOf } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import BarList from '../kit/components/BarList.vue';
import BookTile from '../components/BookTile.vue';

const books = ref(null);
const goal = ref(null);
const today = ref('');
const error = ref('');

onMounted(async () => {
  try {
    const data = await api('/books');
    books.value = data.books;
    goal.value = data.readingGoal;
    today.value = data.today;
  } catch (err) {
    error.value = errorText(err);
  }
});

const all = computed(() => books.value || []);
const read = computed(() => all.value.filter((b) => b.status === 'read'));
const rated = computed(() => all.value.filter((b) => b.rating));
const thisYear = computed(() => Number(today.value.slice(0, 4)) || new Date().getFullYear());
const readThisYear = computed(() => read.value.filter((b) => yearOf(b.finished_on) === thisYear.value));
const count = (status) => all.value.filter((b) => b.status === status).length;

const tiles = computed(() => {
  const pages = read.value.reduce((s, b) => s + (b.pages || 0), 0);
  const withoutPages = read.value.filter((b) => !b.pages).length;
  const avg = rated.value.length ? rated.value.reduce((s, b) => s + b.rating, 0) / rated.value.length : null;
  return [
    { label: t('stats.read'), value: formatNumber(read.value.length), icon: 'check' },
    { label: t('stats.pagesRead'), value: formatNumber(pages), icon: 'pages', sub: withoutPages ? t('stats.pagesSub', { n: withoutPages }) : '' },
    { label: t('stats.thisYear', { year: thisYear.value }), value: formatNumber(readThisYear.value.length), icon: 'calendar', sub: count('reading') ? t('stats.readingSub', { n: count('reading') }) : '' },
    { label: t('stats.avgRating'), value: avg ? `${starValue(Math.round(avg * 2) / 2)} ★` : '–', icon: 'trophy', sub: t('stats.ratedSub', { n: rated.value.length }) },
  ];
});

// The reading goal: how far you are, and how far you'd be reading at an even pace
const goalState = computed(() => {
  if (!goal.value) return null;
  const done = readThisYear.value.length;
  const [y, m, d] = today.value.split('-').map(Number);
  const dayOfYear = (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000 + 1;
  const daysInYear = (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / 86_400_000;
  const diff = done - Math.floor((goal.value * dayOfYear) / daysInYear);
  let note = t('stats.goalOnTrack');
  if (done >= goal.value) note = t('stats.goalDone');
  else if (diff > 0) note = t('stats.goalAhead', { n: diff });
  else if (diff < 0) note = t('stats.goalBehind', { n: -diff });
  return { done, percent: Math.min(100, Math.round((done / goal.value) * 100)), note, behind: diff < 0 && done < goal.value };
});

// Per year, from the newest year back to the first, years without any included
function perYearRows(value) {
  const sums = new Map();
  for (const b of read.value) {
    const y = yearOf(b.finished_on);
    if (y) sums.set(y, (sums.get(y) || 0) + value(b));
  }
  if (!sums.size) return [];
  const years = [...sums.keys()];
  const rows = [];
  for (let y = Math.max(...years); y >= Math.min(...years); y--) rows.push([String(y), sums.get(y) || 0]);
  return rows;
}
const perYear = computed(() => perYearRows(() => 1));
const pagesPerYear = computed(() => perYearRows((b) => b.pages || 0));
const readWithoutDate = computed(() => read.value.filter((b) => !b.finished_on).length);

const statusRows = computed(() => STATUSES.map((s) => [t(`status.${s}`), count(s), s]).filter(([, n]) => n));
const statusLink = (label) => `/?status=${statusRows.value.find(([l]) => l === label)?.[2]}`;

const authorRows = computed(() => countBy(read.value, (b) => b.authors).slice(0, 10));
const ratingRows = computed(() => {
  // From your best to your worst rating, the steps in between included
  const counts = new Map(countBy(rated.value, (b) => b.rating));
  const ratings = [...counts.keys()];
  const rows = [];
  for (let r = Math.max(...ratings); r >= Math.min(...ratings); r--) rows.push([`${starValue(r)} ★`, counts.get(r) || 0]);
  return rows;
});
const favourites = computed(() => [...rated.value].sort((a, b) => b.rating - a.rating || (b.finished_on || '').localeCompare(a.finished_on || '')).slice(0, 8));
</script>

<template>
  <TopBar :title="t('stats.title')" />
  <main class="wide">
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="!books" class="muted center">…</p>
    <div v-else-if="!books.length" class="empty"><p>{{ t('stats.empty') }}</p></div>

    <template v-else>
      <div class="stat-tiles">
        <div v-for="tile in tiles" :key="tile.label" class="stat-tile">
          <span class="stat-label"><Icon :name="tile.icon" />{{ tile.label }}</span>
          <strong>{{ tile.value }}</strong>
          <small v-if="tile.sub" class="muted">{{ tile.sub }}</small>
        </div>
      </div>

      <div class="stat-cards">
        <section v-if="goalState" class="card goal" :class="goalState.behind ? 'st-reading' : 'st-read'">
          <h2 class="card-title">{{ t('stats.goal', { year: thisYear }) }}</h2>
          <div class="goal-numbers">
            <strong>{{ formatNumber(goalState.done) }}</strong>
            <span class="muted">{{ t('stats.goalOf', { goal: formatNumber(goal) }) }}</span>
          </div>
          <div class="progress" :style="{ '--p': goalState.percent }"><span></span></div>
          <p class="small">{{ goalState.note }}</p>
        </section>

        <section v-if="perYear.length" class="card">
          <h2 class="card-title">{{ t('stats.perYear') }}</h2>
          <BarList :rows="perYear" />
          <p v-if="readWithoutDate" class="muted small">{{ t('stats.withoutDate', { n: readWithoutDate }) }}</p>
        </section>

        <section class="card">
          <h2 class="card-title">{{ t('stats.byStatus') }}</h2>
          <BarList :rows="statusRows.map(([l, n]) => [l, n])" :to="statusLink" />
          <p v-if="!goal" class="small"><RouterLink to="/settings">{{ t('stats.goalSet') }}</RouterLink></p>
        </section>

        <section v-if="pagesPerYear.some(([, n]) => n)" class="card">
          <h2 class="card-title">{{ t('stats.pagesPerYear') }}</h2>
          <BarList :rows="pagesPerYear" />
        </section>

        <section v-if="authorRows.length" class="card">
          <h2 class="card-title">{{ t('stats.authors') }}</h2>
          <BarList :rows="authorRows" :to="(a) => `/?author=${encodeURIComponent(a)}`" />
        </section>

        <section v-if="rated.length" class="card">
          <h2 class="card-title">{{ t('stats.ratings') }}</h2>
          <BarList :rows="ratingRows" />
        </section>
      </div>

      <section v-if="favourites.length">
        <h2 class="section">{{ t('stats.favourites') }}</h2>
        <div class="shelf">
          <BookTile v-for="b in favourites" :key="b.id" :book="b" hide-status />
        </div>
      </section>
    </template>
  </main>
</template>
