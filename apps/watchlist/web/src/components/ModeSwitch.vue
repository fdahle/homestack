<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '../i18n.js';
import { lastMode, PATHS } from '../util.js';
import Icon from '../kit/components/Icon.vue';

// Films | Series. In the sidebar on a computer, at the top of the pages on the phone.
// Switching keeps the kind of page (library, add, stats); "up next" only exists for series.
const route = useRoute();
const mode = computed(() => route.meta.mode || lastMode.value);
const target = (m) => PATHS[m][route.meta.page] || PATHS[m].library;
</script>

<template>
  <nav class="segmented wide mode-switch" :aria-label="t('mode.label')">
    <RouterLink :to="target('films')" :class="{ active: mode === 'films' }" :aria-current="mode === 'films' ? 'true' : undefined">
      <Icon name="film" />{{ t('mode.films') }}
    </RouterLink>
    <RouterLink :to="target('series')" :class="{ active: mode === 'series' }" :aria-current="mode === 'series' ? 'true' : undefined">
      <Icon name="tv" />{{ t('mode.series') }}
    </RouterLink>
  </nav>
</template>
