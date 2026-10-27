<script setup>
import { onMounted, ref } from 'vue';
import { api, session } from '../api.js';
import { t } from '../i18n.js';
import { issueLabel } from '../util.js';
import TopBar from '../components/TopBar.vue';
import Icon from '../components/Icon.vue';
import CoverImage from '../components/CoverImage.vue';

const data = ref(null);
onMounted(async () => {
  data.value = await api('/home');
});
</script>

<template>
  <TopBar :title="t('home.greeting', { name: session.user?.display_name })">
    <RouterLink class="icon-btn" to="/settings" :aria-label="t('nav.settings')"><Icon name="gear" /></RouterLink>
  </TopBar>
  <main v-if="data">
    <div v-if="!data.stats.series" class="empty">
      <p>{{ t('home.empty') }}</p>
      <div class="row-buttons">
        <RouterLink class="btn primary" to="/add"><Icon name="search" /> {{ t('home.addSeries') }}</RouterLink>
        <RouterLink class="btn" to="/scan"><Icon name="scan" /> {{ t('home.scan') }}</RouterLink>
      </div>
    </div>

    <template v-else>
      <div class="stats">
        <RouterLink to="/collection" class="stat"><strong>{{ data.stats.series }}</strong><span>{{ t('home.series') }}</span></RouterLink>
        <div class="stat"><strong>{{ data.stats.owned }}</strong><span>{{ t('home.owned') }}</span></div>
        <div class="stat"><strong>{{ data.stats.read }}</strong><span>{{ t('home.read') }}</span></div>
        <RouterLink to="/wishlist" class="stat"><strong>{{ data.stats.wanted }}</strong><span>{{ t('home.wanted') }}</span></RouterLink>
      </div>

      <template v-if="data.continueReading.length">
        <h2 class="section">{{ t('home.continue') }} <small>{{ t('home.unreadOwned', { n: data.stats.unread_owned }) }}</small></h2>
        <div class="shelf">
          <RouterLink v-for="i in data.continueReading" :key="i.id" :to="`/issue/${i.id}`" class="shelf-item">
            <CoverImage :issue="i" :series-name="i.series_name" />
            <span class="shelf-title">{{ i.series_name }}</span>
            <span class="shelf-sub">{{ issueLabel(i) }}{{ i.title ? ` · ${i.title}` : '' }}</span>
          </RouterLink>
        </div>
      </template>

      <template v-if="data.recent.length">
        <h2 class="section">{{ t('home.recent') }}</h2>
        <div class="shelf">
          <RouterLink v-for="i in data.recent" :key="i.id" :to="`/issue/${i.id}`" class="shelf-item">
            <CoverImage :issue="i" :series-name="i.series_name" />
            <span class="shelf-title">{{ i.series_name }}</span>
            <span class="shelf-sub">{{ issueLabel(i) }}{{ i.title ? ` · ${i.title}` : '' }}</span>
          </RouterLink>
        </div>
      </template>

      <div class="row-buttons spaced">
        <RouterLink class="btn" to="/add"><Icon name="search" /> {{ t('home.addSeries') }}</RouterLink>
        <RouterLink class="btn" to="/scan"><Icon name="scan" /> {{ t('home.scan') }}</RouterLink>
      </div>
    </template>
  </main>
</template>
