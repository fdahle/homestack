// Offline first, for apps that keep everything on the device (Notizbuch, To-do). Every change
// lands at once in memory and IndexedDB and goes into an outbox; sync() sends the outbox to
// POST /api/sync (server/sync.js in the kit) and takes in what changed elsewhere. Without a
// network nothing is lost: the outbox waits, and the next sync (back online, the app shown
// again, every minute, a moment after a change) sends it. Each account has its own local
// database, opened when it logs in.
//
// When the server's database isn't the one this copy came from (a backup put back, a new
// database; see server/sync.js), the device starts over: it fetches everything and sends back
// what only it still has (startover.js).
//
//   const off = createOffline({
//     name: 'todo',                           // IndexedDB "todo-<user id>"
//     kinds: { task: 'tasks', list: 'lists' }, // kind (as the server calls it) → local store
//     sendBack: ['note'],                     // kinds a device may send back to a server that
//                                             // lost them (default: all; Notizbuch's files can't)
//     extraStores: ['uploads'],               // the app's own local stores (Notizbuch)
//     onOpen: async (local) => {},            // read them when an account's data opens (again
//                                             // after starting over)
//     onClose: () => {},
//     afterChanges: async ({ local, owner }) => false,  // a step after the changes went out
//                                             // (Notizbuch uploads files); true: pull once more
//     onAnswer: (answer) => {},               // e.g. a toast for conflicts
//   });
//
//   off.state.items.task      Map id → item (with this device's unsent changes on top)
//   off.queue('task', item, patch)   change an item (the item, already changed in memory)
//   off.queue('file', null, patch)   a change for something that isn't kept locally

import { reactive, watch } from 'vue';
import { api, ApiError, onLogout, session } from './api.js';
import { deleteLocal, openLocal, plain } from './localdb.js';
import { startOver } from './startover.js';

export { plain };

