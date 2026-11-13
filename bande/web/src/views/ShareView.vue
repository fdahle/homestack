<script setup>
// Where shares from other apps land (see the share target in the manifest and sw.js), and where
// copied WhatsApp messages can be pasted. Text becomes a draft event; a chat export goes to the import.
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, setDraft, setSharedFile } from '../api.js';
import { t } from '../i18n.js';
import { errorText, showToast } from '../util.js';
import TopBar from '../components/TopBar.vue';
import Icon from '../components/Icon.vue';

const route = useRoute();
const router = useRouter();
const text = ref('');
const title = ref('');
const busy = ref(false);
const lost = ref(Boolean(route.query.lost));

onMounted(async () => {
  if (route.query.file) {
    const file = await takeCachedFile();
    if (file) {
      setSharedFile(file);
      return router.replace('/import');
    }
    lost.value = true;
  }
  const shared = [route.query.share_text, route.query.share_url].filter(Boolean).join('\n');
  title.value = String(route.query.share_title || '');
  if (shared) {
    text.value = shared;
    // Copied messages ("[13.11.26, 17:05] Max: …") or a single shared message: go straight to the form
    await parse({ replace: true });
  }
});

async function takeCachedFile() {
  try {
    const cache = await caches.open('bande-share');
    const res = await cache.match('/shared-file');
    if (!res) return null;
    await cache.delete('/shared-file');
    return { blob: await res.blob(), name: decodeURIComponent(res.headers.get('X-Filename') || '') };
  } catch {
    return null;
  }
}

async function paste() {
  try {
    text.value = await navigator.clipboard.readText();
  } catch {
    showToast(t('share.pasteFailed'));
  }
}

async function parse({ replace = false } = {}) {
  if (!text.value.trim()) return;
  busy.value = true;
  try {
    const draft = await api('/share/parse', { method: 'POST', body: { text: text.value, title: title.value } });
    setDraft(draft);
    router[replace ? 'replace' : 'push']('/event/new');
  } catch (err) {
    showToast(errorText(err));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <TopBar :title="t('share.title')" back="/" />
  <main>
    <p v-if="lost" class="info warn-box">{{ t('share.lost') }}</p>
    <form class="form card" @submit.prevent="parse()">
      <p class="muted small">{{ t('share.intro') }}</p>
      <textarea v-model="text" rows="8" :placeholder="t('share.placeholder')"></textarea>
      <div class="row-buttons">
        <button type="button" class="btn" @click="paste"><Icon name="paste" /> {{ t('share.paste') }}</button>
        <button class="btn primary" :disabled="busy || !text.trim()">{{ t('share.next') }}</button>
      </div>
    </form>

    <section class="card form">
      <h2>{{ t('share.howTitle') }}</h2>
      <ol class="how">
        <li>{{ t('share.howCopy') }}</li>
        <li>{{ t('share.howShare') }}</li>
        <li>{{ t('share.howExport') }}</li>
      </ol>
      <RouterLink class="btn" to="/import"><Icon name="upload" /> {{ t('share.toImport') }}</RouterLink>
    </section>
  </main>
</template>
