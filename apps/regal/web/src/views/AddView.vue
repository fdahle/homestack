<script setup>
import { nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { errorText, formatIsbn, showToast, STATUS_ICONS, STATUSES } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import BookCover from '../components/BookCover.vue';
import IsbnScanner from '../components/IsbnScanner.vue';

const route = useRoute();
const router = useRouter();
// /add?q=… searches straight away
const q = ref(String(route.query.q || ''));
const results = ref(null);
const searching = ref(false);
const error = ref('');
const picked = ref(null); // key of the hit whose status buttons are open
const adding = ref(false);
const manual = ref(null);
const scanning = ref(route.query.scan === '1');
const searchInput = ref(null);

// Quick choices when adding; the rest can be set on the book's page
const QUICK = ['want', 'unread', 'reading', 'read'];

let timer = null;
let seq = 0;
onMounted(() => q.value && runSearch());
watch(q, () => {
  clearTimeout(timer);
  timer = setTimeout(runSearch, 450);
});

const hitKey = (hit) => (hit.source === 'google' ? `gb:${hit.volume}` : `ol:${hit.work}:${hit.edition || ''}`);

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
    const hits = await api(`/search?q=${encodeURIComponent(query)}`);
    if (mine !== seq) return; // an older search answering late
    results.value = hits;
    error.value = '';
    // A scanned or typed ISBN with exactly one new book: its status buttons open right away
    if (/^[\d-\sXx]{10,17}$/.test(query) && hits.length === 1 && !hits[0].bookId) picked.value = hitKey(hits[0]);
  } catch (err) {
    if (mine === seq) error.value = errorText(err);
  } finally {
    if (mine === seq) searching.value = false;
  }
}

// A scanned ISBN is searched like a typed one
function onIsbn(isbn) {
  scanning.value = false;
  manual.value = null;
  q.value = isbn;
  runSearch();
}

function closeScanner() {
  scanning.value = false;
  nextTick(() => searchInput.value?.focus());
}

async function add(hit, status) {
  adding.value = true;
  try {
    const body = hit.source === 'google' ? { source: 'google', volume: hit.volume, status } : { source: 'openlibrary', work: hit.work, edition: hit.edition, status };
    const { id } = await api('/books', { method: 'POST', body });
    showToast(t('add.added', { title: hit.title }));
    router.push(`/book/${id}`);
  } catch (err) {
    if (err.code === 'already_added') return router.push(`/book/${err.data.id}`);
    showToast(errorText(err));
  } finally {
    adding.value = false;
  }
}

function openManual() {
  const query = q.value.trim();
  const isIsbn = /^[\d-\sXx]{10,17}$/.test(query);
  manual.value = { title: isIsbn ? '' : query, authors: '', year: '', pages: '', isbns: isIsbn ? query : '', status: 'want' };
}

async function addManual() {
  adding.value = true;
  try {
    const m = manual.value;
    const { id } = await api('/books', { method: 'POST', body: { ...m, year: m.year || null, pages: m.pages || null } });
    router.push(`/book/${id}`);
  } catch (err) {
    if (err.code === 'already_added') return router.push(`/book/${err.data.id}`);
    showToast(errorText(err));
  } finally {
    adding.value = false;
  }
}
</script>

<template>
  <TopBar :title="t('add.title')" />
  <main>
    <IsbnScanner v-if="scanning" autostart @isbn="onIsbn" @close="closeScanner" />

    <form class="search-box with-scan" role="search" @submit.prevent="runSearch">
      <Icon name="search" />
      <input ref="searchInput" v-model="q" type="search" :placeholder="t('add.search')" :aria-label="t('add.search')" autofocus enterkeyhint="search" />
      <button v-if="!scanning" type="button" class="icon-btn scan-btn" :aria-label="t('add.scan')" :title="t('add.scan')" @click="scanning = true"><Icon name="barcode" /></button>
    </form>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="searching && !results" class="muted center">{{ t('add.searching') }}</p>
    <p v-else-if="!results && !scanning" class="muted small hint">{{ t('add.searchHint') }}</p>
    <p v-else-if="results && !results.length" class="muted center">{{ t('add.noResults') }}</p>

    <ul v-if="results?.length" class="card-list results" :class="{ stale: searching }">
      <li v-for="hit in results" :key="hitKey(hit)">
        <component
          :is="hit.bookId ? 'RouterLink' : 'button'" :to="hit.bookId ? `/book/${hit.bookId}` : undefined" type="button"
          class="result-row" :aria-expanded="hit.bookId ? undefined : picked === hitKey(hit)"
          @click="!hit.bookId && (picked = picked === hitKey(hit) ? null : hitKey(hit))"
        >
          <BookCover class="thumb" :src="hit.thumb" :title="hit.title" />
          <span class="result-body">
            <strong>{{ hit.title }}</strong>
            <span v-if="hit.subtitle" class="muted small">{{ hit.subtitle }}</span>
            <span class="meta">
              <span v-if="hit.authors.length">{{ hit.authors.join(', ') }}</span>
              <span v-if="hit.year">{{ hit.year }}</span>
              <span v-if="hit.language" class="lang">{{ hit.language }}</span>
            </span>
            <span v-if="hit.isbn || hit.bookId || hit.source === 'google'" class="tags">
              <span v-if="hit.bookId" class="tag in-library"><Icon name="check" />{{ t('add.inLibrary') }}</span>
              <span v-if="hit.isbn" class="tag">{{ formatIsbn(hit.isbn) }}</span>
              <span v-if="hit.source === 'google'" class="tag source">{{ t('add.google') }}</span>
            </span>
          </span>
          <Icon v-if="!hit.bookId" :name="picked === hitKey(hit) ? 'close' : 'plus'" class="row-icon" />
        </component>
        <div v-if="picked === hitKey(hit)" class="quick-status">
          <button v-for="s in QUICK" :key="s" class="btn small" :class="`st-${s}`" :disabled="adding" @click="add(hit, s)">
            <Icon :name="STATUS_ICONS[s]" />{{ t(`status.${s}`) }}
          </button>
        </div>
      </li>
    </ul>

    <p v-if="results && !manual" class="center hint">
      <button class="link-btn" @click="openManual">{{ t('add.notFound') }}</button>
    </p>

    <form v-if="manual" class="card form manual" @submit.prevent="addManual">
      <h2><Icon name="edit" />{{ t('add.manualTitle') }}</h2>
      <label><span>{{ t('book.titleField') }}</span><input v-model="manual.title" required maxlength="300" /></label>
      <label><span>{{ t('library.author') }}</span><input v-model="manual.authors" :placeholder="t('book.commaHint')" /></label>
      <div class="two">
        <label><span>{{ t('book.year') }}</span><input v-model="manual.year" type="number" inputmode="numeric" /></label>
        <label><span>{{ t('book.pages') }}</span><input v-model="manual.pages" type="number" inputmode="numeric" min="1" /></label>
      </div>
      <label><span>{{ t('book.isbn') }}</span><input v-model="manual.isbns" inputmode="numeric" /></label>
      <label>
        <span>{{ t('library.status') }}</span>
        <select v-model="manual.status">
          <option v-for="s in STATUSES" :key="s" :value="s">{{ t(`status.${s}`) }}</option>
        </select>
      </label>
      <button class="btn primary" :disabled="adding">{{ t('add.addButton') }}</button>
    </form>
  </main>
</template>
