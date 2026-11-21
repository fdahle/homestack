import { usePersonsStore } from './persons.js'
import { apiFetch, apiList } from '../api.js'
import { defineStore } from 'pinia'

const GROUP_LISTS = { category: 'categories', collection: 'collections', person: 'persons' }

function inGroup(m, { type, id }) {
  if (type === 'smart') {
    if (id === 'favorites') return !!m.is_favorite
    if (id === 'planned') return !!m.planned_at && !m.visited_at
    return true
  }
  const list = m[GROUP_LISTS[type]]
  return id === '__none__' ? !list?.length : !!list?.some((g) => g.id === id)
}

// One rule per group type, passed by belonging to any of its groups (the primary filter is one
// of them when it has that type). A marker must pass the rules of all types.
function filterRules(primary, refinements) {
  const rules = new Map()
  if (primary) rules.set(primary.type, [primary])
  for (const r of refinements) rules.set(r.type, [...rules.get(r.type) ?? [], r])
  return rules
}

const passesRule = (m, groups) => groups.some((g) => inGroup(m, g))

function passesVisited(m, visitedFilter) {
  if (visitedFilter === 'visited') return !!m.visited_at
  if (visitedFilter === 'unvisited') return !m.visited_at
  return true
}

export const useMarkersStore = defineStore('markers', {
  state: () => ({
    items: [],
    // The group open in the sidebar: null | { type: 'category'|'collection'|'person'|'smart', id }
    // (id '__none__' for "Uncategorized" etc.).
    activeGroupFilter: null,
    // Groups narrowing the primary one: [{ type: 'category'|'collection'|'person', id }].
    // Session-only like the primary filter, and cleared whenever that changes.
    refineFilters: [],
    revision: 0,
    // Bumped by writes that change a trip's legs (order, travel modes, via-points) without
    // necessarily changing a stop's coordinates, so the drawn route knows to re-route.
    routeRevision: 0,
    lastDeleted: null, // { id, label } of the most recent deletion, for "Undo"
    visitedFilter: 'all', // 'all' | 'visited' | 'unvisited'
  }),

  getters: {
    filtered: (state) => {
      const rules = [...filterRules(state.activeGroupFilter, state.refineFilters).values()]
      return state.items.filter((m) => rules.every((groups) => passesRule(m, groups)) && passesVisited(m, state.visitedFilter))
    },

    // How many markers each group would leave if added as a refinement:
    // base + (extra.get(id) || 0) per type. Adding to a type that already has a rule widens it,
    // so the markers already shown (base) count for every group of that type.
    refineCounts: (state) => {
      const rules = filterRules(state.activeGroupFilter, state.refineFilters)
      const counts = {}
      for (const [type, list] of Object.entries(GROUP_LISTS)) {
        const others = [...rules].filter(([t]) => t !== type).map(([, groups]) => groups)
        const own = rules.get(type)
        const entry = counts[type] = { base: 0, extra: new Map() }
        for (const m of state.items) {
          if (!passesVisited(m, state.visitedFilter) || !others.every((groups) => passesRule(m, groups))) continue
          if (own && passesRule(m, own)) { entry.base++; continue }
          for (const g of m[list] ?? []) entry.extra.set(g.id, (entry.extra.get(g.id) || 0) + 1)
        }
      }
      return counts
    },
  },

  actions: {
    async fetch() {
      this.items = await apiList('/api/markers')
    },

    async create(data, options = {}) {
      const res = await apiFetch('/api/markers', {
        ...options,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const created = await res.json()
      this.items.unshift(created)
      return created
    },

    async update(id, data) {
      const res = await apiFetch(`/api/markers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const updated = await res.json()
      const idx = this.items.findIndex((m) => m.id === id)
      if (idx !== -1) this.items[idx] = updated
      this.patchPersonAddresses(id, updated)
      return updated
    },

    async remove(id) {
      const res = await apiFetch(`/api/markers/${id}`, { method: 'DELETE' })
      const label = this.items.find((m) => m.id === id)?.label
      this.items = this.items.filter((m) => m.id !== id)
      this.patchPersonAddresses(id, null)
      const { trashed } = await res.json().catch(() => ({}))
      this.lastDeleted = trashed ? { id: trashed.id, label: trashed.label ?? label } : null
    },

    // ── Trash ──
    async fetchTrash() {
      return apiList('/api/markers/trash')
    },

    async restoreFromTrash(id) {
      const res = await apiFetch(`/api/markers/trash/${id}/restore`, { method: 'POST' })
      const restored = await res.json()
      this.items = [restored, ...this.items.filter((m) => m.id !== restored.id)]
      if (this.lastDeleted?.id === id) this.lastDeleted = null
      // Person addresses pointing at the marker are restored on the server. The restore itself
      // succeeded, so a failed refresh must not be reported as a failed restore.
      try { await usePersonsStore().fetch() } catch { /* refreshed again on the next load */ }
      return restored
    },

    async deleteFromTrash(id) {
      await apiFetch(`/api/markers/trash/${id}`, { method: 'DELETE' })
      if (this.lastDeleted?.id === id) this.lastDeleted = null
    },

    async emptyTrash() {
      await apiFetch('/api/markers/trash', { method: 'DELETE' })
      this.lastDeleted = null
    },

    async patchCountry(id, country) {
      const res = await apiFetch(`/api/markers/${id}/country`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country }),
      })
      const updated = await res.json()
      const idx = this.items.findIndex((m) => m.id === id)
      if (idx !== -1) this.items[idx] = updated
    },

    async updateTripPositions(collectionId, positions, segments) {
      await apiFetch(`/api/collections/${collectionId}/${segments ? 'route' : 'positions'}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions, segments }),
      })
      for (const { marker_id, position } of positions) {
        const idx = this.items.findIndex((m) => m.id === marker_id)
        if (idx === -1) continue
        const cols = this.items[idx].collections.map((c) =>
          c.id === collectionId ? { ...c, position: position ?? null } : c
        )
        this.items[idx] = { ...this.items[idx], collections: cols }
      }
      this.routeRevision++
    },

    bumpRouteRevision() { this.routeRevision++ },

    async importBatch(markers, options = {}) {
      const res = await apiFetch('/api/markers/import', { ...options, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markers }) })
      const { results } = await res.json()
      for (const result of results) if (result.marker) this.items.unshift(result.marker)
      return results
    },

    patchPersonAddresses(id, marker) {
      const persons = usePersonsStore()
      for (const person of persons.items) {
        if (person.address_marker_id !== id) continue
        person.address_marker_id = marker ? id : null
        person.address_marker = marker ? { id, lat: marker.lat, lng: marker.lng, label: marker.label, address: marker.address } : null
        this.patchEmbeddedPerson(person.id, person)
      }
    },

    // Called by categories/collections stores after update or delete.
    // Pass patch=null to remove the embedded entry (on delete); a deleted group would leave its
    // refinement matching nothing.
    patchEmbeddedCategory(categoryId, patch) {
      if (!patch) this.removeRefineFilter({ type: 'category', id: categoryId })
      for (let i = 0; i < this.items.length; i++) {
        const m = this.items[i]
        if (!m.categories?.some(c => c.id === categoryId)) continue
        this.items[i] = {
          ...m,
          categories: patch
            ? m.categories.map(c => c.id === categoryId ? { ...c, ...patch } : c)
            : m.categories.filter(c => c.id !== categoryId),
        }
      }
    },

    patchEmbeddedCollection(collectionId, patch) {
      if (!patch) this.removeRefineFilter({ type: 'collection', id: collectionId })
      for (let i = 0; i < this.items.length; i++) {
        const m = this.items[i]
        if (!m.collections?.some(c => c.id === collectionId)) continue
        this.items[i] = {
          ...m,
          collections: patch
            ? m.collections.map(c => c.id === collectionId ? { ...c, ...patch } : c)
            : m.collections.filter(c => c.id !== collectionId),
        }
      }
    },

    patchEmbeddedPerson(personId, patch) {
      if (!patch) this.removeRefineFilter({ type: 'person', id: personId })
      for (let i = 0; i < this.items.length; i++) {
        const m = this.items[i]
        if (!m.persons?.some(p => p.id === personId)) continue
        this.items[i] = {
          ...m,
          persons: patch
            ? m.persons.map(p => p.id === personId ? { ...p, ...patch } : p)
            : m.persons.filter(p => p.id !== personId),
        }
      }
    },

    // The visited filter and the refinements belong to one group view; leaving that view must
    // not keep them hidden-active.
    setGroupFilter(filter) {
      const current = this.activeGroupFilter
      if (current?.type !== filter?.type || current?.id !== filter?.id) {
        this.visitedFilter = 'all'
        this.refineFilters = []
      }
      this.activeGroupFilter = filter
    },
    clearGroupFilter() { this.activeGroupFilter = null; this.visitedFilter = 'all'; this.refineFilters = [] },
    setVisitedFilter(value) { this.visitedFilter = value },

    // Real groups only: smart lists and "no group" entries can only be the primary filter.
    addRefineFilter({ type, id }) {
      if (!GROUP_LISTS[type] || id == null || id === '__none__') return
      const p = this.activeGroupFilter
      if ((p?.type === type && p.id === id) || this.refineFilters.some((r) => r.type === type && r.id === id)) return
      this.refineFilters = [...this.refineFilters, { type, id }]
    },
    removeRefineFilter({ type, id }) {
      this.refineFilters = this.refineFilters.filter((r) => r.type !== type || r.id !== id)
    },
    clearRefineFilters() { this.refineFilters = [] },
  },
})
