<script setup>
import { useRoute } from 'vue-router';
import { t } from '../i18n.js';
import { labelCounts } from '../store/notes.js';
import Icon from '../kit/components/Icon.vue';

// The labels in the sidebar (on a computer): each one filters the notes
const route = useRoute();
const isActive = (label) => route.matched[0]?.name === 'notes' && route.query.label === label;
</script>

<template>
  <div v-if="labelCounts.length" class="label-nav">
    <p class="label-nav-title">{{ t('notes.labels') }}</p>
    <RouterLink v-for="[label, n] in labelCounts" :key="label" :to="{ path: '/', query: { label } }" :class="{ active: isActive(label) }">
      <Icon name="tag" />
      <span class="grow">{{ label }}</span>
      <small>{{ n }}</small>
    </RouterLink>
  </div>
</template>
