<script setup>
import { computed } from 'vue';
import { coverUrl } from '../util.js';
import Cover from '../kit/components/Cover.vue';

// The game's cover, or a placeholder with its name.
// src: a URL to use instead of the stored cover (IGDB thumbnails in the search).
const props = defineProps({ game: Object, src: String, name: String, eager: Boolean });
const url = computed(() => props.src || coverUrl(props.game));
</script>

<template>
  <Cover :src="url" :name="name || game?.name || ''" :eager="eager" />
</template>
