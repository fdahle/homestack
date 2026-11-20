<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { hasText } from '../kit/i18n.js';
import { errorText, relativeDay, showToast, STATUSES } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import AccountCards from '../kit/components/AccountCards.vue';

const settings = ref(null);
const syncing = ref(false);
const goal = ref('');

onMounted(async () => {
  try {
    set(await api('/settings'));
  } catch (err) {
    showToast(errorText(err));
  }
});

function set(s) {
  settings.value = s;
  goal.value = s.readingGoal || '';
  syncing.value = s.calibre.running;
}

async function patch(body) {
  try {
    set(await api('/settings', { method: 'PATCH', body }));
    showToast(t('saved'));
  } catch (err) {
    showToast(errorText(err));
  }
}

async function syncNow() {
  syncing.value = true;
  try {
    set(await api('/calibre/sync', { method: 'POST' }));
  } catch (err) {
    showToast(errorText(err));
  } finally {
    syncing.value = false;
  }
}

async function unignore() {
  await patch({ calibreIgnored: [] });
  await syncNow();
}

const last = computed(() => settings.value?.calibre.last);
const lastTime = computed(() => {
  if (!last.value) return '';
  const d = new Date(last.value.at);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${relativeDay(last.value.at)}, ${time}`;
});
const lastError = computed(() => {
  const code = last.value?.error;
  if (!code) return '';
  return hasText(`errors.${code}`) ? t(`errors.${code}`) : last.value.message || code;
});
</script>

<template>
  <TopBar :title="t('nav.settings')" sidebar-page back="/" />
  <main>
    <AccountCards>
      <template v-if="settings">
        <section class="card form">
          <h2><Icon name="sync" />{{ t('settings.calibre') }}</h2>
          <template v-if="settings.calibre.configured">
            <p class="muted small">{{ settings.calibre.syncHours ? t('settings.calibreHow', { hours: settings.calibre.syncHours }) : t('settings.calibreHowManual') }}</p>
            <div class="sync-result">
              <template v-if="last">
                <strong>{{ t('settings.lastSync', { when: lastTime }) }}</strong>
                <span v-if="last.ok">{{ t('settings.syncCounts', last) }}<template v-if="last.covers"> · {{ t('settings.syncCovers', { n: last.covers }) }}</template></span>
                <span v-else class="error">{{ t('settings.syncFailed', { error: lastError }) }}</span>
                <template v-if="last.problems?.length">
                  <span class="warn">{{ t('settings.syncProblems') }}</span>
                  <ul><li v-for="p in last.problems" :key="p">{{ p }}</li></ul>
                </template>
              </template>
              <span v-else class="muted">{{ t('settings.neverSynced') }}</span>
            </div>
            <div class="row-buttons">
              <button class="btn" :disabled="syncing" @click="syncNow"><Icon name="sync" />{{ syncing ? t('settings.syncing') : t('settings.syncNow') }}</button>
            </div>
            <label>
              <span>{{ t('settings.defaultStatus') }}</span>
              <select :value="settings.calibre.defaultStatus" @change="patch({ calibreDefaultStatus: $event.target.value })">
                <option v-for="s in STATUSES" :key="s" :value="s">{{ t(`status.${s}`) }}</option>
              </select>
            </label>
            <p v-if="settings.calibre.ignored" class="setting-row small muted">
              {{ t('settings.ignored', { n: settings.calibre.ignored }) }}
              <button class="link-btn small" :disabled="syncing" @click="unignore">{{ t('settings.unignore') }}</button>
            </p>
          </template>
          <p v-else class="info warn-box">{{ t('settings.calibreOff') }}</p>
        </section>

        <form class="card form" @submit.prevent="patch({ readingGoal: goal === '' ? null : Number(goal) })">
          <h2><Icon name="goal" />{{ t('settings.goal') }}</h2>
          <p class="muted small">{{ t('settings.goalHint') }}</p>
          <div class="setting-row">
            <input v-model="goal" type="number" inputmode="numeric" min="0" max="1000" :aria-label="t('settings.goal')" />
            <span class="muted">{{ t('settings.goalBooks') }}</span>
            <button class="btn">{{ t('save') }}</button>
          </div>
        </form>

        <section class="card form">
          <h2><Icon name="search" />{{ t('settings.catalogs') }}</h2>
          <p class="ok"><Icon name="check" />{{ t('settings.openLibrary') }}</p>
          <p v-if="settings.google" class="ok"><Icon name="check" />{{ t('settings.googleOn') }}</p>
          <p v-else class="muted small">{{ t('settings.googleOff') }}</p>
          <p class="muted small">{{ t('settings.credit') }}</p>
        </section>
      </template>

      <section class="card form">
        <h2><Icon name="download" />{{ t('settings.export') }}</h2>
        <p class="muted small">{{ t('settings.exportHint') }}</p>
        <div class="row-buttons"><a class="btn" href="/api/export.json" download><Icon name="download" />{{ t('settings.exportButton') }}</a></div>
      </section>
    </AccountCards>
  </main>
</template>
