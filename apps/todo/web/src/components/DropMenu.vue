<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';

// A button with a small menu under it. Closes on a click elsewhere or Escape.
// Slot "button": the button's content. Default slot: the menu; it gets `close`.
defineProps({ label: String, active: Boolean, align: { type: String, default: 'left' } });
const open = ref(false);
const root = ref(null);

const onDoc = (e) => {
  if (!root.value?.contains(e.target)) open.value = false;
};
const onKey = (e) => {
  if (e.key === 'Escape') {
    open.value = false;
    e.stopPropagation();
  }
};
watch(open, (value) => {
  const method = value ? 'addEventListener' : 'removeEventListener';
  document[method]('pointerdown', onDoc, true);
  document[method]('keydown', onKey, true);
});
onBeforeUnmount(() => (open.value = false));
const close = () => (open.value = false);
</script>

<template>
  <div ref="root" class="drop">
    <button type="button" class="chip" :class="{ set: active }" :aria-label="label" :aria-expanded="open" :title="label" @mousedown.prevent @click="open = !open">
      <slot name="button" />
    </button>
    <div v-if="open" class="drop-menu" :class="`align-${align}`" role="menu">
      <slot :close="close" />
    </div>
  </div>
</template>
