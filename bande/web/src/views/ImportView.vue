<script setup>
// Imports a WhatsApp chat export (.txt or .zip): assign who wrote what, keep the message counts,
// then pick the messages that look like plans as events.
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, loadFriends, refreshFriends, setDraft, takeSharedFile } from '../api.js';
import { t } from '../i18n.js';
import { errorText, formatDate, isoDate, KIND_ICONS, showToast } from '../util.js';
import TopBar from '../components/TopBar.vue';
import Icon from '../components/Icon.vue';

const router = useRouter();
const friends = ref([]);
const preview = ref(null);
const mapping = ref({}); // sender → friend id | 'me' | ''
const result = ref(null);
const created = ref(new Set());
const busy = ref(false);
const today = isoDate();

onMounted(async () => {
  friends.value = (await loadFriends()).filter((f) => !f.archived);
  const shared = takeSharedFile();
  if (shared) await upload(shared.blob, shared.name);
});

async function pick(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (file) await upload(file, file.name);
}

async function upload(blob, name) {
  busy.value = true;
  try {
    preview.value = await api(`/whatsapp/preview?name=${encodeURIComponent(name || '')}`, { method: 'POST', raw: blob });
    mapping.value = Object.fromEntries(preview.value.senders.map((s) => [s.name, s.guess ?? '']));
  } catch (err) {
    showToast(errorText(err));
  } finally {
    busy.value = false;
  }
}

const ready = computed(() => Object.values(mapping.value).some((v) => Number.isInteger(v)));

async function createFriend(sender) {
  try {
    const friend = await api('/friends', { method: 'POST', body: { name: sender } });
    refreshFriends();
    friends.value = (await loadFriends()).filter((f) => !f.archived);
    mapping.value[sender] = friend.id;
  } catch (err) {
    showToast(errorText(err));
  }
}

function onSelect(sender, value) {
  if (value === 'new') createFriend(sender);
  else mapping.value[sender] = value === 'me' || value === '' ? value : Number(value);
}

async function runImport() {
  busy.value = true;
  try {
    result.value = await api('/whatsapp/import', { method: 'POST', body: { id: preview.value.id, mapping: mapping.value } });
    showToast(t('import.done'));
  } catch (err) {
    showToast(errorText(err));
  } finally {
    busy.value = false;
  }
}

const planBody = (p) => ({
  title: p.title,
  kind: p.kind,
  status: !p.date ? 'idea' : p.date >= today ? 'planned' : 'done',
  date: p.date,
  time: p.time,
  friendIds: p.friendIds,
  notes: `${p.sender}: ${p.text}`,
  source: 'whatsapp',
});

async function createPlan(p) {
  try {
    await api('/events', { method: 'POST', body: planBody(p) });
    created.value = new Set([...created.value, p.at + p.text]);
  } catch (err) {
    showToast(errorText(err));
  }
}

function editPlan(p) {
  setDraft(planBody(p));
  router.push('/event/new');
}

const friendName = (id) => friends.value.find((f) => f.id === id)?.name;
</script>

<template>
  <TopBar :title="t('import.title')" back="/settings" />
  <main>
    <section v-if="!preview" class="card form">
      <p>{{ t('import.intro') }}</p>
      <ol class="how">
        <li>{{ t('import.step1') }}</li>
        <li>{{ t('import.step2') }}</li>
        <li>{{ t('import.step3') }}</li>
      </ol>
      <p class="muted small">{{ t('import.privacy') }}</p>
      <label class="btn primary" :class="{ disabled: busy }">
        <Icon name="upload" /> {{ busy ? t('import.reading') : t('import.choose') }}
        <input type="file" accept=".txt,.zip,text/plain,application/zip" hidden :disabled="busy" @change="pick" />
      </label>
    </section>

    <section v-else-if="!result" class="card form">
      <h2>{{ preview.name }}</h2>
      <p class="muted small">{{ t('import.summary', { n: preview.messages.toLocaleString(), from: formatDate(preview.first.slice(0, 10), { weekday: false }), to: formatDate(preview.last.slice(0, 10), { weekday: false }) }) }}</p>
      <h3>{{ t('import.whoIsWho') }}</h3>
      <ul class="plain-list sender-list">
        <li v-for="s in preview.senders" :key="s.name">
          <span class="grow"><strong>{{ s.name }}</strong> <small class="muted">{{ t('import.messages', { n: s.count }) }}</small></span>
          <select :value="mapping[s.name]" @change="onSelect(s.name, $event.target.value)">
            <option value="">{{ t('import.nobody') }}</option>
            <option value="me">{{ t('import.me') }}</option>
            <option v-for="f in friends" :key="f.id" :value="f.id">{{ f.name }}</option>
            <option value="new">{{ t('import.newFriend', { name: s.name }) }}</option>
          </select>
        </li>
      </ul>
      <p class="muted small">{{ t('import.mappingHint') }}</p>
      <button class="btn primary" :disabled="busy || !ready" @click="runImport">{{ t('import.run') }}</button>
    </section>

    <template v-else>
      <div class="card">
        <p><Icon name="check" class="ok" /> {{ t('import.saved') }}</p>
        <div class="row-buttons">
          <RouterLink v-for="id in result.friendIds" :key="id" :to="`/friend/${id}`" class="btn small">{{ friendName(id) }}</RouterLink>
        </div>
      </div>
      <h2 class="section">{{ t('import.plansTitle') }}</h2>
      <p v-if="!result.plans.length" class="muted">{{ t('import.noPlans') }}</p>
      <p v-else class="muted small">{{ t('import.plansHint') }}</p>
      <ul class="card-list">
        <li v-for="p in result.plans" :key="p.at + p.text" class="plan-row">
          <div class="plan-head">
            <Icon :name="KIND_ICONS[p.kind]" />
            <strong>{{ p.date ? formatDate(p.date) : t('status.idea') }}<template v-if="p.time"> · {{ p.time }}</template></strong>
            <small class="muted">{{ p.sender }}, {{ formatDate(p.at.slice(0, 10), { weekday: false }) }}</small>
          </div>
          <p class="plan-text">{{ p.text }}</p>
          <div class="row-buttons">
            <span v-if="created.has(p.at + p.text)" class="ok"><Icon name="check" /> {{ t('import.created') }}</span>
            <template v-else>
              <button class="btn small" @click="createPlan(p)"><Icon name="plus" /> {{ t('import.create') }}</button>
              <button class="btn small subtle" @click="editPlan(p)"><Icon name="edit" /> {{ t('import.edit') }}</button>
            </template>
          </div>
        </li>
      </ul>
    </template>
  </main>
</template>
