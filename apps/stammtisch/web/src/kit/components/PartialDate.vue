<!-- Copied from kit/web/components/PartialDate.vue by kit/sync.mjs. Change it there, not here. -->
<script setup>
// A date you may only half remember. Birthday: day and month, year optional ('--MM-DD' or 'YYYY-MM-DD').
// Otherwise ("met on"): a year, month and day optional ('YYYY', 'YYYY-MM' or 'YYYY-MM-DD').
import { computed, ref, watch } from 'vue';
import { lang, t } from '../i18n.js';

const props = defineProps({ modelValue: { type: String, default: '' }, birthday: Boolean });
const emit = defineEmits(['update:modelValue']);

const day = ref('');
const month = ref('');
const year = ref('');

watch(() => props.modelValue, (value) => {
  const [y = '', m = '', d = ''] = props.birthday
    ? (/^(\d{4}|-)-(\d{2})-(\d{2})$/.exec(value || '') || []).slice(1)
    : String(value || '').split('-');
  year.value = y === '-' ? '' : y;
  month.value = m ? String(Number(m)) : '';
  day.value = d ? String(Number(d)) : '';
}, { immediate: true });

const months = computed(() =>
  Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(lang.value, { month: 'long' }).format(new Date(2000, i, 1))));

const pad = (n) => String(n).padStart(2, '0');

function update() {
  const y = /^\d{4}$/.test(year.value) ? year.value : '';
  const m = Number(month.value);
  const d = Number(day.value);
  let value = '';
  if (props.birthday) {
    if (m && d >= 1 && d <= 31) value = `${y || '-'}-${pad(m)}-${pad(d)}`;
  } else if (y) {
    value = m ? (d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : `${y}-${pad(m)}`) : y;
  }
  if (value !== (props.modelValue || '')) emit('update:modelValue', value);
}
</script>

<template>
  <div class="partial-date">
    <input v-model="day" type="number" inputmode="numeric" min="1" max="31" :placeholder="t('date.day')" :aria-label="t('date.day')" @change="update" />
    <select v-model="month" :aria-label="t('date.month')" @change="update">
      <option value="">{{ t('date.month') }}</option>
      <option v-for="(name, i) in months" :key="i" :value="String(i + 1)">{{ name }}</option>
    </select>
    <input v-model="year" type="number" inputmode="numeric" min="1900" max="2100" :placeholder="birthday ? t('date.yearOptional') : t('date.year')" :aria-label="t('date.year')" @change="update" />
  </div>
</template>
