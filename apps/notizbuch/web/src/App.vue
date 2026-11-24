<script setup>
import { computed } from 'vue';
import { t } from './i18n.js';
import { areas } from './store/notes.js';
import AppShell from './kit/components/AppShell.vue';
import AreaSwitch from './kit/components/AreaSwitch.vue';
import LabelNav from './components/LabelNav.vue';

// On a computer a sidebar, like Keep's: the area switch (once there are areas), the three
// lists, the labels under them, settings at the bottom. The phone has no tabs: the + on the
// notes for a new note, the other lists behind the ⋮, the area switch and the labels as chips
// above the notes.
const tabs = computed(() => [
  { to: '/', name: 'notes', icon: 'note', label: t('nav.notes') },
  { to: '/archive', name: 'archive', icon: 'archive', label: t('nav.archive') },
  { to: '/trash', name: 'trash', icon: 'trash', label: t('nav.trash') },
]);
const extras = computed(() => [
  { to: '/settings', name: 'settings', icon: 'gear', label: t('nav.settings') },
]);
</script>

<template>
  <AppShell name="Notizbuch" nav="side" :tabs="tabs" :extras="extras">
    <template #sidebar><AreaSwitch :areas="areas" /></template>
    <template #after><LabelNav /></template>
  </AppShell>
</template>
