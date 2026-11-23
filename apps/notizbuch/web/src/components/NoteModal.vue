<script setup>
import { onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import { useShortcut, wide } from '../kit/util.js';

// The open note. On a computer it lies on top of the list, like a sheet of paper on the desk
// (Escape or a click beside it closes it); on the phone it's simply the page.
const emit = defineEmits(['close']);
const sheet = ref(null);
// TopBar then shows a close button on a computer instead of "back"
provide('splitPane', true);

// The list underneath stays where it is
watch(wide, (value) => document.documentElement.classList.toggle('modal-open', value), { immediate: true });
onBeforeUnmount(() => document.documentElement.classList.remove('modal-open'));

// Keyboard focus moves into the note (unless the note already put it into its title)
onMounted(() => {
  if (wide.value && !sheet.value?.contains(document.activeElement)) sheet.value?.focus({ preventScroll: true });
});

useShortcut('Escape', () => {
  if (!wide.value) return false;
  emit('close');
});

// Only a click that starts beside the note closes it, not a text selection dragged out of it
let downBeside = false;
const onDown = (event) => (downBeside = event.target === event.currentTarget);
function onClick(event) {
  if (wide.value && downBeside && event.target === event.currentTarget) emit('close');
}
</script>

<template>
  <div class="note-layer" @pointerdown="onDown" @click="onClick">
    <div ref="sheet" class="note-sheet" :role="wide ? 'dialog' : undefined" :aria-modal="wide ? 'true' : undefined" tabindex="-1">
      <slot />
    </div>
  </div>
</template>
