<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { t } from '../i18n.js';
import {
  bookChange, COVER_SIZE, coverPhoto, errorText, formatIsbn, formatNumber, languageName, progressOf,
  seriesText, showToast, STATUS_ICONS, STATUSES,
} from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import BookCover from '../components/BookCover.vue';
import StarRating from '../kit/components/StarRating.vue';
import PartialDate from '../kit/components/PartialDate.vue';

const props = defineProps({ id: String });
const router = useRouter();
const book = ref(null);
const calibreWebUrl = ref(null);
const error = ref('');
const saveState = ref(''); // '', 'saving', 'saved'
const busy = ref(false);
const showDescription = ref(false);

// Your entries, as the form shows them
const form = ref({});
const fromBook = (b) => ({
  status: b.status, rating: b.rating, startedOn: b.started_on || '', finishedOn: b.finished_on || '', notes: b.notes || '',
  currentPage: b.current_page ?? '', pages: b.pages ?? '',
});

function setBook(b, { changed = true } = {}) {
  book.value = b;
  form.value = fromBook(b);
  if (changed) bookChange.value = { id: b.id, book: b };
}

onMounted(async () => {
  try {
    const data = await api(`/books/${props.id}`);
    setBook(data.book, { changed: false });
    calibreWebUrl.value = data.calibreWebUrl;
  } catch (err) {
    error.value = errorText(err);
  }
});

let savedTimer = null;
async function save(patch) {
  saveState.value = 'saving';
  try {
    const { book: b } = await api(`/books/${book.value.id}`, { method: 'PATCH', body: patch });
    // Keep notes being typed; take everything else from the server (it may fill in dates)
    const notes = form.value.notes;
    setBook(b);
    if (!('notes' in patch)) form.value.notes = notes;
    saveState.value = 'saved';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (saveState.value = ''), 1500);
  } catch (err) {
    saveState.value = '';
    form.value = { ...fromBook(book.value), notes: form.value.notes };
    showToast(errorText(err));
  }
}

const setStatus = (status) => status !== form.value.status && save({ status });
const setRating = (rating) => save({ rating });
const setDate = (key, value) => save({ [key]: value || null });

// --- where you are ---

const progress = computed(() => progressOf(book.value));
function savePage() {
  const page = form.value.currentPage === '' ? null : Number(form.value.currentPage);
  if (page !== book.value.current_page) save({ currentPage: page });
}
function savePages() {
  const pages = form.value.pages === '' ? null : Number(form.value.pages);
  if (pages !== book.value.pages) save({ pages });
}
function stepPage(delta) {
  const next = Math.max(0, Math.min(book.value.pages || Infinity, (Number(form.value.currentPage) || 0) + delta));
  form.value.currentPage = next;
  savePage();
}

// Notes save a moment after you stop typing, and when you leave the field
let notesTimer = null;
function notesInput() {
  clearTimeout(notesTimer);
  notesTimer = setTimeout(saveNotes, 1200);
}
function saveNotes() {
  clearTimeout(notesTimer);
  if (book.value && form.value.notes !== (book.value.notes || '')) save({ notes: form.value.notes });
}
onBeforeUnmount(saveNotes);

const showStarted = computed(() => form.value.status !== 'want' || form.value.startedOn);
const showFinished = computed(() => ['read', 'dropped'].includes(form.value.status) || form.value.finishedOn);

const facts = computed(() => {
  const b = book.value;
  if (!b) return [];
  return [
    b.series && [t('book.series'), seriesText(b)],
    b.year && [t('book.published'), String(b.year)],
    b.publisher && [t('book.publisher'), b.publisher],
    b.pages && [t('book.pages'), formatNumber(b.pages)],
    b.isbns.length && [t('book.isbn'), b.isbns.map(formatIsbn).join(', ')],
    b.language && [t('book.language'), languageName(b.language)],
    b.tags.length && [t('book.tags'), b.tags.join(', ')],
  ].filter(Boolean);
});

