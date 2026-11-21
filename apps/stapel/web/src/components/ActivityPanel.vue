<script setup>
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { lang, t } from '../i18n.js';
import { activity, activityVisible, refreshActivity, seriesToPick, setMinimized, startActivity, stopActivity } from '../activity.js';
import { errorText, fmtWhen, showToast } from '../util.js';
import Icon from '../kit/components/Icon.vue';

// One indicator for everything that loads in the background: a pill above the
// bottom navigation (or just an icon when minimized) that opens a panel with
// one row per series.
const route = useRoute();
const router = useRouter();

onMounted(startActivity);
onBeforeUnmount(stopActivity);
watch(() => route.fullPath, () => (activity.open = false));

const data = computed(() => activity.data);
const pct = (done, waiting) => (done + waiting ? Math.round((done / (done + waiting)) * 100) : 0);
const fmtClock = (iso) => new Date(iso).toLocaleTimeString(lang.value, { hour: '2-digit', minute: '2-digit' });

const pillText = computed(() => {
  const cv = data.value?.comicvine;
  if (cv?.waiting) return t('activity.pill', { n: cv.waiting, when: fmtWhen(cv.doneAt) });
  if (seriesToPick.value.length) return t('activity.pickPill', { n: seriesToPick.value.length });
  return t('activity.working');
});
const badge = computed(() => data.value?.comicvine.waiting || seriesToPick.value.length || '');

function pick(series) {
  activity.open = false;
  router.push({ path: `/series/${series.id}`, query: { cv: '1' } });
}

async function detailsFirst(series) {
  try {
    await api(`/series/${series.id}/covers`, { method: 'POST' });
    showToast(t('series.coversRequested'));
    refreshActivity();
  } catch (err) {
    showToast(errorText(err));
  }
}
</script>

<template>
  <template v-if="activityVisible || activity.open">
    <div v-if="activity.open" class="menu-backdrop" @click="activity.open = false"></div>

    <section v-if="activity.open && data" class="activity-panel" :aria-label="t('activity.title')">
      <header>
        <h2>{{ t('activity.title') }}</h2>
        <button class="link-btn" @click="setMinimized(!activity.minimized)">{{ activity.minimized ? t('activity.restore') : t('activity.minimize') }}</button>
        <button class="icon-btn" :aria-label="t('close')" @click="activity.open = false"><Icon name="close" /></button>
      </header>

      <ul class="activity-list">
        <li v-for="s in data.series" :key="s.id">
          <RouterLink :to="`/series/${s.id}`" class="activity-name">{{ s.name }}</RouterLink>

          <template v-if="s.cv">
            <div v-if="s.cv.state === 'unmatched'" class="activity-row warn-row">
              <span>{{ t('activity.noCvSeries') }}</span>
              <button class="btn small" @click="pick(s)">{{ t('cv.pick') }}</button>
            </div>
            <div v-else-if="s.cv.state === null" class="activity-row muted">{{ t('activity.looking') }}</div>
            <div v-else-if="s.cv.volumeName && !s.cv.synced" class="activity-row muted">{{ t('activity.assigning') }}</div>
            <div v-else-if="s.cv.waiting" class="activity-row">
              <span class="label">{{ t('activity.covers') }}</span>
              <span class="bar"><span :style="{ width: `${pct(s.cv.done, s.cv.waiting)}%` }"></span></span>
              <span class="count">{{ s.cv.done }}/{{ s.cv.done + s.cv.waiting }}</span>
              <span class="when">{{ fmtWhen(s.cv.doneAt) }}</span>
            </div>
          </template>

          <div v-if="s.details.waiting" class="activity-row">
            <span class="label">{{ t('activity.details') }}</span>
            <span class="bar details"><span :style="{ width: `${pct(s.details.done, s.details.waiting)}%` }"></span></span>
            <span class="count">{{ s.details.done }}/{{ s.details.done + s.details.waiting }}</span>
            <span class="when">{{ fmtWhen(s.details.doneAt) }}</span>
            <button v-if="!s.details.requested" class="link-btn" :title="t('series.loadCovers', { n: s.details.waiting })" @click="detailsFirst(s)">{{ t('series.coversFirst') }}</button>
          </div>
        </li>
        <li v-if="!data.series.length" class="muted">{{ t('activity.nothing') }}</li>
      </ul>

      <p class="activity-foot muted">
        {{ t('activity.gcdRate', { n: data.gcd.perHour }) }}
        <template v-if="data.gcd.pausedUntil"> · {{ t('series.coversPaused', { time: fmtClock(data.gcd.pausedUntil) }) }}</template>
        <template v-if="data.comicvine.cooldownUntil"> · {{ t('activity.cvPaused', { time: fmtClock(data.comicvine.cooldownUntil) }) }}</template>
      </p>
    </section>

    <button v-else-if="activity.minimized" class="activity-mini" :aria-label="t('activity.title')" @click="activity.open = true">
      <Icon name="hourglass" />
      <span v-if="badge" class="badge">{{ badge }}</span>
    </button>

    <div v-else class="activity-pill">
      <button class="activity-pill-main" :class="{ warn: !data?.comicvine.waiting && seriesToPick.length }" @click="activity.open = true">
        <Icon :name="data?.comicvine.waiting ? 'hourglass' : 'image'" />
        <span>{{ pillText }}</span>
      </button>
      <button class="icon-btn" :aria-label="t('activity.minimize')" @click="setMinimized(true)"><Icon name="minus" /></button>
    </div>
  </template>
</template>
