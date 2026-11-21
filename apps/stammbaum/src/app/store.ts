/**
 * Everything the app knows and does that isn't a piece of the page: the family and where it
 * comes from, who is looking, the trees, editing and saving, live updates. Moved here from
 * the old main.ts nearly unchanged; the Vue app (App.vue) shows it. `state.version` goes up
 * whenever something changed that the page shows, and the page draws itself again.
 */

import { shallowReactive } from 'vue';
import { fetchChanges, saveEdits, uploadPhoto, uploadThumb } from '@source';
import { upcoming } from '../calendar';
import { photosWithoutThumb, photoUrl, readFamily } from '../data';
import { makeThumb } from '../edit/photos';
import { confirmMerge, openEditor, openNewPerson, type EditorContext } from '../edit/editor';
import { Family } from '../family';
import { LANGS, lang, setLang, t, type Lang } from '../i18n';
import { relation } from '../kinship';
import { duplicates, gaps } from '../missing';
import type { Person } from '../parser/types';
import type { Edit } from '../parser/write';
import { SaveConflict, UnsupportedImage, type FamilySource } from '../source/types';
import { familyStats } from '../stats';
import { navigate } from '../ui/back';
import { displayName, nameStandIns, shortName, today } from '../ui/format';
import { icon } from '../ui/icons';
import { closeMenu, openMenu } from '../ui/menu';
import { pickPerson } from '../ui/picker';
import { setShowsCauses } from '../ui/prefs';
import { readStored, writeStored } from '../ui/storage';
import { renderDates } from '../views/dates';
import { renderMissing } from '../views/missing';
import { OverviewView, type TreeTarget } from '../views/overview';
import { renderPerson } from '../views/person';
import { renderRelation, route as relationRoute } from '../views/relation';
import { renderSource } from '../views/source';
import { renderStats } from '../views/stats';
import { treeBar } from '../views/tree-bar';
import { addMenu, treeMenu } from '../views/tree-menu';

export const state = shallowReactive({
  /** Goes up with every change the page shows: a save, another language, someone else looking. */
  version: 0,
  /** The address on screen (`#/p/klaus`); hash routing, so links, QR codes and the offline file keep working. */
  hash: location.hash,
  /** The whole family, or only whoever is looking's own. */
  scope: (readStored('stammbaum-scope') === 'kin' ? 'kin' : 'all') as 'all' | 'kin',
  /** The warnings last closed, so the same ones do not come back with every save. */
  dismissedWarnings: undefined as string | undefined,
});

window.addEventListener('hashchange', () => (state.hash = location.hash));

let source: FamilySource;
let family: Family;
let tree: OverviewView;
/** Ancestor and descendant trees, built the first time they are asked for. */
const subtrees = new Map<string, OverviewView>();
/** The tree on screen, if a tree is on screen. */
let shownTree: OverviewView | undefined;

export const getFamily = (): Family => family;
export const getSource = (): FamilySource => source;
export const editable = (): boolean => source.editable;

/** Starts with the family as loaded. */
export function start(loaded: FamilySource): void {
  source = loaded;
  family = new Family(readFamily(source));
  tree = makeTree();
  // A parent nobody has named yet goes by what they are to whoever is looking.
  nameStandIns((person) => caption(person));
  document.documentElement.lang = lang();
  document.querySelector('meta[name="description"]')?.setAttribute('content', t().description);
  document.addEventListener('visibilitychange', checkForChanges);
  setTimeout(() => void fillThumbs(), 4000);
}

/** After the language or the viewer changed: every word and every caption again. */
export function refresh(): void {
  captions.clear();
  tree.localize();
  for (const overview of subtrees.values()) overview.localize();
  document.documentElement.lang = lang();
  document.querySelector('meta[name="description"]')?.setAttribute('content', t().description);
  state.version++;
}

export function changeLanguage(id: Lang): void {
  setLang(id);
  // The tree's words — stand-ins' among them — are drawn in when it is built.
  tree = makeTree();
  subtrees.clear();
  refresh();
}

/** Causes of death shown or hidden, on this device. */
export function showCauses(show: boolean): void {
  setShowsCauses(show);
  state.version++;
}

