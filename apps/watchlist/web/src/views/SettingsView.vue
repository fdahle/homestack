<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { compareText, countryName, errorText, lastMode, PATHS, replaceServerSettings, serverSettings, showToast } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import AccountCards from '../kit/components/AccountCards.vue';

const settings = ref(null);
const regions = ref([]);

onMounted(async () => {
  try {
    settings.value = await serverSettings();
  } catch {
    // shown as unknown
  }
  if (!settings.value?.tmdb) return;
  try {
    regions.value = (await api('/tmdb/regions')).regions;
  } catch {
    // the menu then only has the current country
  }
});

// The countries TMDB has streaming offers for, by name; the current one is always there
const regionChoices = computed(() => {
  const current = settings.value?.region;
  const codes = current && !regions.value.includes(current) ? [current, ...regions.value] : regions.value.length ? regions.value : [current].filter(Boolean);
  return codes.map((code) => ({ code, name: countryName(code) })).sort((a, b) => compareText(a.name, b.name));
});

async function setRegion(region) {
  try {
    const next = await api('/settings', { method: 'PATCH', body: { region } });
    replaceServerSettings(next);
    settings.value = next;
    showToast(t('saved'));
  } catch (err) {
    showToast(errorText(err));
  }
}
</script>

<template>
  <TopBar :title="t('nav.settings')" sidebar-page :back="PATHS[lastMode].library" />
  <main>
    <AccountCards>
      <section class="card form">
        <h2>{{ t('settings.tmdb') }}</h2>
        <p v-if="settings?.tmdb" class="ok"><Icon name="check" />{{ t('settings.tmdbOn', { language: settings.language }) }}</p>
        <p v-else-if="settings && !settings.tmdb" class="info warn-box">{{ t('settings.tmdbOff') }}</p>
        <label v-if="settings?.tmdb">
          <span>{{ t('settings.region') }}</span>
          <select :value="settings.region" @change="setRegion($event.target.value)">
            <option v-for="r in regionChoices" :key="r.code" :value="r.code">{{ r.name }}</option>
          </select>
        </label>
        <p v-if="settings?.tmdb" class="muted small">{{ t('settings.regionHint') }}</p>
        <p class="muted small">
          {{ t('settings.tmdbCredit') }}
          <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer">themoviedb.org</a>
        </p>
        <p class="muted small">{{ t('settings.justwatchCredit') }}</p>
      </section>

      <section class="card form">
        <h2>{{ t('settings.export') }}</h2>
        <p class="muted small">{{ t('settings.exportHint') }}</p>
        <div class="row-buttons"><a class="btn" href="/api/export.json" download><Icon name="download" />{{ t('settings.exportButton') }}</a></div>
      </section>
    </AccountCards>
  </main>
</template>
