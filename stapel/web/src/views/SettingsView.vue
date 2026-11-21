<script setup>
import { onMounted, ref } from 'vue';
import { api, session } from '../api.js';
import { t } from '../i18n.js';
import { errorText, showToast } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import AccountCards from '../kit/components/AccountCards.vue';

const system = ref(null);
const users = ref([]);
const newUser = ref({ username: '', displayName: '', password: '', lang: 'de' });

onMounted(async () => {
  system.value = await api('/system');
  if (session.user.is_admin) users.value = await api('/users');
});

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

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString(session.user.lang, { hour: '2-digit', minute: '2-digit' }) : '');
</script>

<template>
  <TopBar :title="t('nav.settings')" sidebar-page back="/" />
  <main class="settings">
    <AccountCards>
    <!-- Behind a login proxy, people get their account by logging in there -->
    <section v-if="session.user.is_admin && !session.user.via_proxy" class="card form">
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
        <dt>{{ t('settings.comicvine') }}</dt><dd :class="system.comicvine.enabled ? 'ok' : 'warn'">{{ system.comicvine.enabled ? t('settings.comicvineYes') : t('settings.comicvineNo') }}</dd>
        <template v-if="system.comicvine.enabled"><dt>{{ t('settings.cvWaiting') }}</dt><dd>{{ system.comicvine.waiting }}</dd></template>
        <dt>{{ t('settings.account') }}</dt><dd :class="system.gcd.account ? 'ok' : 'warn'">{{ system.gcd.account ? t('settings.accountYes') : t('settings.accountNo') }}</dd>
        <dt>{{ t('settings.backgroundRate') }}</dt><dd>{{ t('settings.perHour', { n: system.gcd.backgroundPerHour }) }}</dd>
        <dt>{{ t('settings.requestsHour') }}</dt><dd>{{ system.gcd.hour }} / {{ system.gcd.limits.hour }}</dd>
        <dt>{{ t('settings.requestsDay') }}</dt><dd>{{ system.gcd.day }} / {{ system.gcd.limits.day }}</dd>
        <dt>{{ t('settings.pendingDetails') }}</dt><dd>{{ system.worker.pending }}</dd>
        <dt>{{ t('settings.storedCovers') }}</dt><dd>{{ system.covers }}</dd>
        <template v-if="system.gcd.cooldownUntil"><dt>{{ t('settings.pausedUntil') }}</dt><dd>{{ fmtTime(system.gcd.cooldownUntil) }}</dd></template>
      </dl>
      <p v-if="!system.comicvine.enabled" class="muted small">
        {{ t('settings.comicvineHint') }}
        <a href="https://comicvine.gamespot.com/api/" target="_blank" rel="noopener">comicvine.gamespot.com</a>
      </p>
      <p v-if="!system.gcd.account" class="muted small">
        {{ t('settings.accountHint') }}
        <a href="https://www.comics.org/accounts/register/" target="_blank" rel="noopener">comics.org</a>
      </p>
      <p class="muted small">{{ t('settings.attribution') }}</p>
    </section>

    </AccountCards>
  </main>
</template>