/** The heading of family.md — without one, the app's own name, in the language on screen. */
export function familyTitle(): string {
  return /^#\s+\S/m.test(source.markdown) ? family.graph.title : t().appName;
}

// ---- who is looking -------------------------------------------------------

/** Stored when someone says they are none of the people in the file. */
const NOBODY = '-';

/** Who the captions are written for: whoever was chosen on this device, else the file's `me` line. */
export function viewer(): string | undefined {
  const chosen = readStored('stammbaum-me');
  if (chosen === NOBODY) return undefined;
  if (chosen && family.person(chosen)) return chosen;
  return family.graph.me;
}

function setViewer(id: string | null): void {
  writeStored('stammbaum-me', id ?? NOBODY);
  // Someone new is looking: the tree is theirs, and opens on them.
  tree = makeTree();
  // Stand-ins in every tree are named for whoever looks.
  subtrees.clear();
  refresh();
}

/** What someone is to the viewer, in the current language — cached, since search asks a lot. */
const captions = new Map<string, string | undefined>();
export function caption(person: Person): string | undefined {
  const me = viewer();
  if (!me) return undefined;
  const key = `${me}|${lang()}|${person.id}`;
  if (!captions.has(key)) captions.set(key, relation(family, me, person.id, lang()));
  return captions.get(key);
}

/** Search finds people by what they are to you, in either language: "tante", "aunt". */
export function relationWords(person: Person): Array<string | undefined> {
  const me = viewer();
  if (!me) return [];
  const key = `${me}|*|${person.id}`;
  if (!captions.has(key)) {
    captions.set(key, LANGS.map(({ id }) => relation(family, me, person.id, id) ?? '').join(' '));
  }
  return [captions.get(key)];
}

export async function chooseViewer(): Promise<void> {
  const chosen = await pickPerson(family, { title: t().whoAreYou, hint: t().iAmHint, none: true });
  if (chosen !== undefined) setViewer(chosen ? chosen.id : null);
}

/**
 * A first visit asks who is looking, rather than quietly captioning everything for the
 * file's `me`. Asked once: closing the sheet keeps the `me` line, and the bubble next to
 * search can still change it.
 */
export function welcome(): void {
  if (readStored('stammbaum-me') !== null || readStored('stammbaum-asked') !== null) return;
  if (family.people().length < 2) return;
  writeStored('stammbaum-asked', 'yes');
  void chooseViewer();
}

/** Asks who to compare `person` with, then shows how the two are related. */
async function pickRelative(person: Person): Promise<void> {
  const other = await pickPerson(family, {
    title: t().pickOther(shortName(person)),
    caption,
    extra: relationWords,
    exclude: person.id,
  });
  if (other) navigate(relationRoute(person, other));
}

export async function findRelation(): Promise<void> {
  const me = viewer();
  const first = (me && family.person(me)) || (await pickPerson(family, { title: t().pickFirst, caption, extra: relationWords }));
  if (first) await pickRelative(first);
}

// ---- routing --------------------------------------------------------------

export type Route =
  | { kind: 'tree' | 'dates' | 'stats' | 'missing' | 'file' | 'settings' }
  | { kind: 'up' | 'down' | 'person'; person: Person }
  | { kind: 'relation' | 'path'; a: Person; b: Person };

/** How far ahead the birthday list looks. */
const DATES_SPAN = 30;

/**
 * `#/`, `#/p/klaus`, `#/up/klaus`, `#/down/klaus`, `#/r/jonas/jakob`,
 * `#/path/jonas/jakob`, `#/dates`, `#/file`, `#/settings`.
 */
export function parseRoute(hash: string): Route | undefined {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const people = parts.slice(1).map((part) => {
    try {
      return family.person(decodeURIComponent(part));
    } catch {
      return undefined;
    }
  });
  const [kind] = parts;
  if (kind === undefined) return { kind: 'tree' };
  if ((kind === 'dates' || kind === 'stats' || kind === 'missing' || kind === 'file' || kind === 'settings') && parts.length === 1) return { kind };
  if (people.some((p) => !p)) return undefined;
  const [a, b] = people as Person[];
  if ((kind === 'p' || kind === 'up' || kind === 'down') && a && !b) {
    return { kind: kind === 'p' ? 'person' : kind, person: a };
  }
  if ((kind === 'r' || kind === 'path') && a && b && people.length === 2) {
    return { kind: kind === 'r' ? 'relation' : 'path', a, b };
  }
  return undefined;
}

