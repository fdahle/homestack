import { apiFetch, apiList } from '../api.js'
import { defineStore } from 'pinia'
import { useMarkersStore } from './markers.js'

export const useCategoriesStore = defineStore('categories', {
  state: () => ({
    items: [],
  }),

  actions: {
    async fetch() {
      this.items = await apiList('/api/categories')
    },

    async create(data, options = {}) {
      const res = await apiFetch('/api/categories', {
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
      const res = await apiFetch(`/api/categories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const updated = await res.json()
      const idx = this.items.findIndex((c) => c.id === id)
      if (idx !== -1) this.items[idx] = updated
      useMarkersStore().patchEmbeddedCategory(id, { name: updated.name, color: updated.color })
      return updated
    },

    async remove(id) {
      await apiFetch(`/api/categories/${id}`, { method: 'DELETE' })
      this.items = this.items.filter((c) => c.id !== id)
      useMarkersStore().patchEmbeddedCategory(id, null)
    },
  },
})
