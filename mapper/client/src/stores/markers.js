import { defineStore } from 'pinia'

export const useMarkersStore = defineStore('markers', {
  state: () => ({
    items: [],
    activeGroupFilter: null, // null | { type: 'category'|'collection', id }
    visitedFilter: 'all', // 'all' | 'visited' | 'unvisited'
  }),

  getters: {
    filtered: (state) => {
      return state.items.filter((m) => {
        if (state.activeGroupFilter) {
          const { type, id } = state.activeGroupFilter
          if (type === 'category') {
            if (id === '__none__') { if (m.categories?.length) return false }
            else if (!m.categories?.some((c) => c.id === id)) return false
          }
          if (type === 'collection') {
            if (id === '__none__') { if (m.collections?.length) return false }
            else if (!m.collections?.some((c) => c.id === id)) return false
          }
        }
        if (state.visitedFilter === 'visited' && !m.visited_at) return false
        if (state.visitedFilter === 'unvisited' && m.visited_at) return false
        return true
      })
    },
  },

  actions: {
    async fetch() {
      const res = await fetch('/api/markers')
      this.items = await res.json()
    },

    async create(data) {
      const res = await fetch('/api/markers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const created = await res.json()
      this.items.unshift(created)
      return created
    },

    async update(id, data) {
      const res = await fetch(`/api/markers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const updated = await res.json()
      const idx = this.items.findIndex((m) => m.id === id)
      if (idx !== -1) this.items[idx] = updated
      return updated
    },

    async remove(id) {
      const res = await fetch(`/api/markers/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      this.items = this.items.filter((m) => m.id !== id)
    },

    async patchCountry(id, country) {
      await fetch(`/api/markers/${id}/country`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country }),
      })
      const idx = this.items.findIndex((m) => m.id === id)
      if (idx !== -1) this.items[idx] = { ...this.items[idx], country }
    },

    async updateTripPositions(collectionId, positions) {
      const res = await fetch(`/api/collections/${collectionId}/positions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      for (const { marker_id, position } of positions) {
        const idx = this.items.findIndex((m) => m.id === marker_id)
        if (idx === -1) continue
        const cols = this.items[idx].collections.map((c) =>
          c.id === collectionId ? { ...c, position: position ?? null } : c
        )
        this.items[idx] = { ...this.items[idx], collections: cols }
      }
    },

    // Called by categories/collections stores after update or delete.
    // Pass patch=null to remove the embedded entry (on delete).
    patchEmbeddedCategory(categoryId, patch) {
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

    setGroupFilter(filter) { this.activeGroupFilter = filter },
    clearGroupFilter() { this.activeGroupFilter = null },
    setVisitedFilter(value) { this.visitedFilter = value },
  },
})
