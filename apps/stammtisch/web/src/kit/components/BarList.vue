<!-- Copied from kit/web/components/BarList.vue by kit/sync.mjs. Change it there, not here. -->
<script setup>
import { computed } from 'vue';
import { formatNumber } from '../util.js';

// Horizontal bars, one per row: label, bar, value. rows: [[label, value], …]
// to (optional): a function row label → link, e.g. to the library filtered by it.
const props = defineProps({ rows: { type: Array, required: true }, to: Function, unit: Function });
const max = computed(() => Math.max(1, ...props.rows.map(([, v]) => v)));
const text = (v) => (props.unit ? props.unit(v) : formatNumber(v));
</script>

<template>
  <ul class="bars">
    <li v-for="[label, value] in rows" :key="label" :title="`${label}: ${text(value)}`">
      <component :is="to ? 'RouterLink' : 'span'" :to="to?.(label)" class="bar-label">{{ label }}</component>
      <span class="bar-track"><span v-if="value" class="bar" :style="{ width: `${(value / max) * 100}%` }"></span></span>
      <span class="bar-value">{{ text(value) }}</span>
    </li>
  </ul>
</template>
