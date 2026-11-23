<script setup>
import { useRoute } from 'vue-router';
import { t } from '../i18n.js';
import { lists, openCount } from '../store/tasks.js';
import Icon from '../kit/components/Icon.vue';

// All lists as chips at the top of a list (on a computer), with how many open tasks each has,
// so the next list is one click away. On the phone the Listen tab does that.
const route = useRoute();
const isActive = (id) => route.matched[0]?.name === 'list' && route.params.listId === id;
</script>

<template>
  <nav class="chips list-nav" :aria-label="t('nav.lists')">
    <RouterLink to="/list/inbox" class="chip" :class="{ active: isActive('inbox') }" :aria-current="isActive('inbox') ? 'page' : undefined">
      <Icon name="inbox" />{{ t('lists.inbox') }}<span v-if="openCount.get(null)" class="chip-count">{{ openCount.get(null) }}</span>
    </RouterLink>
    <RouterLink
      v-for="l in lists" :key="l.id" :to="`/list/${l.id}`" class="chip" :class="[{ active: isActive(l.id) }, l.color && `c-${l.color}`]"
      :aria-current="isActive(l.id) ? 'page' : undefined"
    >
      <i class="dot"></i>{{ l.name }}<span v-if="openCount.get(l.id)" class="chip-count">{{ openCount.get(l.id) }}</span>
    </RouterLink>
  </nav>
</template>
