<script setup>
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { session } from './api.js';
import { lang, t } from './i18n.js';
import { toast } from './util.js';
import Icon from './components/Icon.vue';

const route = useRoute();
const showNav = computed(() => session.user && route.name !== 'login');

watch(() => session.user?.lang, (value) => {
  if (value) lang.value = value;
}, { immediate: true });

const tabs = computed(() => [
  { to: '/', name: 'home', icon: 'home', label: t('nav.home') },
  { to: '/collection', name: 'collection', icon: 'stack', label: t('nav.collection'), also: ['series', 'issue'] },
  { to: '/scan', name: 'scan', icon: 'scan', label: t('nav.scan') },
  { to: '/add', name: 'add', icon: 'plus', label: t('nav.add') },
  { to: '/wishlist', name: 'wishlist', icon: 'heart', label: t('nav.wishlist') },
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
