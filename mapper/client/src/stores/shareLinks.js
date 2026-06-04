import { defineStore } from 'pinia'

export const useShareLinksStore = defineStore('shareLinks', {
  state: () => ({
    items: [],
  }),

  actions: {
    async fetch() {
      const res = await fetch('/api/share-links')
      this.items = await res.json()
    },

    async create(data) {
      const res = await fetch('/api/share-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const created = await res.json()
      this.items.unshift(created)
      return created
    },

    async update(token, data) {
      const res = await fetch(`/api/share-links/${token}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const updated = await res.json()
      const idx = this.items.findIndex((l) => l.token === token)
      if (idx !== -1) this.items[idx] = updated
      return updated
    },

    async remove(token) {
      const res = await fetch(`/api/share-links/${token}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      this.items = this.items.filter((l) => l.token !== token)
    },
  },
})
