<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { hasText, t } from '../i18n.js';
import {
  countriesText,
  airYears, episodeCode, episodeName, errorText, formatDay, formatPartial, formatRuntime, isoDate, itemChange, PATHS, providersStale,
  relativeDay, SERIES_STATUSES, serverSettings, showToast, STATUS_ICONS,
} from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import StarRating from '../kit/components/StarRating.vue';
import PartialDate from '../kit/components/PartialDate.vue';
import HeroPoster from '../components/HeroPoster.vue';
import Providers from '../components/Providers.vue';
import CountryPicker from '../components/CountryPicker.vue';

const props = defineProps({ id: String });
const router = useRouter();
const series = ref(null);
const region = ref('');
const error = ref('');
const saveState = ref('');
const busy = ref(false);
const ticking = ref(false);
const showOverview = ref(false);
const today = isoDate();

const form = ref({});
const fromSeries = (s) => ({ status: s.status, rating: s.rating, notes: s.notes || '' });

function setSeries(s, { changed = true, keepNotes = false } = {}) {
  const notes = form.value.notes;
  const first = !series.value;
  series.value = s;
  form.value = fromSeries(s);
  if (keepNotes) form.value.notes = notes;
  if (first) openSeasons.value = new Set([defaultSeason()]);
  if (changed) {
    const { episodes, ...item } = s;
    itemChange.value = { mode: 'series', id: s.id, item };
  }
}

onMounted(async () => {
  try {
    setSeries((await api(`/series/${props.id}`)).series, { changed: false });
  } catch (err) {
    error.value = errorText(err);
    return;
  }
  try {
    const settings = await serverSettings();
    region.value = settings.region;
    if (settings.tmdb && providersStale(series.value)) setSeries((await api(`/series/${series.value.id}/providers`, { method: 'POST' })).series, { changed: false, keepNotes: true });
  } catch {
    // the old offers stay
  }
});

let savedTimer = null;
async function save(patch) {
  saveState.value = 'saving';
  try {
    const data = await api(`/series/${series.value.id}`, { method: 'PATCH', body: patch });
    setSeries(data.series, { keepNotes: !('notes' in patch) });
    saveState.value = 'saved';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (saveState.value = ''), 1500);
    return true;
  } catch (err) {
    saveState.value = '';
    form.value = { ...fromSeries(series.value), notes: form.value.notes };
    showToast(errorText(err));
    return false;
  }
}

// Marking a show as finished with episodes left: offer to tick them all
async function setStatus(status) {
  if (status === series.value.status) return;
  if (!(await save({ status }))) return;
  const left = aired.value.filter((e) => !e.watched);
  if (status === 'finished' && left.length) {
    showToast(t('series.leftToTick', { n: left.length }), { label: t('series.tickAll'), run: () => tick(left, true) });
  }
}
const setRating = (rating) => save({ rating });

let notesTimer = null;
function notesInput() {
  clearTimeout(notesTimer);
  notesTimer = setTimeout(saveNotes, 1200);
}
function saveNotes() {
  clearTimeout(notesTimer);
  if (series.value && form.value.notes !== (series.value.notes || '')) save({ notes: form.value.notes });
}
onBeforeUnmount(saveNotes);

// --- episodes ---

const manual = computed(() => !series.value?.tmdb_id);
const isAired = (e) => (e.air_date ? e.air_date <= today : manual.value);
const episodes = computed(() => (series.value?.episodes || []).filter((e) => e.season > 0));
const aired = computed(() => episodes.value.filter(isAired));

const seasons = computed(() => {
  const info = new Map((series.value?.seasons || []).map((s) => [s.number, s]));
  const groups = new Map();
  for (const e of episodes.value) {
    if (!groups.has(e.season)) groups.set(e.season, []);
    groups.get(e.season).push(e);
  }
  return [...groups].map(([number, list]) => {
    const airedHere = list.filter(isAired);
    return {
      number,
      name: info.get(number)?.name || t('series.season', { n: number }),
      episodes: list,
      watched: list.filter((e) => e.watched).length,
      aired: airedHere.length,
      total: list.filter((e) => e.watched || isAired(e)).length,
      done: airedHere.length > 0 && airedHere.every((e) => e.watched),
      firstAir: list.find((e) => e.air_date)?.air_date || info.get(number)?.air_date || null,
    };
  });
});

// The season with the next episode is open; the others are a tap away
const openSeasons = ref(new Set());
function defaultSeason() {
  const s = series.value;
  if (s.next) return s.next.season;
  const list = seasons.value;
  return (list.find((x) => !x.done) || list[list.length - 1])?.number ?? 1;
}
function toggleSeason(n) {
  const open = new Set(openSeasons.value);
  if (open.has(n)) open.delete(n);
  else open.add(n);
  openSeasons.value = open;
}