// ---- trees ------------------------------------------------------------------

/** The tree for the overview, as wide as `scope` says. */
function makeTree(): OverviewView {
  const me = viewer();
  const shown = state.scope === 'kin' && me ? new Family(family.kinGraph(me)) : family;
  return new OverviewView(shown, openFromTree, openTreeMenu, pickOnTree, me);
}

/** Everyone, whatever the overview shows — a path between two people may run through anybody. */
function wholeTree(): OverviewView {
  if (state.scope === 'all' || !viewer()) return tree;
  let whole = subtrees.get('all');
  if (!whole) {
    whole = new OverviewView(family, openFromTree, openTreeMenu, pickOnTree, viewer());
    subtrees.set('all', whole);
  }
  return whole;
}

function openFromTree(id: string): void {
  navigate(`#/p/${encodeURIComponent(id)}`);
}

/** What can be done about `target` on a tree. */
function treeChoices(target: TreeTarget): ReturnType<typeof treeMenu> {
  return treeMenu(target, {
    family,
    editor: source.editable ? editorContext() : undefined,
    open: openFromTree,
    added: showAdded,
    fit: () => (shownTree ?? tree).fit(),
  });
}

/** Right-click or long press on a tree: what can be done right there — for a finger, as a sheet. */
function openTreeMenu(target: TreeTarget, at: { x: number; y: number }, touch: boolean): void {
  const { title, items } = treeChoices(target);
  openMenu(touch ? undefined : at, title, items);
}

/**
 * A tap on a tree on a phone: the same choices, in a bar along the bottom. Someone who may
 * only look has nothing to choose but opening, so their tap just opens.
 */
function pickOnTree(target: TreeTarget, done: () => void): HTMLElement | undefined {
  const { title, items } = treeChoices(target);
  if (!title || items.length === 0) return undefined;
  if (target.kind === 'person') {
    if (items.length === 1) return undefined;
    return treeBar(title, items, done, () => openFromTree(target.id));
  }
  return treeBar(title, items, done);
}

/** Someone new on the tree: brought into view and ringed, so the next step starts there. */
function showAdded(id: string): void {
  if (shownTree?.has(id)) shownTree.highlight(id);
}

function subtree(kind: 'up' | 'down', person: Person): OverviewView {
  const key = `${kind}/${person.id}`;
  let overview = subtrees.get(key);
  if (!overview) {
    const graph = kind === 'up' ? family.ancestorsGraph(person.id) : family.descendantsGraph(person.id);
    overview = new OverviewView(new Family(graph), openFromTree, openTreeMenu, pickOnTree, person.id);
    subtrees.set(key, overview);
  }
  return overview;
}

/** The whole family, or only one's own. */
export function setScope(scope: 'all' | 'kin'): void {
  state.scope = scope;
  writeStored('stammbaum-scope', scope);
  tree = makeTree();
  state.version++;
}

/** Search on a tree: a hit centres the bubble instead of leaving the map. */
export function openPerson(person: Person): void {
  if (shownTree?.has(person.id)) shownTree.highlight(person.id);
  else navigate(`#/p/${encodeURIComponent(person.id)}`);
}

// ---- drawing a page -------------------------------------------------------------

/** Whether the first person has been asked for once already — closing the sheet means "not now". */
let offeredStart = false;

function startFamily(): void {
  openNewPerson(editorContext(), showAdded);
}

/**
 * Puts the page `route` names into `view` (the old main.ts show(), nearly unchanged). Returns
 * the title for the browser tab. The settings page is Vue's and not drawn here.
 */
export function show(route: Route, view: HTMLElement, gestureHint: (overview: OverviewView) => void): string {
  const title = draw(route, view, gestureHint);
  // The settings page saves the tree one came from as a picture.
  if (route.kind !== 'settings') lastTree = shownTree ? { overview: shownTree, title } : undefined;
  return title;
}

