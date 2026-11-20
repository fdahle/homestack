<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { t } from './i18n.js';
import { lastMode, PATHS } from './util.js';
import AppShell from './kit/components/AppShell.vue';
import ModeSwitch from './components/ModeSwitch.vue';

// Films and series each have their own tabs; settings keep the tabs of the mode you came from
const route = useRoute();
const mode = computed(() => route.meta.mode || lastMode.value);

const tabs = computed(() => (mode.value === 'series'
  ? [
    { to: PATHS.series.library, name: 'series', icon: 'tv', label: t('nav.library') },
    { to: PATHS.series.upnext, name: 'upnext', icon: 'queue', label: t('nav.upnext') },
    { to: PATHS.series.add, name: 'series-add', icon: 'plus', label: t('nav.add') },
    { to: PATHS.series.stats, name: 'series-stats', icon: 'chart', label: t('nav.stats') },
  ]
  : [
    { to: PATHS.films.library, name: 'films', icon: 'film', label: t('nav.library') },
    { to: PATHS.films.add, name: 'film-add', icon: 'plus', label: t('nav.add') },
    { to: PATHS.films.stats, name: 'film-stats', icon: 'chart', label: t('nav.stats') },
  ]));
const extras = computed(() => [{ to: '/einstellungen', name: 'settings', icon: 'gear', label: t('nav.settings') }]);
</script>

<template>
  <AppShell name="Flimmer" :tabs="tabs" :extras="extras">
    <template #sidebar><ModeSwitch /></template>
  </AppShell>
</template>
