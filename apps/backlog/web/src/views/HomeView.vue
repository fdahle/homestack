<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { errorText, percent, timeAgo } from '../util.js';
import { lastChange, rememberOpen, sameArticle } from '../articles.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import ArticleRow from '../components/ArticleRow.vue';

// New posts, what you saved for later, and every blog with how far you are and what's next
const data = ref(null);
const error = ref('');

async function load() {
  try {
    data.value = await api('/home');
  } catch (err) {
    error.value = errorText(err);
  }
}
onMounted(load);

// Shown again (back from a post): fresh numbers
const onVisible = () => document.visibilityState === 'visible' && data.value && load();
onMounted(() => document.addEventListener('visibilitychange', onVisible));
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible));

watch(lastChange, (changed) => {
  if (!data.value) return;
  sameArticle(data.value.fresh, changed);
  sameArticle(data.value.starred, changed);
});

const shown = (list) => list.filter((a) => !a.ignored);

// New posts can be many: the first few, and the rest on request
const FEW = 8;
const allFresh = ref(false);
const freshShown = (list) => (allFresh.value ? shown(list) : shown(list).slice(0, FEW));
</script>

<template>
  <TopBar :title="t('home.title')">
    <RouterLink to="/settings" class="icon-btn phone-only" :aria-label="t('nav.settings')"><Icon name="gear" /></RouterLink>
  </TopBar>
  <main class="wide">
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="!data" class="muted center">…</p>

    <div v-else-if="!data.blogs.length" class="empty">
      <img src="/icon.svg" alt="" width="72" height="72" />
      <p>{{ t('home.empty') }}</p>
      <div class="row-buttons"><RouterLink to="/add" class="btn primary"><Icon name="plus" />{{ t('home.addFirst') }}</RouterLink></div>
    </div>

    <template v-else>
      <RouterLink v-if="data.newSuggestions" to="/discover" class="info suggestion-hint"><Icon name="compass" />{{ t('home.suggestions', { n: data.newSuggestions }) }}</RouterLink>

      <div class="home-columns">
        <div class="home-lists">
          <template v-if="shown(data.fresh).length">
            <h2 class="section">{{ t('home.fresh') }}</h2>
            <ul class="art-list">
              <ArticleRow v-for="a in freshShown(data.fresh)" :key="a.id" :article="a" show-blog :all="data.fresh" />
            </ul>
            <button v-if="!allFresh && shown(data.fresh).length > FEW" class="link-btn show-all" @click="allFresh = true">{{ t('home.showAll', { n: shown(data.fresh).length }) }}</button>
          </template>
          <template v-if="shown(data.starred).length">
            <h2 class="section">{{ t('home.later') }}</h2>
            <ul class="art-list">
              <ArticleRow v-for="a in shown(data.starred)" :key="a.id" :article="a" show-blog :all="data.starred" />
            </ul>
          </template>
        </div>

        <section class="home-blogs">
          <h2 class="section">{{ t('home.blogs') }}</h2>
          <div class="blog-cards">
            <section v-for="b in data.blogs" :key="b.id" class="blog-card">
              <RouterLink :to="`/blog/${b.id}`" class="blog-link">
                <div class="blog-top">
                  <h3>{{ b.name }}</h3>
                  <span class="unread">{{ b.total - b.read_count }} <small>{{ t('home.unread') }}</small></span>
                </div>
                <div class="progress"><span :style="{ '--p': percent(b.read_count, b.total) }"></span></div>
                <div class="meta">
                  <span>{{ t('home.readOf', { read: b.read_count, total: b.total }) }}</span>
                  <span v-if="b.scanning" class="scanning">{{ t('home.scanning') }}</span>
                  <span v-else-if="b.last_scan_ok === 0" class="error">{{ t('home.scanFailed') }}</span>
                  <span v-else>{{ t('home.checked', { when: timeAgo(b.last_scan_at) }) }}</span>
                </div>
              </RouterLink>
              <a v-if="b.next" class="continue" :href="b.next.url" target="_blank" rel="noopener" @click="rememberOpen(b.next)">
                <strong>{{ t('home.continue') }}</strong> {{ b.next.title }}
              </a>
            </section>
          </div>
        </section>
      </div>
    </template>
  </main>
</template>
