<script setup>
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { draftFromText, session } from './api.js';
import { lang, t } from './i18n.js';
import { errorText, showToast, toast } from './util.js';
import Icon from './components/Icon.vue';

const route = useRoute();
const router = useRouter();
const showNav = computed(() => session.user && route.name !== 'login');

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

watch(() => session.user?.lang, (value) => {
  if (value) lang.value = value;
}, { immediate: true });

const tabs = computed(() => [
  { to: '/', name: 'home', icon: 'home', label: t('nav.home') },
  { to: '/friends', name: 'friends', icon: 'users', label: t('nav.friends'), also: ['friend', 'friend-edit', 'friend-new'] },
  { to: '/timeline', name: 'timeline', icon: 'clock', label: t('nav.timeline'), also: ['event'] },
  { to: '/event/new', name: 'event-new', icon: 'plus', label: t('nav.add'), also: ['share'] },
]);

const isActive = (tab) => route.name === tab.name || tab.also?.includes(route.name);

function runToastAction() {
  toast.action?.run();
  toast.text = '';
  toast.action = null;
}
</script>

<template>
  <div :class="{ 'has-nav': showNav }">
    <RouterView v-slot="{ Component }">
      <component :is="Component" :key="route.fullPath.split('?')[0]" />
    </RouterView>

    <nav v-if="showNav" class="bottom-nav" :aria-label="t('nav.label')">
      <RouterLink v-for="tab in tabs" :key="tab.name" :to="tab.to" :class="{ active: isActive(tab) }">
        <Icon :name="tab.icon" />
        <span>{{ tab.label }}</span>
      </RouterLink>
    </nav>

    <div v-if="toast.text" class="toast" role="status">
      <span>{{ toast.text }}</span>
      <button v-if="toast.action" class="link-btn" @click="runToastAction">{{ toast.action.label }}</button>
    </div>
  </div>
</template>
