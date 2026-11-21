<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { t } from '../i18n.js';
import {
  errorText, FILM_STATUSES, formatPartial, formatRuntime, itemChange, PATHS, providersStale, serverSettings, showToast, STATUS_ICONS, yearOf,
} from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import StarRating from '../kit/components/StarRating.vue';
import PartialDate from '../kit/components/PartialDate.vue';
import HeroPoster from '../components/HeroPoster.vue';
import Providers from '../components/Providers.vue';

const props = defineProps({ id: String });
const router = useRouter();
const film = ref(null);
const region = ref('');
const error = ref('');
const saveState = ref(''); // '', 'saving', 'saved'
const busy = ref(false);
const showOverview = ref(false);
const editingWatch = ref(null); // id of the watch whose date is open

// Your entries, as the form shows them
const form = ref({});
const fromFilm = (f) => ({ status: f.status, rating: f.rating, notes: f.notes || '' });

function setFilm(f, { changed = true, keepNotes = false } = {}) {
  const notes = form.value.notes;
  film.value = f;
  form.value = fromFilm(f);
  if (keepNotes) form.value.notes = notes;
  if (changed) itemChange.value = { mode: 'films', id: f.id, item: f };
}

onMounted(async () => {
  try {
    setFilm((await api(`/films/${props.id}`)).film, { changed: false });
  } catch (err) {
    error.value = errorText(err);
    return;
  }
  // Streaming offers that are a few days old get fetched again, quietly
  try {
    const settings = await serverSettings();
    region.value = settings.region;
    if (settings.tmdb && providersStale(film.value)) setFilm((await api(`/films/${film.value.id}/providers`, { method: 'POST' })).film, { changed: false, keepNotes: true });
  } catch {
    // the old offers stay
  }
});

let savedTimer = null;
async function request(path, options, { notesSaved = false } = {}) {
  saveState.value = 'saving';
  try {
    const data = await api(path, options);
    setFilm(data.film, { keepNotes: !notesSaved });
    saveState.value = 'saved';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (saveState.value = ''), 1500);
    return data;
  } catch (err) {
    saveState.value = '';
    form.value = { ...fromFilm(film.value), notes: form.value.notes };
    showToast(errorText(err));
    return null;
  }
}

const save = (patch) => request(`/films/${film.value.id}`, { method: 'PATCH', body: patch }, { notesSaved: 'notes' in patch });
const setStatus = (status) => status !== film.value.status && save({ status });
const setRating = (rating) => save({ rating });

// Notes save a moment after you stop typing, and when you leave the field
let notesTimer = null;
function notesInput() {
  clearTimeout(notesTimer);
  notesTimer = setTimeout(saveNotes, 1200);
}
function saveNotes() {
  clearTimeout(notesTimer);
  if (film.value && form.value.notes !== (film.value.notes || '')) save({ notes: form.value.notes });
}
onBeforeUnmount(saveNotes);

// --- the watch log ---

const showLog = computed(() => film.value && (film.value.status === 'watched' || film.value.watches.length));
async function addWatch() {
  const data = await request(`/films/${film.value.id}/watches`, { method: 'POST', body: {} });
  if (data) showToast(t('film.watchAdded'));
}
async function setWatchDate(watch, value) {
  if ((watch.watched_on || '') === value) return;
  await request(`/films/${film.value.id}/watches/${watch.id}`, { method: 'PATCH', body: { watchedOn: value || null } });
}
const removeWatch = (watch) => request(`/films/${film.value.id}/watches/${watch.id}`, { method: 'DELETE' });

// --- facts ---

const facts = computed(() => {
  const f = film.value;
  if (!f) return [];
  return [
    f.release_date && [t('film.released'), formatPartial(f.release_date)],
    f.runtime && [t('film.runtime'), formatRuntime(f.runtime)],
    f.director && [t('film.director'), f.director],
    f.cast_names.length && [t('title.cast'), f.cast_names.join(', ')],
    f.genres.length && [t('title.genres'), f.genres.join(', ')],
  ].filter(Boolean);
});

// --- TMDB, by hand, delete ---

async function refresh() {
  busy.value = true;
  try {
    setFilm((await api(`/films/${film.value.id}/refresh`, { method: 'POST' })).film, { keepNotes: true });
    showToast(t('title.refreshed'));
  } catch (err) {
    showToast(errorText(err));
  } finally {
    busy.value = false;
  }
}

const editing = ref(null);
function startEdit() {
  const f = film.value;
  editing.value = { title: f.title, releaseDate: f.release_date || '', runtime: f.runtime || '', director: f.director || '', genres: f.genres.join(', ') };
}
const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
async function saveEdit() {
  const e = editing.value;
  const ok = await save({ title: e.title, releaseDate: e.releaseDate || null, runtime: e.runtime || null, director: e.director, genres: list(e.genres) });
  if (ok) editing.value = null;
}

async function remove() {
  if (!confirm(t('title.deleteConfirm', { title: film.value.title }))) return;
  try {
    await api(`/films/${film.value.id}`, { method: 'DELETE' });
    itemChange.value = { mode: 'films', id: film.value.id, deleted: true };
    showToast(t('title.deleted'));
    router.replace(PATHS.films.library);
  } catch (err) {
    showToast(errorText(err));
  }
}
</script>

