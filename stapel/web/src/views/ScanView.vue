<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api, setStatus } from '../api.js';
import { t } from '../i18n.js';
import { errorText, issueLabel, showToast } from '../util.js';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import TopBar from '../components/TopBar.vue';
import Icon from '../components/Icon.vue';
import CoverImage from '../components/CoverImage.vue';
import SeriesSearch from '../components/SeriesSearch.vue';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

function pref(key, fallback) {
  try {
    return localStorage.getItem(`stapel.scan.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}
// Continuous mode: a scan that matches exactly one issue marks it owned and keeps scanning
const continuous = ref(pref('continuous', '0') === '1');
watch(continuous, (v) => {
  try {
    localStorage.setItem('stapel.scan.continuous', v ? '1' : '0');
  } catch {
    // only a convenience
  }
});

const video = ref(null);
const cameraOn = ref(false);
const cameraError = ref('');
let stream = null;
let detector = null;
let timer = null;
let lastCode = '';
let lastCodeAt = 0;

async function makeDetector() {
  if ('BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      if (supported.includes('ean_13')) return new window.BarcodeDetector({ formats: FORMATS.filter((f) => supported.includes(f)) });
    } catch {
      // fall back to the WebAssembly reader
    }
  }
  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
  prepareZXingModule({ overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } });
  return new BarcodeDetector({ formats: FORMATS });
}

async function startCamera() {
  cameraError.value = '';
  try {
    detector ??= await makeDetector();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    video.value.srcObject = stream;
    await video.value.play();
    cameraOn.value = true;
    scanLoop();
  } catch (err) {
    cameraError.value = !window.isSecureContext ? t('scan.needsHttps') : err?.name === 'NotAllowedError' ? t('scan.denied') : t('scan.noCamera');
    stopCamera();
  }
}

function stopCamera() {
  clearTimeout(timer);
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  cameraOn.value = false;
}

const paused = ref(false);

function scanLoop() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!cameraOn.value) return;
    if (!paused.value && video.value?.readyState >= 2) {
      try {
        const codes = await detector.detect(video.value);
        const code = codes.find((c) => /^\d{8,13}$/.test(c.rawValue))?.rawValue;
        // The same code stays in view for a while; only count it again after a pause
        if (code && (code !== lastCode || Date.now() - lastCodeAt > 4000)) {
          lastCode = code;
          lastCodeAt = Date.now();
          navigator.vibrate?.(60);
          handleCode(code);
        }
      } catch {
        // a frame that couldn't be read
      }
    }
    scanLoop();
  }, 180);
}

onBeforeUnmount(stopCamera);

// --- looking a code up ---

const manualCode = ref('');
const result = ref(null); // { code, isbn13, matches, book }
const looking = ref(false);
const step = ref('result'); // result | search | pick
const pickedSeries = ref(null);
const pickFilter = ref('');
const busyId = ref(null);

async function handleCode(code) {
  paused.value = true;
  looking.value = true;
  step.value = 'result';
  pickedSeries.value = null;
  try {
    result.value = await api(`/lookup/${encodeURIComponent(code)}`);
    const exact = result.value.matches;
    if (continuous.value && exact.length === 1) {
      const issue = exact[0];
      if (!issue.owned_at) await setStatus([issue.id], { owned: true });
      showToast(t(issue.owned_at ? 'scan.alreadyOwned' : 'scan.markedOwned', { name: `${issue.series_name} ${issueLabel(issue)}` }));
      result.value = null;
      paused.value = false;
      return;
    }
    if (!exact.length) step.value = result.value.book ? 'result' : 'search';
  } catch (err) {
    showToast(errorText(err));
    paused.value = false;
  } finally {
    looking.value = false;
  }
}

function submitManual() {
  const code = manualCode.value.replace(/[^0-9Xx]/g, '');
  if (code.length >= 8) handleCode(code);
}

function scanNext() {
  result.value = null;
  manualCode.value = '';
  step.value = 'result';
  paused.value = false;
  if (!cameraOn.value) startCamera();
}

async function toggleMatch(issue, flag) {
  const column = { owned: 'owned_at', read: 'read_at' }[flag];
  const value = !issue[column];
  issue[column] = value ? new Date().toISOString() : null;
  try {
    await setStatus([issue.id], { [flag]: value });
  } catch (err) {
    issue[column] = value ? null : new Date().toISOString();
    showToast(errorText(err));
  }
}

// What to search GCD for. Without a series title, long DNB titles like "Goscinny und
// Uderzo präsentieren ein neues Abenteuer von Asterix" are cut down to "Asterix".
const searchQuery = computed(() => {
  const b = result.value?.book;
  if (!b) return '';
  if (b.series) return b.series;
  const title = b.mainTitle || b.title || '';
  if (title.split(/\s+/).length <= 4) return title;
  return /\b(?:von|mit|of|with)\s+(\S+(?:\s+\S+)?)$/i.exec(title)?.[1] || title;
});

// --- assigning an unknown code to an issue ---

async function pickSeries(r) {
  busyId.value = r.gcdId;
  try {
    const id = r.localId || (await api('/series/import', { method: 'POST', body: { gcdId: r.gcdId } })).id;
    pickedSeries.value = await api(`/series/${id}`);
    pickFilter.value = result.value?.book?.volume || '';
    step.value = 'pick';
  } catch (err) {
    showToast(errorText(err));
  } finally {
    busyId.value = null;
  }
}

const pickList = computed(() => {
  const issues = pickedSeries.value?.issues || [];
  const f = pickFilter.value.trim().toLowerCase();
  if (!f) return issues;
  const exact = issues.filter((i) => i.number.toLowerCase() === f);
  return exact.length ? exact : issues.filter((i) => i.number.toLowerCase().includes(f) || i.title.toLowerCase().includes(f));
});

async function assign(issue) {
  try {
    await api(`/issues/${issue.id}/code`, { method: 'POST', body: { code: result.value.code, cover: result.value.book?.cover } });
    await setStatus([issue.id], { owned: true });
    showToast(t('scan.assigned', { name: `${pickedSeries.value.series.name} ${issueLabel(issue)}` }));
    scanNext();
  } catch (err) {
    showToast(errorText(err));
  }
}

// Not in GCD at all: make a hand-entered series from the library data
async function createFromBook() {
  const b = result.value.book;
  try {
    const name = searchQuery.value || b.title;
    const { id } = await api('/series', { method: 'POST', body: { name, publisher: b.publisher, year: b.year, language: 'de' } });
    const { ids } = await api(`/series/${id}/issues`, { method: 'POST', body: { numbers: b.volume || '1', title: b.title !== name ? b.title : '' } });
    await api(`/issues/${ids[0]}/code`, { method: 'POST', body: { code: result.value.code, cover: b.cover } });
    await setStatus(ids, { owned: true });
    showToast(t('scan.created', { name }));
    scanNext();
  } catch (err) {
    showToast(errorText(err));
  }
}
</script>

<template>
  <TopBar :title="t('scan.title')">
    <label class="check-label small"><input v-model="continuous" type="checkbox" /> {{ t('scan.continuous') }}</label>
  </TopBar>
  <main class="scan-page">
    <div class="camera" :class="{ on: cameraOn, paused }">
      <video ref="video" playsinline muted></video>
      <div v-if="cameraOn" class="aim"></div>
      <div v-if="!cameraOn" class="camera-off">
        <button class="btn primary big" @click="startCamera"><Icon name="camera" /> {{ t('scan.start') }}</button>
        <p v-if="cameraError" class="error">{{ cameraError }}</p>
      </div>
      <button v-if="cameraOn" class="icon-btn camera-close" :aria-label="t('scan.stop')" @click="stopCamera"><Icon name="close" /></button>
    </div>
    <p v-if="continuous" class="muted small">{{ t('scan.continuousHint') }}</p>

    <form class="search-row" @submit.prevent="submitManual">
      <input v-model="manualCode" inputmode="numeric" :placeholder="t('scan.manual')" />
      <button class="btn">{{ t('scan.lookup') }}</button>
    </form>

    <p v-if="looking" class="muted center">{{ t('scan.looking') }}</p>

    <section v-if="result && !looking" class="scan-result card">
      <p class="muted small">{{ result.isbn13 ? `ISBN ${result.isbn13}` : `${t('issue.barcode')} ${result.code}` }}</p>

      <!-- Known issues -->
      <template v-if="result.matches.length">
        <ul class="match-list">
          <li v-for="m in result.matches" :key="m.id">
            <RouterLink :to="`/issue/${m.id}`"><CoverImage class="thumb" :issue="m" /></RouterLink>
            <div class="match-body">
              <RouterLink :to="`/issue/${m.id}`" class="series-name">{{ m.series_name }} {{ issueLabel(m) }}</RouterLink>
              <div class="muted small">{{ m.title }}<template v-if="m.variant"> · {{ m.variant }}</template></div>
              <div class="status-buttons compact">
                <button class="status-btn s-owned" :class="{ on: m.owned_at }" @click="toggleMatch(m, 'owned')"><Icon name="check" /> {{ t('status.owned') }}</button>
                <button class="status-btn s-read" :class="{ on: m.read_at }" @click="toggleMatch(m, 'read')"><Icon name="book" /> {{ t('status.read') }}</button>
              </div>
            </div>
          </li>
        </ul>
      </template>

      <!-- Found in a library, not yet linked to an issue -->
      <template v-else-if="result.book && step === 'result'">
        <div class="book">
          <img v-if="result.book.cover" :src="`/api/library-cover/${result.isbn13}`" alt="" @error="$event.target.remove()" />
          <div>
            <strong>{{ result.book.series || result.book.mainTitle }}</strong>
            <div v-if="result.book.volume">{{ t('scan.volume', { n: result.book.volume }) }}</div>
            <div v-if="result.book.title && result.book.title !== result.book.series">{{ result.book.title }}</div>
            <div class="muted small">{{ [result.book.publisher, result.book.year].filter(Boolean).join(' · ') }} · {{ result.book.source }}</div>
          </div>
        </div>
        <div class="row-buttons">
          <button class="btn primary" @click="step = 'search'"><Icon name="search" /> {{ t('scan.findSeries') }}</button>
          <button class="btn subtle" @click="createFromBook">{{ t('scan.createOwn') }}</button>
        </div>
      </template>

      <!-- Find the series in GCD -->
      <template v-if="!result.matches.length && step === 'search'">
        <p v-if="!result.book" class="muted">{{ t('scan.unknown') }}</p>
        <SeriesSearch :initial-query="searchQuery" :pick-label="t('scan.choose')" :busy-id="busyId" @pick="pickSeries" />
      </template>

      <!-- Pick the issue -->
      <template v-if="step === 'pick' && pickedSeries">
        <h3>{{ pickedSeries.series.name }}</h3>
        <input v-model="pickFilter" :placeholder="t('scan.whichNumber')" inputmode="numeric" />
        <ul class="pick-list">
          <li v-for="i in pickList.slice(0, 60)" :key="i.id">
            <button @click="assign(i)">
              <span class="num">{{ i.number || '–' }}</span>
              <span class="title">{{ i.title }}<small v-if="i.variant"> {{ i.variant }}</small></span>
              <Icon v-if="i.owned_at" name="check" />
            </button>
          </li>
        </ul>
        <button class="link-btn" @click="step = 'search'">{{ t('scan.otherSeries') }}</button>
      </template>

      <button class="btn wide" @click="scanNext"><Icon name="scan" /> {{ t('scan.next') }}</button>
    </section>
  </main>
</template>
