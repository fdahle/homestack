<script setup>
import { computed, ref } from 'vue';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { errorText, showToast } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import AccountCards from '../kit/components/AccountCards.vue';

// Your account (kit), marking posts from the blog itself, scanning, backup
const origin = location.origin;
const bookmarklet = computed(() => `javascript:location.href='${origin}/mark?url='+encodeURIComponent(location.href)`);
const importInput = ref(null);

async function scanAll() {
  await api('/scan-all', { method: 'POST' });
  showToast(t('tools.scanStarted'));
}

async function importFile(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const result = await api('/import', { method: 'POST', body: JSON.parse(await file.text()) });
    showToast(t('tools.imported', { n: result.blogsAdded }));
  } catch (err) {
    showToast(err.data?.message || errorText(err));
  }
}
</script>

<template>
  <TopBar :title="t('nav.settings')" sidebar-page back="/" />
  <main>
    <AccountCards>
      <section class="card form">
        <h2><Icon name="check" />{{ t('tools.mark') }}</h2>
        <p class="small">{{ t('tools.android') }}</p>
        <p class="small">{{ t('tools.desktop') }} <a class="btn small bookmarklet" :href="bookmarklet" @click.prevent>{{ t('tools.bookmarklet') }}</a></p>
        <p class="small">{{ t('tools.iphone', { url: `${origin}/mark?url=` }) }}</p>
      </section>

      <section class="card form">
        <h2><Icon name="refresh" />{{ t('tools.scan') }}</h2>
        <button class="btn" @click="scanAll">{{ t('tools.scanAll') }}</button>
      </section>

      <section class="card form">
        <h2><Icon name="download" />{{ t('tools.backup') }}</h2>
        <p class="muted small">{{ t('tools.backupHow') }}</p>
        <div class="row-buttons">
          <a class="btn" href="/api/export.json" download><Icon name="download" />{{ t('tools.export') }}</a>
          <button class="btn" @click="importInput.click()"><Icon name="upload" />{{ t('tools.import') }}</button>
          <input ref="importInput" type="file" accept="application/json,.json" hidden @change="importFile" />
        </div>
      </section>
    </AccountCards>
  </main>
</template>