<template>
  <TopBar :title="film?.title || ''" :back="PATHS.films.library">
    <template v-if="film">
      <button v-if="film.tmdb_id" class="icon-btn" :disabled="busy" :aria-label="t('title.refresh')" :title="t('title.refresh')" @click="refresh"><Icon name="refresh" /></button>
      <button v-else class="icon-btn" :aria-label="t('title.edit')" :title="t('title.edit')" @click="startEdit"><Icon name="edit" /></button>
      <button class="icon-btn danger" :aria-label="t('delete')" :title="t('delete')" @click="remove"><Icon name="trash" /></button>
    </template>
  </TopBar>
  <main>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="!film" class="muted center">…</p>

    <template v-else>
      <section class="hero">
        <HeroPoster :item="film" mode="films" @update="setFilm($event, { keepNotes: true })" />
        <div class="hero-body">
          <h2>{{ film.title }}</h2>
          <p v-if="film.original_title" class="muted original">{{ film.original_title }}</p>
          <p class="meta">
            <span v-if="film.release_date">{{ yearOf(film.release_date) }}</span>
            <span v-if="film.runtime">{{ formatRuntime(film.runtime) }}</span>
          </p>
          <p v-if="film.director" class="byline">{{ t('film.by', { name: film.director }) }}</p>
          <div v-if="film.genres.length" class="tags"><span v-for="g in film.genres" :key="g" class="tag">{{ g }}</span></div>
          <p v-if="film.tagline" class="tagline">{{ film.tagline }}</p>
        </div>
      </section>

      <form v-if="editing" class="card form" @submit.prevent="saveEdit">
        <h2>{{ t('title.edit') }}</h2>
        <label><span>{{ t('add.title') }}</span><input v-model="editing.title" required maxlength="200" /></label>
        <label><span>{{ t('film.released') }}</span><PartialDate v-model="editing.releaseDate" /></label>
        <div class="two">
          <label><span>{{ t('film.runtimeMinutes') }}</span><input v-model="editing.runtime" type="number" min="1" max="1500" inputmode="numeric" /></label>
          <label><span>{{ t('film.director') }}</span><input v-model="editing.director" maxlength="200" /></label>
        </div>
        <label><span>{{ t('title.genres') }}</span><input v-model="editing.genres" :placeholder="t('title.commaHint')" /></label>
        <div class="row-buttons">
          <button class="btn primary">{{ t('save') }}</button>
          <button type="button" class="btn subtle" @click="editing = null">{{ t('cancel') }}</button>
        </div>
      </form>

      <section class="card form">
        <h2>{{ t('film.yours') }} <small class="save-state" :class="saveState" aria-live="polite">{{ saveState === 'saved' ? t('saved') : '' }}</small></h2>
        <div class="status-picker" role="radiogroup" :aria-label="t('library.status')">
          <button
            v-for="s in FILM_STATUSES" :key="s" type="button" role="radio" :aria-checked="form.status === s"
            :class="[`st-${s}`, { active: form.status === s }]" @click="setStatus(s)"
          >
            <Icon :name="STATUS_ICONS[s]" /><span>{{ t(`status.${s}`) }}</span>
          </button>
        </div>

        <div class="rating-row">
          <span class="field-label">{{ t('rating.label') }}</span>
          <StarRating v-model="form.rating" @update:model-value="setRating" />
        </div>

        <div v-if="showLog" class="watch-log">
          <span class="field-label">{{ film.watches.length > 1 ? t('film.watchedTimes', { n: film.watches.length }) : t('film.watchLog') }}</span>
          <ul v-if="film.watches.length" class="watches">
            <li v-for="w in film.watches" :key="w.id">
              <div class="watch-row">
                <Icon name="eye" />
                <span class="grow" :class="{ muted: !w.watched_on }">{{ w.watched_on ? formatPartial(w.watched_on) : t('film.noDate') }}</span>
                <button class="icon-btn small-btn" :aria-label="t('film.editDate')" :title="t('film.editDate')" @click="editingWatch = editingWatch === w.id ? null : w.id"><Icon name="calendar" /></button>
                <button class="icon-btn small-btn danger" :aria-label="t('film.removeWatch')" :title="t('film.removeWatch')" @click="removeWatch(w)"><Icon name="trash" /></button>
              </div>
              <PartialDate v-if="editingWatch === w.id" class="watch-date" :model-value="w.watched_on || ''" @update:model-value="setWatchDate(w, $event)" />
            </li>
          </ul>
          <div class="row-buttons">
            <button type="button" class="btn small" @click="addWatch"><Icon name="plus" />{{ film.watches.length ? t('film.watchedAgain') : t('film.watchedToday') }}</button>
          </div>
        </div>

        <label>
          <span>{{ t('title.notes') }}</span>
          <textarea v-model="form.notes" rows="4" :placeholder="t('film.notesHint')" @input="notesInput" @blur="saveNotes"></textarea>
        </label>
      </section>

      <section v-if="facts.length || film.overview" class="card">
        <dl class="facts">
          <template v-for="[label, value] in facts" :key="label">
            <dt>{{ label }}</dt>
            <dd>{{ value }}</dd>
          </template>
        </dl>
        <template v-if="film.overview">
          <p class="summary" :class="{ clamped: !showOverview }">{{ film.overview }}</p>
          <button v-if="film.overview.length > 260" class="link-btn small" @click="showOverview = !showOverview">{{ showOverview ? t('less') : t('more') }}</button>
        </template>
        <p v-if="film.tmdb_id" class="source">
          <a :href="`https://www.themoviedb.org/movie/${film.tmdb_id}`" target="_blank" rel="noopener noreferrer"><Icon name="external" />{{ t('title.onTmdb') }}</a>
        </p>
      </section>

      <Providers v-if="film.tmdb_id" :providers="film.providers" :at="film.providers_at" :region="region" />
    </template>
  </main>
</template>
