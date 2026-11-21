<script setup lang="ts">
// What the old menu held, as a page like the other apps' settings: who is looking, where else
// to go, language, light or dark, causes of death, and saving the tree as a picture.
import { computed, ref, watch } from 'vue';
import { openNewPerson } from '../edit/editor';
import { LANGS, lang, t } from '../i18n';
import { theme, applyTheme } from '../kit/theme.js';
import { navigate } from '../ui/back';
import { displayName } from '../ui/format';
import type { IconName } from '../ui/icons';
import { showsCauses } from '../ui/prefs';
import { canShare, openShare } from '../ui/share';
import { bubble } from '../ui/tile';
import SIcon from './SIcon.vue';
import { changeLanguage, chooseViewer, editable, editorContext, findRelation, getFamily, saveTree, showCauses, state, viewer } from './store';

const words = computed(() => (state.version, t()));

const viewerPerson = computed(() => {
  void state.version;
  const me = viewer();
  return me ? getFamily().person(me) : undefined;
});
const viewerSlot = ref<HTMLElement>();
watch(
  [viewerPerson, viewerSlot],
  ([person, slot]) => {
    if (slot && person) slot.replaceChildren(bubble(person));
    else slot?.replaceChildren();
  },
  { flush: 'post' },
);

type Entry = { icon: IconName; label: string; href?: string; run?: () => void };
const links = computed<Entry[]>(() => {
  const w = words.value;
  const list: Entry[] = [
    { icon: 'link', label: w.findRelation, run: () => void findRelation() },
    { icon: 'checklist', label: w.missing, href: '#/missing' },
    { icon: 'file', label: w.viewFile, href: '#/file' },
  ];
  if (editable()) {
    list.push({
      icon: 'plus',
      label: w.addPerson,
      run: () => openNewPerson(editorContext(), (id) => navigate(`#/p/${encodeURIComponent(id)}`)),
    });
  }
  if (canShare()) list.push({ icon: 'qr', label: w.share, run: () => openShare(location.href) });
  return list;
});

const MODES = [
  { id: 'auto', mode: 'system', icon: 'auto' },
  { id: 'light', mode: 'light', icon: 'sun' },
  { id: 'dark', mode: 'dark', icon: 'moon' },
] as const;

// Only once the family has any to hide.
const hasCauses = computed(() => (state.version, getFamily().people().some((person) => person.deathcause)));
const causes = computed(() => (state.version, showsCauses()));
const language = computed(() => (state.version, lang()));
</script>

<template>
  <div class="settings-page">
    <h1 class="page-title">{{ words.menu }}</h1>

    <section class="settings-group">
      <h2 class="settings-label">{{ words.whoIsLooking }}</h2>
      <button type="button" class="settings-viewer" @click="chooseViewer">
        <span v-show="viewerPerson" ref="viewerSlot" class="viewer-bubble"></span>
        <SIcon v-if="!viewerPerson" name="person" />
        <span class="flex-1">{{ viewerPerson ? `${words.iAm} ${displayName(viewerPerson)}` : words.nobody }}</span>
        <small class="settings-hint">{{ words.changeViewer }}</small>
      </button>
    </section>

    <section class="settings-group">
      <h2 class="settings-label">{{ words.more }}</h2>
      <div class="settings-links">
        <template v-for="entry in links" :key="entry.label">
          <a v-if="entry.href" :href="entry.href" class="btn btn-ghost btn-sm w-full justify-start">
            <SIcon :name="entry.icon" />{{ entry.label }}
          </a>
          <button v-else type="button" class="btn btn-ghost btn-sm w-full justify-start" @click="entry.run?.()">
            <SIcon :name="entry.icon" />{{ entry.label }}
          </button>
        </template>
      </div>
    </section>

    <section class="settings-group">
      <h2 class="settings-label">{{ words.language }}</h2>
      <div class="join w-full">
        <button
          v-for="option in LANGS"
          :key="option.id"
          type="button"
          class="btn btn-sm join-item flex-1"
          :class="option.id === language ? 'btn-primary' : 'btn-ghost bg-base-200'"
          :aria-pressed="option.id === language"
          @click="changeLanguage(option.id)"
        >
          {{ option.label }}
        </button>
      </div>
    </section>

    <section class="settings-group">
      <h2 class="settings-label">{{ words.appearance }}</h2>
      <div class="join w-full">
        <button
          v-for="option in MODES"
          :key="option.id"
          type="button"
          class="btn btn-sm join-item flex-1"
          :class="option.id === theme ? 'btn-primary' : 'btn-ghost bg-base-200'"
          :aria-pressed="option.id === theme"
          @click="applyTheme(option.id)"
        >
          <SIcon :name="option.icon" />{{ words.modes[option.mode] }}
        </button>
      </div>
    </section>

    <section v-if="hasCauses" class="settings-group">
      <h2 class="settings-label">{{ words.causes }}</h2>
      <div class="join w-full">
        <button
          v-for="option in (['show', 'hide'] as const)"
          :key="option"
          type="button"
          class="btn btn-sm join-item flex-1"
          :class="(option === 'show') === causes ? 'btn-primary' : 'btn-ghost bg-base-200'"
          :aria-pressed="(option === 'show') === causes"
          @click="showCauses(option === 'show')"
        >
          {{ words.causesModes[option] }}
        </button>
      </div>
      <p class="settings-hint">{{ words.causesHint }}</p>
    </section>

    <section class="settings-group">
      <h2 class="settings-label">{{ words.saveTree }}</h2>
      <div class="join w-full">
        <button type="button" class="btn btn-sm join-item flex-1 btn-ghost bg-base-200" @click="saveTree('png')">
          <SIcon name="download" />{{ words.savePng }}
        </button>
        <button type="button" class="btn btn-sm join-item flex-1 btn-ghost bg-base-200" @click="saveTree('svg')">
          <SIcon name="download" />{{ words.saveSvg }}
        </button>
      </div>
      <p class="settings-hint">{{ words.saveHint }}</p>
    </section>
  </div>
</template>
