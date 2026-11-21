<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { errorText, percent, useShortcut } from '../util.js';
import { lastChange, rememberOpen, sameArticle } from '../articles.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import ArticleRow from '../components/ArticleRow.vue';

// One blog: how far you are, the next post, and all posts (unread, all, later, read)
const props = defineProps({ id: { type: String, required: true } });
const route = useRoute();
const router = useRouter();

const show = ref(['unread', 'all', 'starred', 'read'].includes(route.query.show) ? route.query.show : 'unread');
const sort = ref(route.query.sort === 'desc' ? 'desc' : 'asc');
const q = ref('');
const data = ref(null);
const error = ref('');
const scanCount = ref(null);

async function load() {
  try {
    data.value = await api(`/blogs/${props.id}?show=${show.value}&sort=${sort.value}`);
  } catch (err) {
    error.value = errorText(err);
  }
}
onMounted(load);
watch([show, sort], () => {
  router.replace({ query: { ...(show.value !== 'unread' && { show: show.value }), ...(sort.value !== 'asc' && { sort: sort.value }) } });
  load();
});
watch(lastChange, (changed) => data.value && sameArticle(data.value.articles, changed));

// While it's being scanned: ask every few seconds, and load the posts when it's done
let timer = null;
watch(() => data.value?.scanning, (scanning) => {
  clearInterval(timer);
  if (!scanning) return;
  timer = setInterval(async () => {
    try {
      const status = await api(`/blogs/${props.id}/status`);
      scanCount.value = status.total;
      if (!status.scanning) load();
    } catch {
      clearInterval(timer);
    }
  }, 3000);
});
onBeforeUnmount(() => clearInterval(timer));

// The list follows what you tick: in "unread" a read post goes, in "read" an unread one
const visible = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return (data.value?.articles || []).filter((a) => {
    if (a.ignored) return false;
    if (show.value === 'unread' && a.read_at) return false;
    if (show.value === 'read' && !a.read_at) return false;
    if (show.value === 'starred' && !a.starred) return false;
    return !needle || a.title.toLowerCase().includes(needle);
  });
});

const blog = computed(() => data.value?.blog);
const pct = computed(() => (blog.value ? percent(blog.value.read_count, blog.value.total) : 0));
const emptyText = computed(() => {
  if (data.value?.scanning) return t('blog.firstScan');
  if (show.value === 'unread') return blog.value?.total ? t('blog.empty.unread') : t('blog.empty.none');
  if (show.value === 'all') return t('blog.empty.none');
  return t(`blog.empty.${show.value}`);
});

const filterInput = ref(null);
useShortcut('/', () => filterInput.value?.focus());
</script>

<template>
  <TopBar :title="blog?.name || '…'" back="/">
    <RouterLink v-if="blog" :to="`/blog/${id}/settings`" class="icon-btn" :aria-label="t('blog.settings')" :title="t('blog.settings')"><Icon name="gear" /></RouterLink>
  </TopBar>
  <main>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="!data" class="muted center">…</p>
    <template v-else>
      <div class="progress-line">
        <div class="progress"><span :style="{ '--p': pct }"></span></div>
        <span>{{ t('blog.progress', { read: blog.read_count, total: blog.total, pct }) }}</span>
      </div>
      <p v-if="data.scanning" class="info"><Icon name="refresh" />{{ scanCount ? t('blog.scanningCount', { n: scanCount }) : t('blog.scanning') }}</p>
      <p v-else-if="blog.last_scan_ok === 0" class="info warn-box">
        {{ t('blog.scanFailed', { status: blog.last_scan_status }) }}
        <RouterLink :to="`/blog/${id}/settings`">{{ t('blog.settings') }}</RouterLink>
      </p>
      <a v-if="data.next" class="btn primary continue-btn" :href="data.next.url" target="_blank" rel="noopener" @click="rememberOpen(data.next)">
        {{ t('blog.continue', { title: data.next.title }) }}
      </a>

      <div class="list-tools">
        <div class="segmented" role="tablist">
          <button v-for="s in ['unread', 'all', 'starred', 'read']" :key="s" role="tab" :class="{ active: show === s }" :aria-selected="show === s" @click="show = s">
            {{ t(`blog.${s}`) }}<small v-if="s === 'unread'" class="count">{{ blog.total - blog.read_count }}</small><small v-else-if="s === 'all'" class="count">{{ blog.total }}</small>
          </button>
        </div>
        <button class="icon-btn" :aria-label="sort === 'asc' ? t('blog.oldestFirst') : t('blog.newestFirst')" :title="sort === 'asc' ? t('blog.oldestFirst') : t('blog.newestFirst')" @click="sort = sort === 'asc' ? 'desc' : 'asc'">
          <Icon name="sort" />
        </button>
      </div>
      <div class="filter-row">
        <input ref="filterInput" v-model="q" type="search" :placeholder="t('blog.filter')" :aria-label="t('blog.filter')" />
        <span class="muted small">{{ sort === 'asc' ? t('blog.oldestFirst') : t('blog.newestFirst') }}</span>
      </div>

      <ul v-if="visible.length" class="art-list">
        <ArticleRow v-for="a in visible" :key="a.id" :article="a" :all="data.articles" />
      </ul>
      <p v-else class="empty">{{ emptyText }}</p>
    </template>
  </main>
</template>
