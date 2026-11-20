<script setup>
import { t } from '../i18n.js';
import { STATUS_ICONS, yearOf } from '../util.js';
import GameCover from './GameCover.vue';
import Icon from '../kit/components/Icon.vue';
import StarRating from '../kit/components/StarRating.vue';

// A game in the library grid: cover with its status, name, rating or year
defineProps({ game: { type: Object, required: true }, hideStatus: Boolean, selected: Boolean });
</script>

<template>
  <RouterLink :to="`/game/${game.id}`" class="tile" :class="[`st-${game.status}`, { selected }]">
    <div class="tile-cover">
      <GameCover :game="game" />
      <span v-if="!hideStatus" class="status-pin" :title="t(`status.${game.status}`)"><Icon :name="STATUS_ICONS[game.status]" /></span>
    </div>
    <strong class="tile-name">{{ game.name }}</strong>
    <StarRating v-if="game.rating" :model-value="game.rating" readonly small />
    <small v-else class="muted">{{ yearOf(game.release_date) || '' }}</small>
  </RouterLink>
</template>
