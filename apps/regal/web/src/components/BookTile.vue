<script setup>
import { computed } from 'vue';
import { t } from '../i18n.js';
import { authorsText, formatNumber, progressOf, STATUS_ICONS } from '../util.js';
import BookCover from './BookCover.vue';
import Icon from '../kit/components/Icon.vue';
import StarRating from '../kit/components/StarRating.vue';

// A book in the grid: cover with its status (and an e-book mark when it is in Calibre),
// title, author, and the rating, or how far you are while reading.
// showNumber: its number in its series, on the cover (when the list shows series in order)
const props = defineProps({ book: { type: Object, required: true }, hideStatus: Boolean, selected: Boolean, showProgress: Boolean, showNumber: Boolean });
const progress = computed(() => (props.showProgress ? progressOf(props.book) : null));
</script>

<template>
  <RouterLink :to="`/book/${book.id}`" class="tile" :class="[`st-${book.status}`, { selected }]">
    <div class="tile-cover">
      <BookCover :book="book" />
      <span v-if="!hideStatus" class="status-pin" :title="t(`status.${book.status}`)"><Icon :name="STATUS_ICONS[book.status]" /></span>
      <span v-if="showNumber && book.series && book.series_index != null" class="number-pin" :title="book.series">{{ formatNumber(book.series_index, 2) }}</span>
      <span v-if="book.in_calibre" class="ebook-pin" :title="t('book.ebook')"><Icon name="tablet" /></span>
    </div>
    <div v-if="progress !== null" class="tile-progress">
      <div class="progress" :style="{ '--p': progress }"><span></span></div>
      <span>{{ progress }} %</span>
    </div>
    <strong class="tile-name">{{ book.title }}</strong>
    <span v-if="book.authors.length" class="tile-author">{{ authorsText(book) }}</span>
    <StarRating v-if="book.rating && !showProgress" :model-value="book.rating" readonly small />
  </RouterLink>
</template>
