<script setup>
// Events as a list, grouped by month (or not). A row opens the event.
import { computed } from 'vue';
import { t } from '../i18n.js';
import { formatDate, friendNames, isoDate, KIND_ICONS, monthLabel } from '../util.js';
import Icon from './Icon.vue';

const props = defineProps({
  events: { type: Array, required: true },
  group: { type: Boolean, default: false },
  hideFriend: { type: Number, default: null }, // on a friend's page, don't name them in every row
});

const today = isoDate();

const groups = computed(() => {
  if (!props.group) return [{ key: 'all', label: null, events: props.events }];
  const out = [];
  for (const e of props.events) {
    const key = e.date ? e.date.slice(0, 7) : 'none';
    if (out.at(-1)?.key !== key) out.push({ key, label: e.date ? monthLabel(`${key}-01`) : null, events: [] });
    out.at(-1).events.push(e);
  }
  return out;
});

const others = (e) => e.friends.filter((f) => f.id !== props.hideFriend);
</script>

<template>
  <div class="timeline">
    <section v-for="g in groups" :key="g.key">
      <h3 v-if="g.label" class="month">{{ g.label }}</h3>
      <ul class="event-list">
        <li v-for="e in g.events" :key="e.id">
          <RouterLink :to="`/event/${e.id}`" class="event-row" :class="[`k-${e.kind}`, `s-${e.status}`]">
            <span class="kind-dot"><Icon :name="KIND_ICONS[e.kind]" /></span>
            <span class="event-body">
              <span class="event-title">{{ e.title }}</span>
              <span class="meta">
                <span v-if="e.date">{{ formatDate(e.date) }}<template v-if="e.end_date"> – {{ formatDate(e.end_date) }}</template><template v-if="e.time"> · {{ e.time }}</template></span>
                <span v-if="others(e).length">{{ friendNames(others(e)) }}</span>
                <span v-if="e.place">{{ e.place }}</span>
              </span>
            </span>
            <span v-if="e.status === 'planned' && e.date < today" class="badge open">{{ t('event.open') }}</span>
            <span v-else-if="e.status === 'planned'" class="badge planned">{{ t('status.planned') }}</span>
            <span v-else-if="e.status === 'cancelled'" class="badge">{{ t('status.cancelled') }}</span>
          </RouterLink>
        </li>
      </ul>
    </section>
  </div>
</template>
