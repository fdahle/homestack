<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, refreshFriends } from '../api.js';
import { t } from '../i18n.js';
import { cityFromAddress, errorText, eventChanged, friendChange, showToast, squarePhoto } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import Avatar from '../components/Avatar.vue';
import PartialDate from '../kit/components/PartialDate.vue';

const props = defineProps({ id: { type: String, default: null } });
const router = useRouter();
const isNew = computed(() => !props.id);

const form = ref(null);
const circleInput = ref('');
const allCircles = ref([]);
const photo = ref(null); // a new photo (Blob) to upload on save
const photoPreview = ref(null);
const removePhoto = ref(false);
const busy = ref(false);

const CONTACT_WEEKS = [1, 2, 3, 4, 6, 8, 12, 26, 52];

onMounted(async () => {
  allCircles.value = (await api('/circles')).map((c) => c.name);
  if (isNew.value) {
    form.value = { name: '', nickname: '', birthday: '', city: '', address: '', phone: '', email: '', circles: [], contact_weeks: '', met_on: '', met_story: '', notes: '', archived: false, photo_file: null };
  } else {
    const { friend } = await api(`/friends/${props.id}`);
    form.value = { ...friend, contact_weeks: friend.contact_weeks || '' };
    for (const k of ['nickname', 'birthday', 'city', 'address', 'phone', 'email', 'met_on', 'met_story', 'notes']) form.value[k] ??= '';
  }
});

function addCircle() {
  const name = circleInput.value.replace(/,$/, '').trim();
  if (name && !form.value.circles.some((c) => c.toLowerCase() === name.toLowerCase())) form.value.circles.push(name);
  circleInput.value = '';
}

async function pickPhoto(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    photo.value = await squarePhoto(file);
    photoPreview.value = URL.createObjectURL(photo.value);
    removePhoto.value = false;
  } catch {
    showToast(t('errors.image_required'));
  }
}

const previewFriend = computed(() => ({ name: form.value?.name || '?', photo_file: removePhoto.value ? null : form.value?.photo_file }));

async function save() {
  if (circleInput.value.trim()) addCircle();
  busy.value = true;
  try {
    // The list shows the city; without one, take it from the address
    const body = { ...form.value, contact_weeks: form.value.contact_weeks || null, city: form.value.city.trim() || cityFromAddress(form.value.address) };
    const saved = isNew.value
      ? await api('/friends', { method: 'POST', body })
      : await api(`/friends/${props.id}`, { method: 'PATCH', body });
    let friend = saved;
    if (photo.value) friend = await api(`/friends/${saved.id}/photo`, { method: 'PUT', raw: photo.value });
    else if (removePhoto.value) friend = await api(`/friends/${saved.id}/photo`, { method: 'DELETE' });
    refreshFriends();
    friendChange.value = { id: friend.id, friend };
    // Back to their page: the one we came from if so (no second copy of it in the history)
    const target = `/friend/${saved.id}`;
    if (window.history.state?.back === target) router.back();
    else router.replace(target);
  } catch (err) {
    showToast(errorText(err));
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!confirm(t('friendEdit.confirmDelete', { name: form.value.name }))) return;
  try {
    await api(`/friends/${props.id}`, { method: 'DELETE' });
    refreshFriends();
    friendChange.value = { id: Number(props.id), deleted: true };
    // Their events may be gone too
    eventChanged(null);
    router.replace('/friends');
  } catch (err) {
    showToast(errorText(err));
  }
}
</script>