const percent = (watched, total) => (total ? Math.round((watched / total) * 100) : 0);

async function tick(list, watched) {
  if (!list.length) return;
  ticking.value = true;
  try {
    const data = await api(`/series/${series.value.id}/watch`, { method: 'POST', body: { episodes: list.map((e) => e.id), watched } });
    setSeries(data.series, { keepNotes: true });
    if (data.auto) {
      const { from, to } = data.auto;
      showToast(t(`series.auto.${to}`), { label: t('undo'), run: () => save({ status: from }) });
    }
  } catch (err) {
    showToast(errorText(err));
  } finally {
    ticking.value = false;
  }
}

const toggle = (e) => tick([e], !e.watched);
const tickSeason = (season) => (season.done ? tick(season.episodes.filter((e) => e.watched), false) : tick(season.episodes.filter((e) => !e.watched && isAired(e)), true));
// Everything up to this episode, from the start of the show
const before = (e) => episodes.value.filter((x) => x.season < e.season || (x.season === e.season && x.number <= e.number));
const hasGapBefore = (e) => before(e).some((x) => x !== e && !x.watched && isAired(x));
const tickUpTo = (e) => tick(before(e).filter((x) => !x.watched && (isAired(x) || x === e)), true);

const nextEp = computed(() => {
  const n = series.value?.next;
  return n ? episodes.value.find((e) => e.id === n.id) : null;
});

function episodeMeta(e) {
  const parts = [];
  if (e.air_date) parts.push(e.air_date > today ? relativeDay(e.air_date, today) : formatDay(e.air_date));
  if (e.runtime) parts.push(formatRuntime(e.runtime));
  return parts.join(' · ');
}

// --- series entered by hand: seasons of numbered episodes ---

const newSeason = ref(10);
async function addSeason() {
  busy.value = true;
  try {
    setSeries((await api(`/series/${series.value.id}/seasons`, { method: 'POST', body: { episodes: Number(newSeason.value) } })).series, { keepNotes: true });
    openSeasons.value = new Set([...openSeasons.value, seasons.value[seasons.value.length - 1]?.number]);
  } catch (err) {
    showToast(errorText(err));
  } finally {
    busy.value = false;
  }
}
async function removeSeason() {
  const last = seasons.value[seasons.value.length - 1];
  if (!last || !confirm(t('series.removeSeasonConfirm', { name: last.name }))) return;
  try {
    setSeries((await api(`/series/${series.value.id}/seasons/last`, { method: 'DELETE' })).series, { keepNotes: true });
  } catch (err) {
    showToast(errorText(err));
  }
}

// --- facts ---

const facts = computed(() => {
  const s = series.value;
  if (!s) return [];
  return [
    s.first_air_date && [t('series.firstAired'), formatPartial(s.first_air_date)],
    s.tmdb_status && [t('series.state'), stateLabel.value],
    s.next_air_date && [t('series.nextAir'), formatPartial(s.next_air_date)],
    s.countries.length && [t('title.countries'), countriesText(s)],
    s.networks.length && [t('series.networks'), s.networks.join(', ')],
    s.creators && [t('series.creators'), s.creators],
    s.cast_names.length && [t('title.cast'), s.cast_names.join(', ')],
    s.genres.length && [t('title.genres'), s.genres.join(', ')],
    seasons.value.length && [t('series.size'), t('series.sizeValue', { seasons: seasons.value.length, episodes: episodes.value.length })],
    s.episode_runtime && [t('series.episodeRuntime'), formatRuntime(s.episode_runtime)],
  ].filter(Boolean);
});
// TMDB's status in your language, as far as it is known
const stateLabel = computed(() => {
  const st = series.value?.tmdb_status;
  return st && hasText(`tmdbStatus.${st}`) ? t(`tmdbStatus.${st}`) : st || '';
});

// --- TMDB, by hand, delete ---

async function refresh() {
  busy.value = true;
  try {
    setSeries((await api(`/series/${series.value.id}/refresh`, { method: 'POST' })).series, { keepNotes: true });
    showToast(t('title.refreshed'));
  } catch (err) {
    showToast(errorText(err));
  } finally {
    busy.value = false;
  }
}

const editing = ref(null);
function startEdit() {
  const s = series.value;
  editing.value = { title: s.title, firstAirDate: s.first_air_date || '', episodeRuntime: s.episode_runtime || '', creators: s.creators || '', genres: s.genres.join(', '), countries: [...s.countries] };
}
const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
async function saveEdit() {
  const e = editing.value;
  const ok = await save({ title: e.title, firstAirDate: e.firstAirDate || null, episodeRuntime: e.episodeRuntime || null, creators: e.creators, genres: list(e.genres), countries: e.countries });
  if (ok) editing.value = null;
}

