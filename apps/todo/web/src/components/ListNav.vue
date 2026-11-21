<script setup>
import { useRoute } from 'vue-router';
import { t } from '../i18n.js';
import { lists, openCount } from '../store/tasks.js';
import Icon from '../kit/components/Icon.vue';

// The lists in the sidebar (on a computer), with how many open tasks each has
const route = useRoute();
const isActive = (id) => route.matched[0]?.name === 'list' && route.params.listId === id;
</script>

<template>
  <div class="list-nav">
    <RouterLink to="/list/inbox" :class="{ active: isActive('inbox') }">
      <Icon name="inbox" />
      <span class="grow">{{ t('lists.inbox') }}</span>
      <small v-if="openCount.get(null)">{{ openCount.get(null) }}</small>
    </RouterLink>
    <RouterLink v-for="l in lists" :key="l.id" :to="`/list/${l.id}`" :class="[{ active: isActive(l.id) }, l.color && `c-${l.color}`]">
      <i class="dot"></i>
      <span class="grow">{{ l.name }}</span>
      <small v-if="openCount.get(l.id)">{{ openCount.get(l.id) }}</small>
    </RouterLink>
  </div>
</template>
