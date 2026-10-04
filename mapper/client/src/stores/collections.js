import { apiFetch, apiList } from '../api.js'
import { defineStore } from 'pinia'
import { useMarkersStore } from './markers.js'

export const useCollectionsStore = defineStore('collections', {
  state: () => ({
    items: [],
  }),

  actions: {
    async fetch() {
      this.items = await apiList('/api/collections')
    },

    async create(data, options = {}) {
      const res = await apiFetch('/api/collections', {
        ...options,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const created = await res.json()
      this.items.push(created)
      return created
    },

    async update(id, data) {
      const res = await apiFetch(`/api/collections/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const updated = await res.json()
      const idx = this.items.findIndex((c) => c.id === id)
      if (idx !== -1) this.items[idx] = updated
      useMarkersStore().patchEmbeddedCollection(id, updated)
      return updated
    },

    async remove(id) {
      await apiFetch(`/api/collections/${id}`, { method: 'DELETE' })
      this.items = this.items.filter((c) => c.id !== id)
      useMarkersStore().patchEmbeddedCollection(id, null)
    },
  },
})
