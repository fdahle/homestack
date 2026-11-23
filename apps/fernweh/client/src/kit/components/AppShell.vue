<!-- Copied from kit/web/components/AppShell.vue by kit/sync.mjs. Change it there, not here. -->
<script setup>
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { session } from '../api.js';
import { lang, t } from '../i18n.js';
import { toast } from '../util.js';
import '../theme.js'; // light, dark or auto, and the status bar's colour
import Icon from './Icon.vue';

// The frame of every app: the pages, the navigation (tabs at the bottom on the phone,
// a sidebar on a computer) and the toast.
// tabs: [{ to, name, icon, label, also: [other route names that light this tab up] }]
// extras: like tabs, only in the sidebar (on the phone they live in a page's top bar).
// Slot "sidebar": shown under the app's name in the sidebar (a mode switch, for example).
// nav: 'side' (a sidebar on a computer) or 'top' (a bar across the top, for apps with few pages).
const props = defineProps({
  name: { type: String, required: true },
  tabs: { type: Array, required: true },
  extras: { type: Array, default: () => [] },
  nav: { type: String, default: 'side' },
});

const route = useRoute();
const showNav = computed(() => session.user && !route.meta.public);

watch(() => session.user?.lang, (value) => {
  if (value) {
    lang.value = value;
    document.documentElement.lang = value;
  }
}, { immediate: true });

const isActive = (tab) => route.name === tab.name || tab.also?.includes(route.name) || route.matched.some((m) => m.name === tab.name);

// A page stays the same component while only its entry beside it changes (SplitView)
const viewKey = computed(() => (route.matched.length > 1 ? route.matched[0].path : route.path));

// A search field that still has the focus when the app goes to the background would bring the
// phone's keyboard back up the next time the app is opened
function blurSearch() {
  if (document.visibilityState === 'hidden' && document.activeElement?.matches?.('input[type="search"]')) document.activeElement.blur();
}
onMounted(() => document.addEventListener('visibilitychange', blurSearch));
onBeforeUnmount(() => document.removeEventListener('visibilitychange', blurSearch));

function runToastAction() {
  toast.action?.run();
  toast.text = '';
  toast.action = null;
}
</script>

<template>
  <div :class="{ 'has-nav': showNav, 'nav-top': props.nav === 'top' }">
    <RouterView v-slot="{ Component }">
      <component :is="Component" :key="viewKey" />
    </RouterView>

    <nav v-if="showNav" class="app-nav" :aria-label="t('nav.label')">
      <RouterLink :to="tabs[0].to" class="brand"><img src="/icon.svg" alt="" width="30" height="30" />{{ props.name }}</RouterLink>
      <div class="nav-slot"><slot name="sidebar" /></div>
      <RouterLink v-for="tab in tabs" :key="tab.name" :to="tab.to" :class="{ active: isActive(tab) }">
        <Icon :name="tab.icon" />
        <span>{{ tab.label }}</span>
      </RouterLink>
      <span class="nav-spacer"></span>
      <RouterLink v-for="tab in extras" :key="tab.name" :to="tab.to" class="nav-extra" :class="{ active: isActive(tab) }">
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
