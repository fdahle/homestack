import { usePersonsStore } from './persons.js'
import { apiFetch, apiList } from '../api.js'
import { defineStore } from 'pinia'

export const useMarkersStore = defineStore('markers', {
  state: () => ({
    items: [],
    activeGroupFilter: null, // null | { type: 'category'|'collection', id }
    revision: 0,
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
          if (type === 'person') {
            if (id === '__none__') { if (m.persons?.length) return false }
            else if (!m.persons?.some((p) => p.id === id)) return false
          }
          if (type === 'smart') {
            if (id === 'favorites' && !m.is_favorite) return false
            if (id === 'planned' && (!m.planned_at || m.visited_at)) return false
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
      await apiFetch(`/api/markers/${id}`, { method: 'DELETE' })
      this.items = this.items.filter((m) => m.id !== id)
      this.patchPersonAddresses(id, null)
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
    },

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

    patchEmbeddedPerson(personId, patch) {
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

    // The visited filter belongs to one group view; leaving that view must not keep it hidden-active.
    setGroupFilter(filter) {
      const current = this.activeGroupFilter
      if (current?.type !== filter?.type || current?.id !== filter?.id) this.visitedFilter = 'all'
      this.activeGroupFilter = filter
    },
    clearGroupFilter() { this.activeGroupFilter = null; this.visitedFilter = 'all' },
    setVisitedFilter(value) { this.visitedFilter = value },
  },
})