<template>
  <TopBar :title="isNew ? t('friendEdit.newTitle') : t('friendEdit.title')" :back="isNew ? '/friends' : `/friend/${id}`" />
  <main v-if="form">
    <form class="form" @submit.prevent="save">
      <div class="photo-row">
        <span class="avatar-preview">
          <img v-if="photoPreview" :src="photoPreview" alt="" class="avatar" style="width: 72px; height: 72px" />
          <Avatar v-else :friend="previewFriend" :size="72" />
        </span>
        <label class="btn small">
          <Icon name="camera" /> {{ t('friendEdit.photo') }}
          <input type="file" accept="image/*" hidden @change="pickPhoto" />
        </label>
        <button v-if="(form.photo_file && !removePhoto) || photo" type="button" class="link-btn danger" @click="photo = null; photoPreview = null; removePhoto = true">{{ t('friendEdit.removePhoto') }}</button>
      </div>

      <div class="two">
        <label><span>{{ t('friendEdit.name') }}</span><input v-model="form.name" required autofocus autocomplete="off" /></label>
        <label><span>{{ t('friendEdit.nickname') }}</span><input v-model="form.nickname" autocomplete="off" /></label>
      </div>
      <label><span>{{ t('friendEdit.birthday') }}</span><PartialDate v-model="form.birthday" birthday /></label>

      <h3 class="form-group">{{ t('friendEdit.contact') }}</h3>
      <div class="two">
        <label><span>{{ t('friendEdit.phone') }}</span><input v-model="form.phone" type="tel" autocomplete="off" /></label>
        <label><span>{{ t('friendEdit.email') }}</span><input v-model="form.email" type="email" autocomplete="off" /></label>
      </div>
      <label><span>{{ t('friendEdit.address') }}</span><textarea v-model="form.address" rows="2" :placeholder="t('friendEdit.addressPlaceholder')"></textarea></label>
      <label><span>{{ t('friendEdit.city') }}</span><input v-model="form.city" autocomplete="off" :placeholder="cityFromAddress(form.address)" /></label>

      <h3 class="form-group">{{ t('friendEdit.friendship') }}</h3>
      <div>
        <label for="circle-input"><span>{{ t('friendEdit.circles') }}</span></label>
        <div class="picker-chips">
          <span v-for="(c, i) in form.circles" :key="c" class="person-chip">
            {{ c }}
            <button type="button" class="chip-x" :aria-label="t('delete')" @click="form.circles.splice(i, 1)"><Icon name="close" /></button>
          </span>
          <input id="circle-input" v-model="circleInput" list="circle-list" :placeholder="t('friendEdit.circlesPlaceholder')" @keydown.enter.prevent="addCircle" @input="circleInput.endsWith(',') && addCircle()" @change="addCircle" />
        </div>
        <datalist id="circle-list"><option v-for="c in allCircles.filter((x) => !form.circles.includes(x))" :key="c" :value="c" /></datalist>
      </div>

      <label>
        <span>{{ t('friendEdit.contactEvery') }}</span>
        <select v-model="form.contact_weeks">
          <option value="">{{ t('friendEdit.contactNever') }}</option>
          <option v-for="w in CONTACT_WEEKS" :key="w" :value="w">{{ t('friendEdit.weeks', { n: w }) }}</option>
        </select>
      </label>

      <label><span>{{ t('friendEdit.metOn') }}</span><PartialDate v-model="form.met_on" /></label>
      <label><span>{{ t('friendEdit.metStory') }}</span><textarea v-model="form.met_story" rows="2" :placeholder="t('friendEdit.metStoryPlaceholder')"></textarea></label>

      <h3 class="form-group">{{ t('friendEdit.notes') }}</h3>
      <textarea v-model="form.notes" rows="4" :aria-label="t('friendEdit.notes')"></textarea>

      <label v-if="!isNew" class="check-label"><input v-model="form.archived" type="checkbox" /> {{ t('friendEdit.archived') }}</label>
      <p v-if="!isNew" class="muted small">{{ t('friendEdit.archivedHint') }}</p>

      <button class="btn primary" :disabled="busy">{{ t('save') }}</button>
      <button v-if="!isNew" type="button" class="btn subtle danger" @click="remove"><Icon name="trash" /> {{ t('friendEdit.delete') }}</button>
    </form>
  </main>
</template>
