import { Router } from 'express'
import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { resolveMarkerIds } from '../utils/shareUtils.js'

const router = Router()
router.use(requireAuth)

router.get('/', (_req, res) => {
  const links = db.prepare('SELECT * FROM share_links ORDER BY created_at DESC').all()
  const result = links.map((link) => {
    const filter = JSON.parse(link.filter_json)
    const markerCount = resolveMarkerIds(filter).length
    return {
      token: link.token,
      name: link.name,
      hasPassword: !!link.password_hash,
      filter,
      markerCount,
      createdAt: link.created_at,
      expiresAt: link.expires_at,
    }
  })
  res.json(result)
})

router.post('/', async (req, res, next) => {
  try {
    const { name, password, filter, expiresAt } = req.body
    if (!filter || typeof filter !== 'object') {
      return res.status(400).json({ error: 'filter is required' })
    }

    const token = randomBytes(24).toString('base64url')
    const passwordHash = password ? await bcrypt.hash(password, 12) : null
    const filterJson = JSON.stringify({
      all: !!filter.all,
      categories: Array.isArray(filter.categories) ? filter.categories.filter(Number.isInteger) : [],
      collections: Array.isArray(filter.collections) ? filter.collections.filter(Number.isInteger) : [],
      persons: Array.isArray(filter.persons) ? filter.persons.filter(Number.isInteger) : [],
      markers: Array.isArray(filter.markers) ? filter.markers.filter(Number.isInteger) : [],
    })

    db.prepare(
      'INSERT INTO share_links (token, name, password_hash, filter_json, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(token, name || null, passwordHash, filterJson, expiresAt || null)

    const link = db.prepare('SELECT * FROM share_links WHERE token = ?').get(token)
    const parsedFilter = JSON.parse(link.filter_json)
    res.status(201).json({
      token: link.token,
      name: link.name,
      hasPassword: !!link.password_hash,
      filter: parsedFilter,
      markerCount: resolveMarkerIds(parsedFilter).length,
      createdAt: link.created_at,
      expiresAt: link.expires_at,
    })
  } catch (err) {
    next(err)
  }
})

router.put('/:token', async (req, res, next) => {
  try {
    const link = db.prepare('SELECT * FROM share_links WHERE token = ?').get(req.params.token)
    if (!link) return res.status(404).json({ error: 'Not found' })

    const { name, password, removePassword, filter, expiresAt } = req.body

    let passwordHash = link.password_hash
    if (removePassword) {
      passwordHash = null
    } else if (password) {
      passwordHash = await bcrypt.hash(password, 12)
    }

    let filterJson = link.filter_json
    if (filter && typeof filter === 'object') {
      filterJson = JSON.stringify({
        all: !!filter.all,
        categories: Array.isArray(filter.categories) ? filter.categories.filter(Number.isInteger) : [],
        collections: Array.isArray(filter.collections) ? filter.collections.filter(Number.isInteger) : [],
        persons: Array.isArray(filter.persons) ? filter.persons.filter(Number.isInteger) : [],
        markers: Array.isArray(filter.markers) ? filter.markers.filter(Number.isInteger) : [],
      })
    }

    db.prepare(
      'UPDATE share_links SET name=?, password_hash=?, filter_json=?, expires_at=? WHERE token=?'
    ).run(
      name !== undefined ? name || null : link.name,
      passwordHash,
      filterJson,
      expiresAt !== undefined ? expiresAt || null : link.expires_at,
      req.params.token
    )

    const updated = db.prepare('SELECT * FROM share_links WHERE token = ?').get(req.params.token)
    const parsedFilter = JSON.parse(updated.filter_json)
    res.json({
      token: updated.token,
      name: updated.name,
      hasPassword: !!updated.password_hash,
      filter: parsedFilter,
      markerCount: resolveMarkerIds(parsedFilter).length,
      createdAt: updated.created_at,
      expiresAt: updated.expires_at,
    })
  } catch (err) {
    next(err)
  }
})

router.delete('/:token', (req, res) => {
  const link = db.prepare('SELECT id FROM share_links WHERE token = ?').get(req.params.token)
  if (!link) return res.status(404).json({ error: 'Not found' })
  db.prepare('DELETE FROM share_links WHERE token = ?').run(req.params.token)
  res.json({ ok: true })
})

export default router