async function remove() {
  if (!confirm(t('title.deleteConfirm', { title: series.value.title }))) return;
  try {
    await api(`/series/${series.value.id}`, { method: 'DELETE' });
    itemChange.value = { mode: 'series', id: series.value.id, deleted: true };
    showToast(t('title.deleted'));
    router.replace(PATHS.series.library);
  } catch (err) {
    showToast(errorText(err));
  }
}
</script>

<template>
  <TopBar :title="series?.title || ''" :back="PATHS.series.library">
    <template v-if="series">
      <button v-if="series.tmdb_id" class="icon-btn" :disabled="busy" :aria-label="t('series.refresh')" :title="t('series.refresh')" @click="refresh"><Icon name="refresh" /></button>
      <button v-else class="icon-btn" :aria-label="t('title.edit')" :title="t('title.edit')" @click="startEdit"><Icon name="edit" /></button>
      <button class="icon-btn danger" :aria-label="t('delete')" :title="t('delete')" @click="remove"><Icon name="trash" /></button>
    </template>
  </TopBar>
  <main>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="!series" class="muted center">…</p>

    <template v-else>
      <section class="hero">
        <HeroPoster :item="series" mode="series" @update="setSeries($event, { keepNotes: true })" />
        <div class="hero-body">
          <h2>{{ series.title }}</h2>
          <p v-if="series.original_title" class="muted original">{{ series.original_title }}</p>
          <p class="meta">
            <span v-if="airYears(series)">{{ airYears(series) }}</span>
            <span v-if="series.countries.length">{{ countriesText(series) }}</span>
            <span v-if="series.networks.length">{{ series.networks[0] }}</span>
            <span v-if="stateLabel">{{ stateLabel }}</span>
          </p>
          <p v-if="series.creators" class="byline">{{ t('series.by', { name: series.creators }) }}</p>
          <div v-if="series.genres.length" class="tags"><span v-for="g in series.genres" :key="g" class="tag">{{ g }}</span></div>
          <div v-if="series.total" class="hero-progress" :class="`st-${series.status}`">
            <div class="progress"><span :style="{ '--p': percent(series.watched, series.total) }"></span></div>
            <small class="muted">{{ t('series.progress', { n: series.watched, total: series.total }) }}</small>
          </div>
        </div>
      </section>

      <form v-if="editing" class="card form" @submit.prevent="saveEdit">
        <h2>{{ t('title.edit') }}</h2>
        <label><span>{{ t('add.title') }}</span><input v-model="editing.title" required maxlength="200" /></label>
        <label><span>{{ t('series.firstAired') }}</span><PartialDate v-model="editing.firstAirDate" /></label>
        <div class="two">
          <label><span>{{ t('series.episodeMinutes') }}</span><input v-model="editing.episodeRuntime" type="number" min="1" max="1500" inputmode="numeric" /></label>
          <label><span>{{ t('series.creators') }}</span><input v-model="editing.creators" maxlength="200" /></label>
        </div>
        <label><span>{{ t('title.genres') }}</span><input v-model="editing.genres" :placeholder="t('title.commaHint')" /></label>
        <div><span class="field-label">{{ t('title.countries') }}</span><CountryPicker v-model="editing.countries" /></div>
        <div class="row-buttons">
          <button class="btn primary">{{ t('save') }}</button>
          <button type="button" class="btn subtle" @click="editing = null">{{ t('cancel') }}</button>
        </div>
      </form>

      <section v-if="nextEp && series.status !== 'dropped'" class="card next-box" :class="`st-${series.status === 'watchlist' ? 'watching' : series.status}`">
        <div class="grow">
          <span class="field-label">{{ t('upnext.next') }}</span>
          <strong class="next-title">{{ episodeCode(nextEp) }} · {{ episodeName(nextEp) }}</strong>
          <small v-if="episodeMeta(nextEp)" class="muted">{{ episodeMeta(nextEp) }}</small>
        </div>
        <button class="btn primary" :disabled="ticking" @click="tick([nextEp], true)"><Icon name="check" />{{ t('upnext.seen') }}</button>
      </section>

      <section class="card form">
        <h2>{{ t('series.yours') }} <small class="save-state" :class="saveState" aria-live="polite">{{ saveState === 'saved' ? t('saved') : '' }}</small></h2>
        <div class="status-picker five" role="radiogroup" :aria-label="t('library.status')">
          <button
            v-for="s in SERIES_STATUSES" :key="s" type="button" role="radio" :aria-checked="form.status === s"
            :class="[`st-${s}`, { active: form.status === s }]" @click="setStatus(s)"
          >
            <Icon :name="STATUS_ICONS[s]" /><span>{{ t(`status.${s}`) }}</span>
          </button>
        </div>
        <div class="rating-row">
          <span class="field-label">{{ t('rating.label') }}</span>
          <StarRating v-model="form.rating" @update:model-value="setRating" />
        </div>
        <label>
          <span>{{ t('title.notes') }}</span>
          <textarea v-model="form.notes" rows="3" :placeholder="t('series.notesHint')" @input="notesInput" @blur="saveNotes"></textarea>
        </label>
      </section>

      <section v-if="seasons.length || manual" class="card seasons" :class="{ busy: ticking }">
        <h2 class="card-title">{{ t('series.seasons') }}</h2>
        <div v-for="season in seasons" :key="season.number" class="season" :class="{ open: openSeasons.has(season.number) }">
          <div class="season-head">
            <button class="season-toggle" :aria-expanded="openSeasons.has(season.number)" @click="toggleSeason(season.number)">
              <Icon name="down" class="chevron" />
              <span class="season-name">
                <strong>{{ season.name }}</strong>
                <small class="muted">
                  {{ t('series.seasonCount', { n: season.watched, total: season.episodes.length }) }}<template v-if="season.firstAir && season.firstAir > today"> · {{ formatDay(season.firstAir) }}</template>
                </small>
              </span>
              <span class="progress season-progress" :class="`st-${season.done ? 'finished' : 'watching'}`"><span :style="{ '--p': percent(season.watched, season.total) }"></span></span>
            </button>
            <button v-if="season.aired" class="btn small season-action" :class="{ subtle: season.done }" :disabled="ticking" @click="tickSeason(season)">
              <template v-if="season.done">{{ t('series.untickSeason') }}</template>
              <template v-else><Icon name="checks" />{{ t('series.tickSeason') }}</template>
            </button>
          </div>
          <ol v-if="openSeasons.has(season.number)" class="episodes">
            <li v-for="e in season.episodes" :key="e.id" class="episode" :class="{ watched: e.watched, future: !isAired(e) }">
              <button
                class="ep-check" role="checkbox" :aria-checked="e.watched" :disabled="ticking"
                :aria-label="`${episodeCode(e)} ${episodeName(e)}`" :title="e.watched && e.watched_on ? t('series.watchedOn', { date: formatDay(e.watched_on) }) : undefined"
                @click="toggle(e)"
              >
                <Icon name="check" />
              </button>
              <span class="ep-num">{{ e.number }}</span>
              <span class="ep-body">
                <span class="ep-name">{{ episodeName(e) }}</span>
                <small v-if="episodeMeta(e)" class="muted">{{ episodeMeta(e) }}</small>
              </span>
              <button v-if="!e.watched && isAired(e) && hasGapBefore(e)" class="icon-btn small-btn" :disabled="ticking" :aria-label="t('series.upTo')" :title="t('series.upTo')" @click="tickUpTo(e)">
                <Icon name="checks" />
              </button>
            </li>
          </ol>
        </div>
        <p v-if="!seasons.length" class="muted small">{{ t('series.noEpisodes') }}</p>
        <form v-if="manual" class="add-season" @submit.prevent="addSeason">
          <label class="grow"><span>{{ t('series.newSeason') }}</span><input v-model="newSeason" type="number" min="1" max="200" inputmode="numeric" /></label>
          <button class="btn small" :disabled="busy"><Icon name="plus" />{{ t('series.addSeason') }}</button>
          <button v-if="seasons.length" type="button" class="btn small subtle danger" @click="removeSeason">{{ t('series.removeSeason') }}</button>
        </form>
      </section>

      <section v-if="facts.length || series.overview" class="card">
        <dl class="facts">
          <template v-for="[label, value] in facts" :key="label">
            <dt>{{ label }}</dt>
            <dd>{{ value }}</dd>
          </template>
        </dl>
        <template v-if="series.overview">
          <p class="summary" :class="{ clamped: !showOverview }">{{ series.overview }}</p>
          <button v-if="series.overview.length > 260" class="link-btn small" @click="showOverview = !showOverview">{{ showOverview ? t('less') : t('more') }}</button>
        </template>
        <p v-if="series.tmdb_id" class="source">
          <a :href="`https://www.themoviedb.org/tv/${series.tmdb_id}`" target="_blank" rel="noopener noreferrer"><Icon name="external" />{{ t('title.onTmdb') }}</a>
        </p>
      </section>

      <Providers v-if="series.tmdb_id" :providers="series.providers" :at="series.providers_at" :region="region" />
    </template>
  </main>
</template>
