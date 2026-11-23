<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { bookChange, byAuthor, byDailyRandom, byTitle, compareText, countBy, errorText, formatNumber, lastName, rememberedRef, STATUS_ICONS, STATUSES, useShortcut } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import SplitView from '../kit/components/SplitView.vue';
import BookTile from '../components/BookTile.vue';

const route = useRoute();
const router = useRouter();
const books = ref(null);
const error = ref('');

// Filters live in the address, so "back" from a book returns to the same view.
// The sort order is also remembered on this device.
const status = ref(String(route.query.status || 'all'));
const author = ref(String(route.query.author || ''));
const calibre = ref(String(route.query.calibre || ''));
const SORT_KEYS = ['recent', 'title', 'author', 'rating', 'finished', 'added', 'random'];
const sort = rememberedRef('regal.sort', 'recent', { allowed: SORT_KEYS, initial: route.query.sort && String(route.query.sort) });
const q = ref(String(route.query.q || ''));

watch([status, author, calibre, sort, q], () => {
  if (route.name !== 'library') return;
  const query = {};
  if (status.value !== 'all') query.status = status.value;
  if (author.value) query.author = author.value;
  if (calibre.value) query.calibre = calibre.value;
  if (sort.value !== 'recent') query.sort = sort.value;
  if (q.value.trim()) query.q = q.value.trim();
  router.replace({ query });
});

// Links like /?author=… from a book's page or the stats, while the list is already open
watch(() => route.query, (query) => {
  if (route.name !== 'library') return;
  if (query.author !== undefined) author.value = String(query.author);
  if (query.status !== undefined) status.value = String(query.status);
});

async function load() {
  try {
    books.value = (await api('/books')).books;
  } catch (err) {
    error.value = errorText(err);
  }
}
onMounted(load);

// A change on the book's page (beside the list on a computer) shows in the list straight away
watch(bookChange, (change) => {
  if (!change || !books.value) return;
  const i = books.value.findIndex((b) => b.id === change.id);
  if (change.deleted) {
    if (i >= 0) books.value.splice(i, 1);
  } else if (i >= 0) books.value[i] = { ...books.value[i], ...change.book };
  else books.value.push(change.book);
});

// "/" jumps to the search
const searchInput = ref(null);
useShortcut('/', () => searchInput.value?.focus());

const all = computed(() => books.value || []);
const reading = computed(() => all.value.filter((b) => b.status === 'reading').sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
const counts = computed(() => Object.fromEntries(countBy(all.value, (b) => b.status)));
const statusChips = computed(() => ['all', ...STATUSES.filter((s) => counts.value[s])]);
// Authors with the most books first would bury the rest; the menu is alphabetical by last name
const authors = computed(() => countBy(all.value, (b) => b.authors).map(([a]) => a).sort((a, b) => compareText(lastName(a), lastName(b))));
const hasCalibre = computed(() => all.value.some((b) => b.calibre_id));

const CALIBRE_FILTERS = {
  in: (b) => b.in_calibre,
  out: (b) => !b.in_calibre,
  gone: (b) => b.calibre_id && !b.in_calibre,
};

const SORTS = {
  recent: (a, b) => b.updated_at.localeCompare(a.updated_at),
  title: byTitle,
  author: byAuthor,
  rating: (a, b) => (b.rating || 0) - (a.rating || 0) || byTitle(a, b),
  finished: (a, b) => (b.finished_on || '').localeCompare(a.finished_on || '') || byTitle(a, b),
  added: (a, b) => b.created_at.localeCompare(a.created_at),
  // Shuffled once a day, at 04:00
  random: byDailyRandom((b) => b.id),
};

const shown = computed(() => {
  const needle = q.value.trim().toLowerCase();
  const digits = needle.replace(/[^0-9x]/g, '');
  return all.value
    .filter((b) => status.value === 'all' || b.status === status.value)
    .filter((b) => !author.value || b.authors.includes(author.value))
    .filter((b) => !calibre.value || CALIBRE_FILTERS[calibre.value]?.(b))
    .filter((b) => !needle
      || [b.title, b.subtitle, b.series, ...b.authors].some((s) => s?.toLowerCase().includes(needle))
      || (digits.length >= 10 && b.isbns.some((i) => i.includes(digits))))
    .sort(SORTS[sort.value] || SORTS.recent);
});

const filtered = computed(() => status.value !== 'all' || author.value || calibre.value || q.value.trim());

function resetFilters() {
  status.value = 'all';
  author.value = '';
  calibre.value = '';
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
      <p v-else-if="!books" class="muted center">…</p>

      <div v-else-if="!books.length" class="empty">
        <img src="/icon.svg" alt="" width="72" height="72" />
        <p>{{ t('library.empty') }}</p>
        <div class="row-buttons">
          <RouterLink to="/add" class="btn primary"><Icon name="plus" />{{ t('library.addFirst') }}</RouterLink>
          <RouterLink to="/settings" class="btn"><Icon name="sync" />{{ t('settings.calibre') }}</RouterLink>
        </div>
      </div>

      <template v-else>
        <section v-if="reading.length && !filtered">
          <h2 class="section">{{ t('library.readingNow') }}</h2>
          <div class="shelf">
            <BookTile v-for="b in reading" :key="b.id" :book="b" hide-status show-progress :selected="String(b.id) === route.params.id" />
          </div>
        </section>

        <h2 v-if="reading.length && !filtered" class="section">{{ t('library.all') }}</h2>
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
            <span class="chip-count">{{ s === 'all' ? books.length : counts[s] }}</span>
          </button>
        </div>
        <div v-if="authors.length > 1 || hasCalibre" class="toolbar">
          <select v-if="authors.length > 1" v-model="author" :aria-label="t('library.author')">
            <option value="">{{ t('library.allAuthors') }}</option>
            <option v-for="a in authors" :key="a" :value="a">{{ a }}</option>
          </select>
          <select v-if="hasCalibre" v-model="calibre" :aria-label="t('library.calibre')">
            <option value="">{{ t('library.calibreAll') }}</option>
            <option value="in">{{ t('library.calibreIn') }}</option>
            <option value="out">{{ t('library.calibreOut') }}</option>
            <option value="gone">{{ t('library.calibreGone') }}</option>
          </select>
        </div>

        <p v-if="filtered && shown.length" class="muted small">{{ t('library.count', { n: formatNumber(shown.length) }) }}</p>
        <div v-if="shown.length" class="grid">
          <BookTile v-for="b in shown" :key="b.id" :book="b" :hide-status="status !== 'all'" :selected="String(b.id) === route.params.id" />
        </div>
        <div v-else class="empty">
          <p>{{ t('library.noMatch') }}</p>
          <button class="btn" @click="resetFilters">{{ t('library.reset') }}</button>
        </div>
      </template>
    </main>
  </SplitView>
</template>
