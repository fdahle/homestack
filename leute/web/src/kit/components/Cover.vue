<!-- Copied from design/web/components/Cover.vue by design/sync.mjs. Change it there, not here. -->
<script setup>
import { computed, ref, watch } from 'vue';

// A cover picture, or a coloured placeholder with the name when there is none (or it fails).
// The shape comes from --cover-ratio (2 / 3 unless the app sets another).
const props = defineProps({ src: String, name: { type: String, default: '' }, eager: Boolean });
const failed = ref(false);
// A colour per name, so the placeholders don't all look the same
const hue = computed(() => [...props.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
watch(() => props.src, () => (failed.value = false));
</script>

<template>
  <div class="cover">
    <img v-if="src && !failed" :src="src" alt="" :loading="eager ? 'eager' : 'lazy'" @error="failed = true" />
    <div v-else class="cover-placeholder" :style="{ '--h': hue }"><span>{{ name }}</span></div>
    <slot />
  </div>
</template>
