<script setup>
import { t } from '../i18n.js';
import { fmtDate } from '../util.js';
import { moreActions, rememberOpen, setRead } from '../articles.js';
import Icon from '../kit/components/Icon.vue';

// One post: the circle to tick it off, its title (opens the post), the blog and date, and
// the other things to do with it behind ⋯. all: the page's posts (for "this and all older").
const props = defineProps({ article: { type: Object, required: true }, showBlog: Boolean, all: { type: Array, default: () => [] } });
</script>

<template>
  <li class="art" :class="{ read: article.read_at }">
    <button
      class="check"
      role="checkbox"
      :aria-checked="Boolean(article.read_at)"
      :aria-label="article.read_at ? t('article.markUnread') : t('article.markRead')"
      :title="article.read_at ? t('article.markUnread') : t('article.markRead')"
      @click="setRead(article, !article.read_at)"
    >
      <Icon name="check" />
    </button>
    <div class="art-body">
      <a class="art-title" :href="article.url" target="_blank" rel="noopener" @click="rememberOpen(article)">{{ article.title }}</a>
      <div class="meta">
        <span v-if="showBlog" class="blog-name">{{ article.blog_name }}</span>
        <span v-if="article.published">{{ fmtDate(article.published) }}</span>
        <span v-if="article.starred" class="star-mark" :title="t('article.later')"><Icon name="star" /></span>
      </div>
    </div>
    <button class="icon-btn" :aria-label="t('article.more')" :title="t('article.more')" @click="moreActions(article, props.all)"><Icon name="more" /></button>
  </li>
</template>
