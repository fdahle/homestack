<script setup lang="ts">
// Stammbaum's own icons (ui/icons.ts), for the Vue parts: the same glyphs the tree and the pages use.
import { PATHS, type IconName } from '../ui/icons';

defineProps<{ name: IconName }>();
</script>

<template>
  <svg :class="['icon', `icon-${name}`]" viewBox="0 0 24 24" aria-hidden="true">
    <path
      v-for="d in PATHS[name]"
      :key="d"
      :d="d"
      :class="{ 'icon-solid': name === 'auto' && d.startsWith('M12 3v18') }"
    />
  </svg>
</template>
