<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, session } from '../api.js';
import { t } from '../i18n.js';
import { errorText, formatDate, showToast } from '../util.js';
import TopBar from '../components/TopBar.vue';
import Icon from '../components/Icon.vue';

const router = useRouter();
const settings = ref(null);
const chats = ref([]);
const profile = ref({ displayName: session.user.display_name, lang: session.user.lang });
const pw = ref({ currentPassword: '', newPassword: '' });
const myNames = ref('');
const pushState = ref('unknown'); // unsupported | denied | off | on
const pushBusy = ref(false);

onMounted(async () => {
  settings.value = await api('/settings');
  myNames.value = settings.value.whatsappMe.join(', ');
  chats.value = await api('/chats');
  await checkPush();
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

// --- push on this device ---

async function registration() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  return navigator.serviceWorker.ready;
}

async function checkPush() {
  const reg = await registration();
  if (!reg) return (pushState.value = 'unsupported');
  if (Notification.permission === 'denied') return (pushState.value = 'denied');
  pushState.value = (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}

function keyBytes(base64url) {
  const raw = atob(base64url.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function enablePush() {
  pushBusy.value = true;
  try {
    if ((await Notification.requestPermission()) !== 'granted') return await checkPush();
    const reg = await registration();
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(settings.value.pushKey) });
    settings.value = await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
    await checkPush();
  } catch (err) {
    showToast(errorText(err));
  } finally {
    pushBusy.value = false;
  }
}

async function disablePush() {
  pushBusy.value = true;
  try {
    const sub = await (await registration()).pushManager.getSubscription();
    if (sub) {
      settings.value = await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
      await sub.unsubscribe();
    }
    await checkPush();
  } finally {
    pushBusy.value = false;
  }
}

async function testPush() {
  const { delivered } = await api('/push/test', { method: 'POST' });
  if (!delivered) showToast(t('settings.pushNotDelivered'));
}

async function saveReminders() {
  settings.value = await api('/settings', { method: 'PATCH', body: { reminders: settings.value.reminders } });
}

// --- calendar ---

const icsUrl = computed(() => (settings.value ? `${location.origin}${settings.value.icsPath}` : ''));
const webcalUrl = computed(() => icsUrl.value.replace(/^https?:/, 'webcal:'));

async function copyIcs() {
  try {
    await navigator.clipboard.writeText(icsUrl.value);
    showToast(t('settings.copied'));
  } catch {
    showToast(errorText(null));
  }
}

async function newIcsUrl() {
  if (!confirm(t('settings.icsRenewConfirm'))) return;
  settings.value = await api('/settings/ics-token', { method: 'POST' });
}

// --- WhatsApp ---

async function saveMyNames() {
  settings.value = await api('/settings', { method: 'PATCH', body: { whatsappMe: myNames.value.split(',').map((n) => n.trim()).filter(Boolean) } });
  showToast(t('saved'));
}

async function deleteChat(chat) {
  if (!confirm(t('settings.chatDeleteConfirm', { name: chat.name }))) return;
  chats.value = await api(`/chats/${chat.id}`, { method: 'DELETE' });
}

async function logout() {
  await api('/logout', { method: 'POST' });
  session.user = null;
  router.replace('/login');
}
</script>

<template>
  <TopBar :title="t('nav.settings')" back="/" />
  <main class="settings">
    <section v-if="settings" class="card form">
      <h2><Icon name="bell" /> {{ t('settings.reminders') }}</h2>
      <p class="muted small">{{ t('settings.remindersHint', { hour: settings.reminderHour }) }}</p>
      <p v-if="pushState === 'unsupported'" class="warn small">{{ t('settings.pushUnsupported') }}</p>
      <p v-else-if="pushState === 'denied'" class="warn small">{{ t('settings.pushDenied') }}</p>
      <div v-else class="row-buttons">
        <button v-if="pushState === 'off'" class="btn primary" :disabled="pushBusy" @click="enablePush">{{ t('settings.pushOn') }}</button>
        <template v-if="pushState === 'on'">
          <span class="ok"><Icon name="check" /> {{ t('settings.pushActive') }}</span>
          <button class="btn small" @click="testPush">{{ t('settings.pushTest') }}</button>
          <button class="btn small subtle" :disabled="pushBusy" @click="disablePush">{{ t('settings.pushOff') }}</button>
        </template>
      </div>
      <p class="muted small">{{ t('settings.pushDevices', { n: settings.pushDevices }) }}</p>
      <label class="check-label"><input v-model="settings.reminders.birthdays" type="checkbox" @change="saveReminders" /> {{ t('settings.remindBirthdays') }}</label>
      <label class="check-label"><input v-model="settings.reminders.plans" type="checkbox" @change="saveReminders" /> {{ t('settings.remindPlans') }}</label>
      <label class="check-label"><input v-model="settings.reminders.contact" type="checkbox" @change="saveReminders" /> {{ t('settings.remindContact') }}</label>
    </section>

    <section v-if="settings" class="card form">
      <h2><Icon name="calendar" /> {{ t('settings.calendar') }}</h2>
      <p class="muted small">{{ t('settings.calendarHint') }}</p>
      <input :value="icsUrl" readonly @focus="$event.target.select()" />
      <div class="row-buttons">
        <button class="btn small" @click="copyIcs"><Icon name="copy" /> {{ t('settings.copy') }}</button>
        <a class="btn small" :href="webcalUrl"><Icon name="calendar" /> {{ t('settings.subscribe') }}</a>
        <button class="btn small subtle" @click="newIcsUrl"><Icon name="refresh" /> {{ t('settings.icsRenew') }}</button>
      </div>
    </section>

    <section v-if="settings" class="card form">
      <h2><Icon name="chat" /> WhatsApp</h2>
      <form @submit.prevent="saveMyNames">
        <label>
          <span>{{ t('settings.myNames') }}</span>
          <input v-model="myNames" :placeholder="t('settings.myNamesPlaceholder')" />
        </label>
        <p class="muted small">{{ t('settings.myNamesHint') }}</p>
        <button class="btn small">{{ t('save') }}</button>
      </form>
      <h3>{{ t('settings.chats') }}</h3>
      <ul v-if="chats.length" class="plain-list">
        <li v-for="c in chats" :key="c.id" class="user-row">
          <span>
            <strong>{{ c.name }}</strong>
            <span class="muted small"> · {{ t('import.messages', { n: c.messages }) }}<template v-if="c.last_at">, {{ t('settings.chatUntil', { date: formatDate(c.last_at.slice(0, 10), { weekday: false }) }) }}</template></span>
          </span>
          <button class="link-btn danger" @click="deleteChat(c)">{{ t('delete') }}</button>
        </li>
      </ul>
      <p v-else class="muted small">{{ t('settings.noChats') }}</p>
      <RouterLink class="btn small" to="/import"><Icon name="upload" /> {{ t('share.toImport') }}</RouterLink>
    </section>

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

    <section class="card form">
      <h2>{{ t('settings.export') }}</h2>
      <p class="muted small">{{ t('settings.exportHint') }}</p>
      <div class="row-buttons"><a class="btn" href="/api/export.json" download>JSON</a></div>
    </section>

    <button class="btn wide subtle" @click="logout">{{ t('settings.logout') }}</button>
  </main>
</template>
