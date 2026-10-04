import { apiFetch, apiList } from '../api.js'
import { defineStore } from 'pinia'
import { useMarkersStore } from './markers.js'

export const usePersonsStore = defineStore('persons', {
  state: () => ({
    items: [],
  }),

  actions: {
    async fetch() {
      this.items = await apiList('/api/persons')
    },

    async create(data, options = {}) {
      const res = await apiFetch('/api/persons', {
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
      const res = await apiFetch(`/api/persons/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const updated = await res.json()
      const idx = this.items.findIndex((p) => p.id === id)
      if (idx !== -1) this.items[idx] = updated
      useMarkersStore().patchEmbeddedPerson(id, updated)
      return updated
    },

    async remove(id) {
      await apiFetch(`/api/persons/${id}`, { method: 'DELETE' })
      this.items = this.items.filter((p) => p.id !== id)
      useMarkersStore().patchEmbeddedPerson(id, null)
    },
  },
})
