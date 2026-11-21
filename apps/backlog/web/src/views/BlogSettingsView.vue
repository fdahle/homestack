<script setup>
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { errorText, fmtDate, showToast, timeAgo } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';

// How Backlog finds a blog's posts: the strategy and its details, a test before saving,
// scanning by hand, and deleting the blog
const props = defineProps({ id: { type: String, required: true } });
const route = useRoute();
const router = useRouter();

const STRATEGIES = ['wordpress', 'substack', 'sitemap', 'feed', 'archive'];
const FIELDS = ['apiUrl', 'feedUrl', 'sitemapUrl', 'archiveUrl', 'linkSelector', 'nextSelector'];

const blog = ref(null);
const scanning = ref(false);
const form = ref(null);
const test = ref(null);
const testing = ref(false);
const saving = ref(false);
const error = ref('');
// A note from adding the blog ("Found through the sitemap. …")
const note = ref(String(route.query.note || ''));

onMounted(async () => {
  try {
    const data = await api(`/blogs/${props.id}?show=starred`);
    blog.value = data.blog;
    scanning.value = data.scanning;
    const c = data.blog.config || {};
    form.value = {
      name: data.blog.name,
      url: data.blog.url,
      strategy: data.blog.strategy,
      config: { ...Object.fromEntries(FIELDS.map((f) => [f, c[f] || ''])), order: c.order || 'newest-first', maxPages: c.maxPages || 100, include: c.include || '', exclude: c.exclude || '' },
    };
  } catch (err) {
    error.value = errorText(err);
  }
});

async function save() {
  saving.value = true;
  try {
    await api(`/blogs/${props.id}`, { method: 'PATCH', body: form.value });
    showToast(t('saved'));
    router.push(`/blog/${props.id}`);
  } catch (err) {
    showToast(errorText(err));
  } finally {
    saving.value = false;
  }
}

async function runTest() {
  testing.value = true;
  test.value = null;
  try {
    test.value = await api(`/blogs/${props.id}/test`, { method: 'POST', body: form.value });
  } catch (err) {
    showToast(errorText(err));
  } finally {
    testing.value = false;
  }
}

async function scan(full) {
  await api(`/blogs/${props.id}/scan`, { method: 'POST', body: { full } });
  scanning.value = true;
  showToast(t('settings.scanStarted'));
}

async function remove() {
  if (!confirm(t('settings.deleteConfirm', { name: blog.value.name }))) return;
  await api(`/blogs/${props.id}`, { method: 'DELETE' });
  router.replace('/');
}
</script>

<template>
  <TopBar :title="blog ? `${blog.name}` : t('settings.blogTitle')" :back="`/blog/${id}`" />
  <main>
    <p v-if="error" class="error">{{ error }}</p>
    <template v-else-if="form">
      <p v-if="note" class="info"><Icon name="info" />{{ note }}</p>

      <form class="card form" @submit.prevent="save">
        <label><span>{{ t('settings.name') }}</span><input v-model="form.name" /></label>
        <label><span>{{ t('settings.address') }}</span><input v-model="form.url" type="url" inputmode="url" /></label>
        <label>
          <span>{{ t('settings.strategy') }}</span>
          <select v-model="form.strategy">
            <option v-for="s in STRATEGIES" :key="s" :value="s">{{ t(`settings.strategies.${s}`) }}</option>
          </select>
        </label>
        <details class="advanced" :open="['archive', 'sitemap'].includes(form.strategy)">
          <summary>{{ t('settings.advanced') }}</summary>
          <div class="form">
            <label v-for="f in FIELDS" :key="f">
              <span>{{ t(`settings.${f}`) }}</span>
              <input v-model="form.config[f]" autocomplete="off" spellcheck="false" />
              <small class="muted">{{ t(`settings.${f}Hint`) }}</small>
            </label>
            <label>
              <span>{{ t('settings.order') }}</span>
              <select v-model="form.config.order">
                <option value="newest-first">{{ t('settings.newestFirst') }}</option>
                <option value="oldest-first">{{ t('settings.oldestFirst') }}</option>
              </select>
            </label>
            <label><span>{{ t('settings.maxPages') }}</span><input v-model="form.config.maxPages" inputmode="numeric" /></label>
            <label><span>{{ t('settings.include') }}</span><input v-model="form.config.include" autocomplete="off" spellcheck="false" /><small class="muted">{{ t('settings.includeHint') }}</small></label>
            <label><span>{{ t('settings.exclude') }}</span><input v-model="form.config.exclude" autocomplete="off" spellcheck="false" /><small class="muted">{{ t('settings.excludeHint') }}</small></label>
          </div>
        </details>
        <div class="row-buttons">
          <button class="btn primary" :disabled="saving">{{ t('settings.save') }}</button>
          <button type="button" class="btn" :disabled="testing" @click="runTest">{{ testing ? t('settings.testing') : t('settings.test') }}</button>
        </div>
      </form>

      <section v-if="test" class="card form test-result">
        <h2>{{ test.error ? t('settings.testFailed') : t('settings.testFound', { n: test.count }) }}</h2>
        <p v-if="test.error" class="error">{{ test.error }}</p>
        <template v-else>
          <ol class="test-list">
            <li v-for="it in test.items" :key="it.url"><a :href="it.url" target="_blank" rel="noopener">{{ it.title }}</a> <small class="muted">{{ fmtDate(it.published) }}</small></li>
          </ol>
          <p v-if="test.count > test.items.length" class="muted small">{{ t('settings.testMore', { n: test.count - test.items.length }) }}</p>
        </template>
        <p class="muted small">{{ t('settings.notSaved') }}</p>
      </section>

      <section class="card form">
        <h2>{{ t('settings.scanning') }}</h2>
        <p class="small">
          {{ t('settings.lastScan', { when: timeAgo(blog.last_scan_at) }) }}
          <template v-if="blog.last_scan_status"> · <span :class="{ error: blog.last_scan_ok === 0 }">{{ blog.last_scan_status }}</span></template>
          <span v-if="scanning" class="scanning"> · {{ t('home.scanning') }}</span>
        </p>
        <div class="row-buttons">
          <button class="btn" @click="scan(false)"><Icon name="refresh" />{{ t('settings.scanNow') }}</button>
          <button class="btn" @click="scan(true)">{{ t('settings.fullScan') }}</button>
        </div>
        <p class="muted small">{{ t('settings.scanHow') }}</p>
      </section>

      <section class="card form">
        <h2>{{ t('settings.danger') }}</h2>
        <button class="btn danger" @click="remove"><Icon name="trash" />{{ t('settings.delete') }}</button>
      </section>
    </template>
  </main>
</template>
