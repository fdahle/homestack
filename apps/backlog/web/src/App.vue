<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { t } from './i18n.js';
import { askAboutOpened } from './articles.js';
import AppShell from './kit/components/AppShell.vue';
import ActionSheet from './components/ActionSheet.vue';

const tabs = computed(() => [
  { to: '/', name: 'home', icon: 'books', label: t('nav.home'), also: ['blog', 'blog-settings'] },
  { to: '/discover', name: 'discover', icon: 'compass', label: t('nav.discover') },
  { to: '/add', name: 'add', icon: 'plus', label: t('nav.add') },
]);
const extras = computed(() => [{ to: '/settings', name: 'settings', icon: 'gear', label: t('nav.settings') }]);

// Back from reading a post: "Finished?"
const ask = () => askAboutOpened();
onMounted(() => {
  document.addEventListener('visibilitychange', ask);
  window.addEventListener('pageshow', ask);
});
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', ask);
  window.removeEventListener('pageshow', ask);
});
</script>

<template>
  <AppShell name="Backlog" :tabs="tabs" :extras="extras" />
  <ActionSheet />
</template>
