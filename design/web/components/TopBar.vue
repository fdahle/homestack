<script setup>
import { inject } from 'vue';
import { useRouter } from 'vue-router';
import { t } from '../i18n.js';
import { wide } from '../util.js';
import Icon from './Icon.vue';

// back: true or the page to go to when there is no history to go back to.
// Beside a list (SplitView on a wide screen) the back button closes the entry instead.
const props = defineProps({ title: String, back: [String, Boolean] });
const router = useRouter();
const inPane = inject('splitPane', false);

function goBack() {
  if (window.history.state?.back) router.back();
  else router.push(typeof props.back === 'string' ? props.back : '/');
}
</script>

<template>
  <header class="top">
    <button v-if="back && !(inPane && wide)" class="icon-btn" :aria-label="t('back')" @click="goBack"><Icon name="back" /></button>
    <h1>{{ title }}</h1>
    <div class="actions">
      <slot />
      <button v-if="back && inPane && wide" class="icon-btn" :aria-label="t('close')" :title="`${t('close')} (Esc)`" @click="goBack"><Icon name="close" /></button>
    </div>
  </header>
</template>
