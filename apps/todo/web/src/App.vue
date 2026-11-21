<script setup>
import { computed } from 'vue';
import { t } from './i18n.js';
import AppShell from './kit/components/AppShell.vue';
import ListNav from './components/ListNav.vue';

const tabs = computed(() => [
  { to: '/', name: 'today', icon: 'sun', label: t('nav.today') },
  { to: '/upcoming', name: 'upcoming', icon: 'calendar', label: t('nav.upcoming') },
  { to: '/lists', name: 'lists', icon: 'lists', label: t('nav.lists'), also: ['list', 'list-task'] },
]);
const extras = computed(() => [{ to: '/settings', name: 'settings', icon: 'gear', label: t('nav.settings') }]);
</script>

<template>
  <AppShell name="To-do" :tabs="tabs" :extras="extras">
    <template #sidebar><ListNav /></template>
  </AppShell>
</template>
