<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { errorText, showToast } from '../util.js';
import TopBar from '../components/TopBar.vue';
import SeriesSearch from '../components/SeriesSearch.vue';

const router = useRouter();
const tab = ref('search');
const busyId = ref(null);

async function pick(result) {
  if (result.collected && result.localId) return router.push(`/series/${result.localId}`);
  busyId.value = result.gcdId;
  try {
    const { id } = await api('/series/import', { method: 'POST', body: { gcdId: result.gcdId } });
    router.push(`/series/${id}`);
  } catch (err) {
    showToast(errorText(err));
  } finally {
    busyId.value = null;
  }
}

const form = ref({ name: '', publisher: '', year: '', language: 'de', issues: '' });
async function createCustom() {
  try {
    const { id } = await api('/series', { method: 'POST', body: form.value });
    router.push(`/series/${id}`);
  } catch (err) {
    showToast(errorText(err));
  }
}
</script>

<template>
  <TopBar :title="t('add.title')" />
  <main>
    <div class="segmented wide">
      <button :class="{ active: tab === 'search' }" @click="tab = 'search'">{{ t('add.tabSearch') }}</button>
      <button :class="{ active: tab === 'custom' }" @click="tab = 'custom'">{{ t('add.tabCustom') }}</button>
    </div>

    <template v-if="tab === 'search'">
      <SeriesSearch :busy-id="busyId" @pick="pick" />
      <p class="muted small hint">{{ t('add.gcdHint') }}</p>
    </template>

    <form v-else class="card form" @submit.prevent="createCustom">
      <p class="muted small">{{ t('add.customHint') }}</p>
      <label><span>{{ t('add.name') }}</span><input v-model="form.name" required /></label>
      <label><span>{{ t('add.publisher') }}</span><input v-model="form.publisher" /></label>
      <div class="two">
        <label><span>{{ t('add.year') }}</span><input v-model="form.year" inputmode="numeric" maxlength="4" /></label>
        <label><span>{{ t('add.language') }}</span><input v-model="form.language" maxlength="2" /></label>
      </div>
      <label><span>{{ t('series.numbers') }}</span><input v-model="form.issues" :placeholder="t('series.numbersPlaceholder')" /></label>
      <button class="btn primary">{{ t('add.create') }}</button>
    </form>
  </main>
</template>