const links = computed(() => {
  const b = book.value;
  if (!b) return [];
  return [
    b.in_calibre && calibreWebUrl.value && b.calibre_id && { href: `${calibreWebUrl.value}/book/${b.calibre_id}`, label: t('book.openCalibreWeb'), icon: 'tablet' },
    b.ol_work && { href: `https://openlibrary.org/works/${b.ol_work}`, label: t('book.onOpenLibrary'), icon: 'external' },
    !b.ol_work && b.ol_edition && { href: `https://openlibrary.org/books/${b.ol_edition}`, label: t('book.onOpenLibrary'), icon: 'external' },
    b.google_id && { href: `https://books.google.com/books?id=${encodeURIComponent(b.google_id)}`, label: t('book.onGoogle'), icon: 'external' },
  ].filter(Boolean);
});

const canRefresh = computed(() => book.value && !book.value.in_calibre && (book.value.ol_work || book.value.ol_edition || book.value.google_id));

// --- cover ---

const fileInput = ref(null);

async function uploadCover(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  busy.value = true;
  try {
    const blob = await coverPhoto(file, COVER_SIZE);
    setBook((await api(`/books/${book.value.id}/cover`, { method: 'PUT', raw: blob })).book);
  } catch (err) {
    showToast(errorText(err));
  } finally {
    busy.value = false;
  }
}

async function removePhoto() {
  busy.value = true;
  try {
    setBook((await api(`/books/${book.value.id}/cover`, { method: 'DELETE' })).book);
  } catch (err) {
    showToast(errorText(err));
  } finally {
    busy.value = false;
  }
}

// --- reload, edit, delete ---

async function refresh() {
  busy.value = true;
  try {
    const notes = form.value.notes;
    setBook((await api(`/books/${book.value.id}/refresh`, { method: 'POST' })).book);
    form.value.notes = notes;
    showToast(t('book.refreshed'));
  } catch (err) {
    showToast(errorText(err));
  } finally {
    busy.value = false;
  }
}

const LANGUAGES = ['de', 'en', 'fr', 'es', 'it', 'nl', 'sv', 'da', 'no', 'pl', 'pt', 'ru', 'ja'];
const editing = ref(null);
function startEdit() {
  const b = book.value;
  editing.value = {
    title: b.title, subtitle: b.subtitle || '', authors: b.authors.join(', '), series: b.series || '', seriesIndex: b.series_index ?? '',
    year: b.year ?? '', pages: b.pages ?? '', publisher: b.publisher || '', isbns: b.isbns.join(', '), language: b.language || '', description: b.description || '',
  };
}
const languageChoices = computed(() => [...new Set([...LANGUAGES, book.value?.language].filter(Boolean))]);
async function saveEdit() {
  await save({ ...editing.value, language: editing.value.language || null });
  if (saveState.value !== '') editing.value = null;
}

async function remove() {
  const key = book.value.in_calibre ? 'book.deleteConfirmCalibre' : 'book.deleteConfirm';
  if (!confirm(t(key, { title: book.value.title }))) return;
  try {
    await api(`/books/${book.value.id}`, { method: 'DELETE' });
    bookChange.value = { id: book.value.id, deleted: true };
    showToast(t('book.deleted'));
    router.replace('/');
  } catch (err) {
    showToast(errorText(err));
  }
}
</script>

