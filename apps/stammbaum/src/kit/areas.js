// Copied from kit/web/areas.js by kit/sync.mjs. Change it there, not here.
// Areas ("Zuhause", "Arbeit") on the device: named groups of what an app sorts by (Notizbuch's
// labels, To-do's lists), synced like the app's other things (kind "area", server/areas.js).
// Which area this device shows is its own choice and stays on it ("all": everything).
//
//   const areas = createAreas(off, 'todo');   // off: createOffline({ kinds: { …, area: 'areas' } })
//   areas.list         the areas, in order
//   areas.current      the area shown on this device, or null for all
//   areas.currentId    'all' or an area's id (a ref: set it to switch)
//   areas.add(name, members) / areas.update(id, changes) / areas.remove(id)

import { computed } from 'vue';
import { rememberedRef } from './util.js';

export function createAreas(off, app) {
  const now = () => new Date().toISOString();

  const list = computed(() => [...off.state.items.area.values()]
    .filter((a) => !a.deleted_at && !a.purged)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name)));

  const currentId = rememberedRef(`${app}.area`, 'all');
  // An area deleted elsewhere (or another account's) shows everything again
  const current = computed(() => list.value.find((a) => a.id === currentId.value) || null);

  function add(name, members = []) {
    const at = now();
    const position = Math.max(0, ...list.value.map((a) => a.position || 0)) + 1;
    const area = { id: crypto.randomUUID(), name: name.trim().slice(0, 40), position, members, created_at: at, updated_at: at, deleted_at: null };
    off.state.items.area.set(area.id, { ...area, seq: 0 });
    const { id, ...patch } = area;
    off.queue('area', off.state.items.area.get(id), patch);
    return off.state.items.area.get(id);
  }

  function update(id, changes) {
    const area = off.state.items.area.get(id);
    if (!area) return;
    const patch = { ...changes, updated_at: now() };
    Object.assign(area, patch);
    off.queue('area', area, patch);
  }

  function remove(id) {
    update(id, { deleted_at: now() });
    if (currentId.value === id) currentId.value = 'all';
  }

  return { list, current, currentId, add, update, remove };
}
