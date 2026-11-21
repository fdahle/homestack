<script setup>
// One event: new (/event/new, optionally ?friend=…&status=idea or a draft from a share) or existing.
// An existing one opens beside the list it was picked from (home, timeline, friends; see router.js).
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, takeDraft } from '../api.js';
import { t } from '../i18n.js';
import { errorText, eventChanged, isoDate, KIND_ICONS, KINDS, mapsLink, showToast } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import FriendPicker from '../components/FriendPicker.vue';

const props = defineProps({ id: { type: String, default: null } });
const route = useRoute();
const router = useRouter();
const isNew = computed(() => !props.id);
// The list this event was opened from, to go to when there is no page to go back to
const listPath = computed(() => (isNew.value ? '/' : route.matched[0].path));
const today = isoDate();

const form = ref(null);
const multiDay = ref(false);
const busy = ref(false);
const error = ref('');
const STATUSES = ['idea', 'planned', 'done', 'cancelled'];

onMounted(async () => {
  if (!isNew.value) {
    let e;
    try {
      e = await api(`/events/${props.id}`);
    } catch (err) {
      error.value = errorText(err);
      return;
    }
    form.value = { ...e, friendIds: e.friends.map((f) => f.id) };
  } else {
    const draft = takeDraft();
    const friend = Number(route.query.friend);
    const status = STATUSES.includes(route.query.status) ? route.query.status : 'done';
    form.value = {
      title: '', kind: 'meet', status, date: status === 'idea' ? '' : today, time: '', end_date: '', place: '', notes: '', source: null,
      friendIds: friend ? [friend] : [],
      ...(draft || {}),
    };
  }
  for (const k of ['date', 'time', 'end_date', 'place', 'notes']) form.value[k] ??= '';
  multiDay.value = Boolean(form.value.end_date);
});

// A date in the future makes it a plan, one in the past something that happened
watch(() => form.value?.date, (date, before) => {
  if (!date || before === undefined) return;
  if (form.value.status === 'done' && date > today) form.value.status = 'planned';
  else if (form.value.status === 'planned' && date < today) form.value.status = 'done';
});

function setStatus(status) {
  form.value.status = status;
  if (status !== 'idea' && !form.value.date) form.value.date = today;
}

function goBack(fallback) {
  if (window.history.state?.back && !String(window.history.state.back).startsWith('/share')) router.back();
  else router.replace(fallback);
}

async function save() {
  busy.value = true;
  try {
    const body = { ...form.value, end_date: multiDay.value ? form.value.end_date : '' };
    delete body.friends;
    const saved = isNew.value
      ? await api('/events', { method: 'POST', body })
      : await api(`/events/${props.id}`, { method: 'PATCH', body });
    showToast(t('saved'));
    eventChanged(saved.id);
    goBack(saved.friends.length === 1 ? `/friend/${saved.friends[0].id}` : '/timeline');
  } catch (err) {
    showToast(errorText(err));
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!confirm(t('event.confirmDelete', { title: form.value.title }))) return;
  try {
    await api(`/events/${props.id}`, { method: 'DELETE' });
  } catch (err) {
    showToast(errorText(err));
    return;
  }
  eventChanged(Number(props.id));
  goBack(listPath.value);
}
</script>

<template>
  <TopBar :title="isNew ? t('event.newTitle') : form?.title || ''" :back="listPath" />
  <main v-if="error"><p class="error">{{ error }}</p></main>
  <main v-else-if="form">
    <form class="form" @submit.prevent="save">
      <p v-if="form.source === 'whatsapp' && isNew" class="info"><Icon name="chat" /> {{ t('event.fromWhatsapp') }}</p>

      <div class="segmented wide kinds" role="group" :aria-label="t('event.kind')">
        <button v-for="k in KINDS" :key="k" type="button" :class="{ active: form.kind === k }" :aria-pressed="form.kind === k" @click="form.kind = k">
          <Icon :name="KIND_ICONS[k]" /><span>{{ t(`kind.${k}`) }}</span>
        </button>
      </div>

      <label><span>{{ t('event.title') }}</span><input v-model="form.title" required :placeholder="t(`event.titlePlaceholder.${form.kind}`)" /></label>

      <div class="segmented wide" role="group" :aria-label="t('event.status')">
        <button v-for="s in STATUSES" :key="s" type="button" :class="{ active: form.status === s }" :aria-pressed="form.status === s" @click="setStatus(s)">{{ t(`status.${s}`) }}</button>
      </div>

      <template v-if="form.status !== 'idea'">
        <div class="two">
          <label><span>{{ multiDay ? t('event.from') : t('event.date') }}</span><input v-model="form.date" type="date" required /></label>
          <label v-if="multiDay"><span>{{ t('event.until') }}</span><input v-model="form.end_date" type="date" :min="form.date" /></label>
          <label v-else><span>{{ t('event.time') }}</span><input v-model="form.time" type="time" /></label>
        </div>
        <label class="check-label small"><input v-model="multiDay" type="checkbox" /> {{ t('event.multiDay') }}</label>
      </template>
      <p v-else class="muted small">{{ t('event.ideaHint') }}</p>

      <div>
        <label><span>{{ t('event.friends') }}</span></label>
        <FriendPicker v-model="form.friendIds" />
      </div>
      <div>
        <label><span>{{ t('event.place') }}</span><input v-model="form.place" /></label>
        <a v-if="form.place.trim()" class="map-link small" :href="mapsLink(form.place)" target="_blank" rel="noopener"><Icon name="map" /> {{ t('event.openMap') }}</a>
      </div>
      <label><span>{{ t('event.notes') }}</span><textarea v-model="form.notes" rows="5"></textarea></label>

      <button class="btn primary" :disabled="busy">{{ t('save') }}</button>
      <button v-if="!isNew" type="button" class="btn subtle danger" @click="remove"><Icon name="trash" /> {{ t('event.delete') }}</button>
    </form>
  </main>
</template>
