<script setup>
import { computed } from 'vue';
import { t } from './i18n.js';
import AppShell from './kit/components/AppShell.vue';

const tabs = computed(() => [
  { to: '/', name: 'library', icon: 'books', label: t('nav.library') },
  { to: '/add', name: 'add', icon: 'plus', label: t('nav.add') },
  { to: '/stats', name: 'stats', icon: 'chart', label: t('nav.stats') },
]);
const extras = computed(() => [{ to: '/settings', name: 'settings', icon: 'gear', label: t('nav.settings') }]);
</script>

<template>
  <AppShell name="Regal" :tabs="tabs" :extras="extras" />
</template>
