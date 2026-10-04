import { Router } from 'express'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import db from '../db.js'
import { resolveMarkerIds, buildMarkersPayload } from '../utils/shareUtils.js'
import { shareExpired } from '../utils/validation.js'

const router = Router()

const WINDOW_MS = 15 * 60 * 1000
const shareLimiter = rateLimit({ windowMs: WINDOW_MS, max: 60, standardHeaders: true, handler: (_req, res) => res.status(429).json({ error: 'Too many requests. Please wait a few minutes.' }) })

// Per-link lockout so a password cannot be guessed by spreading attempts over many IPs.
const MAX_FAILURES = 10
const failures = new Map()
function lockedOut(token) {
  const entry = failures.get(token)
  if (entry && entry.resetAt < Date.now()) failures.delete(token)
  return (failures.get(token)?.count ?? 0) >= MAX_FAILURES
}
function recordFailure(token) {
  const entry = failures.get(token) ?? { count: 0, resetAt: Date.now() + WINDOW_MS }
  entry.count++
  failures.set(token, entry)
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
      if (lockedOut(link.token)) {
        res.set('Retry-After', String(Math.ceil((failures.get(link.token).resetAt - Date.now()) / 1000)))
        return res.status(429).json({ error: 'Too many incorrect passwords. Try again in 15 minutes.' })
      }
      const valid = Buffer.byteLength(provided) <= 72 && await bcrypt.compare(provided, link.password_hash)
      if (!valid) {
        recordFailure(link.token)
        return res.status(403).json({ error: 'Incorrect password' })
      }
      failures.delete(link.token)
    }

    let filter
    try { filter = JSON.parse(link.filter_json) } catch { return res.status(500).json({ error: 'Internal server error' }) }
    const markerIds = resolveMarkerIds(filter)
    const markers = buildMarkersPayload(markerIds)

    const unique = key => [...new Map(markers.flatMap(m => m[key]).map(item => [item.id, item])).values()]
    const categories = unique('categories')
    const collections = unique('collections').map(({ position: _position, ...c }) => c)
    const persons = unique('persons')

    res.json({ meta, markers, categories, collections, persons })
  } catch (err) {
    next(err)
  }
}

router.get('/:token/data', shareLimiter, shareData)
router.post('/:token/data', shareLimiter, shareData)

export default router
