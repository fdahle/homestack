<script setup>
import { computed, ref, watch } from 'vue';
import { t, weekdayNames } from '../i18n.js';
import { weekday } from '../lib/dates.js';
import { presetOf, PRESETS } from '../lib/repeat.js';

// Repeat: the usual choices in one menu, and "custom" for every n days/weeks/months/years,
// weekdays, and whether to count from the day it's done.
const props = defineProps({ modelValue: Object, due: String });
const emit = defineEmits(['update:modelValue']);

const custom = ref(presetOf(props.modelValue) === 'custom');
watch(() => props.modelValue, (rule) => {
  if (presetOf(rule) === 'custom') custom.value = true;
});
const choice = computed(() => (custom.value ? 'custom' : presetOf(props.modelValue)));

function choose(value) {
  if (value === 'custom') {
    custom.value = true;
    if (!props.modelValue) emit('update:modelValue', { unit: 'week', every: 1, weekdays: [props.due ? weekday(props.due) : 1], from: 'due' });
    return;
  }
  custom.value = false;
  emit('update:modelValue', value === 'none' ? null : { ...PRESETS[value], from: props.modelValue?.from || 'due' });
}

const rule = computed(() => props.modelValue || { unit: 'day', every: 1 });
const change = (patch) => emit('update:modelValue', { ...rule.value, ...patch });

function toggleDay(d) {
  const days = new Set(rule.value.weekdays || []);
  if (days.has(d)) days.delete(d);
  else days.add(d);
  change({ weekdays: [...days].sort() });
}
</script>

<template>
  <div class="repeat-picker">
    <select :value="choice" :aria-label="t('repeat.label')" @change="choose($event.target.value)">
      <option value="none">{{ t('repeat.none') }}</option>
      <option v-for="(p, name) in PRESETS" :key="name" :value="name">{{ t(`repeat.${name}`) }}</option>
      <option value="custom">{{ t('repeat.custom') }}</option>
    </select>
    <template v-if="modelValue && choice === 'custom'">
      <div class="repeat-every">
        <span>{{ t('repeat.every') }}</span>
        <input type="number" min="1" max="365" :value="rule.every" inputmode="numeric" @change="change({ every: Math.min(365, Math.max(1, Number($event.target.value) || 1)) })" />
        <select :value="rule.unit" @change="change({ unit: $event.target.value, weekdays: $event.target.value === 'week' ? rule.weekdays : undefined })">
          <option v-for="unit in ['day', 'week', 'month', 'year']" :key="unit" :value="unit">{{ t(`repeat.units.${unit}`) }}</option>
        </select>
      </div>
      <div v-if="rule.unit === 'week'" class="weekday-picker">
        <button v-for="(name, i) in weekdayNames()" :key="name" type="button" class="chip" :class="{ active: rule.weekdays?.includes(i + 1) }" :aria-pressed="rule.weekdays?.includes(i + 1)" @click="toggleDay(i + 1)">{{ name }}</button>
      </div>
    </template>
    <label v-if="modelValue" class="check-label small">
      <input type="checkbox" :checked="modelValue.from === 'done'" @change="change({ from: $event.target.checked ? 'done' : 'due' })" />
      {{ t('repeat.fromDone') }}
    </label>
  </div>
</template>
