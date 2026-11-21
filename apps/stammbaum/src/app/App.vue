<script setup lang="ts">
// The frame, as in the other homestack apps: tabs at the bottom on a phone, a sidebar on a
// computer, the bar with search above the page. The pages themselves (the trees, a person,
// birthdays, …) are still drawn by views/*.ts into <main>, whenever the address or the family
// changes; only the settings page is Vue's.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t, warningText } from '../i18n';
import { readStored, writeStored } from '../ui/storage';
import type { OverviewView } from '../views/overview';
import AppBar from './AppBar.vue';
import SettingsPage from './SettingsPage.vue';
import SIcon from './SIcon.vue';
import { dismissWarnings, familyTitle, parseRoute, show, shownWarnings, state, toast, welcome } from './store';

const words = computed(() => (state.version, t()));
const title = computed(() => (state.version, familyTitle()));
const route = computed(() => (state.version, parseRoute(state.hash)));
const kind = computed(() => route.value?.kind ?? 'tree');

const TABS = [
  { kind: 'tree', href: '#/', icon: 'tree', label: () => words.value.navTree },
  { kind: 'dates', href: '#/dates', icon: 'cake', label: () => words.value.dates },
  { kind: 'stats', href: '#/stats', icon: 'chart', label: () => words.value.navStats },
] as const;
/** Everything that is no tab of its own belongs to the tree: a person, a path, the file. */
const activeTab = computed(() => (TABS.some((tab) => tab.kind === kind.value) ? kind.value : kind.value === 'settings' ? 'settings' : 'tree'));

// ---- drawing the page ----

const view = ref<HTMLElement>();
/** The address last put on screen, to tell a new page from the same one again. */
let rendered: string | undefined;

/** The page the address names. The same page again — after a save — keeps where it was scrolled to. */
function render(): void {
  const page = view.value;
  if (!page) return;
  const same = state.hash === rendered;
  rendered = state.hash;
  const shown = parseRoute(state.hash);
  if (!shown) {
    // An old link, a renamed person, a typo: say so rather than quietly showing the tree.
    if (!same && /^#\/?(p|up|down|r|path)\//.test(state.hash)) toast(t().personNotFound, 'info');
    history.replaceState(history.state, '', '#/');
    state.hash = location.hash;
    return;
  }
  const scrolled = same ? page.scrollTop : 0;
  document.title = show(shown, page, showGestureHint);
  page.scrollTop = scrolled;
}

watch([() => state.hash, () => state.version], render, { flush: 'post' });

// ---- the one-off gesture hint on the first tree ----

function showGestureHint(overview: OverviewView): void {
  if (readStored('stammbaum-hint') === 'seen') return;
  // Not behind the "who are you?" sheet, where it would time out unread.
  if (document.querySelector('dialog[open]')) return;
  const touch = matchMedia('(pointer: coarse)').matches;
  const hint = document.createElement('div');
  hint.className = 'hint alert border-0 bg-neutral text-neutral-content shadow-lg';
  hint.textContent = touch ? t().hintTouch : t().hintMouse;
  overview.element.append(hint);
  writeStored('stammbaum-hint', 'seen');
  const dismiss = () => {
    hint.classList.add('is-leaving');
    setTimeout(() => hint.remove(), 400);
  };
  setTimeout(dismiss, 6000);
  overview.element.addEventListener('pointerdown', dismiss, { once: true });
}

// ---- the file's warnings, for whoever can do something about them ----

const WARNINGS_SHOWN = 8;
const warnings = computed(() => (state.version, state.dismissedWarnings, shownWarnings()));

// ---- focus after a sheet ----

/** What last had the focus on the page, as a selector that finds it again once the page is drawn anew. */
let lastFocus: string | undefined;

/** The pen on a card, a bubble in the tree, a link — by what stays the same when they are drawn again. */
function focusKey(element: Element): string | undefined {
  const keyed = element.closest<HTMLElement | SVGElement>('[data-focus], .node[data-id], a[href]');
  if (!keyed) return undefined;
  const { focus, id } = keyed.dataset;
  if (focus) return `[data-focus="${CSS.escape(focus)}"]`;
  if (id) return `.node[data-id="${CSS.escape(id)}"]`;
  return `a[href="${CSS.escape(keyed.getAttribute('href') ?? '')}"]`;
}

function rememberFocus(event: FocusEvent): void {
  lastFocus = focusKey(event.target as Element);
}

// A closed sheet hands the focus back to what opened it. After a save that one was drawn
// anew, and the focus would fall to the page itself: it goes to the new one instead.
function afterSheet(): void {
  setTimeout(() => {
    if (document.querySelector('dialog[open]')) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    if (lastFocus) view.value?.querySelector<HTMLElement | SVGElement>(lastFocus)?.focus();
  });
}

onMounted(() => {
  document.addEventListener('close', afterSheet, true);
  welcome();
  render();
});
onBeforeUnmount(() => document.removeEventListener('close', afterSheet, true));
</script>

<template>
  <div class="frame has-nav">
    <nav class="app-nav" :aria-label="words.navLabel">
      <a href="#/" class="brand"><span class="crest"><SIcon name="tree" /></span>{{ title }}</a>
      <a
        v-for="tab in TABS"
        :key="tab.kind"
        :href="tab.href"
        :class="{ active: activeTab === tab.kind }"
        :aria-current="activeTab === tab.kind ? 'page' : undefined"
      >
        <SIcon :name="tab.icon" />
        <span>{{ tab.label() }}</span>
      </a>
      <span class="nav-spacer"></span>
      <a href="#/settings" class="nav-extra" :class="{ active: activeTab === 'settings' }">
        <SIcon name="settings" />
        <span>{{ words.menu }}</span>
      </a>
    </nav>

    <div class="app-shell">
      <AppBar :back="!['tree', 'dates', 'stats'].includes(kind)" :back-on-phone-only="kind === 'settings'" />
      <main v-show="kind !== 'settings'" id="view" ref="view" class="view" @focusin="rememberFocus"></main>
      <main v-if="kind === 'settings'" class="view">
        <SettingsPage />
      </main>
    </div>

    <section v-if="warnings.length" class="warnings alert alert-warning shadow-lg flex-col items-start gap-1" aria-labelledby="warnings-heading">
      <strong id="warnings-heading">{{ words.warnings(warnings.length) }}</strong>
      <button type="button" class="btn btn-ghost btn-circle btn-sm warnings-close" :title="words.closeWarnings" :aria-label="words.closeWarnings" @click="dismissWarnings">
        <SIcon name="close" />
      </button>
      <ul>
        <li v-for="warning in warnings.slice(0, WARNINGS_SHOWN)" :key="`${warning.line}|${warning.message}`">{{ warningText(warning) }}</li>
        <li v-if="warnings.length > WARNINGS_SHOWN">{{ words.moreWarnings(warnings.length - WARNINGS_SHOWN) }}</li>
      </ul>
      <!-- The whole list, with everything else the file is missing, has a page -->
      <a href="#/missing" class="link font-semibold">{{ words.missing }} →</a>
    </section>
  </div>
</template>
