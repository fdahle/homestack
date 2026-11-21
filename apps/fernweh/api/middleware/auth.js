import jwt from 'jsonwebtoken'
import { createHash, timingSafeEqual } from 'node:crypto'
import db from '../db.js'
import { setAuthCookie, RENEW_AFTER_SECONDS } from '../utils/session.js'

// Behind the homestack login (Authelia, see deploy/places.fdahle.de.conf): nginx asks Authelia,
// then passes the user in Remote-User and a shared secret in X-Auth-Proxy-Secret. Read on every
// request so tests can switch it.
export const proxySecret = () => process.env.AUTH_PROXY_SECRET || ''

// Constant-time comparison of two strings of any length
const sameString = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest())

// The proxy vouches for the user only together with the secret; without it nothing else that
// reaches the port can claim to be someone. Fernweh has one owner, so any user the proxy lets
// through (Authelia's access rules decide who) is that owner.
export function proxyUser(req) {
  const secret = req.get('x-auth-proxy-secret')
  const name = String(req.get('remote-user') || '').trim()
  if (!secret || !name || !sameString(secret, proxySecret())) return null
  const owner = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get()
  return { sub: owner?.id ?? null, proxy: true, name: name.slice(0, 100) }
}

export function requireAuth(req, res, next) {
  if (proxySecret()) {
    req.user = proxyUser(req)
    if (!req.user) return res.status(403).json({ error: 'Sign-in goes through the server’s login page. Reload the page.' })
    return next()
  }
  try {
    req.user = jwt.verify(req.cookies?.mapper_token, process.env.SESSION_SECRET)
    const user = db.prepare('SELECT id, session_version FROM users ORDER BY id LIMIT 1').get()
    if (!user || req.user.sub !== user.id || req.user.version !== user.session_version) throw new Error('Expired session')
  } catch { return res.status(401).json({ error: 'Session expired. Please sign in again.' }) }
  // Same session version, so sign-out-everywhere and password changes still revoke the renewed cookie.
  if (!(Date.now() / 1000 - req.user.iat < RENEW_AFTER_SECONDS)) setAuthCookie(res, req.user)
  next()
}

// Password sign-in, set-up and sign-out don't exist behind the proxy.
export function ownLoginOnly(_req, res, next) {
  if (proxySecret()) return res.status(400).json({ error: 'Sign-in goes through the server’s login page.' })
  next()
}
