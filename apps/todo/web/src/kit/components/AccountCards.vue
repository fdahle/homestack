<!-- Copied from kit/web/components/AccountCards.vue by kit/sync.mjs. Change it there, not here. -->
<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, session } from '../api.js';
import { t } from '../i18n.js';
import { errorText, showToast } from '../util.js';
import { applyTheme, theme, THEMES } from '../theme.js';
import Icon from './Icon.vue';

// Name, language, password and logout: the part of the settings every app has.
// Behind a login proxy (session.user.via_proxy) there is no password or logout here.
const router = useRouter();
const profile = ref({ displayName: session.user.display_name, lang: session.user.lang });
const pw = ref({ currentPassword: '', newPassword: '' });

async function saveProfile() {
  try {
    session.user = await api('/me', { method: 'PATCH', body: profile.value });
    showToast(t('saved'));
  } catch (err) {
    showToast(errorText(err));
  }
}

async function changePassword() {
  try {
    session.user = await api('/me', { method: 'PATCH', body: pw.value });
    pw.value = { currentPassword: '', newPassword: '' };
    showToast(t('account.passwordChanged'));
  } catch (err) {
    showToast(errorText(err));
  }
}

async function logout() {
  await api('/logout', { method: 'POST' }).catch(() => {});
  session.user = null;
  router.replace('/login');
}
</script>

<template>
  <form class="card form" @submit.prevent="saveProfile">
    <h2>{{ t('account.profile') }}</h2>
    <label><span>{{ t('account.name') }}</span><input v-model="profile.displayName" maxlength="80" /></label>
    <label>
      <span>{{ t('account.language') }}</span>
      <select v-model="profile.lang">
        <option value="de">Deutsch</option>
        <option value="en">English</option>
      </select>
    </label>
    <button class="btn primary">{{ t('save') }}</button>
  </form>

  <!-- Applies at once, and only on this device -->
  <section class="card form">
    <h2>{{ t('account.theme') }}</h2>
    <div class="segmented wide" role="radiogroup" :aria-label="t('account.theme')">
      <button v-for="value in THEMES" :key="value" type="button" role="radio" :class="{ active: theme === value }" :aria-checked="theme === value" @click="applyTheme(value)">
        {{ t(`account.themes.${value}`) }}
      </button>
    </div>
  </section>

  <slot />

  <p v-if="session.user.via_proxy" class="info">{{ t('account.viaProxy') }}</p>
  <template v-else>
    <form class="card form" @submit.prevent="changePassword">
      <h2>{{ t('account.password') }}</h2>
      <input type="text" :value="session.user.username" autocomplete="username" hidden />
      <label><span>{{ t('account.currentPassword') }}</span><input v-model="pw.currentPassword" type="password" autocomplete="current-password" required /></label>
      <label><span>{{ t('account.newPassword') }}</span><input v-model="pw.newPassword" type="password" autocomplete="new-password" minlength="8" required /></label>
      <button class="btn">{{ t('account.changePassword') }}</button>
    </form>
    <button class="btn wide danger" @click="logout"><Icon name="logout" />{{ t('account.logout') }}</button>
  </template>
</template>
