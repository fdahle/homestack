import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import db from '../db.js'
import { requireAuth, ownLoginOnly, proxySecret } from '../middleware/auth.js'
import { setAuthCookie, clearAuthCookie } from '../utils/session.js'
import { checkSetupCode, forgetSetupCode } from '../utils/setupCode.js'

const router = Router()

router.get('/config', (_req, res) => {
  // Behind the server's login (AUTH_PROXY_SECRET) there is no password to set or enter.
  if (proxySecret()) return res.json({ setupRequired: false, proxyLogin: true })
  const user = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get()
  res.json({ setupRequired: !user, proxyLogin: false })
})

router.post('/setup', ownLoginOnly, async (req, res, next) => {
  try {
    const existing = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get()
    if (existing) return res.status(409).json({ error: 'Already set up' })

    const { password, setupCode } = req.body
    // Attempts count against the sign-in rate limit (api/index.js), like wrong passwords.
    if (!checkSetupCode(setupCode)) return res.status(403).json({ error: 'Wrong set-up code. The server prints it to its log on start.' })
    if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 72) {
      return res.status(400).json({ error: 'Password must be at least 12 characters and at most 72 bytes' })
    }

    const hash = await bcrypt.hash(password, 12)
    const version = randomBytes(32).toString('hex')
    const result = db.prepare('INSERT INTO users (password_hash, session_version) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)').run(hash, version)
    if (!result.changes) return res.status(409).json({ error: 'Already set up' })
    forgetSetupCode()
    setAuthCookie(res, { sub: result.lastInsertRowid, version })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

router.post('/login', ownLoginOnly, async (req, res, next) => {
  try {
    const user = db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get()
    if (!user) return res.status(401).json({ error: 'Not set up' })

    const { password } = req.body
    if (typeof password !== 'string' || Buffer.byteLength(password) > 72) return res.status(400).json({ error: 'Password required' })

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid || db.prepare('SELECT session_version FROM users WHERE id=?').get(user.id)?.session_version !== user.session_version) return res.status(401).json({ error: 'Invalid password' })

    setAuthCookie(res, { sub: user.id, version: user.session_version })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

router.post('/logout', ownLoginOnly, (_req, res) => {
  clearAuthCookie(res)
  res.json({ ok: true })
})

// Rotating the session version invalidates every issued cookie, this one included.
router.post('/logout-all', ownLoginOnly, requireAuth, (req, res) => {
  db.prepare('UPDATE users SET session_version=? WHERE id=?').run(randomBytes(32).toString('hex'), req.user.sub)
  clearAuthCookie(res)
  res.json({ ok: true })
})

router.get('/me', requireAuth, (req, res) => {
  res.json({ loggedIn: true, id: req.user.sub, viaProxy: !!req.user.proxy })
})

router.post('/change-password', ownLoginOnly, requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'Both passwords required' })
    }
    if (newPassword.length < 12 || Buffer.byteLength(newPassword) > 72) {
      return res.status(400).json({ error: 'New password must be at least 12 characters and at most 72 bytes' })
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub)
    if (!user) return res.status(404).json({ error: 'User not found' })
    const valid = await bcrypt.compare(currentPassword, user.password_hash)
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' })
    const hash = await bcrypt.hash(newPassword, 12)
    const version = randomBytes(32).toString('hex')
    const result = db.prepare('UPDATE users SET password_hash=?, session_version=? WHERE id=? AND session_version=?').run(hash, version, user.id, user.session_version)
    if (!result.changes) return res.status(409).json({ error: 'Password changed in another session. Sign in again.' })
    setAuthCookie(res, { sub: user.id, version })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

export default router
