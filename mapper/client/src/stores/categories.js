import { defineStore } from 'pinia'

export const useCategoriesStore = defineStore('categories', {
  state: () => ({
    items: [],
  }),

  actions: {
    async fetch() {
      const res = await fetch('/api/categories')
      this.items = await res.json()
    },

    async create(data) {
      const res = await fetch('/api/categories', {
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
      const res = await fetch(`/api/categories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const updated = await res.json()
      const idx = this.items.findIndex((c) => c.id === id)
      if (idx !== -1) this.items[idx] = updated
      return updated
    },

    async remove(id) {
      const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      this.items = this.items.filter((c) => c.id !== id)
    },
  },
})
