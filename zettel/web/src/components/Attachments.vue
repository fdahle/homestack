<script setup>
import { computed } from 'vue';
import { t } from '../i18n.js';
import { formatSize, isImage } from '../lib/files.js';
import { fileUrl, removeFile } from '../store/notes.js';
import Icon from '../kit/components/Icon.vue';

// The pictures (as tiles) and other files (as rows) of a note
const props = defineProps({ files: { type: Array, required: true }, readonly: Boolean });
const images = computed(() => props.files.filter(isImage));
const others = computed(() => props.files.filter((f) => !isImage(f)));
</script>

<template>
  <div v-if="files.length" class="attachments">
    <div v-if="images.length" class="image-grid" :class="{ single: images.length === 1 }">
      <figure v-for="file in images" :key="file.id" class="image-tile">
        <a :href="fileUrl(file)" target="_blank" rel="noopener" :title="file.name">
          <img :src="fileUrl(file)" :alt="file.name" :width="file.width" :height="file.height" loading="lazy" />
        </a>
        <span v-if="file.pending" class="pending-mark" :title="t('files.waiting')"><Icon name="cloud-up" /></span>
        <button v-if="!readonly" class="icon-btn remove" :aria-label="t('files.remove', { name: file.name })" @click="removeFile(file.id)"><Icon name="close" /></button>
      </figure>
    </div>
    <ul v-if="others.length" class="file-list">
      <li v-for="file in others" :key="file.id">
        <a :href="fileUrl(file)" target="_blank" rel="noopener" :download="file.name" class="file-row">
          <Icon name="file" />
          <span class="grow">{{ file.name }}</span>
          <small class="muted">{{ formatSize(file.size) }}</small>
          <Icon v-if="file.pending" name="cloud-up" class="muted" :title="t('files.waiting')" />
        </a>
        <button v-if="!readonly" class="icon-btn" :aria-label="t('files.remove', { name: file.name })" @click="removeFile(file.id)"><Icon name="close" /></button>
      </li>
    </ul>
  </div>
</template>
