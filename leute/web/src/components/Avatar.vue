<script setup>
import { computed } from 'vue';
import { avatarHue, initial } from '../util.js';

const props = defineProps({ friend: { type: Object, required: true }, size: { type: Number, default: 40 } });
const style = computed(() => ({ '--h': avatarHue(props.friend.name), width: `${props.size}px`, height: `${props.size}px`, fontSize: `${props.size * 0.44}px` }));
</script>

<template>
  <span class="avatar" :style="style">
    <img v-if="friend.photo_file" :src="`/photos/${friend.photo_file}`" alt="" loading="lazy" />
    <span v-else>{{ initial(friend.name) }}</span>
  </span>
</template>
