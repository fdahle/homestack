<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { errorText } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import { afterAdding } from '../blogs.js';

// A new blog: Backlog works out how to read it and fetches all its posts
const route = useRoute();
const router = useRouter();
const url = ref(String(route.query.url || ''));
const busy = ref(false);
const error = ref('');

async function add() {
  busy.value = true;
  error.value = '';
  try {
    afterAdding(router, await api('/blogs', { method: 'POST', body: { url: url.value } }));
  } catch (err) {
    error.value = err.data?.message ? t('add.failed', { message: err.data.message }) : errorText(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <TopBar :title="t('add.title')" />
  <main>
    <form class="card form" @submit.prevent="add">
      <label>
        <span>{{ t('add.address') }}</span>
        <input v-model="url" type="url" inputmode="url" required placeholder="https://acoup.blog" autofocus />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
      <button class="btn primary" :disabled="busy">{{ busy ? t('add.busy') : t('add.submit') }}</button>
      <p class="muted small">{{ t('add.how') }}</p>
    </form>
  </main>
</template>
