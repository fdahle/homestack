<!-- Copied from kit/web/components/AreaEditor.vue by kit/sync.mjs. Change it there, not here. -->
<script setup>
import { computed, ref } from 'vue';
import { t } from '../i18n.js';
import Icon from './Icon.vue';

// The areas in the settings: a new one, and for each its name and what belongs to it (tap to
// add or take out). The first one picked is where new things go while the area is shown.
// areas: createAreas(…) (web/areas.js)
// choices: [{ value, name, cls? }] what an area can group (labels, lists)
// how: a line on what areas are for in this app; first(name): the line about the first one picked
const props = defineProps({
  areas: { type: Object, required: true },
  choices: { type: Array, required: true },
  how: String,
  first: Function,
});

const newName = ref('');
const nameOf = computed(() => new Map(props.choices.map((c) => [c.value, c.name])));

function create() {
  const name = newName.value.trim();
  if (!name) return;
  props.areas.add(name);
  newName.value = '';
}

function rename(area, event) {
  const name = event.target.value.trim().slice(0, 40);
  if (name && name !== area.name) props.areas.update(area.id, { name });
  else event.target.value = area.name;
}

const has = (area, value) => area.members.includes(value);
function toggle(area, value) {
  props.areas.update(area.id, { members: has(area, value) ? area.members.filter((m) => m !== value) : [...area.members, value] });
}

function remove(area) {
  if (confirm(t('areas.deleteConfirm', { name: area.name }))) props.areas.remove(area.id);
}

// The first member that still exists
const firstName = (area) => area.members.map((m) => nameOf.value.get(m)).find(Boolean);
</script>

<template>
  <section class="card form area-editor">
    <h2><Icon name="grid" />{{ t('areas.title') }}</h2>
    <p v-if="how" class="muted small">{{ how }}</p>

    <div v-for="area in areas.list.value" :key="area.id" class="area-item">
      <div class="area-head">
        <input :value="area.name" :aria-label="t('areas.name')" maxlength="40" @change="rename(area, $event)" @keydown.enter="$event.target.blur()" />
        <button type="button" class="icon-btn danger" :aria-label="t('areas.delete', { name: area.name })" :title="t('areas.delete', { name: area.name })" @click="remove(area)"><Icon name="trash" /></button>
      </div>
      <div class="area-members" role="group" :aria-label="area.name">
        <button
          v-for="c in choices" :key="c.value" type="button" class="chip" :class="[{ active: has(area, c.value) }, c.cls]"
          :aria-pressed="has(area, c.value)" @click="toggle(area, c.value)"
        >
          <i v-if="c.cls" class="dot"></i>{{ c.name }}
        </button>
        <p v-if="!choices.length" class="muted small">{{ t('areas.noChoices') }}</p>
      </div>
      <p v-if="first && firstName(area)" class="muted small">{{ first(firstName(area)) }}</p>
    </div>

    <form class="area-new" @submit.prevent="create">
      <input v-model="newName" :placeholder="t('areas.newName')" :aria-label="t('areas.newName')" maxlength="40" />
      <button class="btn" :disabled="!newName.trim()"><Icon name="plus" />{{ t('areas.add') }}</button>
    </form>
  </section>
</template>
