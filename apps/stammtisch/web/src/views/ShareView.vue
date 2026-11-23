<script setup>
// Where shares from other apps land, and where copied WhatsApp messages can be pasted. The text
// becomes a draft event. The share target in the manifest POSTs the text to the service worker
// (public/sw.js), which keeps it in a cache, so it never shows up in a URL; ?title=&text=&url=
// still works for older installs that share with GET.
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { draftFromText } from '../api.js';
import { t } from '../i18n.js';
import { errorText, showToast } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';

const route = useRoute();
const router = useRouter();
const text = ref('');
const busy = ref(false);
const sharedTitle = ref(String(route.query.title || ''));

// What the service worker kept from a share, read once and then thrown away
async function takeShared() {
  try {
    const cache = await caches.open('stammtisch-share');
    const response = await cache.match('/share/shared.json');
    if (!response) return null;
    await cache.delete('/share/shared.json');
    return await response.json();
  } catch {
    return null; // no Cache API (not a secure context) or nothing readable
  }
}

onMounted(async () => {
  let shared = [route.query.text, route.query.url].filter(Boolean).join('\n');
  const stash = await takeShared();
  if (!shared && stash) {
    shared = [stash.text, stash.url].filter(Boolean).join('\n');
    sharedTitle.value = String(stash.title || '');
  }
  if (shared) {
    text.value = shared;
    // Shared straight from another app: go on to the form
    await parse({ replace: true });
  }
});

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
    await draftFromText(text.value, { title: sharedTitle.value });
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
        <li>{{ t('share.howPhone') }}</li>
        <li>{{ t('share.howComputer') }}</li>
        <li>{{ t('share.howShare') }}</li>
      </ol>
    </section>
  </main>
</template>
