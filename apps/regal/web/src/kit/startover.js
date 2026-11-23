// Copied from kit/web/startover.js by kit/sync.mjs. Change it there, not here.
// Starting over (kit/offline.js), when the server's database isn't the one this device's copy
// came from: a backup was put back, or it is a new database. The device has fetched everything
// the server has; this works out the device's new copy and what to send.
//
// The server's copy is the base. Kinds in `sendBack` (the device's own content: notes, tasks,
// lists) are then repaired from the device, so what only the device still has isn't lost:
//   - an item the server doesn't have goes back whole;
//   - one the device changed at least as late as the server (updated_at) sends the fields that differ;
//   - one the server has changed later stays the server's.
// Changes still waiting in the outbox go out as well. Their base_seq belonged to the old
// counter: it becomes the server's seq for what the device sends back, otherwise 0 (Notizbuch
// then keeps both texts instead of overwriting). Items the server deleted for good stay deleted.
// Other kinds (Notizbuch's files, which a sync can't create) become what the server has.
//
//   startOver({ kinds: ['task', 'list'], sendBack: ['task', 'list'],
//               server: { task: [items] }, local: { task: Map id → item }, outbox: [entries] })
//   → { items: { task: Map id → item }, outbox: [changed or new entries], sentBack: n }

const NOT_FIELDS = new Set(['id', 'seq', 'purged', 'pending']);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function fields(item) {
  return Object.fromEntries(Object.entries(item).filter(([key]) => !NOT_FIELDS.has(key)));
}

// What the device has that the server doesn't: null when nothing (or the server's is newer)
function repair(mine, theirs) {
  if (!theirs) return fields(mine);
  if ((mine.updated_at ?? '') < (theirs.updated_at ?? '')) return null;
  const diff = Object.fromEntries(Object.entries(fields(mine)).filter(([key, value]) => !same(value, theirs[key])));
  return Object.keys(diff).length ? diff : null;
}

export function startOver({ kinds, sendBack = kinds, server, local, outbox }) {
  const entries = new Map(outbox.map((e) => [e.id, { ...e, patch: { ...e.patch }, base_seq: 0 }]));
  const changed = new Set(entries.keys());
  const items = {};
  let sentBack = 0;

  for (const kind of kinds) {
    const theirs = new Map((server[kind] || []).map((item) => [item.id, item]));
    const mine = local[kind] || new Map();
    const next = new Map([...theirs].filter(([, item]) => !item.purged));

    if (sendBack.includes(kind)) {
      for (const item of mine.values()) {
        const key = `${kind}:${item.id}`;
        const there = theirs.get(item.id);
        if (there?.purged || entries.get(key)?.patch.purge) continue;
        const patch = repair(item, there);
        if (!patch) continue;
        const entry = entries.get(key) ?? { id: key, kind, item: item.id, patch: {}, v: 0 };
        entry.patch = { ...patch, ...entry.patch };
        entry.base_seq = there?.seq ?? 0;
        entry.v++;
        entries.set(key, entry);
        changed.add(key);
        sentBack++;
      }
    }

    // What the device shows: the server's copy with this device's waiting changes on top
    for (const entry of entries.values()) {
      if (entry.kind !== kind) continue;
      if (entry.patch.purge) {
        next.delete(entry.item);
        continue;
      }
      const there = theirs.get(entry.item);
      if (there?.purged) continue;
      const base = there ?? mine.get(entry.item);
      if (base) next.set(entry.item, { ...base, ...entry.patch, seq: there?.seq ?? 0 });
    }
    items[kind] = next;
  }

  return { items, outbox: [...changed].map((key) => entries.get(key)), sentBack };
}
