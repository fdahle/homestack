<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { browseLinks, lang, t } from '../i18n.js';
import { errorText, fmtDate, showToast, timeAgo } from '../util.js';
import { afterAdding } from '../blogs.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';

// Blogs you might like: from what your blogs link to, Substack recommendations, and Claude
const router = useRouter();
const show = ref('new');
const data = ref(null);
const error = ref('');
const wish = ref('');
const busy = ref(null); // id of the suggestion being added, or 'ai'

async function load() {
  try {
    data.value = await api(`/discover?show=${show.value}`);
  } catch (err) {
    error.value = errorText(err);
  }
}
onMounted(load);
watch(show, load);

// While it's looking: ask every few seconds, and load when it's done
let timer = null;
watch(() => data.value?.running, (running) => {
  clearInterval(timer);
  if (!running) return;
  timer = setInterval(async () => {
    const status = await api('/discover/status').catch(() => null);
    if (status && !status.running) load();
  }, 4000);
});
onBeforeUnmount(() => clearInterval(timer));

async function run(ai) {
  busy.value = ai ? 'ai' : 'refresh';
  try {
    await api('/discover/run', { method: 'POST', body: { ai, wish: wish.value } });
    data.value.running = true;
  } finally {
    busy.value = null;
  }
}

async function add(s) {
  busy.value = s.id;
  try {
    const added = await api(`/discover/${s.id}`, { method: 'POST', body: { action: 'add' } });
    showToast(t('discover.added', { name: s.name || s.host }));
    afterAdding(router, added);
  } catch (err) {
    showToast(err.data?.message || errorText(err));
  } finally {
    busy.value = null;
  }
}

async function setStatus(s, action) {
  const list = data.value.suggestions;
  const i = list.indexOf(s);
  list.splice(i, 1);
  await api(`/discover/${s.id}`, { method: 'POST', body: { action } });
  const back = show.value === 'later' ? 'later' : 'new';
  showToast(t(action === 'later' ? 'discover.savedLater' : 'discover.dismissed'), {
    label: t('undo'),
    run: async () => {
      await api(`/discover/${s.id}`, { method: 'POST', body: { action: back } });
      list.splice(i, 0, s);
    },
  });
}

function reasons(s) {
  const out = [];
  if (s.sources.links) {
    const blogs = [...s.sources.links.blogs].sort((a, b) => b.n - a.n).map((b) => `${b.name} (${b.n})`).join(', ');
    out.push(t('discover.linkedFrom', { posts: s.sources.links.posts, blogs }));
  }
  if (s.sources.substack?.length) out.push(t('discover.recommendedBy', { names: s.sources.substack.join(', ') }));
  if (s.sources.ai) out.push(t('discover.claude', { text: s.sources.ai }));
  return out;
}

const num = (n) => n.toLocaleString(lang.value);
const emptyText = computed(() => {
  if (show.value === 'later') return t('discover.emptyLater');
  return data.value?.progress.done === 0 ? t('discover.emptyFirst') : t('discover.empty');
});
</script>

<template>
  <TopBar :title="t('discover.title')" />
  <main>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="!data" class="muted center">…</p>
    <template v-else>
      <p v-if="data.running" class="info"><Icon name="refresh" />{{ t('discover.running') }}</p>
      <p v-else-if="data.status && !data.status.ok" class="info warn-box">{{ t('discover.failed', { message: data.status.message }) }}</p>

      <form v-if="data.aiEnabled" class="ai-box" @submit.prevent="run(true)">
        <input v-model="wish" :placeholder="t('discover.wish')" :aria-label="t('discover.wish')" maxlength="300" />
        <button class="btn" :disabled="busy === 'ai' || data.running">{{ busy === 'ai' ? t('discover.asking') : t('discover.ask') }}</button>
      </form>

      <div class="segmented wide" role="tablist">
        <button role="tab" :class="{ active: show === 'new' }" :aria-selected="show === 'new'" @click="show = 'new'">{{ t('discover.suggestions') }} <small class="count">{{ data.counts.new }}</small></button>
        <button role="tab" :class="{ active: show === 'later' }" :aria-selected="show === 'later'" @click="show = 'later'">{{ t('discover.later') }} <small class="count">{{ data.counts.later }}</small></button>
      </div>

      <div v-if="data.suggestions.length" class="suggestions">
        <article v-for="s in data.suggestions" :key="s.id" class="card suggestion">
          <h2><a :href="s.url" target="_blank" rel="noopener">{{ s.name || s.host }}</a></h2>
          <p class="meta"><span>{{ s.host }}</span><span v-if="s.last_post">{{ t('discover.lastPost', { date: fmtDate(s.last_post) }) }}</span></p>
          <p v-if="s.description" class="suggestion-desc">{{ s.description }}</p>
          <ul class="why"><li v-for="r in reasons(s)" :key="r">{{ r }}</li></ul>
          <ul v-if="s.samples.length" class="samples">
            <li v-for="p in s.samples" :key="p.url"><a :href="p.url" target="_blank" rel="noopener">{{ p.title }}</a></li>
          </ul>
          <div class="row-buttons">
            <button class="btn primary" :disabled="busy === s.id" @click="add(s)"><Icon name="plus" />{{ busy === s.id ? t('discover.adding') : t('discover.add') }}</button>
            <button v-if="s.status !== 'later'" class="btn" @click="setStatus(s, 'later')">{{ t('discover.saveLater') }}</button>
            <button class="btn subtle" @click="setStatus(s, 'dismissed')">{{ t('discover.dismiss') }}</button>
          </div>
        </article>
      </div>
      <p v-else class="empty">{{ emptyText }}</p>

      <section class="card form">
        <h2>{{ t('discover.how') }}</h2>
        <p class="small">
          {{ t('discover.howLinks', {
            links: num(data.progress.links), done: num(data.progress.done), total: num(data.progress.total),
            rest: data.progress.done < data.progress.total ? t('discover.howRest') : '',
            ai: data.aiEnabled ? t('discover.howAi') : '',
          }) }}
        </p>
        <p class="small">{{ t('discover.howChecked') }}<template v-if="data.counts.unchecked">{{ t('discover.howUnchecked', { n: data.counts.unchecked }) }}</template></p>
        <p class="muted small">{{ t('discover.lastUpdate', { when: data.status ? `${timeAgo(data.status.at)} · ${data.status.message}` : t('ago.never') }) }}</p>
        <button class="btn" :disabled="data.running || busy === 'refresh'" @click="run(false)"><Icon name="refresh" />{{ t('discover.refresh') }}</button>
        <p v-if="!data.aiEnabled" class="muted small">{{ t('discover.noAi') }}</p>
      </section>

      <section class="card form">
        <h2>{{ t('discover.browse') }}</h2>
        <ul class="browse-links">
          <li v-for="[href, name, what] in browseLinks()" :key="href"><a :href="href" target="_blank" rel="noopener">{{ name }}</a> <span class="muted">– {{ what }}</span></li>
        </ul>
      </section>
    </template>
  </main>
</template>
