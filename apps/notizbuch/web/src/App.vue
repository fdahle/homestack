<script setup>
import { computed } from 'vue';
import { t } from './i18n.js';
import AppShell from './kit/components/AppShell.vue';

const tabs = computed(() => [
  { to: '/', name: 'notes', icon: 'note', label: t('nav.notes') },
]);
// At the right end of the bar on a computer; on the phone (which has no tabs, only the + on the notes)
// behind the ⋮ on the notes page. A new note: the box above the notes, or the +.
const extras = computed(() => [
  { to: '/archive', name: 'archive', icon: 'archive', label: t('nav.archive') },
  { to: '/trash', name: 'trash', icon: 'trash', label: t('nav.trash') },
  { to: '/settings', name: 'settings', icon: 'gear', label: t('nav.settings') },
]);
</script>

<template>
  <AppShell name="Notizbuch" :tabs="tabs" :extras="extras" />
</template>
