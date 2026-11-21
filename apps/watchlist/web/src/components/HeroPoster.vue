<script setup>
import { ref } from 'vue';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { coverPhoto, errorText, POSTER_SIZE, showToast } from '../util.js';
import Icon from '../kit/components/Icon.vue';
import Poster from './Poster.vue';

// The big poster on a title's page, with your own photo instead of TMDB's poster
const props = defineProps({ item: { type: Object, required: true }, mode: { type: String, required: true } });
const emit = defineEmits(['update']);
const busy = ref(false);
const fileInput = ref(null);
const base = () => `/${props.mode}/${props.item.id}/poster`;
const key = () => (props.mode === 'series' ? 'series' : 'film');

async function upload(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  busy.value = true;
  try {
    const blob = await coverPhoto(file, POSTER_SIZE);
    emit('update', (await api(base(), { method: 'PUT', raw: blob }))[key()]);
  } catch (err) {
    showToast(errorText(err));
  } finally {
    busy.value = false;
  }
}

async function removePhoto() {
  busy.value = true;
  try {
    emit('update', (await api(base(), { method: 'DELETE' }))[key()]);
  } catch (err) {
    showToast(errorText(err));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="hero-cover">
    <Poster :item="item" eager />
    <div class="cover-actions">
      <button class="link-btn small" :disabled="busy" @click="fileInput.click()"><Icon name="camera" />{{ t('title.ownPoster') }}</button>
      <button v-if="item.poster_source === 'photo'" class="link-btn small" :disabled="busy" @click="removePhoto">
        {{ item.tmdb_poster ? t('title.tmdbPoster') : t('title.removePoster') }}
      </button>
    </div>
    <input ref="fileInput" type="file" accept="image/*" hidden @change="upload" />
  </div>
</template>
