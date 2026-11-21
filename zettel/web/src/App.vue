<script setup>
import { computed } from 'vue';
import { t } from './i18n.js';
import AppShell from './kit/components/AppShell.vue';
import LabelNav from './components/LabelNav.vue';

const tabs = computed(() => [
  { to: '/', name: 'notes', icon: 'note', label: t('nav.notes') },
  { to: '/new', name: 'new', icon: 'plus', label: t('nav.new') },
  { to: '/archive', name: 'archive', icon: 'archive', label: t('nav.archive') },
]);
const extras = computed(() => [
  { to: '/trash', name: 'trash', icon: 'trash', label: t('nav.trash') },
  { to: '/settings', name: 'settings', icon: 'gear', label: t('nav.settings') },
]);
</script>

<template>
  <AppShell name="Zettel" :tabs="tabs" :extras="extras">
    <template #sidebar><LabelNav /></template>
  </AppShell>
</template>