export function createOffline({ name, kinds, sendBack = Object.keys(kinds), extraStores = [], onOpen, onClose, afterChanges, onAnswer, batchSize = 200 }) {
  const storeOf = kinds; // kind → local store name
  const stores = [...Object.values(kinds), ...extraStores, 'outbox', 'meta'];

  const state = reactive({
    ready: false,
    items: Object.fromEntries(Object.keys(kinds).map((k) => [k, new Map()])),
    pending: 0, // changes not yet on the server (the app may add its own, e.g. uploads)
    extraPending: 0,
    status: 'idle', // idle | syncing | offline | error
    lastSync: null,
    settings: null, // GET /api/settings, kept for offline
  });

  let local = null;
  let owner = null;
  let seq = 0;
  let database = null; // the server's database this copy comes from
  const outbox = new Map(); // '<kind>:<id>' → { id, kind, item, base_seq, patch, v }
  const countPending = () => (state.pending = outbox.size + state.extraPending);

  // --- open and close ---

  async function open(user) {
    close();
    owner = user.id;
    const db = await openLocal(`${name}-${user.id}`, stores);
    if (owner !== user.id) return db.close();
    local = db;
    const meta = await local.all('meta');
    const metaValue = (key, fallback) => meta.find((m) => m.key === key)?.value ?? fallback;
    for (const [kind, store] of Object.entries(storeOf)) state.items[kind] = new Map((await local.all(store)).map((x) => [x.id, x]));
    for (const entry of await local.all('outbox')) outbox.set(entry.id, entry);
    seq = metaValue('seq', 0);
    database = metaValue('database', null);
    state.lastSync = metaValue('lastSync', null);
    state.settings = metaValue('settings', null);
    await onOpen?.(local);
    countPending();
    state.ready = true;

    // Ask the browser to keep the data even when space runs low
    navigator.storage?.persist?.().catch(() => {});
    listen(true);
    sync();
    loadSettings();
  }

  function close() {
    listen(false);
    clearTimeout(soonTimer);
    local?.close();
    local = null;
    owner = null;
    seq = 0;
    database = null;
    outbox.clear();
    onClose?.();
    state.ready = false;
    for (const kind of Object.keys(storeOf)) state.items[kind] = new Map();
    state.extraPending = 0;
    state.pending = 0;
    state.status = 'idle';
  }

  function whenReady() {
    if (state.ready) return Promise.resolve();
    return new Promise((resolve) => {
      const stop = watch(() => state.ready, (ready) => {
        if (!ready) return;
        stop();
        resolve();
      });
    });
  }

  function loadSettings() {
    return api('/settings').then((s) => {
      state.settings = s;
      local?.put('meta', { key: 'settings', value: s });
      return s;
    }, () => state.settings);
  }

  // --- when to sync ---

  let soonTimer = null;
  let everyMinute = null;
  const onOnline = () => sync();
  const onOffline = () => (state.status = 'offline');
  // Shown again: catch up. Hidden (switching apps, closing the tab): send what's waiting now.
  const onVisibility = () => sync();

  function listen(on) {
    const method = on ? 'addEventListener' : 'removeEventListener';
    window[method]('online', onOnline);
    window[method]('offline', onOffline);
    document[method]('visibilitychange', onVisibility);
    clearInterval(everyMinute);
    if (on) everyMinute = setInterval(() => document.visibilityState === 'visible' && sync(), 60_000);
  }

  function syncSoon(delay = 1000) {
    clearTimeout(soonTimer);
    soonTimer = setTimeout(sync, delay);
  }

  // --- changes ---

  // item: the item as it is now (already changed in memory), or null for something not kept locally.
  // base_seq: the item's seq when the first unsent change was made (for apps that merge, Notizbuch).
  function queue(kind, item, patch, id = item?.id) {
    const key = `${kind}:${id}`;
    const entry = outbox.get(key) ?? { id: key, kind, item: id, base_seq: item?.seq ?? 0, patch: {}, v: 0 };
    if (patch.purge) entry.patch = { purge: true };
    else Object.assign(entry.patch, patch);
    entry.v++;
    outbox.set(key, entry);
    local?.put('outbox', plain(entry));
    if (item) local?.put(storeOf[kind], plain(item));
    countPending();
    syncSoon();
  }

  // Changes the app makes only on this device (its own copy), e.g. dropping an item
  const putLocal = (kind, item) => local?.put(storeOf[kind], plain(item));
  const removeLocal = (kind, id) => local?.remove(storeOf[kind], id);
  const isQueued = (kind, id) => outbox.has(`${kind}:${id}`);

  // --- sync ---

  let running = null;
  let again = false;

  function sync() {
    if (!local || !session.user) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    clearTimeout(soonTimer);
    running = run().finally(() => {
      running = null;
      if (again) {
        again = false;
        syncSoon(0);
      }
    });
    return running;
  }

  async function exchange(changes) {
    const sent = new Map(changes.map((e) => [e.id, e.v]));
    const answer = await api('/sync', {
      method: 'POST',
      body: { database, since: seq, changes: changes.map(({ kind, item, base_seq, patch }) => ({ kind, id: item, base_seq, patch })) },
    });
    return { answer, sent };
  }

  async function run() {
    if (!navigator.onLine) {
      state.status = 'offline';
      return;
    }
    const me = owner;
    state.status = 'syncing';
    let startedOver = false;
    try {
      for (;;) {
        const all = [...outbox.values()];
        const batch = all.slice(0, batchSize);
        const { answer, sent } = await exchange(batch);
        if (me !== owner) return;
        if (answer.start_over) {
          // Once per run: a server that keeps asking is broken, not restored
          if (startedOver) throw new Error('The server keeps asking to start over');
          startedOver = true;
          await restart(answer.database, me);
          if (me !== owner) return;
          continue;
        }
        await take(answer, sent);
        if (all.length <= batch.length) break;
      }
      if (afterChanges && (await afterChanges({ local, isOwner: () => me === owner, requeue: () => (again = true) }))) {
        if (me !== owner) return;
        const { answer, sent } = await exchange([]);
        await take(answer, sent);
      }
      state.status = 'idle';
      state.lastSync = new Date().toISOString();
      await local.put('meta', { key: 'lastSync', value: state.lastSync });
    } catch (err) {
      if (me !== owner) return;
      // No answer at all: offline, or the server is away. An answer with an error: something to look at.
      state.status = err instanceof ApiError ? 'error' : 'offline';
      if (err instanceof ApiError && err.status !== 401) console.warn('Sync:', err);
    } finally {
      countPending();
    }
  }

  // An answer from POST /api/sync. sent: outbox key → version that went out.
  async function take(answer, sent) {
    const puts = {};
    const removes = {};
    const outboxPuts = [];
    const outboxRemoves = [];
    const unqueue = (key) => {
      outbox.delete(key);
      outboxRemoves.push(key);
    };

    // Sent and not changed again meanwhile: done
    for (const [key, v] of sent) if (outbox.get(key)?.v === v) unqueue(key);
    for (const r of answer.rejected || []) {
      console.warn(`The server didn't take a change to ${r.kind} ${r.id}: ${r.error}`);
      const key = `${r.kind}:${r.id}`;
      if (sent.has(key) && outbox.has(key)) unqueue(key);
    }

    for (const [kind, items] of Object.entries(answer.items || {})) {
      const store = storeOf[kind];
      if (!store) continue;
      puts[store] ??= [];
      removes[store] ??= [];
      for (const item of items) {
        const key = `${kind}:${item.id}`;
        const pending = outbox.get(key);
        if (item.purged) {
          if (pending) unqueue(key);
          if (state.items[kind].has(item.id)) {
            state.items[kind].delete(item.id);
            removes[store].push(item.id);
          }
          continue;
        }
        if (pending) {
          // Changed again while the sync was on its way: the server has the version that was sent
          if (sent.has(key)) {
            pending.base_seq = item.seq;
            outboxPuts.push(plain(pending));
          }
          if (pending.patch.purge) continue;
        }
        const merged = pending ? { ...item, ...pending.patch } : item;
        state.items[kind].set(item.id, merged);
        puts[store].push(plain(merged));
      }
    }

    seq = answer.seq;
    database = answer.database ?? database;
    await Promise.all([
      ...Object.entries(puts).map(([s, list]) => local.put(s, list)),
      ...Object.entries(removes).map(([s, list]) => local.remove(s, list)),
      local.put('outbox', outboxPuts),
      local.remove('outbox', outboxRemoves),
      local.put('meta', [{ key: 'seq', value: seq }, { key: 'database', value: database }]),
    ]);
    onAnswer?.(answer);
  }

  // The server's database isn't the one this copy came from: fetch everything, rebuild the
  // copy from it, and queue what only this device still has (startover.js). Memory changes in
  // one go, with nothing awaited in between, so a change made meanwhile lands on top. The new
  // seq and database are saved last: if the page closes halfway, the next start starts over
  // again, from a copy that still holds everything this device had.
  async function restart(theirs, me) {
    const answer = await api('/sync', { method: 'POST', body: { database: theirs, since: 0, changes: [] } });
    if (me !== owner) return;
    if (answer.start_over) throw new Error('The server asked to start over again');
    const db = local;
    const result = startOver({ kinds: Object.keys(storeOf), sendBack, server: answer.items || {}, local: state.items, outbox: [...outbox.values()] });

    const writes = [db.put('outbox', result.outbox.map(plain))];
    for (const [kind, store] of Object.entries(storeOf)) {
      const next = result.items[kind];
      const gone = [...state.items[kind].keys()].filter((id) => !next.has(id));
      state.items[kind] = next;
      writes.push(db.remove(store, gone), db.put(store, [...next.values()].map(plain)));
    }
    for (const entry of result.outbox) outbox.set(entry.id, entry);
    seq = answer.seq;
    database = answer.database;
    countPending();
    await Promise.all(writes);
    await db.put('meta', [{ key: 'seq', value: answer.seq }, { key: 'database', value: answer.database }]);
    console.info(`Sync: the server's data isn't this device's (a backup put back?). Started over, sending back ${result.sentBack} item(s).`);
    if (me === owner) await onOpen?.(db);
  }

  // The app's own pending work (uploads) counts in state.pending too
  function setExtraPending(n) {
    state.extraPending = n;
    countPending();
  }

  // Each account's data opens when it logs in (last, so everything above is defined)
  watch(() => session.user?.id, (id) => (id ? open(session.user) : close()), { immediate: true });

  // Logging out: one last try to send the outbox, then this account's copy leaves the device
  onLogout({
    async pending() {
      if (state.pending) await sync().catch(() => {});
      return state.pending;
    },
    async after(user) {
      close();
      if (user) await deleteLocal(`${name}-${user.id}`);
    },
  });

  return { state, whenReady, queue, putLocal, removeLocal, isQueued, sync, syncSoon, loadSettings, setExtraPending, local: () => local };
}
