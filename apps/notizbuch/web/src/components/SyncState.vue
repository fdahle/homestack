<script setup>
import { computed } from 'vue';
import { t } from '../i18n.js';
import { store, sync } from '../store/notes.js';
import Icon from '../kit/components/Icon.vue';

// A small cloud in the top bar: synced, changes waiting, or offline. Tapping it syncs now.
const state = computed(() => {
  if (store.status === 'offline') return { icon: 'cloud-off', cls: 'warn', text: t('sync.offline') };
  if (store.status === 'error') return { icon: 'cloud-off', cls: 'error', text: t('sync.error') };
  if (store.status === 'syncing') return { icon: 'cloud-up', cls: 'muted busy', text: t('sync.syncing') };
  if (store.pending) return { icon: 'cloud-up', cls: 'muted', text: t('sync.pending', { n: store.pending }) };
  return { icon: 'cloud', cls: 'muted', text: t('sync.idle') };
});
</script>

<template>
  <button class="icon-btn sync-state" :class="state.cls" :aria-label="state.text" :title="state.text" @click="sync()">
    <Icon :name="state.icon" />
    <span v-if="store.pending && store.status !== 'syncing'" class="sync-count">{{ store.pending }}</span>
  </button>
</template>
