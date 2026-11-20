<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { errorText, formatNumber, lastMode, PATHS, serverSettings, showToast } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import AccountCards from '../kit/components/AccountCards.vue';

const settings = ref(null);
const job = ref(null);
const sending = ref(false);
const fileInput = ref(null);

onMounted(async () => {
  try {
    settings.value = await serverSettings();
  } catch {
    // shown as unknown
  }
  try {
    job.value = (await api('/import')).state;
    if (job.value?.running) poll();
  } catch {
    // no import shown
  }
});

// --- Watcharr import: the file goes up, the server works through it, the page asks how far it is ---

let timer = null;
function poll() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      job.value = (await api('/import')).state;
    } catch {
      // try again
    }
    if (job.value?.running) poll();
  }, 1500);
}
onBeforeUnmount(() => clearTimeout(timer));

async function upload(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  sending.value = true;
  try {
    // As bytes, so the size limit for JSON requests doesn't apply
    const raw = new Blob([file], { type: 'application/octet-stream' });
    job.value = (await api('/import/watcharr', { method: 'POST', raw })).state;
    poll();
  } catch (err) {
    showToast(errorText(err));
  } finally {
    sending.value = false;
  }
}

const percent = computed(() => (job.value?.total ? Math.round((job.value.done / job.value.total) * 100) : 0));
const report = computed(() => job.value?.report);
const counts = (c) => t('settings.importCounts', { added: formatNumber(c.added), updated: formatNumber(c.updated), unchanged: formatNumber(c.unchanged) });
</script>

<template>
  <TopBar :title="t('nav.settings')" :back="PATHS[lastMode].library" />
  <main>
    <AccountCards>
      <section class="card form">
        <h2>{{ t('settings.tmdb') }}</h2>
        <p v-if="settings?.tmdb" class="ok"><Icon name="check" />{{ t('settings.tmdbOn', { language: settings.language, region: settings.region }) }}</p>
        <p v-else-if="settings && !settings.tmdb" class="info warn-box">{{ t('settings.tmdbOff') }}</p>
        <p class="muted small">
          {{ t('settings.tmdbCredit') }}
          <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer">themoviedb.org</a>
        </p>
        <p class="muted small">{{ t('settings.justwatchCredit') }}</p>
      </section>

      <section class="card form">
        <h2>{{ t('settings.import') }}</h2>
        <p class="muted small">{{ t('settings.importHint') }}</p>
        <template v-if="job">
          <div v-if="job.running" class="import-progress">
            <div class="progress"><span :style="{ '--p': percent }"></span></div>
            <small class="muted">{{ t('settings.importRunning', { done: job.done, total: job.total }) }}<template v-if="job.current"> · {{ job.current }}</template></small>
          </div>
          <p v-else-if="job.error" class="error">{{ errorText({ code: job.error }) }}</p>
          <div v-else-if="report" class="import-report">
            <p class="ok"><Icon name="check" />{{ t('settings.importDone') }}</p>
            <dl class="facts">
              <dt>{{ t('mode.films') }}</dt><dd>{{ counts(report.films) }}</dd>
              <dt>{{ t('mode.series') }}</dt><dd>{{ counts(report.series) }}</dd>
              <template v-if="report.games"><dt>{{ t('settings.games') }}</dt><dd>{{ t('settings.gamesSkipped', { n: report.games }) }}</dd></template>
            </dl>
            <details v-if="report.skipped.length || report.failed.length">
              <summary>{{ t('settings.importProblems', { n: report.skipped.length + report.failed.length }) }}</summary>
              <ul class="small">
                <li v-for="(f, i) in report.failed" :key="`f${i}`">{{ f.title }}: <span class="error">{{ errorText({ code: f.error }) }}</span></li>
                <li v-for="(s, i) in report.skipped" :key="`s${i}`">{{ s.title || '?' }}: <span class="muted">{{ t(`settings.skip.${s.reason}`) }}</span></li>
              </ul>
            </details>
          </div>
        </template>
        <div class="row-buttons">
          <button class="btn" :disabled="sending || job?.running || settings?.tmdb === false" @click="fileInput.click()"><Icon name="upload" />{{ t('settings.importButton') }}</button>
        </div>
        <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="upload" />
        <p class="muted small">{{ t('settings.importCli') }} <code>npm run import:watcharr -- watcharr.db</code></p>
      </section>

      <section class="card form">
        <h2>{{ t('settings.export') }}</h2>
        <p class="muted small">{{ t('settings.exportHint') }}</p>
        <div class="row-buttons"><a class="btn" href="/api/export.json" download><Icon name="download" />{{ t('settings.exportButton') }}</a></div>
      </section>
    </AccountCards>
  </main>
</template>
