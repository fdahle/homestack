<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { lang, t } from '../i18n.js';
import { relativeDay } from '../util.js';
import { labelCounts, renameLabel, store, sync } from '../store/notes.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import AccountCards from '../kit/components/AccountCards.vue';
import SyncState from '../components/SyncState.vue';

const lastSync = computed(() => {
  if (!store.lastSync) return t('settings.never');
  const d = new Date(store.lastSync);
  const time = d.toLocaleTimeString(lang.value, { hour: '2-digit', minute: '2-digit' });
  return t('settings.lastSync', { when: `${relativeDay(store.lastSync)}, ${time}` });
});
const noteCount = computed(() => [...store.notes.values()].filter((n) => !n.deleted_at).length);
const online = ref(navigator.onLine);
const onLine = () => (online.value = navigator.onLine);
onMounted(() => ['online', 'offline'].forEach((e) => window.addEventListener(e, onLine)));
onBeforeUnmount(() => ['online', 'offline'].forEach((e) => window.removeEventListener(e, onLine)));

// --- labels ---

const editing = ref('');
const newName = ref('');

function startRename(label) {
  editing.value = label;
  newName.value = label;
}

function saveRename() {
  const to = newName.value.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (to && to !== editing.value) renameLabel(editing.value, to);
  editing.value = '';
}

function remove(label, n) {
  if (confirm(t('settings.removeLabelConfirm', { label, n }))) renameLabel(label, '');
}
</script>

<template>
  <TopBar :title="t('nav.settings')" sidebar-page back="/" />
  <main>
    <AccountCards>
      <section class="card form">
        <h2><Icon name="sync" />{{ t('settings.device') }}<span class="grow"></span><SyncState /></h2>
        <p class="muted small">{{ t('settings.deviceHow') }}</p>
        <div class="sync-facts">
          <span>{{ t('settings.stored', { n: noteCount }) }}</span>
          <span v-if="store.pending" class="warn">{{ t('settings.pending', { n: store.pending }) }}</span>
          <span class="muted">{{ lastSync }}</span>
          <span v-if="store.status === 'offline'" class="warn">{{ t('sync.offline') }}</span>
        </div>
        <button class="btn" :disabled="store.status === 'syncing'" @click="sync()"><Icon name="sync" />{{ t('settings.syncNow') }}</button>
        <p class="muted small">{{ t('settings.install') }}</p>
      </section>

      <section class="card form">
        <h2><Icon name="tag" />{{ t('settings.labels') }}</h2>
        <p v-if="!labelCounts.length" class="muted small">{{ t('settings.noLabels') }}</p>
        <ul v-else class="card-list label-list">
          <li v-for="[label, n] in labelCounts" :key="label">
            <form v-if="editing === label" class="label-rename" @submit.prevent="saveRename">
              <input v-model="newName" :aria-label="t('settings.renameTo', { label })" maxlength="60" autofocus @keydown.esc="editing = ''" />
              <button class="btn small primary">{{ t('save') }}</button>
              <button type="button" class="btn small subtle" @click="editing = ''">{{ t('cancel') }}</button>
            </form>
            <template v-else>
              <span class="grow">{{ label }} <small class="muted">{{ n }}</small></span>
              <button class="link-btn small" @click="startRename(label)"><Icon name="edit" />{{ t('settings.rename') }}</button>
              <button class="link-btn small danger" @click="remove(label, n)"><Icon name="close" />{{ t('settings.removeLabel') }}</button>
            </template>
          </li>
        </ul>
      </section>

      <section class="card form">
        <h2><Icon name="download" />{{ t('settings.export') }}</h2>
        <p class="muted small">{{ t('settings.exportHow') }}</p>
        <a v-if="online" class="btn" href="/api/export" download><Icon name="download" />{{ t('settings.exportButton') }}</a>
        <p v-else class="warn small">{{ t('settings.exportOffline') }}</p>
      </section>
    </AccountCards>
  </main>
</template>
