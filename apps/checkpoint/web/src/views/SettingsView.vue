<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { hasText, relativeDay } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import AccountCards from '../kit/components/AccountCards.vue';

const igdb = ref(null);
const steam = ref(null);

onMounted(async () => {
  try {
    const settings = await api('/settings');
    igdb.value = settings.igdb;
    steam.value = settings.steam;
  } catch {
    // shown as unknown
  }
});
</script>

<template>
  <TopBar :title="t('nav.settings')" sidebar-page back="/" />
  <main>
    <AccountCards>
      <section class="card form">
        <h2>{{ t('settings.igdb') }}</h2>
        <p v-if="igdb" class="ok"><Icon name="check" />{{ t('settings.igdbOn') }}</p>
        <p v-else-if="igdb === false" class="info warn-box">{{ t('settings.igdbOff') }}</p>
        <p class="muted small">{{ t('settings.igdbCredit') }}</p>
      </section>

      <section v-if="steam" class="card form">
        <h2>{{ t('steam.title') }}</h2>
        <template v-if="steam.configured">
          <p v-if="steam.last?.ok" class="ok"><Icon name="check" />{{ t('steam.lastSync', { when: relativeDay(steam.last.at), total: steam.last.total }) }}</p>
          <p v-else-if="steam.last" class="info warn-box">{{ hasText(`errors.${steam.last.error}`) ? t(`errors.${steam.last.error}`) : steam.last.message }}</p>
          <p class="muted small">{{ steam.syncHours ? t('steam.howOften', { hours: steam.syncHours }) : t('steam.howManual') }}</p>
          <div class="row-buttons"><RouterLink to="/steam" class="btn"><Icon name="download" />{{ steam.waiting ? t('steam.waiting', { n: steam.waiting }) : t('steam.open') }}</RouterLink></div>
        </template>
        <p v-else class="muted small">{{ t('steam.notConfigured') }}</p>
      </section>

      <section class="card form">
        <h2>{{ t('settings.export') }}</h2>
        <p class="muted small">{{ t('settings.exportHint') }}</p>
        <div class="row-buttons"><a class="btn" href="/api/export.json" download><Icon name="download" />{{ t('settings.exportButton') }}</a></div>
      </section>
    </AccountCards>
  </main>
</template>
