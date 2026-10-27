<script setup>
import { useRouter } from 'vue-router';
import { t } from '../i18n.js';
import Icon from './Icon.vue';

const props = defineProps({ title: String, back: [String, Boolean] });
const router = useRouter();

// Go back in history when we came from inside the app, otherwise to the given page
function goBack() {
  if (window.history.state?.back) router.back();
  else router.push(typeof props.back === 'string' ? props.back : '/');
}
</script>

<template>
  <header class="top">
    <button v-if="back" class="icon-btn" :aria-label="t('back')" @click="goBack"><Icon name="back" /></button>
    <h1>{{ title }}</h1>
    <div class="actions"><slot /></div>
  </header>
</template>
