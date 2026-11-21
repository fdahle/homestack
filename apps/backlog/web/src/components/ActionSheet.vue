<script setup>
import { ref, watch } from 'vue';
import { t } from '../i18n.js';
import { sheet } from '../util.js';

// Choices that slide up from the bottom (on a computer: a small dialog). openSheet() in util.js.
const dialog = ref(null);

watch(() => sheet.open, (open) => {
  if (open && !dialog.value?.open) dialog.value?.showModal();
  if (!open && dialog.value?.open) dialog.value.close();
});

function choose(action) {
  sheet.open = false;
  action?.run?.();
}
</script>

<template>
  <dialog ref="dialog" class="sheet" @close="sheet.open = false" @click.self="sheet.open = false">
    <p v-if="sheet.title" class="sheet-title">{{ sheet.title }}</p>
    <button v-for="(a, i) in sheet.actions" :key="i" class="btn" :class="{ primary: a.primary }" @click="choose(a)">{{ a.label }}</button>
    <button class="btn subtle" @click="choose(null)">{{ t('cancel') }}</button>
  </dialog>
</template>
