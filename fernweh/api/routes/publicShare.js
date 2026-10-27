import { Router } from 'express'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import db from '../db.js'
import { buildSharePayload, parseShareFilter } from '../utils/shareUtils.js'
import { shareExpired } from '../utils/validation.js'
import { clientKey } from '../utils/clientKey.js'

const router = Router()

const WINDOW_MS = 15 * 60 * 1000
const shareLimiter = rateLimit({ windowMs: WINDOW_MS, max: 60, standardHeaders: true, keyGenerator: req => clientKey(req.ip), handler: (_req, res) => res.status(429).json({ error: 'Too many requests. Please wait a few minutes.' }) })

// Wrong passwords lock out the client that sent them, so one visitor cannot lock everyone else out
// of a link. The much higher per-link ceiling stops guesses spread over many addresses.
const MAX_CLIENT_FAILURES = 10
const MAX_LINK_FAILURES = 100
const failures = new Map() // `${token} ${client}` and `${token}` -> { count, resetAt }
function lockout(key) {
  const entry = failures.get(key)
  if (entry && entry.resetAt < Date.now()) failures.delete(key)
  return failures.get(key)
}
function lockedOut(token, client) {
  const entries = [[lockout(`${token} ${client}`), MAX_CLIENT_FAILURES], [lockout(token), MAX_LINK_FAILURES]]
  return entries.find(([entry, max]) => entry?.count >= max)?.[0] ?? null
}
function recordAttempt(token, client) {
  if (failures.size > 10000) for (const key of failures.keys()) lockout(key)
  for (const key of [`${token} ${client}`, token]) {
    const entry = failures.get(key) ?? { count: 0, resetAt: Date.now() + WINDOW_MS }
    entry.count++
    failures.set(key, entry)
  }
}

async function shareData(req, res, next) {
  try {
    const link = db.prepare('SELECT * FROM share_links WHERE token = ?').get(req.params.token)
    if (!link) return res.status(404).json({ error: 'Share link not found' })

    if (shareExpired(link.expires_at)) {
      return res.status(410).json({ error: 'This share link has expired' })
    }

    const meta = { name: link.name, token: link.token }

    if (link.password_hash) {
      // POST bodies carry any Unicode password; the header is kept for already-open older pages.
      const provided = req.method === 'POST' ? req.body?.password : req.headers['x-share-password']
      if (typeof provided !== 'string' || !provided) {
        return res.status(401).json({ requiresPassword: true, meta })
      }
      const client = clientKey(req.ip)
      const locked = lockedOut(link.token, client)
      if (locked) {
        res.set('Retry-After', String(Math.ceil((locked.resetAt - Date.now()) / 1000)))
        return res.status(429).json({ error: 'Too many incorrect passwords. Try again in 15 minutes.' })
      }
      // Counted before the slow compare, so parallel guesses cannot all pass the lockout check.
      recordAttempt(link.token, client)
      const valid = Buffer.byteLength(provided) <= 72 && await bcrypt.compare(provided, link.password_hash)
      if (!valid) return res.status(403).json({ error: 'Incorrect password' })
      // The per-link count only gives back this correct attempt: a visitor who knows the password
      // must not reset the ceiling that guesses from other addresses count against.
      failures.delete(`${link.token} ${client}`)
      const linkEntry = failures.get(link.token)
      if (linkEntry) linkEntry.count--
    }

    const filter = parseShareFilter(link.filter_json)
    if (!filter) return res.status(500).json({ error: 'Internal server error' })
    res.json({ meta, ...buildSharePayload(filter) })
  } catch (err) {
    next(err)
  }
}

router.get('/:token/data', shareLimiter, shareData)
router.post('/:token/data', shareLimiter, shareData)

export default router
