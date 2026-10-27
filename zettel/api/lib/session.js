// Shared CouchDB session verification. The browser holds an AuthSession cookie
// issued by CouchDB; we forward it to GET /_session to learn who the caller is.
// Used by the auth, push and admin routers so the check lives in one place.

const fetch   = (...args) => import('node-fetch').then(({ default: f }) => f(...args))
const DB_BASE = process.env.COUCHDB_URL || 'http://localhost:5984'

// Returns { name, roles } for the cookie, or null if not authenticated.
async function getSession(cookie) {
  const res  = await fetch(`${DB_BASE}/_session`, { headers: { Cookie: cookie || '' } })
  const body = await res.json()
  if (!body?.userCtx?.name) return null
  return { name: body.userCtx.name, roles: body.userCtx.roles || [] }
}

// Express middleware: 401 if not authenticated, else sets req.username + req.userCtx.
async function requireAuth(req, res, next) {
  try {
    const ctx = await getSession(req.headers.cookie)
    if (!ctx) return res.status(401).json({ error: 'Not authenticated' })
    req.userCtx  = ctx
    req.username = ctx.name
    next()
  } catch {
    res.status(502).json({ error: 'Auth backend unavailable' })
  }
}

// Express middleware: 403 unless the caller has the admin role.
async function requireAdmin(req, res, next) {
  try {
    const ctx = await getSession(req.headers.cookie)
    if (!ctx || !ctx.roles.includes('admin')) {
      return res.status(403).json({ error: 'Admin access required' })
    }
    req.userCtx       = ctx
    req.username      = ctx.name
    req.adminUsername = ctx.name
    next()
  } catch {
    res.status(502).json({ error: 'Auth backend unavailable' })
  }
}

module.exports = { getSession, requireAuth, requireAdmin }
