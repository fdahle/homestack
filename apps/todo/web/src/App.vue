<script setup>
import { computed } from 'vue';
import { t } from './i18n.js';
import { areas } from './store/tasks.js';
import AppShell from './kit/components/AppShell.vue';
import AreaSwitch from './kit/components/AreaSwitch.vue';
import ListNav from './components/ListNav.vue';

// On a computer a sidebar: the area switch (once there are areas), the three pages, the
// inbox and the lists, settings at the bottom. On the phone the tabs at the bottom, the area
// switch at the top of the pages.
const tabs = computed(() => [
  { to: '/', name: 'today', icon: 'sun', label: t('nav.today') },
  { to: '/upcoming', name: 'upcoming', icon: 'calendar', label: t('nav.upcoming') },
  { to: '/lists', name: 'lists', icon: 'lists', label: t('nav.lists'), also: ['list', 'list-task'] },
]);
const extras = computed(() => [{ to: '/settings', name: 'settings', icon: 'gear', label: t('nav.settings') }]);
</script>

<template>
  <AppShell name="To-do" nav="side" :tabs="tabs" :extras="extras">
    <template #sidebar><AreaSwitch :areas="areas" /></template>
    <template #after><ListNav /></template>
  </AppShell>
</template>