/** The tree last on screen and its title, for saving it as a picture. */
let lastTree: { overview: OverviewView; title: string } | undefined;

function draw(route: Route, view: HTMLElement, gestureHint: (overview: OverviewView) => void): string {
  shownTree = undefined;
  closeMenu();
  // A ring from the last search, or a tapped person's bar, would read as part of whatever comes next.
  for (const overview of [tree, ...subtrees.values()]) {
    overview.unhighlight();
    overview.unpick();
  }

  const showTree = (overview: OverviewView, label?: string, closeTo = '#/', focus?: string): void => {
    overview.element.querySelector('.tree-chip')?.remove();
    if (label) {
      const chip = document.createElement('div');
      chip.className = 'tree-chip badge badge-lg bg-base-100 shadow-md';
      const text = document.createElement('span');
      text.textContent = label;
      const close = document.createElement('a');
      close.className = 'tree-chip-close';
      close.href = closeTo;
      close.title = t().close;
      close.setAttribute('aria-label', t().close);
      close.append(icon('close'));
      chip.append(text, close);
      overview.element.append(chip);
    }
    overview.element.querySelector('.scope-toggle')?.remove();
    if (overview === tree && viewer()) overview.element.append(scopeToggle());
    view.replaceChildren(overview.element);
    overview.markViewer(viewer());
    overview.activate(focus);
    gestureHint(overview);
    shownTree = overview;
  };

  switch (route.kind) {
    case 'person': {
      const { person } = route;
      view.replaceChildren(
        renderPerson(family, person, {
          viewer: viewer(),
          pickRelative,
          edit: source.editable ? (someone) => openEditor(someone, editorContext()) : undefined,
          add: source.editable ? (someone) => openMenu(undefined, t().addMenu, addMenu(family, someone, editorContext())) : undefined,
        }),
      );
      return `${displayName(person)} — ${familyTitle()}`;
    }
    case 'relation': {
      const { a, b } = route;
      view.replaceChildren(
        renderRelation(family, a, b, {
          change: async (which) => {
            const keep = which === 'a' ? b : a;
            const other = await pickPerson(family, { title: t().pickOther(shortName(keep)), caption, extra: relationWords });
            if (other) navigate(which === 'a' ? relationRoute(other, b) : relationRoute(a, other));
          },
        }),
      );
      return `${shortName(a)} & ${shortName(b)} — ${familyTitle()}`;
    }
    case 'dates':
      view.replaceChildren(renderDates(upcoming(family, today(), DATES_SPAN), DATES_SPAN, caption));
      return `${t().datesTitle} — ${familyTitle()}`;
    case 'stats':
      view.replaceChildren(renderStats(familyStats(family, today())));
      return `${t().stats} — ${familyTitle()}`;
    case 'missing':
      // The page lists the file's warnings itself.
      dismissWarnings();
      view.replaceChildren(
        renderMissing(
          gaps(family, (p) => !!photoUrl(p), today()),
          family.graph.warnings,
          duplicates(family),
          source.editable ? (a, b) => confirmMerge(a, b, editorContext()) : undefined,
        ),
      );
      return `${t().missing} — ${familyTitle()}`;
    case 'file':
      view.replaceChildren(renderSource(source.markdown, source.editable ? () => void save([{ kind: 'tidy' }], t().msg.tidied) : undefined));
      return `family.md — ${familyTitle()}`;
    case 'settings':
      view.replaceChildren();
      return `${t().menu} — ${familyTitle()}`;
    case 'tree':
      if (family.people().length === 0) {
        view.replaceChildren(renderEmpty());
        // A family that does not exist yet starts with its first person.
        if (source.editable && !offeredStart && !document.querySelector('dialog[open]')) {
          offeredStart = true;
          startFamily();
        }
        return familyTitle();
      }
      showTree(tree, undefined, undefined, viewer());
      tree.emphasize(undefined);
      return familyTitle();
    case 'path': {
      const { a, b } = route;
      const whole = wholeTree();
      showTree(whole, `${shortName(a)} ↔ ${shortName(b)}`, relationRoute(a, b));
      whole.emphasize(family.path(a.id, b.id));
      return `${shortName(a)} ↔ ${shortName(b)} — ${familyTitle()}`;
    }
    case 'up':
    case 'down': {
      const { person } = route;
      const label = route.kind === 'up' ? t().ancestorsOf(shortName(person)) : t().descendantsOf(shortName(person));
      showTree(subtree(route.kind, person), label, `#/p/${encodeURIComponent(person.id)}`, person.id);
      return `${label} — ${familyTitle()}`;
    }
  }
}

