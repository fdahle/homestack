import { defineStore } from 'pinia'

const USERNAME_KEY    = 'auth_username'
const DBID_KEY        = 'auth_dbid'
const ENCRYPTION_KEY  = 'auth_encryption_enabled'

function readStorage(key) {
  return localStorage.getItem(key) || sessionStorage.getItem(key) || null
}

function writeStorage(key, value, persistent) {
  if (persistent) {
    localStorage.setItem(key, value)
  } else {
    sessionStorage.setItem(key, value)
  }
}

function clearStorage(key) {
  localStorage.removeItem(key)
  sessionStorage.removeItem(key)
}

export const useAuthStore = defineStore('auth', {
  state: () => {
    // Rehydrate from storage so the router can skip a network round-trip
    // when the app loads offline (or before the session check completes).
    // localStorage = rememberMe, sessionStorage = session-only.
    const savedUsername = readStorage(USERNAME_KEY)
    const savedDbId     = readStorage(DBID_KEY)
    return {
      username:          savedUsername,
      dbId:              savedDbId,
      isAuthenticated:   !!savedUsername,
      encryptionKey:     null, // CryptoKey | null — kept only in memory
      encSalt:           null, // base64 per-user salt from the server — needed to (re)derive the key
      encryptionEnabled: localStorage.getItem(ENCRYPTION_KEY) === 'true',
      isAdmin:           false,
      allowSignup:       true,
      setupRequired:     false,
      maxAttachmentMb:   10,
    }
  },

  actions: {
    async fetchConfig() {
      try {
        const res  = await fetch('/api/auth/config')
        const body = await res.json()
        this.encryptionEnabled = !!body.encryptionEnabled
        localStorage.setItem(ENCRYPTION_KEY, String(!!body.encryptionEnabled))
        this.allowSignup       = body.allowSignup !== false
        this.setupRequired     = !!body.setupRequired
        this.maxAttachmentMb   = parseInt(body.maxAttachmentMb) || 10
      } catch { /* server may not be up in local dev */ }
    },

    async checkSession() {
      try {
        const res  = await fetch('/api/auth/me')
        const body = await res.json()
        if (body.authenticated) {
          this.username        = body.username
          this.dbId            = body.dbId || null
          this.encSalt         = body.encSalt || null
          this.isAuthenticated = true
          this.isAdmin         = body.isAdmin || false
          // Preserve whichever storage was already used (don't change rememberMe semantics)
          const persistent = !!localStorage.getItem(USERNAME_KEY)
          writeStorage(USERNAME_KEY, body.username, persistent)
          if (body.dbId) writeStorage(DBID_KEY, body.dbId, persistent)
          return true
        }
        // Server explicitly said not authenticated (e.g. session expired) — clear cache
        this._clearAuth()
        return false
      } catch {
        // Network error — could be offline. Preserve cached state so the app
        // remains usable; PouchDB's 401 handler will clear auth if the session
        // turns out to be invalid once connectivity is restored.
        return this.isAuthenticated
      }
    },

    async login(username, password, rememberMe = false) {
      const res  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, password, rememberMe }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Login failed')

      this.username        = username
      this.dbId            = body.dbId || null
      this.encSalt         = body.encSalt || null
      this.isAuthenticated = true
      this.isAdmin         = body.isAdmin || false
      writeStorage(USERNAME_KEY, username, rememberMe)
      if (body.dbId) writeStorage(DBID_KEY, body.dbId, rememberMe)

      if (this.encryptionEnabled) {
        const { deriveKey } = await import('../utils/crypto.js')
        this.encryptionKey = await deriveKey(password, this.encSalt)
      }
    },

    async register(username, password) {
      const res  = await fetch('/api/auth/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, password }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Registration failed')

      this.username        = username
      this.dbId            = body.dbId || null
      this.encSalt         = body.encSalt || null
      this.isAuthenticated = true
      this.isAdmin         = body.isAdmin || false
      // Registration auto-logs in with persistent session
      writeStorage(USERNAME_KEY, username, true)
      if (body.dbId) writeStorage(DBID_KEY, body.dbId, true)

      if (this.encryptionEnabled) {
        const { deriveKey } = await import('../utils/crypto.js')
        this.encryptionKey = await deriveKey(password, this.encSalt)
      }
    },

    async logout() {
      try {
        await fetch('/api/auth/logout', { method: 'POST' })
      } catch { /* ignore */ }
      this._clearAuth()
    },

    _clearAuth() {
      this.username        = null
      this.dbId            = null
      this.encSalt         = null
      this.isAuthenticated = false
      this.encryptionKey   = null
      this.isAdmin         = false
      clearStorage(USERNAME_KEY)
      clearStorage(DBID_KEY)
      localStorage.removeItem(ENCRYPTION_KEY)
    },
  },
})
