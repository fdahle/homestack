<script setup>
// Messages per month over the last two years, one bar per month. A single series, so the
// heading names it and there is no legend; every bar has its own label for hover and screen readers.
import { computed } from 'vue';
import { lang, t } from '../i18n.js';
import { isoDate } from '../util.js';

const props = defineProps({ months: { type: Array, required: true } }); // [{ month: 'YYYY-MM', n }]

const bars = computed(() => {
  const counts = new Map(props.months.map((m) => [m.month, m.n]));
  const now = new Date();
  const out = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = isoDate(d).slice(0, 7);
    out.push({ key, n: counts.get(key) || 0, label: new Intl.DateTimeFormat(lang.value, { month: 'short', year: 'numeric' }).format(d) });
  }
  const max = Math.max(1, ...out.map((b) => b.n));
  for (const b of out) b.height = b.n ? Math.max(4, (b.n / max) * 100) : 0;
  return out;
});
const total = computed(() => props.months.reduce((sum, m) => sum + m.n, 0));
</script>

<template>
  <figure class="chat-bars">
    <div class="bars" role="list">
      <span v-for="b in bars" :key="b.key" class="bar-slot" role="listitem" :title="t('chat.barLabel', { month: b.label, n: b.n })" :aria-label="t('chat.barLabel', { month: b.label, n: b.n })">
        <span class="bar" :style="{ height: `${b.height}%` }"></span>
      </span>
    </div>
    <figcaption class="bars-axis muted small">
      <span>{{ bars[0].label }}</span>
      <span>{{ t('chat.total', { n: total.toLocaleString(lang) }) }}</span>
      <span>{{ bars.at(-1).label }}</span>
    </figcaption>
  </figure>
</template>
