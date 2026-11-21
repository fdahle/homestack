import { t } from './i18n.js';

// Where to go once a blog is added: a note (how its posts are found) or the archive strategy
// need a look at its settings; otherwise straight to its posts
export function afterAdding(router, { id, strategy, note, duplicate }) {
  if (!duplicate && (note || strategy === 'archive')) {
    const text = strategy === 'archive' ? note : t('add.using', { strategy: t(`settings.strategies.${strategy}`), note });
    router.push({ path: `/blog/${id}/settings`, query: { note: text } });
  } else {
    router.push(`/blog/${id}`);
  }
}
