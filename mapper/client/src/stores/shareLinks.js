import { apiFetch, apiList } from '../api.js'
import { defineStore } from 'pinia'

export const useShareLinksStore = defineStore('shareLinks', {
  state: () => ({
    items: [],
  }),

  actions: {
    async fetch() {
      this.items = await apiList('/api/share-links')
    },

    async create(data, options = {}) {
      const res = await apiFetch('/api/share-links', {
        ...options,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const created = await res.json()
      this.items.unshift(created)
      return created
    },

    async update(token, data) {
      const res = await apiFetch(`/api/share-links/${token}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const updated = await res.json()
      const idx = this.items.findIndex((l) => l.token === token)
      if (idx !== -1) this.items[idx] = updated
      return updated
    },

    async remove(token) {
      await apiFetch(`/api/share-links/${token}`, { method: 'DELETE' })
      this.items = this.items.filter((l) => l.token !== token)
    },
  },
})