<template>
  <TopBar :title="book?.title || ''" back="/">
    <template v-if="book">
      <button v-if="canRefresh" class="icon-btn" :disabled="busy" :aria-label="t('book.refresh')" :title="t('book.refresh')" @click="refresh"><Icon name="refresh" /></button>
      <button class="icon-btn" :aria-label="t('book.edit')" :title="t('book.edit')" @click="startEdit"><Icon name="edit" /></button>
      <button class="icon-btn danger" :aria-label="t('delete')" :title="t('delete')" @click="remove"><Icon name="trash" /></button>
    </template>
  </TopBar>
  <main>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="!book" class="muted center">…</p>

    <template v-else>
      <section class="hero">
        <div class="hero-cover">
          <BookCover :book="book" eager />
          <div class="cover-actions">
            <button class="link-btn small" :disabled="busy" @click="fileInput.click()"><Icon name="camera" />{{ t('book.ownCover') }}</button>
            <button v-if="book.cover_source === 'photo'" class="link-btn small" :disabled="busy" @click="removePhoto">{{ book.cover_url || book.in_calibre ? t('book.originalCover') : t('book.removeCover') }}</button>
          </div>
          <input ref="fileInput" type="file" accept="image/*" hidden @change="uploadCover" />
        </div>
        <div class="hero-body">
          <h2>{{ book.title }}</h2>
          <p v-if="book.subtitle" class="subtitle">{{ book.subtitle }}</p>
          <p v-if="book.authors.length" class="authors">
            <template v-for="(a, i) in book.authors" :key="a"><RouterLink :to="{ path: '/', query: { author: a } }">{{ a }}</RouterLink>{{ i < book.authors.length - 1 ? ', ' : '' }}</template>
          </p>
          <p v-if="book.series" class="series-line"><RouterLink :to="{ path: '/', query: { q: book.series, sort: 'author' } }">{{ seriesText(book) }}</RouterLink></p>
          <p class="meta">
            <span v-if="book.year">{{ book.year }}</span>
            <span v-if="book.pages">{{ t('book.pagesN', { n: formatNumber(book.pages) }) }}</span>
            <span v-if="book.language && book.language !== 'de'">{{ languageName(book.language) }}</span>
          </p>
          <div v-if="book.in_calibre || book.calibre_id" class="tags">
            <span v-if="book.in_calibre" class="tag ebook"><Icon name="tablet" />{{ t('book.ebook') }}<template v-if="book.formats.length"> · {{ book.formats.join(', ') }}</template></span>
            <span v-else class="tag gone">{{ t('book.goneFromCalibre') }}</span>
          </div>
        </div>
      </section>

      <form v-if="editing" class="card form" @submit.prevent="saveEdit">
        <h2>{{ t('book.edit') }}</h2>
        <p v-if="book.in_calibre" class="info warn-box edit-note">{{ t('book.editCalibre') }}</p>
        <label><span>{{ t('book.titleField') }}</span><input v-model="editing.title" required maxlength="300" /></label>
        <label><span>{{ t('book.subtitle') }}</span><input v-model="editing.subtitle" maxlength="300" /></label>
        <label><span>{{ t('library.author') }}</span><input v-model="editing.authors" :placeholder="t('book.commaHint')" /></label>
        <div class="two">
          <label><span>{{ t('book.series') }}</span><input v-model="editing.series" maxlength="200" /></label>
          <label><span>{{ t('book.seriesIndex') }}</span><input v-model="editing.seriesIndex" inputmode="decimal" /></label>
        </div>
        <div class="two">
          <label><span>{{ t('book.year') }}</span><input v-model="editing.year" type="number" inputmode="numeric" /></label>
          <label><span>{{ t('book.pages') }}</span><input v-model="editing.pages" type="number" inputmode="numeric" min="1" /></label>
        </div>
        <label><span>{{ t('book.publisher') }}</span><input v-model="editing.publisher" maxlength="200" /></label>
        <div class="two">
          <label><span>{{ t('book.isbn') }}</span><input v-model="editing.isbns" :placeholder="t('book.commaHint')" /></label>
          <label>
            <span>{{ t('book.language') }}</span>
            <select v-model="editing.language">
              <option value="">{{ t('book.unknownLanguage') }}</option>
              <option v-for="l in languageChoices" :key="l" :value="l">{{ languageName(l) }}</option>
            </select>
          </label>
        </div>
        <label><span>{{ t('book.description') }}</span><textarea v-model="editing.description" rows="5"></textarea></label>
        <div class="row-buttons">
          <button class="btn primary">{{ t('save') }}</button>
          <button type="button" class="btn subtle" @click="editing = null">{{ t('cancel') }}</button>
        </div>
      </form>

      <section class="card form">
        <h2>{{ t('book.yourBook') }} <small class="save-state" :class="saveState" aria-live="polite">{{ saveState === 'saved' ? t('saved') : '' }}</small></h2>
        <div class="status-picker" role="radiogroup" :aria-label="t('library.status')">
          <button
            v-for="s in STATUSES" :key="s" type="button" role="radio" :aria-checked="form.status === s"
            :class="[`st-${s}`, { active: form.status === s }]" @click="setStatus(s)"
          >
            <Icon :name="STATUS_ICONS[s]" /><span>{{ t(`status.${s}`) }}</span>
          </button>
        </div>

        <div v-if="form.status === 'reading'" class="reading-progress st-reading">
          <span class="field-label">{{ t('book.progress') }}</span>
          <div class="page-row">
            <button type="button" class="icon-btn" aria-label="−10" title="−10" @click="stepPage(-10)"><Icon name="minus" /></button>
            <input v-model="form.currentPage" type="number" inputmode="numeric" min="0" :max="book.pages || undefined" :placeholder="t('book.page')" :aria-label="t('book.page')" @change="savePage" />
            <button type="button" class="icon-btn" aria-label="+10" title="+10" @click="stepPage(10)"><Icon name="plus" /></button>
            <span class="muted">{{ t('book.of') }}</span>
            <input v-model="form.pages" type="number" inputmode="numeric" min="1" :placeholder="t('book.pages')" :aria-label="t('book.pages')" @change="savePages" />
          </div>
          <div v-if="progress !== null" class="progress-line">
            <div class="progress" :style="{ '--p': progress }"><span></span></div>
            <span class="percent">{{ progress }} %</span>
          </div>
          <p v-else class="muted small">{{ t('book.pagesUnknown') }}</p>
        </div>

        <div class="rating-row">
          <span class="field-label">{{ t('rating.label') }}</span>
          <StarRating v-model="form.rating" @update:model-value="setRating" />
        </div>

        <div v-if="showStarted" class="date-field">
          <span class="field-label">{{ t('book.started') }}</span>
          <PartialDate :model-value="form.startedOn" @update:model-value="setDate('startedOn', $event)" />
        </div>
        <div v-if="showFinished" class="date-field">
          <span class="field-label">{{ form.status === 'dropped' ? t('book.dropped') : t('book.finished') }}</span>
          <PartialDate :model-value="form.finishedOn" @update:model-value="setDate('finishedOn', $event)" />
        </div>

        <label>
          <span>{{ t('book.notes') }}</span>
          <textarea v-model="form.notes" rows="4" :placeholder="t('book.notesHint')" @input="notesInput" @blur="saveNotes"></textarea>
        </label>
      </section>

      <section v-if="facts.length || book.description || links.length" class="card">
        <dl v-if="facts.length" class="facts">
          <template v-for="[label, value] in facts" :key="label">
            <dt>{{ label }}</dt>
            <dd>{{ value }}</dd>
          </template>
        </dl>
        <template v-if="book.description">
          <p class="summary" :class="{ clamped: !showDescription }">{{ book.description }}</p>
          <button v-if="book.description.length > 260" class="link-btn small" @click="showDescription = !showDescription">{{ showDescription ? t('less') : t('more') }}</button>
        </template>
        <p v-for="l in links" :key="l.href" class="source">
          <a :href="l.href" target="_blank" rel="noopener noreferrer"><Icon :name="l.icon" />{{ l.label }}</a>
        </p>
      </section>
    </template>
  </main>
</template>
