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

// Parse a response as JSON, but fail loudly and clearly when the body isn't
// JSON at all. This happens when the request never reaches the API and the
// proxy falls back to serving the SPA's index.html (an HTML page) — otherwise
// res.json() throws a cryptic "Unexpected token '<'" that hides the real cause.
async function parseJson(res) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    const looksLikeHtml = /^\s*<(?:!doctype|html)/i.test(text)
    throw new Error(
      looksLikeHtml
        ? `The server (HTTP ${res.status}) returned a web page instead of data — the API is likely unreachable. Check that the API service is running.`
        : `Unexpected server response (HTTP ${res.status}).`
    )
  }
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
      encryptionKey:     null, // CryptoKey | null (the DEK) — kept only in memory
      encSalt:           null, // base64 per-user salt from the server — needed to derive the KEK
      wrappedDek:        null, // the DEK wrapped under the password's KEK (opaque blob from the server)
      encryptionEnabled: localStorage.getItem(ENCRYPTION_KEY) === 'true',
      isAdmin:           false,
      allowSignup:       false,
      setupRequired:     false,
      maxAttachmentMb:   10,
      notice:            null, // message for the login screen (e.g. session expired with unsynced changes)
    }
  },

  actions: {
    async fetchConfig() {
      try {
        const res  = await fetch('/api/auth/config')
        const body = await res.json()
        this.encryptionEnabled = !!body.encryptionEnabled
        localStorage.setItem(ENCRYPTION_KEY, String(!!body.encryptionEnabled))
        this.allowSignup       = body.allowSignup === true
        this.setupRequired     = !!body.setupRequired
        this.maxAttachmentMb   = parseInt(body.maxAttachmentMb) || 10
      } catch { /* server may not be up in local dev */ }
    },

    async checkSession() {
      try {
        const res  = await fetch('/api/auth/me')
        // Only a 401 means "logged out"; a 5xx is a server hiccup — keep the
        // cached state like the offline case below.
        if (!res.ok && res.status !== 401) return this.isAuthenticated
        const body = await res.json()
        if (body.authenticated) {
          this.username        = body.username
          this.dbId            = body.dbId || null
          this.encSalt         = body.encSalt || null
          this.wrappedDek      = body.wrappedDek || null
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
      const body = await parseJson(res)
      if (!res.ok) throw new Error(body.error || 'Login failed')

      this.username        = username
      this.dbId            = body.dbId || null
      this.encSalt         = body.encSalt || null
      this.wrappedDek      = body.wrappedDek || null
      this.isAuthenticated = true
      this.isAdmin         = body.isAdmin || false
      writeStorage(USERNAME_KEY, username, rememberMe)
      if (body.dbId) writeStorage(DBID_KEY, body.dbId, rememberMe)

      if (this.encryptionEnabled) await this._unlockOrLogout(password)
    },

    async register(username, password) {
      const res  = await fetch('/api/auth/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, password }),
      })
      const body = await parseJson(res)
      if (!res.ok) throw new Error(body.error || 'Registration failed')

      this.username        = username
      this.dbId            = body.dbId || null
      this.encSalt         = body.encSalt || null
      this.wrappedDek      = body.wrappedDek || null
      this.isAuthenticated = true
      this.isAdmin         = body.isAdmin || false
      // Registration auto-logs in with persistent session
      writeStorage(USERNAME_KEY, username, true)
      if (body.dbId) writeStorage(DBID_KEY, body.dbId, true)

      if (this.encryptionEnabled) await this._unlockOrLogout(password)
    },

    // Envelope encryption: derive the KEK from the password, then either unwrap
    // the stored DEK or — for a brand-new user with no DEK yet — generate one,
    // wrap it, and persist it server-side. Returns the DEK (used to encrypt notes).
    async _establishDek(password) {
      const { deriveKek, importDek, generateDekBytes, wrapDek, unwrapDek } = await import('../utils/crypto.js')
      // Without the server's salt the KEK is wrong, and a DEK minted from it
      // would orphan every existing note. Never guess — fail the login instead.
      if (!this.encSalt) throw new Error('Could not load your encryption settings. Please try again.')
      const kek = await deriveKek(password, this.encSalt)
      if (this.wrappedDek) {
        return importDek(await unwrapDek(kek, this.wrappedDek))
      }
      const dekBytes = generateDekBytes()
      const wrapped  = await wrapDek(kek, dekBytes)
      if (await this._saveWrappedDek(wrapped)) {
        this.wrappedDek = wrapped
        return importDek(dekBytes)
      }
      // 409: another device stored the first DEK meanwhile — use that one.
      const me = await parseJson(await fetch('/api/auth/me'))
      if (!me.wrappedDek) throw new Error('Could not load your encryption key. Please try again.')
      this.wrappedDek = me.wrappedDek
      return importDek(await unwrapDek(kek, me.wrappedDek))
    },

    // true when stored, false when the server already has a DEK (409).
    async _saveWrappedDek(wrappedDek) {
      const res = await fetch('/api/auth/enc-key', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ wrappedDek }),
      })
      if (res.status === 409) return false
      if (!res.ok) throw new Error('Could not store encryption key')
      return true
    },

    // Login/register succeeded server-side but the notes key couldn't be set
    // up: drop the session again rather than run without (or with a wrong) key.
    async _unlockOrLogout(password) {
      try {
        this.encryptionKey = await this._establishDek(password)
      } catch (err) {
        await this.logout()
        throw err
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
      this.wrappedDek      = null
      this.isAuthenticated = false
      this.encryptionKey   = null
      this.isAdmin         = false
      clearStorage(USERNAME_KEY)
      clearStorage(DBID_KEY)
      localStorage.removeItem(ENCRYPTION_KEY)
    },
  },
})
