<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api.js';
import { t } from '../i18n.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import AccountCards from '../kit/components/AccountCards.vue';

const igdb = ref(null);

onMounted(async () => {
  try {
    igdb.value = (await api('/settings')).igdb;
  } catch {
    // shown as unknown
  }
});
</script>

<template>
  <TopBar :title="t('nav.settings')" back="/" />
  <main>
    <AccountCards>
      <section class="card form">
        <h2>{{ t('settings.igdb') }}</h2>
        <p v-if="igdb" class="ok"><Icon name="check" />{{ t('settings.igdbOn') }}</p>
        <p v-else-if="igdb === false" class="info warn-box">{{ t('settings.igdbOff') }}</p>
        <p class="muted small">{{ t('settings.igdbCredit') }}</p>
      </section>

      <section class="card form">
        <h2>{{ t('settings.export') }}</h2>
        <p class="muted small">{{ t('settings.exportHint') }}</p>
        <div class="row-buttons"><a class="btn" href="/api/export.json" download><Icon name="download" />{{ t('settings.exportButton') }}</a></div>
      </section>
    </AccountCards>
  </main>
</template>
