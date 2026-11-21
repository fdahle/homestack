<script setup lang="ts">
// The bar above every page: back, search, and who is looking. On a phone also the family's
// name and the way to the settings, which on a computer are in the sidebar.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t } from '../i18n';
import type { Person } from '../parser/types';
import { navigate } from '../ui/back';
import { displayName, lifespan } from '../ui/format';
import { bubble } from '../ui/tile';
import SIcon from './SIcon.vue';
import { caption, chooseViewer, familyTitle, getFamily, openPerson, relationWords, state, viewer } from './store';

const props = defineProps<{ back: boolean; backOnPhoneOnly: boolean }>();

/** Read inside every computed: a save, a language or someone else looking draws the bar again. */
const words = computed(() => (state.version, t()));
const title = computed(() => (state.version, familyTitle()));

// ---- who is looking: their bubble, or a blank person ----

const viewerSlot = ref<HTMLElement>();
const viewerPerson = computed(() => {
  void state.version;
  const me = viewer();
  return me ? getFamily().person(me) : undefined;
});
const viewerLabel = computed(() =>
  viewerPerson.value ? `${words.value.iAm}: ${displayName(viewerPerson.value)} — ${words.value.changeViewer}` : words.value.whoAreYou,
);
watch(
  [viewerPerson, viewerSlot],
  ([person, slot]) => {
    if (slot && person) slot.replaceChildren(bubble(person));
    else slot?.replaceChildren();
  },
  { flush: 'post' },
);

// ---- search ----

const searching = ref(false);
const query = ref('');
const hits = ref<Person[]>([]);
/** The hit Enter opens, moved with the arrow keys. */
const active = ref(0);
const resultsOpen = ref(false);
const input = ref<HTMLInputElement>();
const results = ref<HTMLUListElement>();

function closeResults(): void {
  resultsOpen.value = false;
  hits.value = [];
}

function closeSearch(): void {
  searching.value = false;
  query.value = '';
}

/** On a phone the field lives under the bar and is opened by the search icon. */
function toggleSearch(): void {
  if (searching.value) {
    closeResults();
    closeSearch();
  } else {
    searching.value = true;
    void nextTick(() => input.value?.focus());
  }
}

/**
 * The hits for what is typed, as a listbox the field points into: the focus stays in the
 * field, the arrow keys move the active hit, and a click or a tap on a hit opens it.
 */
function search(keep = false): void {
  hits.value = getFamily().search(query.value, { extra: relationWords });
  if (hits.value.length === 0) {
    closeResults();
    return;
  }
  resultsOpen.value = true;
  markActive(keep ? Math.min(active.value, hits.value.length - 1) : 0);
}

function markActive(index: number): void {
  active.value = (index + hits.value.length) % hits.value.length;
  void nextTick(() => results.value?.children[active.value]?.scrollIntoView({ block: 'nearest' }));
}

function open(person: Person): void {
  closeResults();
  closeSearch();
  input.value?.blur();
  openPerson(person);
}

function onKey(event: KeyboardEvent): void {
  const shown = resultsOpen.value && hits.value.length > 0;
  if (shown && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault();
    markActive(active.value + (event.key === 'ArrowDown' ? 1 : -1));
  }
  const hit = hits.value[active.value];
  if (event.key === 'Enter' && shown && hit) open(hit);
  if (event.key === 'Escape') {
    closeResults();
    closeSearch();
  }
}

const detail = (person: Person) => [caption(person), lifespan(person)].filter(Boolean).join(' · ');

// Another page: the search starts over. The same page again (a save, someone else's): the
// hits again, from the family as it is now.
watch(
  () => state.hash,
  () => {
    closeResults();
    closeSearch();
  },
);
watch(
  () => state.version,
  () => {
    if (resultsOpen.value) search(true);
  },
);

function outside(event: PointerEvent): void {
  const target = event.target as Element | null;
  if (target?.closest('.search') || target?.closest('.search-toggle')) return;
  closeResults();
  if (query.value === '') closeSearch();
}
onMounted(() => document.addEventListener('pointerdown', outside));
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside));
</script>

<template>
  <header class="app-bar" :class="{ 'is-searching': searching }">
    <a href="#/" class="btn btn-ghost brand">
      <span class="crest"><SIcon name="tree" /></span>
      <span class="family-title">{{ title }}</span>
    </a>

    <div class="app-actions">
      <button
        v-if="props.back"
        type="button"
        class="btn btn-ghost btn-circle"
        :class="{ 'phone-only': props.backOnPhoneOnly }"
        :title="words.back"
        :aria-label="words.back"
        @click="navigate('#/')"
      >
        <SIcon name="back" />
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-circle search-toggle"
        :aria-pressed="searching"
        :title="words.search"
        :aria-label="words.search"
        @click="toggleSearch"
      >
        <SIcon name="search" />
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-circle viewer-button"
        :title="viewerLabel"
        :aria-label="viewerLabel"
        @click="chooseViewer"
      >
        <span v-show="viewerPerson" ref="viewerSlot" class="viewer-bubble"></span>
        <SIcon v-if="!viewerPerson" name="person" />
      </button>
      <a href="#/settings" class="btn btn-ghost btn-circle phone-only" :title="words.menu" :aria-label="words.menu">
        <SIcon name="settings" />
      </a>
    </div>

    <div class="search" role="search">
      <input
        id="search"
        ref="input"
        v-model="query"
        type="search"
        autocomplete="off"
        spellcheck="false"
        :placeholder="words.searchPlaceholder"
        :aria-label="words.search"
        role="combobox"
        aria-controls="results"
        aria-autocomplete="list"
        :aria-expanded="resultsOpen"
        :aria-activedescendant="resultsOpen ? `result-${active}` : undefined"
        class="input search-input"
        @input="search()"
        @keydown="onKey"
      />
      <ul v-show="resultsOpen" id="results" ref="results" class="results menu" role="listbox">
        <li
          v-for="(person, index) in hits"
          :id="`result-${index}`"
          :key="person.id"
          role="option"
          :aria-selected="index === active"
          @click="open(person)"
        >
          <div class="result flex w-full items-baseline justify-between gap-3" :class="{ 'is-active': index === active }">
            <span>{{ displayName(person) }}</span>
            <small class="opacity-60 tabular-nums text-right">{{ detail(person) }}</small>
          </div>
        </li>
      </ul>
    </div>
  </header>
</template>
