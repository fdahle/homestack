<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '../i18n.js';
import Icon from '../kit/components/Icon.vue';

// A ⋮ button with a few pages behind it (on the phone: archive, trash, settings).
// items: [{ to, icon, label }]
defineProps({ items: { type: Array, required: true } });
const open = ref(false);
const root = ref(null);
const route = useRoute();

watch(() => route.fullPath, () => (open.value = false));

const onOutside = (event) => !root.value?.contains(event.target) && (open.value = false);
watch(open, (value) => {
  if (value) document.addEventListener('pointerdown', onOutside);
  else document.removeEventListener('pointerdown', onOutside);
});
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside));
</script>

<template>
  <div ref="root" class="more-menu" @keydown.esc="open = false">
    <button class="icon-btn" :aria-label="t('more')" :title="t('more')" aria-haspopup="menu" :aria-expanded="open" @click="open = !open"><Icon name="more" /></button>
    <div v-if="open" class="menu-pop" role="menu">
      <RouterLink v-for="item in items" :key="item.to" :to="item.to" role="menuitem"><Icon :name="item.icon" />{{ item.label }}</RouterLink>
    </div>
  </div>
</template>
