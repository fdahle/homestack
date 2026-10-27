<script setup>
import { computed, onMounted, ref } from 'vue';
import { api, setStatus } from '../api.js';
import { t } from '../i18n.js';
import { compressNumbers, errorText, issueLabel, showToast } from '../util.js';
import TopBar from '../components/TopBar.vue';
import Icon from '../components/Icon.vue';
import CoverImage from '../components/CoverImage.vue';

const data = ref(null);
onMounted(async () => {
  data.value = await api('/wishlist');
});

// Missing numbers grouped per series
const missing = computed(() => {
  const bySeries = new Map();
  for (const m of data.value?.missing || []) {
    if (!bySeries.has(m.series_id)) bySeries.set(m.series_id, { id: m.series_id, name: m.series_name, year: m.year_began, numbers: [] });
    bySeries.get(m.series_id).numbers.push(m.number);
  }
  return [...bySeries.values()];
});

async function gotIt(issue) {
  try {
    await setStatus([issue.id], { owned: true });
    data.value.wanted = data.value.wanted.filter((w) => w.id !== issue.id);
    showToast(t('wishlist.gotIt', { name: `${issue.series_name} ${issueLabel(issue)}` }));
  } catch (err) {
    showToast(errorText(err));
  }
}
</script>

<template>
  <TopBar :title="t('nav.wishlist')" />
  <main v-if="data">
    <h2 class="section">{{ t('wishlist.wanted') }} <small>{{ data.wanted.length }}</small></h2>
    <p v-if="!data.wanted.length" class="muted">{{ t('wishlist.wantedEmpty') }}</p>
    <ul class="match-list">
      <li v-for="w in data.wanted" :key="w.id">
        <RouterLink :to="`/issue/${w.id}`"><CoverImage class="thumb" :issue="w" /></RouterLink>
        <div class="match-body">
          <RouterLink :to="`/issue/${w.id}`" class="series-name">{{ w.series_name }} {{ issueLabel(w) }}</RouterLink>
          <div class="muted small">{{ w.title }}<template v-if="w.price"> · {{ w.price }}</template></div>
        </div>
        <button class="btn small" @click="gotIt(w)"><Icon name="check" /> {{ t('wishlist.bought') }}</button>
      </li>
    </ul>

    <h2 class="section">{{ t('wishlist.missing') }}</h2>
    <p class="muted small">{{ t('wishlist.missingHint') }}</p>
    <p v-if="!missing.length" class="muted">{{ t('wishlist.missingEmpty') }}</p>
    <ul class="missing-list">
      <li v-for="s in missing" :key="s.id">
        <RouterLink :to="`/series/${s.id}`">
          <strong>{{ s.name }}</strong><span v-if="s.year" class="muted"> ({{ s.year }})</span>
          <span class="count">{{ s.numbers.length }}</span>
        </RouterLink>
        <p class="numbers">{{ compressNumbers(s.numbers) }}</p>
      </li>
    </ul>
  </main>
</template>