/** The tree before there is anyone in it. */
function renderEmpty(): HTMLElement {
  const root = document.createElement('article');
  root.className = 'empty-view';
  const heading = document.createElement('h1');
  heading.className = 'page-title';
  heading.textContent = t().emptyTitle;
  const text = document.createElement('p');
  text.className = 'page-hint';
  text.textContent = source.editable ? t().emptyText : t().emptyReadOnly;
  root.append(icon('tree'), heading, text);
  if (source.editable) {
    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'btn btn-primary';
    start.append(icon('plus'), t().emptyStart);
    start.addEventListener('click', startFamily);
    root.append(start);
  }
  return root;
}

/** Bottom left of the overview: the whole family, or only one's own. */
function scopeToggle(): HTMLButtonElement {
  const on = state.scope === 'kin';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `scope-toggle btn btn-sm shadow-md ${on ? 'btn-primary' : 'bg-base-100'}`;
  button.setAttribute('aria-pressed', String(on));
  button.title = t().onlyMyFamilyHint;
  button.append(icon('family'), t().onlyMyFamily);
  button.addEventListener('click', () => setScope(on ? 'all' : 'kin'));
  return button;
}

// ---- saving the tree as a picture -------------------------------------------------

/** Downloads the tree last on screen — or the whole family, when the last page was no tree. */
export async function saveTree(format: 'png' | 'svg'): Promise<void> {
  const overview = lastTree?.overview ?? tree;
  const heading = lastTree?.title ?? familyTitle();
  try {
    const blob = await overview.exportImage(format, heading);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${fileName(heading)}.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  } catch (error) {
    console.error(error);
    toast(t().saveFailed);
  }
}

/** "Vorfahren von Nina — Familie Bauer" → "vorfahren-von-nina-familie-bauer". */
function fileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'stammbaum';
}

// ---- messages -------------------------------------------------------------------

/** A short message at the bottom of the screen that goes away on its own. */
export function toast(text: string, kind: 'error' | 'success' | 'info' = 'error'): void {
  // One at a time: "uploading" gives way to "saved".
  for (const earlier of document.querySelectorAll('.toast-note')) earlier.remove();
  const element = document.createElement('div');
  element.className = `toast-note alert alert-${kind} shadow-lg`;
  // Screen readers hear it from the region that is always there, not from here.
  element.setAttribute('aria-hidden', 'true');
  element.textContent = text;
  document.body.append(element);
  setTimeout(() => element.remove(), kind === 'error' ? 6000 : 2500);
  announce(text);
}

/**
 * Says `text` through the live region in index.html. A region that is already there is what
 * screen readers listen to; one appearing with its words in it often goes unread. Emptied
 * first, so the same words twice are said twice.
 */
function announce(text: string): void {
  const region = document.querySelector('#announcer');
  if (!region) return;
  region.textContent = '';
  setTimeout(() => (region.textContent = text), 50);
}

// ---- editing ----------------------------------------------------------------

export function editorContext(): EditorContext {
  return {
    // Read at the moment it is needed: after a save, the new family.
    get family() {
      return family;
    },
    save,
    upload,
    caption,
    fail: (text) => toast(text),
  };
}

export function addPerson(): void {
  openNewPerson(editorContext(), (id) => navigate(`#/p/${encodeURIComponent(id)}`));
}

async function upload(image: Blob, name: string): Promise<string | undefined> {
  toast(t().uploading, 'info');
  try {
    const saved = await uploadPhoto(image, name);
    // The small version for the bubbles goes along; without it they show the big one.
    const thumb = await makeThumb(image);
    if (thumb) await uploadThumb(saved, thumb).catch((error: unknown) => console.error(error));
    return saved;
  } catch (error) {
    console.error(error);
    // A kind of picture the server does not take says so; anything else is a failed upload.
    toast(error instanceof UnsupportedImage ? t().unreadable(image instanceof File ? image.name : '') : t().uploadError);
    return undefined;
  }
}

