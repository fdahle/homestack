<template>
  <span class="app-icon" v-html="ICONS[name]" aria-hidden="true" />
</template>

<script setup>
import { ICONS } from '../icons.js'
defineProps({ name: { type: String, required: true } })
</script>

<style scoped>
.app-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
</style>
