<script setup>
// Picks friends for an event: chips for the chosen ones, a search field, and a way to add someone new.
import { computed, onMounted, ref } from 'vue';
import { api, loadFriends, refreshFriends } from '../api.js';
import { t } from '../i18n.js';
import { errorText, showToast } from '../util.js';
import Avatar from './Avatar.vue';
import Icon from './Icon.vue';

const model = defineModel({ type: Array, default: () => [] });
const friends = ref([]);
const query = ref('');
const focused = ref(false);

onMounted(async () => {
  friends.value = await loadFriends();
});

const byId = computed(() => new Map(friends.value.map((f) => [f.id, f])));
const chosen = computed(() => model.value.map((id) => byId.value.get(id)).filter(Boolean));

const norm = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const matches = computed(() => {
  const q = norm(query.value.trim());
  if (!q && !focused.value) return [];
  return friends.value
    .filter((f) => !model.value.includes(f.id) && (!f.archived || q))
    .filter((f) => !q || norm(f.name).includes(q) || norm(f.nickname).includes(q))
    .slice(0, 6);
});
const canCreate = computed(() => query.value.trim().length >= 2 && !friends.value.some((f) => norm(f.name) === norm(query.value.trim())));

function add(friend) {
  model.value = [...model.value, friend.id];
  query.value = '';
}

function remove(id) {
  model.value = model.value.filter((x) => x !== id);
}

async function create() {
  try {
    const friend = await api('/friends', { method: 'POST', body: { name: query.value.trim() } });
    refreshFriends();
    friends.value = await loadFriends();
    add(friend);
    showToast(t('picker.created', { name: friend.name }));
  } catch (err) {
    showToast(errorText(err));
  }
}

function onEnter() {
  if (matches.value.length) add(matches.value[0]);
  else if (canCreate.value) create();
}

// Leaving the field closes the list, but a tap on the list must land first
const blur = () => setTimeout(() => (focused.value = false), 150);
</script>

<template>
  <div class="picker">
    <div class="picker-chips">
      <span v-for="f in chosen" :key="f.id" class="person-chip">
        <Avatar :friend="f" :size="24" />
        {{ f.name }}
        <button type="button" class="chip-x" :aria-label="t('picker.remove', { name: f.name })" @click="remove(f.id)"><Icon name="close" /></button>
      </span>
      <input
        v-model="query"
        :placeholder="chosen.length ? t('picker.more') : t('picker.placeholder')"
        @focus="focused = true"
        @blur="blur"
        @keydown.enter.prevent="onEnter"
        @keydown.backspace="!query && model.length && remove(model.at(-1))"
      />
    </div>
    <ul v-if="matches.length || canCreate" class="picker-list">
      <li v-for="f in matches" :key="f.id">
        <button type="button" @mousedown.prevent @click="add(f)"><Avatar :friend="f" :size="28" /> {{ f.name }}<small v-if="f.nickname" class="muted">{{ f.nickname }}</small></button>
      </li>
      <li v-if="canCreate">
        <button type="button" @mousedown.prevent @click="create"><Icon name="userPlus" /> {{ t('picker.create', { name: query.trim() }) }}</button>
      </li>
    </ul>
  </div>
</template>
