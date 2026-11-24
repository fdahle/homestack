<script setup>
import { t } from '../i18n.js';

// "Alle · Zuhause · Arbeit": which area the app shows (web/areas.js). In the sidebar on a
// computer, at the top of the pages on the phone. Wraps onto a second line rather than scroll.
// Nothing shows until there are areas (they're made in the settings, AreaEditor).
// areas: createAreas(…)
const props = defineProps({ areas: { type: Object, required: true } });
const pick = (id) => (props.areas.currentId.value = id);
const isOn = (id) => (id === 'all' ? !props.areas.current.value : props.areas.current.value?.id === id);
</script>

<template>
  <div v-if="areas.list.value.length" class="area-switch" role="group" :aria-label="t('areas.label')">
    <button type="button" :class="{ active: isOn('all') }" :aria-pressed="isOn('all')" @click="pick('all')">{{ t('areas.all') }}</button>
    <button v-for="a in areas.list.value" :key="a.id" type="button" :class="{ active: isOn(a.id) }" :aria-pressed="isOn(a.id)" @click="pick(a.id)">{{ a.name }}</button>
  </div>
</template>
