<script setup>
import { computed } from 'vue';
import { t } from '../i18n.js';
import { compareText, COUNTRY_CODES, countryName } from '../util.js';
import Icon from '../kit/components/Icon.vue';

// The countries of a title entered by hand: chips to take one away, a menu to add one.
// v-model: a list of codes ('US', 'DE')
const model = defineModel({ type: Array, default: () => [] });

const choices = computed(() => COUNTRY_CODES.filter((c) => !model.value.includes(c))
  .map((code) => ({ code, name: countryName(code) }))
  .sort((a, b) => compareText(a.name, b.name)));

function add(event) {
  const code = event.target.value;
  event.target.value = '';
  if (code) model.value = [...model.value, code];
}
const remove = (code) => (model.value = model.value.filter((c) => c !== code));
</script>

<template>
  <div class="country-picker">
    <button v-for="c in model" :key="c" type="button" class="chip active" :aria-label="t('title.removeCountry', { country: countryName(c) })" @click="remove(c)">
      {{ countryName(c) }}<Icon name="close" />
    </button>
    <select :aria-label="t('title.addCountry')" @change="add">
      <option value="">{{ t('title.addCountry') }}</option>
      <option v-for="c in choices" :key="c.code" :value="c.code">{{ c.name }}</option>
    </select>
  </div>
</template>

<style scoped>
.country-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
}
.country-picker select {
  width: auto;
  flex: 1 1 10rem;
}
</style>
