<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { t } from '../i18n.js';
import { useShortcut } from '../util.js';
import { plainText } from '../lib/markdown.js';
import { filesOf, purgeNote, store } from '../store/notes.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import SplitView from '../kit/components/SplitView.vue';
import NoteCard from '../components/NoteCard.vue';
import SyncState from '../components/SyncState.vue';

// The notes, the archive or the trash (the route says which), with search and label filter.
// A note opens beside the list on a computer, in its place on the phone.
const route = useRoute();
const router = useRouter();
const mode = route.matched[0].name; // notes | archive | trash

const q = ref(String(route.query.q || ''));
const label = ref(String(route.query.label || ''));

// Filters live in the address, so "back" from a note returns to the same view
watch([q, label], () => {
  if (route.name !== mode) return;
  const query = {};
  if (q.value.trim()) query.q = q.value.trim();
  if (label.value) query.label = label.value;
  router.replace({ query });
});
// A label picked in the sidebar while the list is open
watch(() => route.query.label, (value) => {
  if (route.name === mode) label.value = String(value || '');
});

const searchInput = ref(null);
useShortcut('/', () => searchInput.value?.focus());
useShortcut('n', () => router.push(newNote.value));

const IN_MODE = {
  notes: (n) => !n.deleted_at && !n.archived_at,
  archive: (n) => !n.deleted_at && n.archived_at,
  trash: (n) => n.deleted_at,
};
const all = computed(() => [...store.notes.values()].filter(IN_MODE[mode]));

const labels = computed(() => {
  const counts = new Map();
  for (const n of all.value) for (const l of n.labels) counts.set(l, (counts.get(l) || 0) + 1);
  return [...counts].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base', numeric: true }));
});

// Every word has to be somewhere: title, text, labels or a file name
const haystack = (n) => [n.title, plainText(n.body), ...n.labels, ...filesOf(n.id).map((f) => f.name)].join('\n').toLowerCase();
const shown = computed(() => {
  const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
  const order = mode === 'trash' ? (a, b) => b.deleted_at.localeCompare(a.deleted_at) : (a, b) => b.updated_at.localeCompare(a.updated_at);
  return all.value
    .filter((n) => !label.value || n.labels.includes(label.value))
    .filter((n) => {
      if (!words.length) return true;
      const text = haystack(n);
      return words.every((w) => text.includes(w));
    })
    .sort(order);
});
const pinned = computed(() => (mode === 'notes' ? shown.value.filter((n) => n.pinned) : []));
const others = computed(() => (mode === 'notes' ? shown.value.filter((n) => !n.pinned) : shown.value));

const title = computed(() => (mode === 'notes' ? t('notes.title') : t(`nav.${mode}`)));
const newNote = computed(() => (label.value ? { path: '/new', query: { label: label.value } } : '/new'));
const cardLink = (n) => ({ name: `${mode}-note`, params: { id: n.id } });

function reset() {
  q.value = '';
  label.value = '';
}

function emptyTrash() {
  if (!confirm(t('notes.emptyTrashConfirm', { n: all.value.length }))) return;
  for (const n of all.value) purgeNote(n.id);
  if (route.name !== mode) router.replace({ name: mode });
}
</script>

<template>
  <SplitView>
    <TopBar :title="title">
      <SyncState />
      <template v-if="mode === 'notes'">
        <RouterLink to="/trash" class="icon-btn phone-only" :aria-label="t('nav.trash')"><Icon name="trash" /></RouterLink>
        <RouterLink to="/settings" class="icon-btn phone-only" :aria-label="t('nav.settings')"><Icon name="gear" /></RouterLink>
      </template>
    </TopBar>
    <main class="wide">
      <p v-if="!store.ready" class="muted center">{{ t('note.loading') }}</p>

      <template v-else>
        <div v-if="all.length" class="search-box">
          <Icon name="search" />
          <input ref="searchInput" v-model="q" type="search" :placeholder="t('notes.search')" :aria-label="t('notes.search')" />
          <kbd class="desktop-only">/</kbd>
        </div>

        <div v-if="labels.length" class="chips" :class="{ 'phone-only': mode === 'notes' }" role="group" :aria-label="t('notes.labels')">
          <button class="chip" :class="{ active: !label }" @click="label = ''">{{ t('notes.allLabels') }}</button>
          <button v-for="[l, n] in labels" :key="l" class="chip" :class="{ active: label === l }" @click="label = label === l ? '' : l">
            {{ l }}<span class="chip-count">{{ n }}</span>
          </button>
        </div>
        <div v-if="mode === 'notes' && label" class="filter-line desktop-only">
          <span class="chip active"><Icon name="tag" />{{ label }}</span>
          <button class="link-btn small" @click="label = ''"><Icon name="close" />{{ t('notes.reset') }}</button>
        </div>

        <RouterLink v-if="mode === 'notes' && all.length" :to="newNote" class="write-box desktop-only">
          <Icon name="edit" /><span class="grow">{{ t('notes.write') }}</span><kbd>N</kbd>
        </RouterLink>

        <div v-if="mode === 'trash' && all.length" class="info trash-info">
          <Icon name="info" />
          <span class="grow">{{ t('notes.trashHint', { days: store.settings.trashDays }) }}</span>
          <button class="btn small danger" @click="emptyTrash">{{ t('notes.emptyTrash') }}</button>
        </div>

        <div v-if="!all.length" class="empty">
          <img src="/icon.svg" alt="" width="72" height="72" />
          <p>{{ mode === 'notes' ? t('notes.empty') : mode === 'archive' ? t('notes.archiveEmpty') : t('notes.trashEmpty') }}</p>
          <div v-if="mode === 'notes'" class="row-buttons">
            <RouterLink to="/new" class="btn primary"><Icon name="plus" />{{ t('notes.write') }}</RouterLink>
          </div>
        </div>

        <div v-else-if="!shown.length" class="empty">
          <p>{{ t('notes.noMatch') }}</p>
          <button class="btn" @click="reset">{{ t('notes.reset') }}</button>
        </div>

        <template v-else>
          <template v-if="pinned.length">
            <h2 class="section">{{ t('notes.pinned') }}</h2>
            <div class="note-grid">
              <NoteCard v-for="n in pinned" :key="n.id" :note="n" :to="cardLink(n)" :selected="route.params.id === n.id" />
            </div>
            <h2 v-if="others.length" class="section">{{ t('notes.others') }}</h2>
          </template>
          <div class="note-grid">
            <NoteCard v-for="n in others" :key="n.id" :note="n" :to="cardLink(n)" :selected="route.params.id === n.id" />
          </div>
        </template>
      </template>
    </main>
  </SplitView>
</template>
