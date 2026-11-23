<script setup>
import { computed } from 'vue';
import { t } from '../i18n.js';
import { checklistCount, previewLines } from '../lib/markdown.js';
import { isImage } from '../lib/files.js';
import { fileUrl, filesOf } from '../store/notes.js';
import Icon from '../kit/components/Icon.vue';

// A note in the list: its title, the start of its text (checklists with their boxes),
// the first picture, labels and how many files hang on it.
const props = defineProps({
  note: { type: Object, required: true },
  to: { type: [String, Object], required: true },
  selected: Boolean,
});

const lines = computed(() => previewLines(props.note.body, 10));
const files = computed(() => filesOf(props.note.id));
const image = computed(() => files.value.find(isImage));
const otherFiles = computed(() => files.value.length - (image.value ? 1 : 0));
const checks = computed(() => checklistCount(props.note.body));
</script>

<template>
  <RouterLink :to="to" class="note-card" :class="{ selected }" :data-color="note.color || undefined" :aria-current="selected ? 'page' : undefined">
    <img v-if="image" :src="fileUrl(image)" class="note-card-image" alt="" loading="lazy" :width="image.width" :height="image.height" />
    <div class="note-card-body">
      <h3 v-if="note.title" class="note-card-title">
        <Icon v-if="note.pinned" name="pin" class="pinned-mark" />{{ note.title }}
      </h3>
      <div v-if="lines.length" class="preview">
        <template v-for="(line, i) in lines" :key="i">
          <div v-if="line.kind === 'gap'" class="gap"></div>
          <p v-else :class="['line', line.kind, { checked: line.checked }]" :style="line.depth ? { marginLeft: `${line.depth * 14}px` } : null">
            <Icon v-if="line.kind === 'check'" :name="line.checked ? 'check-box' : 'box'" />
            <span>{{ line.text }}</span>
          </p>
        </template>
      </div>
      <p v-else-if="!note.title && !image" class="muted small">{{ t('notes.untitled') }}</p>
      <div v-if="note.labels.length || otherFiles || checks" class="note-card-foot">
        <span v-if="checks" class="tag" :class="{ 'all-done': checks.done === checks.total }"><Icon name="check" />{{ checks.done }}/{{ checks.total }}</span>
        <span v-if="otherFiles" class="tag"><Icon name="paperclip" />{{ otherFiles }}</span>
        <span v-for="label in note.labels" :key="label" class="tag">{{ label }}</span>
      </div>
    </div>
  </RouterLink>
</template>
