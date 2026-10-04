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

    const unique = key => [...new Map(markers.flatMap(m => m[key]).map(item => [item.id, item])).values()]
    const categories = unique('categories')
    const collections = unique('collections').map(({ position: _position, ...c }) => c)
    const persons = unique('persons')

    res.json({ meta, markers, categories, collections, persons })
  } catch (err) {
    next(err)
  }
})

export default router
