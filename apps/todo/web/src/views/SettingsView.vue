<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { lang, t } from '../i18n.js';
import { errorText, relativeDay, showToast } from '../util.js';
import { areas, lists, loadSettings, openTasks, store, sync } from '../store/tasks.js';
import TopBar from '../kit/components/TopBar.vue';
import AreaEditor from '../kit/components/AreaEditor.vue';
import Icon from '../kit/components/Icon.vue';
import AccountCards from '../kit/components/AccountCards.vue';
import SyncState from '../components/SyncState.vue';

const settings = ref(null);
const online = ref(navigator.onLine);
const onLine = () => (online.value = navigator.onLine);
const pushState = ref('unknown'); // unsupported | denied | off | on
const pushBusy = ref(false);

onMounted(async () => {
  ['online', 'offline'].forEach((e) => window.addEventListener(e, onLine));
  settings.value = await loadSettings();
  await checkPush();
});
onBeforeUnmount(() => ['online', 'offline'].forEach((e) => window.removeEventListener(e, onLine)));

// --- reminders on this device ---

async function registration() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  return navigator.serviceWorker.getRegistration();
}

async function checkPush() {
  const reg = await registration();
  if (!reg) return (pushState.value = 'unsupported');
  if (Notification.permission === 'denied') return (pushState.value = 'denied');
  pushState.value = (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}

const keyBytes = (base64url) => Uint8Array.from(atob(base64url.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

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
    const sub = await (await registration())?.pushManager.getSubscription();
    if (sub) {
      settings.value = await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
      await sub.unsubscribe();
    }
    await checkPush();
  } catch (err) {
    showToast(errorText(err));
  } finally {
    pushBusy.value = false;
  }
}

async function testPush() {
  try {
    const { delivered } = await api('/push/test', { method: 'POST' });
    if (!delivered) showToast(t('settings.pushNotDelivered'));
  } catch (err) {
    showToast(errorText(err));
  }
}

async function setDigest(value) {
  try {
    settings.value = await api('/settings', { method: 'PATCH', body: { digestHour: value === 'off' ? null : Number(value) } });
    showToast(t('saved'));
  } catch (err) {
    showToast(errorText(err));
  }
}

// --- calendar feed ---

const icsUrl = computed(() => (settings.value?.icsPath ? `${location.origin}${settings.value.icsPath}` : ''));

async function copyIcs() {
  try {
    await navigator.clipboard.writeText(icsUrl.value);
    showToast(t('settings.copied'));
  } catch {
    showToast(errorText());
  }
}

async function newIcs() {
  if (!confirm(t('settings.newAddressConfirm'))) return;
  try {
    settings.value = await api('/settings/ics-token', { method: 'POST' });
  } catch (err) {
    showToast(errorText(err));
  }
}

// --- this device ---

const lastSync = computed(() => {
  if (!store.lastSync) return t('settings.never');
  const time = new Date(store.lastSync).toLocaleTimeString(lang.value, { hour: '2-digit', minute: '2-digit' });
  return t('settings.lastSync', { when: `${relativeDay(store.lastSync)}, ${time}` });
});
</script>

<template>
  <TopBar :title="t('nav.settings')" sidebar-page back="/" />
  <main>
    <AccountCards>
      <AreaEditor
        :areas="areas" :choices="lists.map((l) => ({ value: l.id, name: l.name, cls: l.color ? `c-${l.color}` : 'c-none' }))"
        :how="t('settings.areasHow')" :first="(list) => t('settings.areasFirst', { list })"
      />

      <section class="card form">
        <h2><Icon name="bell" />{{ t('settings.reminders') }}</h2>
        <p class="muted small">{{ t('settings.remindersHow') }}</p>
        <p v-if="!online" class="warn small">{{ t('settings.offlineOnly') }}</p>
        <template v-else-if="settings">
          <p v-if="pushState === 'unsupported'" class="warn small">{{ t('settings.pushUnsupported') }}</p>
          <p v-else-if="pushState === 'denied'" class="warn small">{{ t('settings.pushDenied') }}</p>
          <div class="row-buttons">
            <button v-if="pushState === 'off'" class="btn primary" :disabled="pushBusy" @click="enablePush"><Icon name="bell" />{{ t('settings.pushOn') }}</button>
            <template v-if="pushState === 'on'">
              <span class="ok"><Icon name="check" /> {{ t('settings.pushActive') }}</span>
              <button class="btn small" @click="testPush">{{ t('settings.pushTest') }}</button>
              <button class="btn small subtle" :disabled="pushBusy" @click="disablePush">{{ t('settings.pushOff') }}</button>
            </template>
          </div>
          <p class="muted small">{{ t('settings.pushDevices', { n: settings.pushDevices }) }}</p>
          <label class="setting-row">
            <span>{{ t('settings.digest') }}</span>
            <select :value="settings.digestHour ?? 'off'" @change="setDigest($event.target.value)">
              <option value="off">{{ t('settings.digestOff') }}</option>
              <option v-for="h in [5, 6, 7, 8, 9, 10, 11, 12]" :key="h" :value="h">{{ t('settings.digestAt', { h }) }}</option>
            </select>
          </label>
        </template>
      </section>

      <section class="card form">
        <h2><Icon name="calendar" />{{ t('settings.calendar') }}</h2>
        <p class="muted small">{{ t('settings.calendarHow') }}</p>
        <template v-if="icsUrl && online">
          <input class="ics-url" :value="icsUrl" readonly @focus="$event.target.select()" />
          <div class="row-buttons">
            <button class="btn small" @click="copyIcs"><Icon name="copy" />{{ t('settings.copy') }}</button>
            <button class="btn small subtle" @click="newIcs"><Icon name="refresh" />{{ t('settings.newAddress') }}</button>
          </div>
        </template>
        <p v-else-if="!online" class="warn small">{{ t('settings.offlineOnly') }}</p>
      </section>

      <section class="card form">
        <h2><Icon name="sync" />{{ t('settings.device') }}<span class="grow"></span><SyncState /></h2>
        <p class="muted small">{{ t('settings.deviceHow') }}</p>
        <div class="sync-facts">
          <span>{{ t('settings.stored', { n: openTasks.length }) }}</span>
          <span v-if="store.pending" class="warn">{{ t('settings.pending', { n: store.pending }) }}</span>
          <span class="muted">{{ lastSync }}</span>
          <span v-if="store.status === 'offline'" class="warn">{{ t('sync.offline') }}</span>
        </div>
        <button class="btn" :disabled="store.status === 'syncing'" @click="sync()"><Icon name="sync" />{{ t('settings.syncNow') }}</button>
      </section>
    </AccountCards>
  </main>
</template>
