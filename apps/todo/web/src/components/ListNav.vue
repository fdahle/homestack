<script setup>
import { useRoute } from 'vue-router';
import { t } from '../i18n.js';
import { areaLists, openCount } from '../store/tasks.js';
import Icon from '../kit/components/Icon.vue';

// The inbox and the lists of the area shown, in the sidebar on a computer (in AppShell's slot
// after the tabs, which scrolls on its own when there are many), with how many open tasks
// each has. On the phone the Listen tab does that.
const route = useRoute();
const isActive = (id) => route.matched[0]?.name === 'list' && route.params.listId === id;
</script>

<template>
  <nav class="side-list list-nav" :aria-label="t('nav.lists')">
    <h2 class="side-list-title">{{ t('nav.lists') }}</h2>
    <RouterLink to="/list/inbox" :class="{ active: isActive('inbox') }" :aria-current="isActive('inbox') ? 'page' : undefined">
      <Icon name="inbox" /><span class="grow">{{ t('lists.inbox') }}</span><span class="side-list-count">{{ openCount.get(null) || '' }}</span>
    </RouterLink>
    <RouterLink
      v-for="l in areaLists" :key="l.id" :to="`/list/${l.id}`" :class="[{ active: isActive(l.id) }, l.color && `c-${l.color}`]"
      :aria-current="isActive(l.id) ? 'page' : undefined"
    >
      <i class="dot"></i><span class="grow">{{ l.name }}</span><span class="side-list-count">{{ openCount.get(l.id) || '' }}</span>
    </RouterLink>
  </nav>
</template>
