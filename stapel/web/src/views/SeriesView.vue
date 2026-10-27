<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, setStatus } from '../api.js';
import { t } from '../i18n.js';
import { compressNumbers, errorText, issueLabel, languageTag, parseNumberList, showToast, yearRange } from '../util.js';
import TopBar from '../components/TopBar.vue';
import Icon from '../components/Icon.vue';
import CoverImage from '../components/CoverImage.vue';

const props = defineProps({ id: String });
const router = useRouter();

const data = ref(null);
const loadError = ref('');

// --- view preferences, remembered per browser ---
function pref(key, fallback) {
  try {
    return localStorage.getItem(`stapel.series.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}
const mode = ref(pref('mode', 'view')); // view | owned | read | wanted: what a tap does
const layout = ref(pref('layout', 'grid'));
const filter = ref('all');
const showVariants = ref(pref('variants', '0') === '1');
watch([mode, layout, showVariants], () => {
  try {
    localStorage.setItem('stapel.series.mode', mode.value);
    localStorage.setItem('stapel.series.layout', layout.value);
    localStorage.setItem('stapel.series.variants', showVariants.value ? '1' : '0');
  } catch {
    // only a convenience
  }
});

async function load() {
  try {
    data.value = await api(`/series/${props.id}`);
  } catch (err) {
    loadError.value = err.status === 404 ? t('errors.not_found') : errorText(err);
  }
}

// While covers are being fetched for this series, refresh now and then
let poll = null;
function startPolling() {
  clearInterval(poll);
  poll = setInterval(async () => {
    if (document.hidden) return;
    const fresh = await api(`/series/${props.id}`).catch(() => null);
    if (!fresh) return;
    const byId = new Map(fresh.issues.map((i) => [i.id, i]));
    for (const issue of data.value.issues) {
      const f = byId.get(issue.id);
      if (f) Object.assign(issue, { cover_file: f.cover_file, cover_url: f.cover_url, details_at: f.details_at, title: f.title });
    }
    data.value.coversRequested = fresh.coversRequested;
    if (!fresh.coversRequested) clearInterval(poll);
  }, 6000);
}

onMounted(async () => {
  await load();
  if (data.value?.coversRequested) startPolling();
});
onBeforeUnmount(() => clearInterval(poll));

// --- grouping by number: variants and reprints count towards their number ---

const groups = computed(() => {
  const map = new Map();
  for (const issue of data.value?.issues || []) {
    let g = map.get(issue.number);
    if (!g) {
      g = { number: issue.number, main: issue, all: [] };
      map.set(issue.number, g);
    }
    g.all.push(issue);
  }
  for (const g of map.values()) {
    g.owned = g.all.some((i) => i.owned_at);
    g.read = g.all.some((i) => i.read_at);
    g.wanted = !g.owned && g.all.some((i) => i.wanted_at);
  }
  return [...map.values()];
});

const hasVariants = computed(() => (data.value?.issues || []).some((i) => i.is_variant));

const stats = computed(() => {
  const g = groups.value;
  return {
    total: g.length,
    owned: g.filter((x) => x.owned).length,
    read: g.filter((x) => x.read).length,
    missing: g.filter((x) => !x.owned).map((x) => x.number),
  };
});

const missingText = computed(() => compressNumbers(stats.value.missing));
const showAllMissing = ref(false);

// Tiles shown: one per number, or every printing when variants are shown
const tiles = computed(() => {
  const list = showVariants.value
    ? groups.value.flatMap((g) => g.all.map((issue) => ({ key: issue.id, issue, ids: [issue.id], owned: Boolean(issue.owned_at), read: Boolean(issue.read_at), wanted: Boolean(issue.wanted_at) && !issue.owned_at, variants: 0 })))
    : groups.value.map((g) => ({ key: g.main.id, issue: g.main, ids: g.all.map((i) => i.id), owned: g.owned, read: g.read, wanted: g.wanted, variants: g.all.length - 1 }));
  if (filter.value === 'missing') return list.filter((x) => !x.owned);
  if (filter.value === 'owned') return list.filter((x) => x.owned);
  if (filter.value === 'unread') return list.filter((x) => x.owned && !x.read);
  return list;
});

const pendingCovers = computed(() => (data.value?.issues || []).filter((i) => i.gcd_id && !i.details_at && !i.details_failed && !i.is_variant).length);

// --- changing status ---

const COLUMN = { owned: 'owned_at', read: 'read_at', wanted: 'wanted_at' };

function applyLocal(ids, flags) {
  const stamp = new Date().toISOString();
  const set = new Set(ids);
  for (const issue of data.value.issues) {
    if (!set.has(issue.id)) continue;
    for (const [flag, value] of Object.entries(flags)) issue[COLUMN[flag]] = value ? issue[COLUMN[flag]] || stamp : null;
    if (flags.owned) issue.wanted_at = null;
  }
}

async function change(ids, flags, message) {
  const before = data.value.issues.filter((i) => ids.includes(i.id)).map((i) => ({ id: i.id, owned_at: i.owned_at, read_at: i.read_at, wanted_at: i.wanted_at }));
  applyLocal(ids, flags);
  try {
    await setStatus(ids, flags);
    if (!data.value.collected && Object.values(flags).some(Boolean)) data.value.collected = true;
    if (message) showToast(message, { label: t('undo'), run: () => undo(before) });
  } catch (err) {
    restore(before);
    showToast(errorText(err));
  }
}

function restore(before) {
  const byId = new Map(before.map((b) => [b.id, b]));
  for (const issue of data.value.issues) if (byId.has(issue.id)) Object.assign(issue, byId.get(issue.id));
}

async function undo(before) {
  restore(before);
  // Put each flag back the way it was, grouped by target value
  for (const flag of ['owned', 'read', 'wanted']) {
    for (const value of [true, false]) {
      const ids = before.filter((b) => Boolean(b[COLUMN[flag]]) === value).map((b) => b.id);
      if (ids.length) await setStatus(ids, { [flag]: value }).catch(() => {});
    }
  }
}

function onTile(tile) {
  if (selecting.value) {
    toggleSelect(tile);
    return;
  }
  if (mode.value === 'view') {
    router.push(`/issue/${tile.issue.id}`);
    return;
  }
  const flag = mode.value;
  if (tile[flag]) {
    // Clearing applies to every printing of the number, setting only to the one tapped
    change(tile.ids, { [flag]: false });
  } else {
    change([tile.issue.id], { [flag]: true });
  }
}

function toggleFlag(tile, flag) {
  if (tile[flag]) change(tile.ids, { [flag]: false });
  else change([tile.issue.id], { [flag]: true });
}

// --- selecting many ---

const selecting = ref(false);
const selected = ref(new Set());
const rangeText = ref('');

function toggleSelect(tile) {
  const s = new Set(selected.value);
  if (s.has(tile.key)) s.delete(tile.key);
  else s.add(tile.key);
  selected.value = s;
}

function selectRange() {
  const numbers = parseNumberList(rangeText.value);
  selected.value = new Set([...selected.value, ...tiles.value.filter((x) => numbers.has(x.issue.number)).map((x) => x.key)]);
}

const selectAll = () => (selected.value = new Set(tiles.value.map((x) => x.key)));
const selectNone = () => (selected.value = new Set());
function stopSelecting() {
  selecting.value = false;
  selected.value = new Set();
  rangeText.value = '';
}

function bulk(flag, value) {
  const chosen = tiles.value.filter((x) => selected.value.has(x.key));
  if (!chosen.length) return;
  // Setting marks the shown printing; clearing clears every printing of those numbers
  const ids = value ? chosen.map((x) => x.issue.id) : chosen.flatMap((x) => x.ids);
  change(ids, { [flag]: value }, t('series.bulkDone', { n: chosen.length }));
  stopSelecting();
}

// --- series actions ---

const menuOpen = ref(false);

async function requestCovers() {
  menuOpen.value = false;
  await api(`/series/${props.id}/covers`, { method: 'POST' });
  data.value.coversRequested = true;
  showToast(t('series.coversRequested'));
  startPolling();
}

async function resync() {
  menuOpen.value = false;
  try {
    await api(`/series/${props.id}/sync`, { method: 'POST' });
    await load();
    showToast(t('series.synced'));
  } catch (err) {
    showToast(errorText(err));
  }
}

async function setCollected(value) {
  menuOpen.value = false;
  await api(`/series/${props.id}/collect`, { method: 'POST', body: { collected: value } });
  data.value.collected = value;
  showToast(value ? t('series.addedToCollection') : t('series.removedFromCollection'));
}

async function deleteSeries() {
  menuOpen.value = false;
  if (!confirm(t('series.confirmDelete', { name: data.value.series.name }))) return;
  try {
    await api(`/series/${props.id}`, { method: 'DELETE' });
    router.replace('/collection');
  } catch (err) {
    showToast(errorText(err));
  }
}

// Adding issues by hand (also for GCD series that miss something)
const addDialog = ref(null);
const addForm = ref({ numbers: '', title: '' });
function openAdd() {
  menuOpen.value = false;
  addForm.value = { numbers: '', title: '' };
  addDialog.value.showModal();
}
async function submitAdd() {
  try {
    await api(`/series/${props.id}/issues`, { method: 'POST', body: addForm.value });
    addDialog.value.close();
    await load();
  } catch (err) {
    showToast(errorText(err));
  }
}

const editDialog = ref(null);
const editForm = ref({});
function openEdit() {
  menuOpen.value = false;
  const s = data.value.series;
  editForm.value = { name: s.name, publisher: s.publisher_name || '', year: s.year_began || '', language: s.language || '' };
  editDialog.value.showModal();
}
async function submitEdit() {
  try {
    data.value.series = await api(`/series/${props.id}`, { method: 'PATCH', body: editForm.value });
    editDialog.value.close();
  } catch (err) {
    showToast(errorText(err));
  }
}

const MODES = ['view', 'owned', 'read', 'wanted'];
const MODE_ICONS = { view: 'eye',owned: 'check', read: 'book', wanted: 'heart' };
</script>

<template>
  <TopBar :title="data?.series.name || ''" back="/collection">
    <template v-if="data">
      <button class="icon-btn" :class="{ on: selecting }" :aria-label="t('series.select')" @click="selecting ? stopSelecting() : (selecting = true)"><Icon name="select" /></button>
      <button class="icon-btn" :aria-label="t('more')" @click="menuOpen = !menuOpen"><Icon name="more" /></button>
    </template>
  </TopBar>

  <div v-if="menuOpen" class="menu-backdrop" @click="menuOpen = false"></div>
  <div v-if="menuOpen" class="menu">
    <button v-if="data.series.gcd_id && pendingCovers" @click="requestCovers"><Icon name="image" /> {{ t('series.loadCovers', { n: pendingCovers }) }}</button>
    <button v-if="data.series.gcd_id" @click="resync"><Icon name="refresh" /> {{ t('series.resync') }}</button>
    <button @click="openAdd"><Icon name="plus" /> {{ t('series.addIssues') }}</button>
    <button v-if="!data.series.gcd_id" @click="openEdit"><Icon name="edit" /> {{ t('series.edit') }}</button>
    <a v-if="data.series.gcd_id" :href="`https://www.comics.org/series/${data.series.gcd_id}/`" target="_blank" rel="noopener"><Icon name="external" /> {{ t('series.openGcd') }}</a>
    <button v-if="data.collected" @click="setCollected(false)"><Icon name="close" /> {{ t('series.removeFromCollection') }}</button>
    <button v-else @click="setCollected(true)"><Icon name="plus" /> {{ t('series.addToCollection') }}</button>
    <button v-if="!data.series.gcd_id" class="danger" @click="deleteSeries"><Icon name="trash" /> {{ t('series.delete') }}</button>
  </div>

  <main v-if="data" class="series-page">
    <section class="series-head">
      <div class="meta">
        <span v-if="data.series.publisher_name">{{ data.series.publisher_name }}</span>
        <span v-if="data.series.year_began">{{ yearRange(data.series) }}</span>
        <span v-if="data.series.language" class="tag">{{ languageTag(data.series.language) }}</span>
        <span v-if="data.series.format">{{ data.series.format }}</span>
      </div>
      <div class="bar big">
        <span class="owned" :style="{ width: `${stats.total ? (stats.owned / stats.total) * 100 : 0}%` }"></span>
        <span class="read" :style="{ width: `${stats.total ? (stats.read / stats.total) * 100 : 0}%` }"></span>
      </div>
      <div class="meta">
        <span>{{ t('collection.ownedOf', { owned: stats.owned, total: stats.total }) }}</span>
        <span>{{ t('collection.readCount', { n: stats.read }) }}</span>
        <span v-if="!data.collected" class="warn">{{ t('series.notInCollection') }}</span>
      </div>
      <p v-if="stats.owned && stats.missing.length" class="missing">
        <strong>{{ t('series.missing', { n: stats.missing.length }) }}</strong>
        <span :class="{ clamp: !showAllMissing }">{{ missingText }}</span>
        <button v-if="missingText.length > 160" class="link-btn" @click="showAllMissing = !showAllMissing">{{ showAllMissing ? t('less') : t('moreText') }}</button>
      </p>
      <p v-else-if="stats.total && stats.owned === stats.total" class="ok">{{ t('series.completeBanner') }}</p>
      <p v-if="data.coversRequested" class="muted small">{{ t('series.coversLoading', { n: pendingCovers }) }}</p>
    </section>

    <div class="mode-bar" role="radiogroup" :aria-label="t('series.tapMode')">
      <span class="muted small">{{ t('series.tapMode') }}</span>
      <div class="segmented">
        <button v-for="m in MODES" :key="m" role="radio" :aria-checked="mode === m" :class="[`m-${m}`, { active: mode === m }]" @click="mode = m">
          <Icon :name="MODE_ICONS[m]" /> {{ t(`series.mode.${m}`) }}
        </button>
      </div>
    </div>

    <div class="toolbar">
      <div class="chips">
        <button v-for="f in ['all', 'missing', 'owned', 'unread']" :key="f" class="chip" :class="{ active: filter === f }" @click="filter = f">{{ t(`series.filter.${f}`) }}</button>
      </div>
      <label v-if="hasVariants" class="check-label"><input v-model="showVariants" type="checkbox" /> {{ t('series.showVariants') }}</label>
      <button class="icon-btn" :aria-label="t('series.toggleLayout')" @click="layout = layout === 'grid' ? 'list' : 'grid'"><Icon :name="layout === 'grid' ? 'list' : 'grid'" /></button>
    </div>

    <div v-if="selecting" class="select-bar">
      <form class="range" @submit.prevent="selectRange">
        <input v-model="rangeText" :placeholder="t('series.rangePlaceholder')" inputmode="numeric" />
        <button class="btn small">{{ t('series.selectRange') }}</button>
      </form>
      <div class="row-buttons">
        <button class="link-btn" @click="selectAll">{{ t('series.selectAll') }}</button>
        <button class="link-btn" @click="selectNone">{{ t('series.selectNone') }}</button>
        <span class="muted small">{{ t('series.selectedCount', { n: selected.size }) }}</span>
      </div>
    </div>

    <p v-if="!tiles.length" class="muted center">{{ data.issues.length ? t('series.noneMatch') : t('series.noIssues') }}</p>

    <div v-if="layout === 'grid'" class="tile-grid" :class="{ 'mode-active': mode !== 'view' || selecting }">
      <button
        v-for="tile in tiles"
        :key="tile.key"
        class="tile"
        :class="{ owned: tile.owned, read: tile.read, wanted: tile.wanted, selected: selected.has(tile.key) }"
        :aria-pressed="selecting ? selected.has(tile.key) : mode !== 'view' ? tile[mode] : undefined"
        @click="onTile(tile)"
      >
        <CoverImage :issue="tile.issue" />
        <span class="tile-num">{{ issueLabel(tile.issue) }}<template v-if="showVariants && tile.issue.variant"> · {{ tile.issue.variant }}</template></span>
        <span class="tile-flags">
          <span v-if="tile.owned" class="f-owned"><Icon name="check" /></span>
          <span v-if="tile.read" class="f-read"><Icon name="book" /></span>
          <span v-if="tile.wanted" class="f-wanted"><Icon name="heart" /></span>
        </span>
        <span v-if="tile.variants && !showVariants" class="tile-variants">+{{ tile.variants }}</span>
      </button>
    </div>

    <ul v-else class="issue-list">
      <li v-for="tile in tiles" :key="tile.key" :class="{ owned: tile.owned, selected: selected.has(tile.key) }">
        <button v-if="selecting" class="check-box" :aria-pressed="selected.has(tile.key)" @click="toggleSelect(tile)"><Icon name="check" /></button>
        <RouterLink :to="`/issue/${tile.issue.id}`" class="issue-line">
          <span class="num">{{ tile.issue.number || '–' }}</span>
          <span class="title">{{ tile.issue.title || ' ' }}<small v-if="showVariants && tile.issue.variant"> {{ tile.issue.variant }}</small></span>
        </RouterLink>
        <div class="flag-buttons">
          <button :class="{ on: tile.owned }" class="fb-owned" :aria-label="t('status.owned')" @click="toggleFlag(tile, 'owned')"><Icon name="check" /></button>
          <button :class="{ on: tile.read }" class="fb-read" :aria-label="t('status.read')" @click="toggleFlag(tile, 'read')"><Icon name="book" /></button>
          <button :class="{ on: tile.wanted }" class="fb-wanted" :aria-label="t('status.wanted')" @click="toggleFlag(tile, 'wanted')"><Icon name="heart" /></button>
        </div>
      </li>
    </ul>
  </main>
  <main v-else-if="loadError"><p class="error center">{{ loadError }}</p></main>

  <div v-if="selecting && selected.size" class="action-sheet">
    <button class="btn" @click="bulk('owned', true)"><Icon name="check" /> {{ t('series.bulk.owned') }}</button>
    <button class="btn" @click="bulk('read', true)"><Icon name="book" /> {{ t('series.bulk.read') }}</button>
    <button class="btn" @click="bulk('wanted', true)"><Icon name="heart" /> {{ t('series.bulk.wanted') }}</button>
    <button class="btn subtle" @click="bulk('owned', false)">{{ t('series.bulk.notOwned') }}</button>
    <button class="btn subtle" @click="bulk('read', false)">{{ t('series.bulk.unread') }}</button>
    <button class="btn subtle" @click="bulk('wanted', false)">{{ t('series.bulk.notWanted') }}</button>
  </div>

  <dialog ref="addDialog" class="dialog">
    <form @submit.prevent="submitAdd">
      <h2>{{ t('series.addIssues') }}</h2>
      <label><span>{{ t('series.numbers') }}</span><input v-model="addForm.numbers" :placeholder="t('series.numbersPlaceholder')" required /></label>
      <label><span>{{ t('issue.title') }}</span><input v-model="addForm.title" :placeholder="t('series.titleOnlySingle')" /></label>
      <div class="row-buttons end">
        <button type="button" class="btn subtle" @click="addDialog.close()">{{ t('cancel') }}</button>
        <button class="btn primary">{{ t('add') }}</button>
      </div>
    </form>
  </dialog>

  <dialog ref="editDialog" class="dialog">
    <form @submit.prevent="submitEdit">
      <h2>{{ t('series.edit') }}</h2>
      <label><span>{{ t('add.name') }}</span><input v-model="editForm.name" required /></label>
      <label><span>{{ t('add.publisher') }}</span><input v-model="editForm.publisher" /></label>
      <div class="two">
        <label><span>{{ t('add.year') }}</span><input v-model="editForm.year" inputmode="numeric" /></label>
        <label><span>{{ t('add.language') }}</span><input v-model="editForm.language" maxlength="2" placeholder="de" /></label>
      </div>
      <div class="row-buttons end">
        <button type="button" class="btn subtle" @click="editDialog.close()">{{ t('cancel') }}</button>
        <button class="btn primary">{{ t('save') }}</button>
      </div>
    </form>
  </dialog>
</template>
