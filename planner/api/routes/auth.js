const { randomUUID } = require('crypto')
const express  = require('express')
const fetch    = (...args) => import('node-fetch').then(({ default: f }) => f(...args))
const { hasAnyUsers, userExists, createUser, createUserDb, setSecurityDoc, getUserDbId, changeUserPassword } = require('../lib/couchdb')

const router  = express.Router()
const DB_BASE = process.env.COUCHDB_URL || 'http://localhost:5984'

function validUsername(u) { return /^[a-z0-9_-]{3,32}$/.test(u) }
function validPassword(p) { return typeof p === 'string' && p.length >= 12 }
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
    return res.status(500).json({ error: err.message })
  }

  // Auto-login after registration — keep session alive since they just signed up
  return loginUser(username, password, true, req, res)
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password, rememberMe } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'username and password required' })
  return loginUser(username, password, !!rememberMe, req, res)
})

async function loginUser(username, password, rememberMe, _req, res) {
  try {
    const couchRes = await fetch(`${DB_BASE}/_session`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: username, password }),
    })
    const body = await couchRes.json()

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

    const dbId    = await getUserDbId(username)
    const isAdmin = (body.roles || []).includes('admin')
    console.log(`[login] username="${username}" dbId=${dbId} isAdmin=${isAdmin} rememberMe=${rememberMe}`)
    return res.json({ ok: true, username, dbId, isAdmin })
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
  res.setHeader('Set-Cookie', 'AuthSession=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict')
  return res.json({ ok: true })
})

// GET /api/auth/me
router.get('/me', async (req, res) => {
  try {
    const cookie   = req.headers.cookie || ''
    const couchRes = await fetch(`${DB_BASE}/_session`, {
      headers: { Cookie: cookie },
    })
    const body = await couchRes.json()

    if (!body?.userCtx?.name) {
      return res.status(401).json({ authenticated: false })
    }

    const username = body.userCtx.name
    const dbId     = await getUserDbId(username)
    const isAdmin  = (body.userCtx.roles || []).includes('admin')
    console.log(`[/me] username="${username}" dbId=${dbId} isAdmin=${isAdmin}`)
    return res.json({ authenticated: true, username, dbId, isAdmin })
  } catch {
    return res.status(502).json({ error: 'Auth backend unavailable' })
  }
})

// POST /api/auth/change-password
router.post('/change-password', async (req, res) => {
  const cookie = req.headers.cookie || ''
  let username
  try {
    const sessionRes  = await fetch(`${DB_BASE}/_session`, { headers: { Cookie: cookie } })
    const sessionBody = await sessionRes.json()
    if (!sessionBody?.userCtx?.name) return res.status(401).json({ error: 'Not authenticated' })
    username = sessionBody.userCtx.name
  } catch {
    return res.status(502).json({ error: 'Auth backend unavailable' })
  }

  const { currentPassword, newPassword } = req.body || {}
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' })
  }
  if (!validPassword(newPassword)) {
    return res.status(400).json({ error: 'New password must be at least 12 characters' })
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
    await changeUserPassword(username, newPassword)
    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

// GET /api/auth/config
router.get('/config', async (_req, res) => {
  const setupRequired = !(await hasAnyUsers())
  res.json({
    encryptionEnabled: process.env.ENCRYPTION_ENABLED === 'true',
    allowSignup:       signupsAllowed(),
    setupRequired,
  })
})

module.exports = router
