<!-- Copied from kit/web/components/SplitView.vue by kit/sync.mjs. Change it there, not here. -->
<script setup>
import { computed, nextTick, provide, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useShortcut, wide } from '../util.js';

// A list page with its entries as child routes. On a computer the open entry shows
// beside the list; on the phone it replaces the list (which stays alive, filters and all).
// Use it in a top-level route that has children: { path: '/', component: List, children: [{ path: 'game/:id', … }] }
const route = useRoute();
const router = useRouter();
const pane = ref(null);
const hasDetail = computed(() => route.matched.length > 1);
provide('splitPane', true);

// A new entry starts at its top
watch(() => route.path, async () => {
  await nextTick();
  if (pane.value) pane.value.scrollTop = 0;
});

useShortcut('Escape', () => {
  if (!hasDetail.value || !wide.value) return false;
  if (window.history.state?.back) router.back();
  else router.push(route.matched[0].path);
});
</script>

<template>
  <div class="split" :class="{ 'has-detail': hasDetail }">
    <div class="split-list"><slot /></div>
    <RouterView v-slot="{ Component, route: inner }">
      <aside v-if="Component" ref="pane" class="split-detail">
        <component :is="Component" :key="inner.path" />
      </aside>
    </RouterView>
  </div>
</template>
