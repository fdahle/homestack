import { defineStore } from 'pinia'
import { useMarkersStore } from './markers.js'

export const useCollectionsStore = defineStore('collections', {
  state: () => ({
    items: [],
  }),

  actions: {
    async fetch() {
      const res = await fetch('/api/collections')
      this.items = await res.json()
    },

    async create(data) {
      const res = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const created = await res.json()
      this.items.push(created)
      return created
    },

    async update(id, data) {
      const res = await fetch(`/api/collections/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const updated = await res.json()
      const idx = this.items.findIndex((c) => c.id === id)
      if (idx !== -1) this.items[idx] = updated
      useMarkersStore().patchEmbeddedCollection(id, { name: updated.name, color: updated.color, is_trip: updated.is_trip })
      return updated
    },

    async remove(id) {
      const res = await fetch(`/api/collections/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      this.items = this.items.filter((c) => c.id !== id)
      useMarkersStore().patchEmbeddedCollection(id, null)
    },
  },
})
