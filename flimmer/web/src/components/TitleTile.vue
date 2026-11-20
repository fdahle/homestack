<script setup>
import { computed } from 'vue';
import { t } from '../i18n.js';
import { airYears, itemPath, STATUS_ICONS, yearOf } from '../util.js';
import Poster from './Poster.vue';
import Icon from '../kit/components/Icon.vue';
import StarRating from '../kit/components/StarRating.vue';

// A film or series in a grid or shelf: poster with its status, title, rating or year.
// Series show how far you are (progress bar); base: the list page it opens beside.
const props = defineProps({
  item: { type: Object, required: true },
  mode: { type: String, required: true },
  base: String,
  hideStatus: Boolean,
  selected: Boolean,
  showProgress: Boolean,
});

const year = computed(() => (props.mode === 'series' ? airYears(props.item) : yearOf(props.item.release_date)));
const percent = computed(() => (props.item.total ? Math.round((props.item.watched / props.item.total) * 100) : 0));
</script>

<template>
  <RouterLink :to="itemPath(mode, item.id, base)" class="tile" :class="[`st-${item.status}`, { selected }]">
    <div class="tile-cover">
      <Poster :item="item" />
      <span v-if="!hideStatus" class="status-pin" :title="t(`status.${item.status}`)"><Icon :name="STATUS_ICONS[item.status]" /></span>
    </div>
    <div v-if="showProgress && item.total" class="progress" :title="t('series.progress', { n: item.watched, total: item.total })">
      <span :style="{ '--p': percent }"></span>
    </div>
    <strong class="tile-name">{{ item.title }}</strong>
    <StarRating v-if="item.rating" :model-value="item.rating" readonly small />
    <small v-else class="muted">{{ year || '' }}</small>
  </RouterLink>
</template>
