<script setup>
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { errorText, showToast } from '../util.js';
import { rememberOpen } from '../articles.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';

// From the bookmarklet (/mark?url=…) or the share menu (/share?url=…&text=…): which post this
// is, and a button to mark it. Marking takes a tap, because any website can send a browser here.
const route = useRoute();
const info = ref(null);
const marked = ref(false);
const undone = ref(false);
const error = ref('');

onMounted(async () => {
  const query = new URLSearchParams();
  for (const key of ['url', 'text', 'title']) if (route.query[key]) query.set(key, String(route.query[key]));
  try {
    info.value = await api(`/mark?${query}`);
  } catch (err) {
    error.value = errorText(err);
  }
});

async function mark() {
  info.value = await api('/mark', { method: 'POST', body: { url: info.value.url } });
  marked.value = true;
}

async function addAsRead() {
  info.value = await api('/mark/add', { method: 'POST', body: { url: info.value.url, blogId: info.value.guessBlog.id } });
  marked.value = true;
}

async function undo() {
  await api('/read-many', { method: 'POST', body: { ids: info.value.matches.map((m) => m.id), read: false } });
  undone.value = true;
  showToast(t('article.markedUnread'));
}

const origin = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
};
</script>

<template>
  <TopBar :title="t('markPage.title')" back="/" />
  <main class="mark-page">
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="!info" class="muted center">…</p>

    <section v-else-if="info.matches.length" class="card mark-card">
      <div v-if="marked" class="big-check"><Icon name="check" /></div>
      <p class="muted">{{ marked ? t('markPage.marked') : info.matches[0].read_at ? t('markPage.already') : t('markPage.ask') }}</p>
      <h2>{{ info.matches[0].title }}</h2>
      <p class="muted">{{ info.matches[0].blog_name }}</p>
      <div class="row-buttons center">
        <button v-if="!marked" class="btn primary" autofocus @click="mark"><Icon name="check" />{{ t('markPage.mark') }}</button>
        <button v-else class="btn" :disabled="undone" @click="undo">{{ t('undo') }}</button>
        <RouterLink :to="`/blog/${info.matches[0].blog_id}`" class="btn">{{ t('markPage.openList') }}</RouterLink>
      </div>
      <template v-if="marked">
        <a v-if="info.next" class="btn primary wide" :href="info.next.url" @click="rememberOpen(info.next)">{{ t('markPage.next', { title: info.next.title }) }}</a>
        <p v-else class="muted">{{ t('markPage.last') }}</p>
      </template>
    </section>

    <section v-else-if="info.guessBlog" class="card mark-card">
      <p>{{ t('markPage.notInList', { name: info.guessBlog.name }) }}</p>
      <p class="muted small break">{{ info.url }}</p>
      <div class="row-buttons center">
        <button class="btn primary" @click="addAsRead">{{ t('markPage.addRead') }}</button>
        <RouterLink :to="`/blog/${info.guessBlog.id}/settings`" class="btn">{{ t('markPage.checkSettings') }}</RouterLink>
      </div>
    </section>

    <section v-else class="card mark-card">
      <p>{{ info.url ? t('markPage.notTracked') : t('markPage.noUrl') }}</p>
      <template v-if="info.url">
        <p class="muted small break">{{ info.url }}</p>
        <RouterLink :to="{ path: '/add', query: { url: origin(info.url) } }" class="btn primary">{{ t('markPage.track') }}</RouterLink>
      </template>
    </section>
  </main>
</template>
