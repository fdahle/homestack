import { Router } from 'express'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import db from '../db.js'
import { resolveMarkerIds, buildMarkersPayload } from '../utils/shareUtils.js'

const router = Router()

const shareLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 })

router.get('/:token/data', shareLimiter, async (req, res, next) => {
  try {
    const link = db.prepare('SELECT * FROM share_links WHERE token = ?').get(req.params.token)
    if (!link) return res.status(404).json({ error: 'Share link not found' })

    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This share link has expired' })
    }

    const meta = { name: link.name, token: link.token }

    if (link.password_hash) {
      const provided = req.headers['x-share-password']
      if (!provided) {
        return res.status(401).json({ requiresPassword: true, meta })
      }
      const valid = await bcrypt.compare(provided, link.password_hash)
      if (!valid) {
        return res.status(403).json({ error: 'Incorrect password' })
      }
    }

    let filter
    try { filter = JSON.parse(link.filter_json) } catch { return res.status(500).json({ error: 'Internal server error' }) }
    const markerIds = resolveMarkerIds(filter)
    const markers = buildMarkersPayload(markerIds)

    const categoryIds = new Set()
    const collectionIds = new Set()
    const personIds = new Set()
    for (const m of markers) {
      for (const c of m.categories) categoryIds.add(c.id)
      for (const c of m.collections) collectionIds.add(c.id)
      for (const p of m.persons) personIds.add(p.id)
    }

    const categories = categoryIds.size
      ? db.prepare(`SELECT * FROM categories WHERE id IN (${[...categoryIds].map(() => '?').join(',')})`).all(...categoryIds)
      : []
    const collections = collectionIds.size
      ? db.prepare(`SELECT * FROM collections WHERE id IN (${[...collectionIds].map(() => '?').join(',')})`).all(...collectionIds)
      : []
    const persons = personIds.size
      ? db.prepare(`SELECT * FROM persons WHERE id IN (${[...personIds].map(() => '?').join(',')})`).all(...personIds)
      : []

    res.json({ meta, markers, categories, collections, persons })
  } catch (err) {
    next(err)
  }
})

export default router
