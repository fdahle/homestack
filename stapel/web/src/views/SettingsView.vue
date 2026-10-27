<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, session } from '../api.js';
import { t } from '../i18n.js';
import { errorText, showToast } from '../util.js';
import TopBar from '../components/TopBar.vue';

const router = useRouter();
const system = ref(null);
const users = ref([]);
const profile = ref({ displayName: session.user.display_name, lang: session.user.lang });
const pw = ref({ currentPassword: '', newPassword: '' });
const newUser = ref({ username: '', displayName: '', password: '', lang: 'de' });

onMounted(async () => {
  system.value = await api('/system');
  if (session.user.is_admin) users.value = await api('/users');
});

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
    showToast(t('settings.passwordChanged'));
  } catch (err) {
    showToast(errorText(err));
  }
}

async function addUser() {
  try {
    users.value = await api('/users', { method: 'POST', body: newUser.value });
    showToast(t('settings.userAdded', { name: newUser.value.username }));
    newUser.value = { username: '', displayName: '', password: '', lang: 'de' };
  } catch (err) {
    showToast(errorText(err));
  }
}

async function removeUser(u) {
  if (!confirm(t('settings.confirmRemoveUser', { name: u.display_name }))) return;
  users.value = await api(`/users/${u.id}`, { method: 'DELETE' });
}

async function logout() {
  await api('/logout', { method: 'POST' });
  session.user = null;
  router.replace('/login');
}

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString(session.user.lang, { hour: '2-digit', minute: '2-digit' }) : '');
</script>

<template>
  <TopBar :title="t('nav.settings')" back="/" />
  <main class="settings">
    <form class="card form" @submit.prevent="saveProfile">
      <h2>{{ t('settings.profile') }}</h2>
      <label><span>{{ t('settings.displayName') }}</span><input v-model="profile.displayName" /></label>
      <label>
        <span>{{ t('settings.language') }}</span>
        <select v-model="profile.lang"><option value="de">Deutsch</option><option value="en">English</option></select>
      </label>
      <button class="btn primary">{{ t('save') }}</button>
    </form>

    <form class="card form" @submit.prevent="changePassword">
      <h2>{{ t('settings.password') }}</h2>
      <label><span>{{ t('settings.currentPassword') }}</span><input v-model="pw.currentPassword" type="password" autocomplete="current-password" required /></label>
      <label><span>{{ t('settings.newPassword') }}</span><input v-model="pw.newPassword" type="password" autocomplete="new-password" minlength="8" required /></label>
      <button class="btn">{{ t('settings.changePassword') }}</button>
    </form>

    <section v-if="session.user.is_admin" class="card form">
      <h2>{{ t('settings.users') }}</h2>
      <ul class="plain-list">
        <li v-for="u in users" :key="u.id" class="user-row">
          <span><strong>{{ u.display_name }}</strong> <span class="muted">{{ u.username }}{{ u.is_admin ? ' · admin' : '' }}</span></span>
          <button v-if="u.id !== session.user.id" class="link-btn danger" @click="removeUser(u)">{{ t('settings.remove') }}</button>
        </li>
      </ul>
      <form @submit.prevent="addUser">
        <h3>{{ t('settings.addUser') }}</h3>
        <div class="two">
          <label><span>{{ t('login.username') }}</span><input v-model="newUser.username" autocapitalize="none" required /></label>
          <label><span>{{ t('settings.displayName') }}</span><input v-model="newUser.displayName" /></label>
        </div>
        <div class="two">
          <label><span>{{ t('login.password') }}</span><input v-model="newUser.password" type="text" minlength="8" autocomplete="off" required /></label>
          <label>
            <span>{{ t('settings.language') }}</span>
            <select v-model="newUser.lang"><option value="de">Deutsch</option><option value="en">English</option></select>
          </label>
        </div>
        <p class="muted small">{{ t('settings.addUserHint') }}</p>
        <button class="btn">{{ t('settings.addUser') }}</button>
      </form>
    </section>

    <section class="card form">
      <h2>{{ t('settings.export') }}</h2>
      <p class="muted small">{{ t('settings.exportHint') }}</p>
      <div class="row-buttons">
        <a class="btn" href="/api/export.csv" download>CSV</a>
        <a class="btn" href="/api/export.json" download>JSON</a>
      </div>
    </section>

    <section v-if="system" class="card form">
      <h2>{{ t('settings.gcd') }}</h2>
      <p class="muted small">{{ t('settings.gcdHint') }}</p>
      <dl class="facts">
        <dt>{{ t('settings.requestsHour') }}</dt><dd>{{ system.gcd.hour }} / {{ system.gcd.limits.hour }}</dd>
        <dt>{{ t('settings.requestsDay') }}</dt><dd>{{ system.gcd.day }} / {{ system.gcd.limits.day }}</dd>
        <dt>{{ t('settings.pendingDetails') }}</dt><dd>{{ system.worker.pending }}</dd>
        <dt>{{ t('settings.storedCovers') }}</dt><dd>{{ system.covers }}</dd>
        <template v-if="system.gcd.cooldownUntil"><dt>{{ t('settings.pausedUntil') }}</dt><dd>{{ fmtTime(system.gcd.cooldownUntil) }}</dd></template>
      </dl>
      <p class="muted small">{{ t('settings.attribution') }}</p>
    </section>

    <button class="btn wide subtle" @click="logout">{{ t('settings.logout') }}</button>
  </main>
</template>
