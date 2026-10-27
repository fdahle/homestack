const { randomUUID } = require('crypto')
const express  = require('express')
const fetch    = (...args) => import('node-fetch').then(({ default: f }) => f(...args))
const { hasAnyUsers, userExists, createUser, createUserDb, setSecurityDoc, getUserMeta, changeUserPassword, setUserWrappedDek } = require('../lib/couchdb')
const { getSession, requireAuth } = require('../lib/session')
const { validUsername, validPassword } = require('../lib/validate')

const router  = express.Router()
const DB_BASE = process.env.COUCHDB_URL || 'http://localhost:5984'

// Identifying info (usernames, dbIds) is only logged outside production to avoid
// leaking it into prod logs.
function debug(...args) { if (process.env.NODE_ENV !== 'production') console.log(...args) }

function signupsAllowed()  { return process.env.ALLOW_SIGNUP !== 'false' }

// POST /api/auth/register
router.post('/register', async (req, res) => {
  if (!signupsAllowed()) {
    return res.status(403).json({ error: 'Sign-ups are disabled on this server' })
  }

  const { username, password } = req.body || {}

  if (!validUsername(username)) {
    return res.status(400).json({ error: 'Username must be 3–32 lowercase alphanumeric/dash/underscore characters' })
  }
  if (!validPassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 12 characters' })
  }

  const dbId = randomUUID()

  try {
    if (await userExists(username)) {
      return res.status(409).json({ error: 'Username already taken' })
    }
    const isFirstUser = !(await hasAnyUsers())
    await createUser(username, password, isFirstUser ? ['admin'] : [], dbId)
    await createUserDb(dbId)
    await setSecurityDoc(username, dbId)
  } catch (err) {
    console.error('[register] failed:', err.message)
    return res.status(500).json({ error: 'Registration failed' })
  }

  // Auto-login after registration — keep session alive since they just signed up.
  // Retry a few times: CouchDB's auth cache can briefly return 401 for a user
  // that was just created, so the immediate login otherwise fails spuriously.
  return loginUser(username, password, true, req, res, 5)
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password, rememberMe } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'username and password required' })
  return loginUser(username, password, !!rememberMe, req, res)
})

async function loginUser(username, password, rememberMe, _req, res, retries = 0) {
  try {
    let couchRes, body
    for (let attempt = 0; ; attempt++) {
      couchRes = await fetch(`${DB_BASE}/_session`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: username, password }),
      })
      body = await couchRes.json()
      if ((couchRes.ok && body.ok) || attempt >= retries) break
      await new Promise(r => setTimeout(r, 200)) // wait for CouchDB auth cache to settle
    }

    if (!couchRes.ok || !body.ok) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const setCookie = couchRes.headers.get('set-cookie')
    if (setCookie) {
      const secure  = process.env.NODE_ENV === 'production' ? '; Secure' : ''
      const maxAge  = rememberMe ? '; Max-Age=2592000' : '' // 30 days when remembered
      const patched = setCookie.replace(/; ?HttpOnly/i, '') + `; HttpOnly; SameSite=Strict${secure}${maxAge}`
      res.setHeader('Set-Cookie', patched)
    }

    const { dbId, encSalt, wrappedDek } = await getUserMeta(username)
    const isAdmin = (body.roles || []).includes('admin')
    debug(`[login] username="${username}" dbId=${dbId} isAdmin=${isAdmin} rememberMe=${rememberMe}`)
    return res.json({ ok: true, username, dbId, encSalt, wrappedDek, isAdmin })
  } catch (err) {
    return res.status(502).json({ error: 'Auth backend unavailable' })
  }
}

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  try {
    const cookie = req.headers.cookie || ''
    await fetch(`${DB_BASE}/_session`, {
      method:  'DELETE',
      headers: { Cookie: cookie },
    })
  } catch { /* ignore */ }
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `AuthSession=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${secure}`)
  return res.json({ ok: true })
})

// GET /api/auth/me
router.get('/me', async (req, res) => {
  try {
    const ctx = await getSession(req.headers.cookie)
    if (!ctx) return res.status(401).json({ authenticated: false })

    const { dbId, encSalt, wrappedDek } = await getUserMeta(ctx.name)
    const isAdmin = ctx.roles.includes('admin')
    debug(`[/me] username="${ctx.name}" dbId=${dbId} isAdmin=${isAdmin}`)
    return res.json({ authenticated: true, username: ctx.name, dbId, encSalt, wrappedDek, isAdmin })
  } catch {
    return res.status(502).json({ error: 'Auth backend unavailable' })
  }
})

// POST /api/auth/change-password
router.post('/change-password', async (req, res) => {
  let username
  try {
    const ctx = await getSession(req.headers.cookie)
    if (!ctx) return res.status(401).json({ error: 'Not authenticated' })
    username = ctx.name
  } catch {
    return res.status(502).json({ error: 'Auth backend unavailable' })
  }

  // wrappedDek: the DEK re-wrapped under the new password's KEK (sent only when
  // encryption is on). Stored atomically with the password so they stay in sync.
  const { currentPassword, newPassword, wrappedDek } = req.body || {}
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' })
  }
  if (!validPassword(newPassword)) {
    return res.status(400).json({ error: 'New password must be at least 12 characters' })
  }
  if (wrappedDek !== undefined && typeof wrappedDek !== 'string') {
    return res.status(400).json({ error: 'Invalid wrappedDek' })
  }

  try {
    const verifyRes  = await fetch(`${DB_BASE}/_session`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: username, password: currentPassword }),
    })
    const verifyBody = await verifyRes.json()
    if (!verifyRes.ok || !verifyBody.ok) {
      return res.status(401).json({ error: 'Current password is incorrect' })
    }
  } catch {
    return res.status(502).json({ error: 'Auth backend unavailable' })
  }

  try {
    await changeUserPassword(username, newPassword, wrappedDek)
    return res.json({ ok: true })
  } catch (err) {
    console.error('[change-password] failed:', err.message)
    return res.status(500).json({ error: 'Could not change password' })
  }
})

// POST /api/auth/enc-key — store the caller's wrapped DEK (envelope encryption).
// Used to persist the DEK the first time a user establishes it (registration /
// first login with encryption enabled).
router.post('/enc-key', requireAuth, async (req, res) => {
  const { wrappedDek } = req.body || {}
  if (typeof wrappedDek !== 'string' || !wrappedDek) {
    return res.status(400).json({ error: 'wrappedDek is required' })
  }
  try {
    await setUserWrappedDek(req.username, wrappedDek)
    return res.json({ ok: true })
  } catch (err) {
    console.error('[enc-key] failed:', err.message)
    return res.status(500).json({ error: 'Could not store encryption key' })
  }
})

// GET /api/auth/config
router.get('/config', async (_req, res) => {
  let setupRequired
  try {
    setupRequired = !(await hasAnyUsers())
  } catch (err) {
    // A transient CouchDB failure here must not crash the process (this call
    // runs unauthenticated on every app load). Surface it as a 503 instead.
    console.error('[config] failed:', err.message)
    return res.status(503).json({ error: 'Auth backend unavailable' })
  }
  res.json({
    encryptionEnabled: process.env.ENCRYPTION_ENABLED === 'true',
    allowSignup:       signupsAllowed(),
    setupRequired,
    maxAttachmentMb:   parseInt(process.env.MAX_ATTACHMENT_SIZE_MB ?? '') || 10,
  })
})

module.exports = router
