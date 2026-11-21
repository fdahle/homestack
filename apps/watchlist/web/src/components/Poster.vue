<script setup>
import { computed } from 'vue';
import { posterUrl } from '../util.js';
import Cover from '../kit/components/Cover.vue';

// The poster of a film or series, or a placeholder with its title.
// src: a URL to use instead of the stored poster (TMDB thumbnails in the search).
const props = defineProps({ item: Object, src: String, title: String, eager: Boolean });
const url = computed(() => props.src || posterUrl(props.item));
</script>

<template>
  <Cover :src="url" :name="title || item?.title || ''" :eager="eager"><slot /></Cover>
</template>
