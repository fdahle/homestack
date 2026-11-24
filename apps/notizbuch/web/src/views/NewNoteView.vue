<script setup>
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { t } from '../i18n.js';
import { areaLabel, createNote, whenReady } from '../store/notes.js';

// /new makes a note and opens it (with ?label=… it starts with that label, else with the
// first label of the area shown).
// /share does the same with what another app shared (the manifest's share_target):
// a page's title, a text, a link.
const route = useRoute();
const router = useRouter();

const text = (v) => (typeof v === 'string' ? v.trim() : '');

onMounted(async () => {
  await whenReady();
  const fields = {};
  if (route.name === 'share') {
    const title = text(route.query.title);
    let body = text(route.query.text);
    const url = text(route.query.url);
    // Many apps put the link into the text already
    if (url && !body.includes(url)) body = body ? `${body}\n\n${url}` : url;
    fields.title = title.slice(0, 300);
    fields.body = body;
  }
  // Without a label asked for, the area shown gives its first one
  const label = text(route.query.label).slice(0, 60) || areaLabel();
  if (label) fields.labels = [label];
  const note = createNote(fields);
  router.replace({ name: 'notes-note', params: { id: note.id }, query: { new: '' } });
});
</script>

<template>
  <main><p class="muted center">{{ t('note.loading') }}</p></main>
</template>
