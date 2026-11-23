<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import { t } from '../i18n.js';
import { NOTE_COLORS } from '../store/notes.js';
import Icon from '../kit/components/Icon.vue';

// A palette button with the note's colours behind it ('' is none). The menu stays open, so
// you can try a few and see the note change underneath.
const props = defineProps({ modelValue: { type: String, default: '' } });
const emit = defineEmits(['update:modelValue']);
const open = ref(false);
const root = ref(null);
const choices = ['', ...NOTE_COLORS];

const onOutside = (event) => !root.value?.contains(event.target) && (open.value = false);
watch(open, (value) => {
  if (value) document.addEventListener('pointerdown', onOutside);
  else document.removeEventListener('pointerdown', onOutside);
});
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside));

function pick(color) {
  if (color !== props.modelValue) emit('update:modelValue', color);
}

// Escape closes the menu, not the note underneath
function onEscape(event) {
  if (!open.value) return;
  event.stopPropagation();
  open.value = false;
}
</script>

<template>
  <div ref="root" class="more-menu color-menu" @keydown.esc="onEscape">
    <button class="icon-btn" :class="{ active: open }" :aria-label="t('note.color')" :title="t('note.color')" aria-haspopup="true" :aria-expanded="open" @click="open = !open"><Icon name="palette" /></button>
    <div v-if="open" class="menu-pop color-pop" role="group" :aria-label="t('note.color')">
      <button
        v-for="color in choices"
        :key="color || 'none'"
        type="button"
        class="swatch"
        :class="{ none: !color, current: modelValue === color }"
        :style="color ? { background: `var(--note-${color})` } : null"
        :aria-label="t(`colors.${color || 'none'}`)"
        :aria-pressed="modelValue === color"
        :title="t(`colors.${color || 'none'}`)"
        @click="pick(color)"
      >
        <Icon v-if="modelValue === color" name="check" />
        <Icon v-else-if="!color" name="color-off" />
      </button>
    </div>
  </div>
</template>
