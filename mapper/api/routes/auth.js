import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

function setAuthCookie(res, payload) {
  const token = jwt.sign(payload, process.env.SESSION_SECRET, { expiresIn: '7d' })
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `mapper_token=${token}; HttpOnly; SameSite=Strict; Max-Age=604800${secure}; Path=/`)
}

router.get('/config', (_req, res) => {
  const user = db.prepare('SELECT id FROM users LIMIT 1').get()
  res.json({ setupRequired: !user })
})

router.post('/setup', async (req, res) => {
  const existing = db.prepare('SELECT id FROM users LIMIT 1').get()
  if (existing) return res.status(409).json({ error: 'Already set up' })

  const { password } = req.body
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' })
  }

  const hash = await bcrypt.hash(password, 12)
  const { lastInsertRowid } = db.prepare('INSERT INTO users (password_hash) VALUES (?)').run(hash)

  setAuthCookie(res, { sub: lastInsertRowid })
  res.json({ ok: true })
})

router.post('/login', async (req, res) => {
  const user = db.prepare('SELECT * FROM users LIMIT 1').get()
  if (!user) return res.status(401).json({ error: 'Not set up' })

  const { password } = req.body
  if (!password) return res.status(400).json({ error: 'Password required' })

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) return res.status(401).json({ error: 'Invalid password' })

  setAuthCookie(res, { sub: user.id })
  res.json({ ok: true })
})

router.post('/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'mapper_token=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/')
  res.json({ ok: true })
})

router.get('/me', requireAuth, (req, res) => {
  res.json({ loggedIn: true, id: req.user.sub })
})

export default router
