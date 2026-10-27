import { apiFetch } from '../api.js'
import { defineStore } from 'pinia'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    isAuthenticated: false,
    setupRequired: false,
    _sessionChecked: false,
    sessionExpired: false, // a write was rejected with 401 while the app was open
    offline: false, // the last session check could not reach the server
  }),

  actions: {
    async fetchConfig() {
      const res = await apiFetch('/api/auth/config')
      const data = await res.json()
      this.setupRequired = data.setupRequired
    },

    async checkSession() {
      if (this._sessionChecked && this.isAuthenticated) return true
      try {
        await apiFetch('/api/auth/me')
        Object.assign(this, { isAuthenticated: true, _sessionChecked: true, sessionExpired: false, offline: false })
        return true
      } catch (err) {
        // Only the server answering 401 means signed out. A dropped connection or a proxy error
        // must not send the user to a login page that cannot work either; the view's own
        // requests show what failed, and a real 401 there still redirects.
        if (err.status === 401) {
          this.isAuthenticated = false
          this.offline = false
          return false
        }
        this.offline = !err.status
        return true
      }
    },

    // Called when the tab becomes visible or the connection returns: clears the
    // "session expired" / "offline" hints once the server accepts the session again.
    async recheck() {
      if (!this.sessionExpired && !this.offline) return
      this._sessionChecked = false
      await this.checkSession()
    },

    async setup(password) {
      const res = await apiFetch('/api/auth/setup', {
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
      this.sessionExpired = false
    },

    async login(password) {
      const res = await apiFetch('/api/auth/login', {
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
      this.sessionExpired = false
    },

    async logout() {
      await apiFetch('/api/auth/logout', { method: 'POST' })
      this.isAuthenticated = false
      this._sessionChecked = false
    },

    async logoutEverywhere() {
      await apiFetch('/api/auth/logout-all', { method: 'POST' })
      this.isAuthenticated = false
      this._sessionChecked = false
    },

    async changePassword(currentPassword, newPassword) {
      const res = await apiFetch('/api/auth/change-password', {
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
