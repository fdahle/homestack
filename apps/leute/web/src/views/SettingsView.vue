<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { errorText, showToast } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import AccountCards from '../kit/components/AccountCards.vue';

const settings = ref(null);
const myNames = ref('');
const pushState = ref('unknown'); // unsupported | denied | off | on
const pushBusy = ref(false);

onMounted(async () => {
  settings.value = await api('/settings');
  myNames.value = settings.value.whatsappMe.join(', ');
  await checkPush();
});

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
</script>

<template>
  <TopBar :title="t('nav.settings')" sidebar-page back="/" />
  <main class="settings">
    <AccountCards>
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
      </section>

      <section class="card form">
        <h2>{{ t('settings.export') }}</h2>
        <p class="muted small">{{ t('settings.exportHint') }}</p>
        <div class="row-buttons"><a class="btn" href="/api/export.json" download><Icon name="download" /> JSON</a></div>
      </section>
    </AccountCards>
  </main>
</template>
