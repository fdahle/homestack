<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { COVER_SIZE, coverPhoto, errorText, formatHours, formatPartial, gameChange, PLAYED, showToast, STATUS_ICONS, STATUSES, yearOf } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import GameCover from '../components/GameCover.vue';
import StarRating from '../kit/components/StarRating.vue';
import PartialDate from '../kit/components/PartialDate.vue';

const props = defineProps({ id: String });
const router = useRouter();
const game = ref(null);
const usedPlatforms = ref([]);
const error = ref('');
const saveState = ref(''); // '', 'saving', 'saved'
const busy = ref(false);
const showSummary = ref(false);

// Your entries, as the form shows them
const form = ref({});
const fromGame = (g) => ({
  status: g.status, rating: g.rating, playedOn: [...(g.played_on || [])], startedOn: g.started_on || '', finishedOn: g.finished_on || '', notes: g.notes || '',
});

function setGame(g, { changed = true } = {}) {
  game.value = g;
  form.value = fromGame(g);
  if (changed) gameChange.value = { id: g.id, game: g };
}

onMounted(async () => {
  try {
    const data = await api(`/games/${props.id}`);
    setGame(data.game, { changed: false });
    usedPlatforms.value = data.platforms;
  } catch (err) {
    error.value = errorText(err);
  }
});

let savedTimer = null;
async function save(patch) {
  saveState.value = 'saving';
  try {
    const { game: g } = await api(`/games/${game.value.id}`, { method: 'PATCH', body: patch });
    // Keep notes being typed; take everything else from the server (it may fill in dates)
    const notes = form.value.notes;
    setGame(g);
    if (!('notes' in patch)) form.value.notes = notes;
    saveState.value = 'saved';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (saveState.value = ''), 1500);
  } catch (err) {
    saveState.value = '';
    form.value = { ...fromGame(game.value), notes: form.value.notes };
    showToast(errorText(err));
  }
}

const setStatus = (status) => status !== form.value.status && save({ status });
const setRating = (rating) => save({ rating });
const setDate = (key, value) => save({ [key]: value || null });
// Played on: tap the platforms IGDB lists for the game; one it doesn't list goes in "Andere …"
function setPlayedOn(list) {
  form.value.playedOn = list;
  save({ playedOn: list });
}
const togglePlayedOn = (p) => setPlayedOn(form.value.playedOn.includes(p) ? form.value.playedOn.filter((x) => x !== p) : [...form.value.playedOn, p]);
const otherPlatform = ref('');
function addOtherPlatform() {
  const p = otherPlatform.value.trim();
  otherPlatform.value = '';
  if (!p) return;
  const known = [...platformChoices.value, ...usedPlatforms.value].find((x) => x.toLowerCase() === p.toLowerCase()) || p;
  if (!form.value.playedOn.includes(known)) setPlayedOn([...form.value.playedOn, known]);
}

// Notes save a moment after you stop typing, and when you leave the field
let notesTimer = null;
function notesInput() {
  clearTimeout(notesTimer);
  notesTimer = setTimeout(saveNotes, 1200);
}
function saveNotes() {
  clearTimeout(notesTimer);
  if (game.value && form.value.notes !== (game.value.notes || '')) save({ notes: form.value.notes });
}
onBeforeUnmount(saveNotes);

