import { validateShare, normalizeShareFilter } from '../utils/validation.js'
import { Router } from 'express'
import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { parseShareFilter, resolveMarkerIds } from '../utils/shareUtils.js'

const router = Router()
router.use(requireAuth)

// One unreadable link must not break the whole list.
function linkResponse(link) {
  const filter = parseShareFilter(link.filter_json)
  let markerCount = null
  try { markerCount = filter ? resolveMarkerIds(filter).length : 0 } catch (err) { console.error('Share link count failed:', err.message) }
  return {
    token: link.token,
    name: link.name,
    hasPassword: !!link.password_hash,
    filter: filter ?? { all: false, categories: [], collections: [], persons: [], markers: [] },
    markerCount,
    createdAt: link.created_at,
    expiresAt: link.expires_at,
  }
}

router.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM share_links ORDER BY created_at DESC').all().map(linkResponse))
})

router.post('/', async (req, res, next) => {
  try {
    validateShare(req.body)
    const { name, password, filter, expiresAt } = req.body
    if (!filter) return res.status(400).json({ error: 'filter is required' })
    const filterJson = JSON.stringify(normalizeShareFilter(filter))

    const token = randomBytes(24).toString('base64url')
    const passwordHash = password ? await bcrypt.hash(password, 12) : null
    db.prepare(
      'INSERT INTO share_links (token, name, password_hash, filter_json, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(token, name || null, passwordHash, filterJson, expiresAt || null)

    res.status(201).json(linkResponse(db.prepare('SELECT * FROM share_links WHERE token = ?').get(token)))
  } catch (err) {
    next(err)
  }
})

router.put('/:token', async (req, res, next) => {
  try {
    validateShare(req.body)
    const link = db.prepare('SELECT * FROM share_links WHERE token = ?').get(req.params.token)
    if (!link) return res.status(404).json({ error: 'Not found' })

    const { name, password, removePassword, filter, expiresAt } = req.body
    const filterJson = filter ? JSON.stringify(normalizeShareFilter(filter)) : link.filter_json

    let passwordHash = link.password_hash
    if (removePassword) {
      passwordHash = null
    } else if (password) {
      passwordHash = await bcrypt.hash(password, 12)
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

    res.json(linkResponse(db.prepare('SELECT * FROM share_links WHERE token = ?').get(req.params.token)))
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
