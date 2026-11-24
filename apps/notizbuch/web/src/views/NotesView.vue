<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { t } from '../i18n.js';
import { useShortcut, wide } from '../util.js';
import { plainText } from '../lib/markdown.js';
import { areaLabel, areas, countLabels, createNote, filesOf, IN_LIST, inArea, purgeNote, store } from '../store/notes.js';
import AreaSwitch from '../kit/components/AreaSwitch.vue';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import NoteCard from '../components/NoteCard.vue';
import NoteMasonry from '../components/NoteMasonry.vue';
import NoteModal from '../components/NoteModal.vue';
import MoreMenu from '../components/MoreMenu.vue';
import SyncState from '../components/SyncState.vue';

// The notes, the archive or the trash (the route says which), with search and label filter.
// A note opens on top of the list on a computer, in its place on the phone.
const route = useRoute();
const router = useRouter();
const mode = route.matched[0].name; // notes | archive | trash
const listPath = route.matched[0].path;
const hasNote = computed(() => route.matched.length > 1);

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
// A label link (on a note, say) while the list is open
watch(() => route.query.label, (value) => {
  if (route.name === mode) label.value = String(value || '');
});

const searchInput = ref(null);
useShortcut('/', () => {
  if (hasNote.value) return false;
  searchInput.value?.focus();
});
useShortcut('n', () => {
  if (hasNote.value || mode !== 'notes') return false;
  write();
});

// The list's notes in the area shown
const all = computed(() => [...store.notes.values()].filter((n) => IN_LIST[mode](n) && inArea(n)));
// Another area: a label of the last one would show nothing
watch(areas.currentId, () => (label.value = ''));
// As chips above the notes on the phone; a computer has them in the sidebar (LabelNav)
const labels = computed(() => countLabels(all.value));

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

const title = computed(() => t(`nav.${mode}`));
const searchLabel = computed(() => t(`notes.search.${mode}`));
// Two columns on the phone, as many as fit on a computer
const columns = computed(() => (wide.value ? { minWidth: 230, gap: 14 } : { minWidth: 150, gap: 8 }));
const cardLink = (n) => ({ name: `${mode}-note`, params: { id: n.id } });
const menu = computed(() => [
  { to: '/archive', icon: 'archive', label: t('nav.archive') },
  { to: '/trash', icon: 'trash', label: t('nav.trash') },
  { to: '/settings', icon: 'gear', label: t('nav.settings') },
]);

// A new note opens right on top of the list, with the label that's filtered by (or the
// first label of the area shown, so it stays in it)
function write() {
  const start = label.value || areaLabel();
  const note = createNote(start ? { labels: [start] } : {});
  router.push({ name: 'notes-note', params: { id: note.id }, query: { new: '' } });
}

// Back to the list, with its search and label as they were when you came from it
function closeNote() {
  const previous = window.history.state?.back;
  if (previous && previous.split('?')[0] === listPath) router.back();
  else router.push(listPath);
}

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
  <div class="notes" :class="{ 'has-note': hasNote }">
    <div class="notes-list">
      <!-- The search is the header, like a notepad you look things up in. On the phone the
           archive and the trash have a title and a way back instead (there is no sidebar). -->
      <header v-if="mode === 'notes' || wide" class="top notes-top">
        <div class="search-box top-search">
          <Icon name="search" />
          <input ref="searchInput" v-model="q" type="search" :placeholder="searchLabel" :aria-label="searchLabel" />
          <kbd v-if="!q" class="desktop-only">/</kbd>
        </div>
        <div class="actions">
          <SyncState />
          <MoreMenu v-if="mode === 'notes'" class="phone-only" :items="menu" />
        </div>
      </header>
      <TopBar v-else :title="title" back="/" sidebar-page>
        <SyncState />
      </TopBar>

      <main class="wide">
        <p v-if="!store.ready" class="muted center">{{ t('note.loading') }}</p>

        <template v-else>
          <AreaSwitch v-if="!wide" class="page-areas" :areas="areas" />

          <div v-if="mode !== 'notes' && !wide && all.length" class="search-box">
            <Icon name="search" />
            <input ref="searchInput" v-model="q" type="search" :placeholder="searchLabel" :aria-label="searchLabel" />
          </div>

          <button v-if="mode === 'notes' && all.length" type="button" class="write-box desktop-only" @click="write">
            <span class="grow">{{ t('notes.write') }}</span><kbd>N</kbd><Icon name="edit" />
          </button>

          <div v-if="labels.length" class="chips phone-only" role="group" :aria-label="t('notes.labels')">
            <button class="chip" :class="{ active: !label }" @click="label = ''">{{ t('notes.allLabels') }}</button>
            <button v-for="[l, n] in labels" :key="l" class="chip" :class="{ active: label === l }" @click="label = label === l ? '' : l">
              {{ l }}<span class="chip-count">{{ n }}</span>
            </button>
          </div>

          <div v-if="mode === 'trash' && all.length" class="info trash-info">
            <Icon name="info" />
            <span class="grow">{{ t('notes.trashHint', { days: store.settings.trashDays }) }}</span>
            <button class="btn small danger" @click="emptyTrash">{{ t('notes.emptyTrash') }}</button>
          </div>

          <div v-if="!all.length" class="empty">
            <img src="/icon.svg" alt="" width="72" height="72" />
            <p>{{ mode === 'notes' ? t('notes.empty') : mode === 'archive' ? t('notes.archiveEmpty') : t('notes.trashEmpty') }}</p>
            <div v-if="mode === 'notes'" class="row-buttons">
              <button type="button" class="btn primary" @click="write"><Icon name="plus" />{{ t('notes.write') }}</button>
            </div>
          </div>

          <div v-else-if="!shown.length" class="empty">
            <p>{{ t('notes.noMatch') }}</p>
            <button class="btn" @click="reset">{{ t('notes.reset') }}</button>
          </div>

          <template v-else>
            <template v-if="pinned.length">
              <h2 class="section">{{ t('notes.pinned') }}</h2>
              <NoteMasonry :items="pinned" v-bind="columns" v-slot="{ item: n }">
                <NoteCard :note="n" :to="cardLink(n)" :selected="route.params.id === n.id" />
              </NoteMasonry>
              <h2 v-if="others.length" class="section">{{ t('notes.others') }}</h2>
            </template>
            <NoteMasonry :items="others" v-bind="columns" v-slot="{ item: n }">
              <NoteCard :note="n" :to="cardLink(n)" :selected="route.params.id === n.id" />
            </NoteMasonry>
          </template>
        </template>
      </main>

      <button v-if="mode === 'notes' && store.ready" type="button" class="fab phone-only" :aria-label="t('notes.write')" :title="t('notes.write')" @click="write"><Icon name="plus" /></button>
    </div>

    <RouterView v-slot="{ Component, route: inner }">
      <NoteModal v-if="Component" @close="closeNote">
        <component :is="Component" :key="inner.path" />
      </NoteModal>
    </RouterView>
  </div>
</template>
