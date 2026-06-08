import { defineStore } from 'pinia'
import { useMarkersStore } from './markers.js'

export const usePersonsStore = defineStore('persons', {
  state: () => ({
    items: [],
  }),

  actions: {
    async fetch() {
      const res = await fetch('/api/persons')
      this.items = await res.json()
    },

    async create(data) {
      const res = await fetch('/api/persons', {
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
      const res = await fetch(`/api/persons/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const updated = await res.json()
      const idx = this.items.findIndex((p) => p.id === id)
      if (idx !== -1) this.items[idx] = updated
      useMarkersStore().patchEmbeddedPerson(id, { name: updated.name, first_name: updated.first_name, last_name: updated.last_name, color: updated.color })
      return updated
    },

    async remove(id) {
      const res = await fetch(`/api/persons/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      this.items = this.items.filter((p) => p.id !== id)
      useMarkersStore().patchEmbeddedPerson(id, null)
    },
  },
})
