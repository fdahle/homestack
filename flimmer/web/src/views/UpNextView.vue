<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { episodeCode, episodeName, errorText, formatDay, itemChange, itemPath, PATHS, relativeDay, showToast, toDate } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import SplitView from '../kit/components/SplitView.vue';
import ModeSwitch from '../components/ModeSwitch.vue';
import Poster from '../components/Poster.vue';

// What to watch next in each show you are watching, and what is coming soon
const route = useRoute();
const data = ref(null);
const error = ref('');
const busy = ref(new Set());

async function load() {
  try {
    data.value = await api('/upnext');
  } catch (err) {
    error.value = errorText(err);
  }
}
onMounted(load);

// Ticking an episode beside the list (on a computer) moves this list on too
watch(itemChange, (change) => {
  if (change?.mode === 'series') load();
});

async function seen(entry) {
  const id = entry.series.id;
  busy.value = new Set([...busy.value, id]);
  try {
    const res = await api(`/series/${id}/watch`, { method: 'POST', body: { episodes: [entry.episode.id], watched: true } });
    const { episodes, ...item } = res.series;
    itemChange.value = { mode: 'series', id, item };
    if (res.auto) {
      const { from, to } = res.auto;
      showToast(t(`series.auto.${to}`), {
        label: t('undo'),
        run: async () => {
          await api(`/series/${id}`, { method: 'PATCH', body: { status: from } }).catch(() => {});
          load();
        },
      });
    } else {
      showToast(t('upnext.ticked', { code: episodeCode(entry.episode), title: entry.series.title }));
    }
  } catch (err) {
    showToast(errorText(err));
  } finally {
    const next = new Set(busy.value);
    next.delete(id);
    busy.value = next;
  }
}

const base = PATHS.series.upnext;
const selected = (s) => String(s.id) === route.params.id;

// Coming soon, by day: today and tomorrow get words, the rest weekday and date
const days = computed(() => {
  const groups = new Map();
  for (const u of data.value?.upcoming || []) {
    if (!groups.has(u.episode.air_date)) groups.set(u.episode.air_date, []);
    groups.get(u.episode.air_date).push(u);
  }
  return [...groups].map(([day, list]) => ({ day, list }));
});
const daysAway = (day) => Math.round((toDate(day) - toDate(data.value.today)) / 86_400_000);
const dayLabel = (day) => (daysAway(day) <= 1 ? relativeDay(day, data.value.today) : formatDay(day, { weekday: true }));
</script>

<template>
  <SplitView>
    <TopBar :title="t('upnext.title')">
      <RouterLink to="/einstellungen" class="icon-btn phone-only" :aria-label="t('nav.settings')"><Icon name="gear" /></RouterLink>
    </TopBar>
    <main class="wide">
      <ModeSwitch class="phone-only page-mode" />
      <p v-if="error" class="error">{{ error }}</p>
      <p v-else-if="!data" class="muted center">…</p>

      <template v-else>
        <h2 class="section">{{ t('upnext.continue') }}</h2>
        <div v-if="data.next.length" class="next-list">
          <article v-for="n in data.next" :key="n.series.id" class="card next-card" :class="{ selected: selected(n.series) }">
            <RouterLink :to="itemPath('series', n.series.id, base)" class="next-poster"><Poster :item="n.series" /></RouterLink>
            <div class="next-body">
              <RouterLink :to="itemPath('series', n.series.id, base)" class="next-series">{{ n.series.title }}</RouterLink>
              <strong class="next-title">{{ episodeCode(n.episode) }} · {{ episodeName(n.episode) }}</strong>
              <small class="muted">
                <template v-if="n.episode.air_date">{{ formatDay(n.episode.air_date) }} · </template>{{ n.left > 1 ? t('upnext.left', { n: n.left - 1 }) : t('upnext.last') }}
              </small>
              <div class="progress st-watching"><span :style="{ '--p': n.series.total ? Math.round((n.series.watched / n.series.total) * 100) : 0 }"></span></div>
            </div>
            <button class="btn primary seen-btn" :disabled="busy.has(n.series.id)" :aria-label="`${t('upnext.seen')}: ${n.series.title} ${episodeCode(n.episode)}`" @click="seen(n)">
              <Icon name="check" /><span>{{ t('upnext.seen') }}</span>
            </button>
          </article>
        </div>
        <div v-else class="empty compact">
          <p>{{ t('upnext.nothing') }}</p>
          <RouterLink :to="PATHS.series.library" class="btn"><Icon name="tv" />{{ t('nav.series') }}</RouterLink>
        </div>

        <h2 class="section">{{ t('upnext.soon') }}</h2>
        <div v-if="days.length" class="soon">
          <section v-for="d in days" :key="d.day" class="soon-day">
            <h3 :class="{ near: daysAway(d.day) <= 1 }">{{ dayLabel(d.day) }}</h3>
            <ul class="card-list">
              <li v-for="u in d.list" :key="u.episode.id">
                <RouterLink :to="itemPath('series', u.series.id, base)" class="soon-row" :class="{ selected: selected(u.series) }">
                  <Poster class="thumb" :item="u.series" />
                  <span class="result-body">
                    <strong>{{ u.series.title }}</strong>
                    <span class="muted small">{{ episodeCode(u.episode) }} · {{ episodeName(u.episode) }}</span>
                  </span>
                </RouterLink>
              </li>
            </ul>
          </section>
        </div>
        <p v-else class="muted small">{{ t('upnext.noDates') }}</p>
      </template>
    </main>
  </SplitView>
</template>
