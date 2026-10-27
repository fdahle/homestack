<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, loadSession } from '../api.js';
import { t } from '../i18n.js';

const route = useRoute();
const router = useRouter();
const username = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  busy.value = true;
  error.value = '';
  try {
    await api('/login', { method: 'POST', body: { username: username.value, password: password.value } });
    await loadSession();
    const next = String(route.query.next || '/');
    router.replace(next.startsWith('/') && !next.startsWith('//') ? next : '/');
  } catch (err) {
    error.value = err.status === 401 ? t('login.wrong') : t('errors.generic');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="login">
    <form class="card login-card" @submit.prevent="submit">
      <img src="/icon.svg" alt="" width="64" height="64" />
      <h1>Stapel</h1>
      <label>
        <span>{{ t('login.username') }}</span>
        <input v-model="username" autocomplete="username" autocapitalize="none" required autofocus />
      </label>
      <label>
        <span>{{ t('login.password') }}</span>
        <input v-model="password" type="password" autocomplete="current-password" required />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
      <button class="btn primary" :disabled="busy">{{ t('login.submit') }}</button>
    </form>
  </main>
</template>
