<script setup>
import { computed, ref, watch } from 'vue';
import { coverSrc } from '../util.js';

// Shows the cover, or a placeholder with number and title when there is none
// (or GCD's image doesn't load).
const props = defineProps({ issue: Object, seriesName: String, eager: Boolean });
const failed = ref(false);
const src = computed(() => coverSrc(props.issue));
watch(src, () => (failed.value = false));
</script>

<template>
  <div class="cover">
    <img v-if="src && !failed" :src="src" alt="" :loading="eager ? 'eager' : 'lazy'" referrerpolicy="no-referrer" @error="failed = true" />
    <div v-else class="cover-placeholder">
      <span v-if="seriesName" class="ph-series">{{ seriesName }}</span>
      <strong v-if="issue?.number">{{ issue.number }}</strong>
      <span v-if="issue?.title" class="ph-title">{{ issue.title }}</span>
    </div>
  </div>
</template>
