import { defineStore } from 'pinia'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    isAuthenticated: false,
    setupRequired: false,
    _sessionChecked: false,
  }),

  actions: {
    async fetchConfig() {
      const res = await fetch('/api/auth/config')
      const data = await res.json()
      this.setupRequired = data.setupRequired
    },

    async checkSession() {
      if (this._sessionChecked && this.isAuthenticated) return true
      try {
        const res = await fetch('/api/auth/me')
        this.isAuthenticated = res.ok
        this._sessionChecked = true
        return this.isAuthenticated
      } catch {
        this.isAuthenticated = false
        return false
      }
    },

    async setup(password) {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Setup failed')
      }
      this.isAuthenticated = true
      this.setupRequired = false
      this._sessionChecked = true
    },

    async login(password) {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Login failed')
      }
      this.isAuthenticated = true
      this._sessionChecked = true
    },

    async logout() {
      await fetch('/api/auth/logout', { method: 'POST' })
      this.isAuthenticated = false
      this._sessionChecked = false
    },

    async changePassword(currentPassword, newPassword) {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Password change failed')
      }
    },

    invalidateSession() {
      this._sessionChecked = false
    },
  },
})
