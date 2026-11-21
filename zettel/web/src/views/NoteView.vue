<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { lang, t } from '../i18n.js';
import { relativeDay, showToast } from '../util.js';
import {
  addFiles, archiveNote, filesOf, isEmpty, pinNote, purgeNote, restoreNote, store, trashNote, updateNote,
} from '../store/notes.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import NoteEditor from '../components/NoteEditor.vue';
import LabelEditor from '../components/LabelEditor.vue';
import Attachments from '../components/Attachments.vue';

// One note, to read and write. What you type is kept as a draft and saved to the device a
// moment after you stop (and when you leave); the sync takes it from there.
const props = defineProps({ id: { type: String, required: true } });
const route = useRoute();
const router = useRouter();

const note = computed(() => store.notes.get(props.id));
const files = computed(() => filesOf(props.id));
const trashed = computed(() => Boolean(note.value?.deleted_at));
const listPath = computed(() => route.matched[0].path);

// --- the draft ---

const draft = reactive({ title: note.value?.title ?? '', body: note.value?.body ?? '' });
let timer = null;

function changed() {
  clearTimeout(timer);
  timer = setTimeout(flush, 400);
}

function flush() {
  clearTimeout(timer);
  timer = null;
  const n = note.value;
  if (!n || n.deleted_at) return;
  const patch = {};
  if (draft.title !== n.title) patch.title = draft.title;
  if (draft.body !== n.body) patch.body = draft.body;
  if (Object.keys(patch).length) updateNote(n.id, patch);
}

// Changes from elsewhere (another device, the notes arriving after a fresh start) show,
// unless you're typing right now: then yours win, and the sync keeps both if they clash.
watch(() => note.value?.title, (value) => {
  if (value !== undefined && !timer) draft.title = value;
});
watch(() => note.value?.body, (value) => {
  if (value !== undefined && !timer) draft.body = value;
});

function setTitle(event) {
  draft.title = event.target.value;
  changed();
}
function setBody(value) {
  draft.body = value;
  changed();
}

const onHide = () => document.visibilityState === 'hidden' && flush();
onMounted(() => document.addEventListener('visibilitychange', onHide));
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onHide);
  flush();
  // An empty note isn't worth keeping (a "New" tapped by mistake)
  const n = note.value;
  if (n && !n.deleted_at && isEmpty(n)) purgeNote(n.id);
});

// A new note starts in its title
const titleInput = ref(null);
onMounted(async () => {
  if (route.query.new === undefined) return;
  await nextTick();
  titleInput.value?.focus();
  router.replace({ query: {} });
});

// --- actions ---

// Back to the list, with its search and label as they were when you came from it
function back() {
  const previous = window.history.state?.back;
  if (previous && previous.split('?')[0] === listPath.value) router.back();
  else router.push(listPath.value);
}

function togglePin() {
  pinNote(props.id, !note.value.pinned);
}

function toggleArchive() {
  flush();
  const archived = !note.value.archived_at;
  archiveNote(props.id, archived);
  showToast(t(archived ? 'note.archived' : 'note.unarchived'), { label: t('note.undo'), run: () => archiveNote(props.id, !archived) });
  back();
}

function toTrash() {
  flush();
  const id = props.id;
  // An empty note simply goes
  if (isEmpty(note.value)) {
    purgeNote(id);
    return back();
  }
  trashNote(id);
  showToast(t('note.trashed'), { label: t('note.undo'), run: () => restoreNote(id) });
  back();
}

function restore() {
  restoreNote(props.id);
  showToast(t('note.restored'));
}

function purge() {
  if (!confirm(t('note.purgeConfirm'))) return;
  purgeNote(props.id);
  back();
}

function setLabels(labels) {
  updateNote(props.id, { labels });
}

// --- files ---

const fileInput = ref(null);
const dragging = ref(false);

function attach(list) {
  const picked = [...list];
  if (picked.length && !trashed.value) addFiles(props.id, picked);
}
function onPick(event) {
  attach(event.target.files);
  event.target.value = '';
}
function onDrop(event) {
  dragging.value = false;
  attach(event.dataTransfer?.files || []);
}
const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');

// --- dates ---

const edited = computed(() => {
  const at = note.value?.updated_at;
  if (!at) return '';
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(lang.value, { hour: '2-digit', minute: '2-digit' });
  return t('note.edited', { when: today ? time : `${relativeDay(at)}, ${time}` });
});
const created = computed(() => (note.value ? new Date(note.value.created_at).toLocaleDateString(lang.value, { day: 'numeric', month: 'long', year: 'numeric' }) : ''));
</script>

<template>
  <TopBar :title="''" :back="listPath">
    <template v-if="note && !trashed">
      <button class="icon-btn" :class="{ on: note.pinned }" :aria-label="note.pinned ? t('note.unpin') : t('note.pin')" :aria-pressed="note.pinned" :title="note.pinned ? t('note.unpin') : t('note.pin')" @click="togglePin"><Icon name="pin" /></button>
      <button class="icon-btn" :aria-label="t('note.attach')" :title="t('note.attach')" @click="fileInput.click()"><Icon name="paperclip" /></button>
      <button class="icon-btn" :aria-label="note.archived_at ? t('note.unarchive') : t('note.archive')" :title="note.archived_at ? t('note.unarchive') : t('note.archive')" @click="toggleArchive"><Icon :name="note.archived_at ? 'unarchive' : 'archive'" /></button>
      <button class="icon-btn" :aria-label="t('note.trash')" :title="t('note.trash')" @click="toTrash"><Icon name="trash" /></button>
    </template>
    <template v-else-if="note">
      <button class="btn small" @click="restore"><Icon name="restore" />{{ t('note.restore') }}</button>
      <button class="icon-btn danger" :aria-label="t('note.purge')" :title="t('note.purge')" @click="purge"><Icon name="trash" /></button>
    </template>
  </TopBar>

  <main
    class="note-page"
    :class="{ dragging }"
    @dragover.prevent="dragging = hasFiles($event)"
    @dragleave.self="dragging = false"
    @drop.prevent="onDrop"
  >
    <p v-if="!store.ready" class="muted center">{{ t('note.loading') }}</p>
    <div v-else-if="!note" class="empty">
      <p>{{ t('note.notFound') }}</p>
      <RouterLink :to="listPath" class="btn">{{ t('back') }}</RouterLink>
    </div>

    <template v-else>
      <p v-if="trashed" class="info warn-box"><Icon name="trash" />{{ t('note.inTrash') }}</p>
      <p v-else-if="note.archived_at" class="tag archived-tag"><Icon name="archive" />{{ t('note.inArchive') }}</p>

      <input
        ref="titleInput"
        class="note-title"
        :value="draft.title"
        :placeholder="t('note.title')"
        :aria-label="t('note.title')"
        :readonly="trashed"
        maxlength="300"
        enterkeyhint="next"
        @input="setTitle"
        @keydown.enter.prevent="$refs.editor?.focus('start')"
      />

      <Attachments :files="files" :readonly="trashed" />

      <NoteEditor ref="editor" :key="note.id" :model-value="draft.body" :editable="!trashed" @update:model-value="setBody" @files="attach" />

      <LabelEditor :model-value="note.labels" :disabled="trashed" @update:model-value="setLabels" />

      <p class="note-dates muted small">
        <span>{{ edited }}</span>
        <span>{{ t('note.created', { date: created }) }}</span>
      </p>

      <input ref="fileInput" type="file" multiple hidden @change="onPick" />
      <div v-if="dragging" class="drop-hint"><Icon name="paperclip" />{{ t('files.dropHere') }}</div>
    </template>
  </main>
</template>
