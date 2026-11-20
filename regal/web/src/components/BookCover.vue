<script setup>
import { computed } from 'vue';
import { coverUrl } from '../util.js';
import Cover from '../kit/components/Cover.vue';

// The book's cover, or a placeholder with its title.
// src: a URL to use instead of the stored cover (catalog thumbnails in the search).
const props = defineProps({ book: Object, src: String, title: String, eager: Boolean });
const url = computed(() => props.src || coverUrl(props.book));
</script>

<template>
  <Cover :src="url" :name="title || book?.title || ''" :eager="eager"><slot /></Cover>
</template>