/**
 * Sends edits to the server and shows the family as it is afterwards. When someone else got
 * there first, their version is shown instead and nothing of this edit is lost silently — it
 * just has to be made again.
 */
async function save(edits: Edit[], message: string): Promise<Record<string, string> | undefined> {
  // Whatever a check for changes brings back from before this save is older than its result.
  generation++;
  try {
    const saved = await saveEdits(edits, message);
    followRenames(saved.renamed);
    useSource(saved.source);
    toast(t().saved, 'success');
    return saved.created;
  } catch (error) {
    if (error instanceof SaveConflict) {
      // Any open form still holds the old values; it has to start again from the new ones.
      for (const dialog of document.querySelectorAll('dialog[open]')) (dialog as HTMLDialogElement).close();
      useSource(error.source);
      toast(t().saveConflict);
    } else {
      console.error(error);
      toast(t().saveError);
    }
    return undefined;
  }
}

/** Someone's id changed: the page on screen and who is looking follow, so nothing points at the old one. */
function followRenames(renamed: Record<string, string>): void {
  if (Object.keys(renamed).length === 0) return;
  const parts = location.hash.split('/').map((part) => {
    try {
      const now = renamed[decodeURIComponent(part)];
      return now ? encodeURIComponent(now) : part;
    } catch {
      return part;
    }
  });
  // The state stays: it may be an open sheet's. Still the same page, under its new name.
  history.replaceState(history.state, '', parts.join('/') || '#/');
  state.hash = location.hash;
  const me = readStored('stammbaum-me');
  if (me && renamed[me]) writeStored('stammbaum-me', renamed[me]);
}

/** Goes up with every save and every new version on screen, so a late answer can tell it is late. */
let generation = 0;

/** Puts a new version of the family on screen, wherever one was looking. */
function useSource(next: FamilySource): void {
  generation++;
  source = next;
  family = new Family(readFamily(next));
  const before = tree;
  tree = makeTree();
  // The same family a moment later: stay where one was looking.
  tree.keepViewOf(before);
  subtrees.clear();
  lastTree = undefined;
  refresh();
}

/** Someone else may have saved while this tab was in the background. */
function checkForChanges(): void {
  if (document.visibilityState !== 'visible') return;
  const asked = generation;
  fetchChanges()
    .then((next) => {
      // A save in the meantime put a newer family on screen than this answer may be.
      if (generation !== asked) return;
      if (next && (next.version !== source.version || next.editable !== source.editable)) useSource(next);
    })
    .catch(() => undefined);
}

// ---- the file's warnings ------------------------------------------------------

export function warningsKey(): string {
  return family.graph.warnings.map((warning) => `${warning.line}|${warning.message}`).join('\n');
}

/** The warnings, for whoever can do something about them, unless closed (until they change). */
export function shownWarnings(): typeof family.graph.warnings {
  const { warnings } = family.graph;
  if (!source.editable || warnings.length === 0 || warningsKey() === state.dismissedWarnings) return [];
  return warnings;
}

export function dismissWarnings(): void {
  state.dismissedWarnings = warningsKey();
}

// ---- small pictures for old photos ---------------------------------------------------

/**
 * Photos from before there were small versions — or put into photos/ by hand — get theirs
 * from the first editor who comes by, one at a time and in the background. The bubbles use
 * them from the next visit on.
 */
async function fillThumbs(): Promise<void> {
  if (!source.editable || sparingData()) return;
  for (const name of photosWithoutThumb()) {
    const url = source.photos.get(name);
    if (!url) continue;
    try {
      const thumb = await makeThumb(await (await fetch(url)).blob());
      if (thumb) await uploadThumb(name, thumb);
    } catch (error) {
      console.error(error);
    }
  }
}

/** Whether the phone asked to save data, or is on mobile data. Only some browsers say either. */
function sparingData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; type?: string } }).connection;
  return connection?.saveData === true || connection?.type === 'cellular';
}
