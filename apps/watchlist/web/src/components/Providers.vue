<script setup>
import { computed } from 'vue';
import { t } from '../i18n.js';
import { countryName, formatPartial, tmdbImage } from '../util.js';
import Icon from '../kit/components/Icon.vue';

// Where to stream a title in the chosen country, as TMDB gets it from JustWatch (which wants to be named)
const props = defineProps({ providers: Object, at: String, region: String });
const KINDS = ['flatrate', 'free', 'rent', 'buy'];
// The server keeps only https links to TMDB; offers stored before it did are checked here too
const link = computed(() => (/^https:\/\/([a-z0-9-]+\.)*themoviedb\.org\//i.test(props.providers?.link || '') ? props.providers.link : null));
const groups = computed(() => KINDS.map((kind) => [kind, props.providers?.[kind] || []]).filter(([, list]) => list.length));
</script>

<template>
  <section class="card providers">
    <h2 class="card-title">{{ t('providers.title') }}<span v-if="region" class="muted region">{{ countryName(region) }}</span></h2>
    <template v-if="groups.length">
      <div v-for="[kind, list] in groups" :key="kind" class="provider-group">
        <span class="field-label">{{ t(`providers.${kind}`) }}</span>
        <ul class="provider-list">
          <li v-for="p in list" :key="p.id" :title="p.name">
            <img v-if="p.logo" :src="tmdbImage(p.logo, 'w92')" alt="" width="34" height="34" loading="lazy" @error="$event.target.remove()" />
            <span>{{ p.name }}</span>
          </li>
        </ul>
      </div>
    </template>
    <p v-else class="muted small">{{ t('providers.none') }}</p>
    <p class="muted small attribution">
      <a v-if="link" :href="link" target="_blank" rel="noopener noreferrer"><Icon name="external" />{{ t('providers.all') }}</a>
      <span>{{ t('providers.justwatch') }}<template v-if="at"> · {{ t('providers.asOf', { date: formatPartial(at.slice(0, 10)) }) }}</template></span>
    </p>
  </section>
</template>
