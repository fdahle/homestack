<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '../i18n.js';
import { countLabels, IN_LIST, store } from '../store/notes.js';
import Icon from '../kit/components/Icon.vue';

// The labels in the sidebar on a computer (the phone has them as chips above the notes).
// They filter the list you're on (notes, archive or trash); from any other page, the notes.
const route = useRoute();
const list = computed(() => {
  const top = route.matched[0];
  return IN_LIST[top?.name] ? { name: top.name, path: top.path } : { name: 'notes', path: '/' };
});
const labels = computed(() => countLabels([...store.notes.values()].filter(IN_LIST[list.value.name])));
const current = computed(() => (route.name === list.value.name ? String(route.query.label || '') : ''));

// A click on the label that's on takes it off again; a search stays
function target(label) {
  const { label: _, ...query } = route.name === list.value.name ? route.query : {};
  return { path: list.value.path, query: current.value === label ? query : { ...query, label } };
}
</script>

<template>
  <div v-if="labels.length" class="label-nav" role="group" :aria-label="t('notes.labels')">
    <h2 class="label-nav-title">{{ t('notes.labels') }}</h2>
    <RouterLink v-for="[l, n] in labels" :key="l" :to="target(l)" :class="{ active: current === l }" :aria-current="current === l ? 'true' : undefined">
      <Icon name="tag" /><span class="grow">{{ l }}</span><span class="label-nav-count">{{ n }}</span>
    </RouterLink>
  </div>
</template>
