<script setup>
import { ref, watch } from 'vue';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { errorText, languageTag } from '../util.js';
import Icon from './Icon.vue';

// Searches GCD for series. Emits 'pick' with the chosen result.
const props = defineProps({ initialQuery: String, pickLabel: String, busyId: Number });
const emit = defineEmits(['pick']);

const LANGUAGE_FILTERS = { de: ['de'], en: ['en'], deen: ['de', 'en'], all: [] };
function pref(fallback) {
  try {
    return localStorage.getItem('stapel.search.lang') || fallback;
  } catch {
    return fallback;
  }
}

const query = ref(props.initialQuery || '');
const year = ref('');
const langFilter = ref(pref('deen'));
const results = ref([]);
const nextPage = ref(null);
const count = ref(0);
const loading = ref(false);
const error = ref('');
const searched = ref(false);

watch(langFilter, (value) => {
  try {
    localStorage.setItem('stapel.search.lang', value);
  } catch {
    // only a convenience
  }
  if (searched.value) search();
});

async function search(more = false) {
  const q = query.value.trim();
  if (q.length < 2) return;
  loading.value = true;
  error.value = '';
  try {
    const params = new URLSearchParams({ q, lang: LANGUAGE_FILTERS[langFilter.value].join(','), page: more ? nextPage.value : 1 });
    if (year.value) params.set('year', year.value);
    const data = await api(`/search?${params}`);
    results.value = more ? [...results.value, ...data.results] : data.results;
    nextPage.value = data.nextPage;
    count.value = data.count;
    searched.value = true;
  } catch (err) {
    error.value = errorText(err);
  } finally {
    loading.value = false;
  }
}

if (query.value) search();

const range = (r) => (r.first && r.last ? `#${r.first.number || '?'}–${r.last.number || '?'}` : r.first?.number ? `#${r.first.number}` : '');
</script>

<template>
  <form class="search-form" @submit.prevent="search()">
    <div class="search-row">
      <input v-model="query" type="search" :placeholder="t('add.searchPlaceholder')" enterkeyhint="search" />
      <input v-model="year" class="year" inputmode="numeric" maxlength="4" :placeholder="t('add.year')" :aria-label="t('add.yearHint')" />
      <button class="btn primary" :disabled="loading"><Icon name="search" /></button>
    </div>
    <div class="chips">
      <button v-for="(v, k) in LANGUAGE_FILTERS" :key="k" type="button" class="chip" :class="{ active: langFilter === k }" @click="langFilter = k">{{ t(`add.lang.${k}`) }}</button>
    </div>
  </form>

  <p v-if="loading && !results.length" class="muted center">{{ t('add.searching') }}</p>
  <p v-if="error" class="error">{{ error }}</p>
  <p v-if="searched && !loading && !results.length && !error" class="muted center">
    {{ nextPage ? t('add.nothingYet') : t('add.nothing') }}
  </p>

  <ul class="result-list">
    <li v-for="r in results" :key="r.gcdId" class="result">
      <div class="result-body">
        <div class="series-name">{{ r.name }} <span class="muted">({{ r.yearBegan || '?' }}{{ r.yearEnded && r.yearEnded !== r.yearBegan ? `–${r.yearEnded}` : '' }})</span></div>
        <div class="meta">
          <span v-if="r.publisher">{{ r.publisher }}</span>
          <span class="tag">{{ languageTag(r.language) }}</span>
          <span>{{ t('add.issueCount', { n: r.issueCount }) }} {{ range(r) }}</span>
          <span v-if="r.format" class="format">{{ r.format }}</span>
        </div>
        <div v-if="r.first?.title" class="muted small ellipsis">{{ r.first.number }} – {{ r.first.title }}</div>
      </div>
      <button class="btn small" :class="r.collected ? 'subtle' : 'primary'" :disabled="busyId === r.gcdId" @click="emit('pick', r)">
        {{ busyId === r.gcdId ? '…' : r.collected ? t('add.open') : (pickLabel || t('add.add')) }}
      </button>
    </li>
  </ul>

  <div v-if="nextPage" class="center">
    <button class="btn subtle" :disabled="loading" @click="search(true)">{{ loading ? t('add.searching') : t('add.more') }}</button>
    <p class="muted small">{{ t('add.searchedOf', { n: count }) }}</p>
  </div>
</template>
