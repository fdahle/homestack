<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { draftFromText, session } from './api.js';
import { t } from './i18n.js';
import { errorText, showToast } from './util.js';
import AppShell from './kit/components/AppShell.vue';

const route = useRoute();
const router = useRouter();

// Text pasted outside a text field (copied WhatsApp messages, Ctrl+V on the computer) becomes
// a draft event; on a friend's page with that friend
const PASTE_PAGES = ['home', 'friends', 'friend', 'timeline'];

async function onPaste(event) {
  if (!session.user || !PASTE_PAGES.includes(route.name)) return;
  if (event.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const text = event.clipboardData?.getData('text/plain')?.trim();
  if (!text) return;
  event.preventDefault();
  try {
    await draftFromText(text, { friendId: route.name === 'friend' ? Number(route.params.id) : null });
    router.push('/event/new');
  } catch (err) {
    showToast(errorText(err));
  }
}

onMounted(() => document.addEventListener('paste', onPaste));
onBeforeUnmount(() => document.removeEventListener('paste', onPaste));

const tabs = computed(() => [
  { to: '/', name: 'home', icon: 'home', label: t('nav.home') },
  { to: '/friends', name: 'friends', icon: 'users', label: t('nav.friends') },
  { to: '/timeline', name: 'timeline', icon: 'clock', label: t('nav.timeline') },
  { to: '/event/new', name: 'event-new', icon: 'plus', label: t('nav.add'), also: ['share'] },
]);
const extras = computed(() => [{ to: '/settings', name: 'settings', icon: 'gear', label: t('nav.settings') }]);
</script>

<template>
  <AppShell name="Stammtisch" :tabs="tabs" :extras="extras" />
</template>
