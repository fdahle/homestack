<script setup>
import { computed } from 'vue';
import { t } from '../i18n.js';
import { starValue } from '../util.js';

// Five stars in half steps; the value is 1–10 (null = not rated).
// Tap the left or right half of a star; tap the current value again to clear it.
// With the keyboard: arrow keys, Delete to clear.
const props = defineProps({ modelValue: { type: Number, default: null }, readonly: Boolean, small: Boolean });
const emit = defineEmits(['update:modelValue']);

const value = computed(() => props.modelValue || 0);
// How star i (0–4) is filled: 'full', 'half' or ''
const fill = (i) => (value.value >= i * 2 + 2 ? 'full' : value.value === i * 2 + 1 ? 'half' : '');
const label = computed(() => (props.modelValue ? t('rating.value', { n: starValue(props.modelValue) }) : t('rating.none')));

function pick(i, event) {
  if (props.readonly) return;
  const { left, width } = event.currentTarget.getBoundingClientRect();
  const half = event.clientX - left < width / 2;
  const next = i * 2 + (half ? 1 : 2);
  emit('update:modelValue', next === props.modelValue ? null : next);
}

function onKey(event) {
  const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
  if (step) {
    event.preventDefault();
    const next = Math.max(0, Math.min(10, value.value + step));
    emit('update:modelValue', next || null);
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    emit('update:modelValue', null);
  }
}

const STAR = 'M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z';
</script>

<template>
  <div
    class="stars"
    :class="{ readonly, small }"
    :role="readonly ? 'img' : 'slider'"
    :aria-label="readonly ? label : t('rating.label')"
    :aria-valuemin="readonly ? undefined : 0"
    :aria-valuemax="readonly ? undefined : 10"
    :aria-valuenow="readonly ? undefined : value"
    :aria-valuetext="readonly ? undefined : label"
    :tabindex="readonly ? undefined : 0"
    @keydown="onKey"
  >
    <svg v-for="i in 5" :key="i" viewBox="0 0 24 24" class="star" aria-hidden="true" @click="pick(i - 1, $event)">
      <path :d="STAR" class="star-empty" />
      <path v-if="fill(i - 1)" :d="STAR" class="star-full" :class="fill(i - 1)" />
    </svg>
  </div>
</template>
