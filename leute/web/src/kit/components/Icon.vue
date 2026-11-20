<!-- Copied from design/web/components/Icon.vue by design/sync.mjs. Change it there, not here. -->
<script setup>
import { ICONS } from '../icons.js';

defineProps({ name: { type: String, required: true } });
</script>

<template>
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS[name]"></svg>
</template>
