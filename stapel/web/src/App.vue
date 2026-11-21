<script setup>
import { computed, watchEffect } from 'vue';
import { useRoute } from 'vue-router';
import { session } from './api.js';
import { t } from './i18n.js';
import AppShell from './kit/components/AppShell.vue';
import ActivityPanel from './components/ActivityPanel.vue';
import { activityVisible } from './activity.js';

const route = useRoute();
const showNav = computed(() => session.user && !route.meta.public);

const tabs = computed(() => [
  { to: '/', name: 'home', icon: 'home', label: t('nav.home') },
  { to: '/collection', name: 'collection', icon: 'stack', label: t('nav.collection'), also: ['series', 'issue'] },
  { to: '/scan', name: 'scan', icon: 'scan', label: t('nav.scan') },
  { to: '/add', name: 'add', icon: 'plus', label: t('nav.add') },
  { to: '/wishlist', name: 'wishlist', icon: 'heart', label: t('nav.wishlist') },
]);
const extras = computed(() => [{ to: '/settings', name: 'settings', icon: 'gear', label: t('nav.settings') }]);

// The activity pill floats over the page's end: the page makes room for it
watchEffect(() => document.body.classList.toggle('has-activity', Boolean(showNav.value && activityVisible.value)));
</script>

<template>
  <AppShell name="Stapel" :tabs="tabs" :extras="extras" />
  <ActivityPanel v-if="showNav" />
</template>