// The server keeps only https links to IGDB; games stored before it did are checked here too
const igdbUrl = computed(() => (/^https:\/\/([a-z0-9-]+\.)*igdb\.com\//i.test(game.value?.igdb_url || '') ? game.value.igdb_url : null));
// The chips: where the game came out (IGDB), and whatever you picked besides
const platformChoices = computed(() => [...new Set([...(game.value?.platforms || []), ...(form.value.playedOn || [])])]);
// Suggestions for "Andere …": platforms you used for other games
const otherChoices = computed(() => usedPlatforms.value.filter((p) => !platformChoices.value.includes(p)));
const showStarted = computed(() => PLAYED.includes(form.value.status) || form.value.startedOn);
const showFinished = computed(() => ['finished', 'completed', 'dropped'].includes(form.value.status) || form.value.finishedOn);
const facts = computed(() => {
  const g = game.value;
  if (!g) return [];
  return [
    g.release_date && [t('game.released'), formatPartial(g.release_date)],
    g.developer && [t('game.developer'), g.developer],
    g.franchise && [t('game.series'), g.franchise],
    g.genres.length && [t('game.genres'), g.genres.join(', ')],
    g.platforms.length && [t('game.platforms'), g.platforms.join(', ')],
    g.steam_appid && g.steam_minutes != null && [t('game.steam'), [
      g.steam_minutes ? t('game.steamPlayed', { h: formatHours(Math.round(g.steam_minutes / 6) / 10) }) : t('game.steamUnplayed'),
      g.steam_last_played && t('game.steamLast', { when: formatPartial(g.steam_last_played) }),
    ].filter(Boolean).join(' · ')],
    (g.hours_main || g.hours_complete) && [t('game.timeToBeat'), [
      g.hours_main && t('game.hoursMain', { h: formatHours(g.hours_main) }),
      g.hours_complete && t('game.hoursComplete', { h: formatHours(g.hours_complete) }),
    ].filter(Boolean).join(' · ')],
  ].filter(Boolean);
});

// --- cover ---

const fileInput = ref(null);

async function uploadCover(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  busy.value = true;
  try {
    const blob = await coverPhoto(file, COVER_SIZE);
    setGame((await api(`/games/${game.value.id}/cover`, { method: 'PUT', raw: blob })).game);
  } catch (err) {
    showToast(errorText(err));
  } finally {
    busy.value = false;
  }
}

async function removePhoto() {
  busy.value = true;
  try {
    setGame((await api(`/games/${game.value.id}/cover`, { method: 'DELETE' })).game);
  } catch (err) {
    showToast(errorText(err));
  } finally {
    busy.value = false;
  }
}

// --- IGDB, by hand, delete ---

async function refresh() {
  busy.value = true;
  try {
    const notes = form.value.notes;
    setGame((await api(`/games/${game.value.id}/refresh`, { method: 'POST' })).game);
    form.value.notes = notes;
    showToast(t('game.refreshed'));
  } catch (err) {
    showToast(errorText(err));
  } finally {
    busy.value = false;
  }
}

const editing = ref(null);
function startEdit() {
  const g = game.value;
  editing.value = { name: g.name, releaseDate: g.release_date || '', developer: g.developer || '', platforms: g.platforms.join(', '), genres: g.genres.join(', ') };
}
const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
async function saveEdit() {
  const e = editing.value;
  await save({ name: e.name, releaseDate: e.releaseDate || null, developer: e.developer, platforms: list(e.platforms), genres: list(e.genres) });
  editing.value = null;
}

async function remove() {
  if (!confirm(t('game.deleteConfirm', { name: game.value.name }))) return;
  try {
    await api(`/games/${game.value.id}`, { method: 'DELETE' });
    gameChange.value = { id: game.value.id, deleted: true };
    showToast(t('game.deleted'));
    router.replace('/');
  } catch (err) {
    showToast(errorText(err));
  }
}
</script>

<template>
  <TopBar :title="game?.name || ''" back="/">
    <template v-if="game">
      <button v-if="game.igdb_id" class="icon-btn" :disabled="busy" :aria-label="t('game.refresh')" :title="t('game.refresh')" @click="refresh"><Icon name="refresh" /></button>
      <button v-else class="icon-btn" :aria-label="t('game.edit')" :title="t('game.edit')" @click="startEdit"><Icon name="edit" /></button>
      <button class="icon-btn danger" :aria-label="t('delete')" :title="t('delete')" @click="remove"><Icon name="trash" /></button>
    </template>
  </TopBar>
  <main>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="!game" class="muted center">…</p>

    <template v-else>
      <section class="hero">
        <div class="hero-cover">
          <GameCover :game="game" eager />
          <div class="cover-actions">
            <button class="link-btn small" :disabled="busy" @click="fileInput.click()"><Icon name="camera" />{{ t('game.ownCover') }}</button>
            <button v-if="game.cover_source === 'photo'" class="link-btn small" :disabled="busy" @click="removePhoto">{{ game.igdb_cover_id ? t('game.igdbCover') : t('game.removeCover') }}</button>
          </div>
          <input ref="fileInput" type="file" accept="image/*" hidden @change="uploadCover" />
        </div>
        <div class="hero-body">
          <h2>{{ game.name }}</h2>
          <p class="meta">
            <span v-if="game.release_date">{{ yearOf(game.release_date) }}</span>
            <span v-if="game.developer">{{ game.developer }}</span>
          </p>
          <div v-if="game.platforms.length" class="tags">
            <span v-for="p in game.platforms" :key="p" class="tag">{{ p }}</span>
          </div>
          <p v-if="game.hours_main" class="hours"><Icon name="clock" />{{ t('game.hoursMain', { h: formatHours(game.hours_main) }) }}</p>
        </div>
      </section>

      <form v-if="editing" class="card form" @submit.prevent="saveEdit">
        <h2>{{ t('game.edit') }}</h2>
        <label><span>{{ t('add.name') }}</span><input v-model="editing.name" required maxlength="200" /></label>
        <label><span>{{ t('game.released') }}</span><PartialDate v-model="editing.releaseDate" /></label>
        <label><span>{{ t('game.developer') }}</span><input v-model="editing.developer" maxlength="200" /></label>
        <label><span>{{ t('game.platforms') }}</span><input v-model="editing.platforms" :placeholder="t('game.commaHint')" /></label>
        <label><span>{{ t('game.genres') }}</span><input v-model="editing.genres" :placeholder="t('game.commaHint')" /></label>
        <div class="row-buttons">
          <button class="btn primary">{{ t('save') }}</button>
          <button type="button" class="btn subtle" @click="editing = null">{{ t('cancel') }}</button>
        </div>
      </form>

      <section class="card form">
        <h2>{{ t('game.yourGame') }} <small class="save-state" :class="saveState" aria-live="polite">{{ saveState === 'saved' ? t('saved') : '' }}</small></h2>
        <div class="status-picker" role="radiogroup" :aria-label="t('library.status')">
          <button
            v-for="s in STATUSES" :key="s" type="button" role="radio" :aria-checked="form.status === s"
            :class="[`st-${s}`, { active: form.status === s }]" @click="setStatus(s)"
          >
            <Icon :name="STATUS_ICONS[s]" /><span>{{ t(`status.${s}`) }}</span>
          </button>
        </div>

        <div class="rating-row">
          <span class="field-label">{{ t('rating.label') }}</span>
          <StarRating v-model="form.rating" @update:model-value="setRating" />
        </div>

        <div class="played-on">
          <span class="field-label">{{ t('game.playedOn') }}</span>
          <div class="chips" role="group" :aria-label="t('game.playedOn')">
            <button
              v-for="p in platformChoices" :key="p" type="button" class="chip" :class="{ active: form.playedOn.includes(p) }"
              :aria-pressed="form.playedOn.includes(p)" @click="togglePlayedOn(p)"
            >
              <Icon v-if="form.playedOn.includes(p)" name="check" />{{ p }}
            </button>
            <input
              v-model="otherPlatform" class="other-platform" list="platform-choices" maxlength="60" enterkeyhint="done"
              :placeholder="platformChoices.length ? t('game.playedOnOther') : t('game.playedOnHint')" :aria-label="t('game.playedOnOther')"
              @keydown.enter.prevent="addOtherPlatform" @change="addOtherPlatform"
            />
          </div>
          <datalist id="platform-choices"><option v-for="p in otherChoices" :key="p" :value="p" /></datalist>
        </div>

        <div v-if="showStarted" class="date-field">
          <span class="field-label">{{ t('game.started') }}</span>
          <PartialDate :model-value="form.startedOn" @update:model-value="setDate('startedOn', $event)" />
        </div>
        <div v-if="showFinished" class="date-field">
          <span class="field-label">{{ form.status === 'dropped' ? t('game.dropped') : t('game.finished') }}</span>
          <PartialDate :model-value="form.finishedOn" @update:model-value="setDate('finishedOn', $event)" />
        </div>

        <label>
          <span>{{ t('game.notes') }}</span>
          <textarea v-model="form.notes" rows="4" :placeholder="t('game.notesHint')" @input="notesInput" @blur="saveNotes"></textarea>
        </label>
      </section>

      <section v-if="facts.length || game.summary || game.steam_appid" class="card">
        <dl class="facts">
          <template v-for="[label, value] in facts" :key="label">
            <dt>{{ label }}</dt>
            <dd>{{ value }}</dd>
          </template>
        </dl>
        <template v-if="game.summary">
          <p class="summary" :class="{ clamped: !showSummary }">{{ game.summary }}</p>
          <button v-if="game.summary.length > 260" class="link-btn small" @click="showSummary = !showSummary">{{ showSummary ? t('game.less') : t('game.more') }}</button>
        </template>
        <p v-if="igdbUrl" class="source">
          <a :href="igdbUrl" target="_blank" rel="noopener noreferrer"><Icon name="external" />{{ t('game.onIgdb') }}</a>
        </p>
        <p v-if="game.steam_appid" class="source">
          <a :href="`https://store.steampowered.com/app/${game.steam_appid}/`" target="_blank" rel="noopener noreferrer"><Icon name="external" />{{ t('game.onSteam') }}</a>
        </p>
      </section>
    </template>
  </main>
</template>
