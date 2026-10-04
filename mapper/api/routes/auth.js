import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

const secureFlag = () => process.env.NODE_ENV === 'production' ? '; Secure' : ''

function setAuthCookie(res, payload) {
  const token = jwt.sign(payload, process.env.SESSION_SECRET, { expiresIn: '7d' })
  res.setHeader('Set-Cookie', `mapper_token=${token}; HttpOnly; SameSite=Strict; Max-Age=604800${secureFlag()}; Path=/`)
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `mapper_token=; HttpOnly; SameSite=Strict; Max-Age=0${secureFlag()}; Path=/`)
}

router.get('/config', (_req, res) => {
  const user = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get()
  res.json({ setupRequired: !user })
})

router.post('/setup', async (req, res, next) => {
  try {
    const existing = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get()
    if (existing) return res.status(409).json({ error: 'Already set up' })

    const { password } = req.body
    if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 72) {
      return res.status(400).json({ error: 'Password must be at least 12 characters and at most 72 bytes' })
    }

    const hash = await bcrypt.hash(password, 12)
    const version = randomBytes(32).toString('hex')
    const result = db.prepare('INSERT INTO users (password_hash, session_version) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)').run(hash, version)
    if (!result.changes) return res.status(409).json({ error: 'Already set up' })
    setAuthCookie(res, { sub: result.lastInsertRowid, version })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

router.post('/login', async (req, res, next) => {
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

router.post('/logout', (_req, res) => {
  clearAuthCookie(res)
  res.json({ ok: true })
})

router.get('/me', requireAuth, (req, res) => {
  res.json({ loggedIn: true, id: req.user.sub })
})

router.post('/change-password', requireAuth, async (req, res, next) => {
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
