<script setup>
import { computed, ref } from 'vue';
import { t } from '../i18n.js';
import { labelCounts } from '../store/notes.js';
import Icon from '../kit/components/Icon.vue';

// The labels of a note: chips to remove, a field to add one (Enter or comma), with the
// labels you already use as suggestions.
const props = defineProps({ modelValue: { type: Array, required: true }, disabled: Boolean });
const emit = defineEmits(['update:modelValue']);
const text = ref('');
const listId = `labels-${Math.random().toString(36).slice(2)}`;

const has = (label) => props.modelValue.some((l) => l.toLowerCase() === label.toLowerCase());
const suggestions = computed(() => labelCounts.value.map(([l]) => l).filter((l) => !has(l)));

function add() {
  const label = text.value.replace(/,/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 60);
  text.value = '';
  if (!label || has(label)) return;
  // The spelling already in use wins ("arbeit" → "Arbeit")
  const known = labelCounts.value.find(([l]) => l.toLowerCase() === label.toLowerCase())?.[0];
  emit('update:modelValue', [...props.modelValue, known || label]);
}

function remove(label) {
  emit('update:modelValue', props.modelValue.filter((l) => l !== label));
}

function onKey(event) {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault();
    add();
  } else if (event.key === 'Backspace' && !text.value && props.modelValue.length) {
    remove(props.modelValue.at(-1));
  }
}

// Picking a suggestion from the list fills the field without a key press
function onInput() {
  if (suggestions.value.includes(text.value)) add();
}
</script>

<template>
  <div class="label-editor">
    <Icon name="tag" class="muted" />
    <span v-for="label in modelValue" :key="label" class="chip label-chip">
      {{ label }}
      <button v-if="!disabled" type="button" class="chip-x" :aria-label="t('note.removeLabel', { label })" @click="remove(label)"><Icon name="close" /></button>
    </span>
    <template v-if="!disabled">
      <input
        v-model="text"
        class="label-input"
        :list="listId"
        :placeholder="t('note.addLabel')"
        :aria-label="t('note.labels')"
        enterkeyhint="done"
        @keydown="onKey"
        @input="onInput"
        @blur="add"
      />
      <datalist :id="listId">
        <option v-for="label in suggestions" :key="label" :value="label" />
      </datalist>
    </template>
  </div>
</template>
