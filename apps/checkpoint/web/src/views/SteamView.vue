<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { errorText, formatNumber, hasText, relativeDay, showToast } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';

// Your Steam games that aren't in Checkpoint: tick the ones to bring in, hide the rest.
// The sync itself (play time, platforms, status) runs on its own; it's shown here too.
const data = ref(null);
const error = ref('');
const busy = ref(''); // '', 'sync', 'import'
const picked = ref(new Set());
const showHidden = ref(false);
const q = ref('');

function take(d) {
  data.value = d;
  const waiting = new Set(d.games.map((g) => g.appid));
  picked.value = new Set([...picked.value].filter((a) => waiting.has(a)));
}

onMounted(async () => {
  try {
    take(await api('/steam'));
  } catch (err) {
    error.value = errorText(err);
  }
});

const games = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return (data.value?.games || []).filter((g) => !!g.hidden === showHidden.value && (!needle || g.name.toLowerCase().includes(needle)));
});
const hiddenCount = computed(() => (data.value?.games || []).filter((g) => g.hidden).length);
const playedOnes = computed(() => games.value.filter((g) => g.minutes > 0));

const syncError = (last) => (hasText(`errors.${last?.error}`) ? t(`errors.${last.error}`) : last?.message || t('errors.generic'));
const hours = (minutes) => t('hours', { n: formatNumber(minutes / 60, minutes < 600 ? 1 : 0) });

function toggle(appid) {
  const next = new Set(picked.value);
  if (next.has(appid)) next.delete(appid);
  else next.add(appid);
  picked.value = next;
}
const pickPlayed = () => (picked.value = new Set([...picked.value, ...playedOnes.value.map((g) => g.appid)]));
const pickNone = () => (picked.value = new Set());

async function sync() {
  busy.value = 'sync';
  try {
    take(await api('/steam/sync', { method: 'POST' }));
    if (!data.value.last?.ok) showToast(syncError(data.value.last));
  } catch (err) {
    showToast(errorText(err));
  } finally {
    busy.value = '';
  }
}

async function bringIn() {
  busy.value = 'import';
  try {
    const result = await api('/steam/import', { method: 'POST', body: { appids: [...picked.value] } });
    take(result);
    showToast(t('steam.imported', { n: result.added + result.linked }));
  } catch (err) {
    showToast(errorText(err));
  } finally {
    busy.value = '';
  }
}

async function setHidden(g, hidden) {
  try {
    await api(`/steam/${g.appid}`, { method: 'PATCH', body: { hidden } });
    g.hidden = hidden ? 1 : 0;
    if (hidden) {
      const next = new Set(picked.value);
      next.delete(g.appid);
      picked.value = next;
    }
  } catch (err) {
    showToast(errorText(err));
  }
}
</script>

<template>
  <TopBar :title="t('steam.title')" back="/add" />
  <main>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="!data" class="muted center">…</p>

    <section v-else-if="!data.configured" class="card form">
      <p>{{ t('steam.notConfigured') }}</p>
    </section>

    <template v-else>
      <div class="steam-status">
        <p v-if="data.running || busy === 'sync'" class="muted small">{{ t('steam.syncing') }}</p>
        <p v-else-if="data.last?.ok" class="muted small">{{ t('steam.lastSync', { when: relativeDay(data.last.at), total: data.last.total }) }}</p>
        <p v-else-if="data.last" class="error small">{{ syncError(data.last) }}</p>
        <p v-else class="muted small">{{ t('steam.neverSynced') }}</p>
        <button class="btn small" :disabled="!!busy || data.running" @click="sync"><Icon name="sync" />{{ t('steam.syncNow') }}</button>
      </div>
      <p class="muted small">{{ t('steam.how') }}</p>

      <template v-if="data.games.length">
        <div class="toolbar">
          <input v-model="q" type="search" enterkeyhint="search" :placeholder="t('steam.search')" :aria-label="t('steam.search')" @keydown.enter="$event.target.blur()" />
        </div>
        <div class="row-buttons steam-actions">
          <template v-if="!showHidden">
            <button class="btn small" :disabled="!playedOnes.length" @click="pickPlayed">{{ t('steam.pickPlayed', { n: playedOnes.length }) }}</button>
            <button v-if="picked.size" class="link-btn small" @click="pickNone">{{ t('steam.pickNone') }}</button>
          </template>
          <span class="grow"></span>
          <button v-if="hiddenCount || showHidden" class="link-btn small" @click="showHidden = !showHidden">
            {{ showHidden ? t('steam.backToList') : t('steam.showHidden', { n: hiddenCount }) }}
          </button>
        </div>

        <ul class="card-list steam-list">
          <li v-for="g in games" :key="g.appid" :class="{ picked: picked.has(g.appid) }">
            <label v-if="!showHidden" class="steam-pick">
              <input type="checkbox" :checked="picked.has(g.appid)" @change="toggle(g.appid)" />
              <span class="steam-name">{{ g.name }}</span>
            </label>
            <span v-else class="steam-name">{{ g.name }}</span>
            <span class="steam-meta">
              <span v-if="g.minutes">{{ hours(g.minutes) }}</span>
              <span v-else class="muted">{{ t('steam.unplayed') }}</span>
              <span v-if="data.igdb && !g.igdb_id" class="tag" :title="t('steam.notInIgdbHint')">{{ t('steam.notInIgdb') }}</span>
            </span>
            <button
              class="icon-btn" :aria-label="showHidden ? t('steam.unhide') : t('steam.hide')" :title="showHidden ? t('steam.unhide') : t('steam.hide')"
              @click="setHidden(g, !showHidden)"
            >
              <Icon :name="showHidden ? 'eye' : 'close'" />
            </button>
          </li>
        </ul>
        <p v-if="!games.length" class="muted center">{{ showHidden ? t('steam.noHidden') : t('steam.noMatch') }}</p>

        <div v-if="!showHidden && picked.size" class="steam-bar">
          <button class="btn primary" :disabled="!!busy" @click="bringIn">
            <Icon name="download" />{{ busy === 'import' ? t('steam.importing') : t('steam.import', { n: picked.size }) }}
          </button>
        </div>
      </template>
      <div v-else-if="data.last?.ok" class="empty">
        <p>{{ t('steam.allIn') }}</p>
      </div>
    </template>
  </main>
</template>
