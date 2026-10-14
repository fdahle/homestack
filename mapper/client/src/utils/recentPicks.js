// Collections, categories and persons recently ticked in a saved marker, so the marker form lists
// them first. Kept in memory only: every page load starts with an empty list.
const MAX_PER_LIST = 4
const recent = { collection_ids: [], category_ids: [], person_ids: [] }

// Only what was newly ticked counts; assignments an edited marker already had were not picked now.
export function rememberPicks(form, initial = {}) {
  for (const key of Object.keys(recent)) {
    const picked = form[key].filter(id => !initial[key]?.includes(id))
    recent[key] = [...new Set([...picked, ...recent[key]])].slice(0, MAX_PER_LIST)
  }
}

// A copy, so a form keeps its order while open even if another save changes the list.
export function recentPicks() {
  return Object.fromEntries(Object.entries(recent).map(([key, ids]) => [key, [...ids]]))
}

// Recent items first (most recent on top), then the rest in their usual order.
export function recentFirst(items, recentIds) {
  const byId = new Map(items.map(item => [item.id, item]))
  const first = recentIds.map(id => byId.get(id)).filter(Boolean)
  return { items: [...first, ...items.filter(item => !recentIds.includes(item.id))], recentCount: first.length }
}
