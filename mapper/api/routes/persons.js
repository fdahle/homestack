import { Router } from 'express'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

const SELECT_PERSON = `
  SELECT p.*, m.lat AS address_lat, m.lng AS address_lng, m.label AS address_label, m.address AS address_address
  FROM persons p
  LEFT JOIN markers m ON m.id = p.address_marker_id
`

function formatPerson(p) {
  const { address_lat, address_lng, address_label, address_address, ...rest } = p
  rest.name = [rest.first_name, rest.last_name].filter(Boolean).join(' ') || rest.name
  if (p.address_marker_id) {
    rest.address_marker = { id: p.address_marker_id, lat: address_lat, lng: address_lng, label: address_label, address: address_address }
  } else {
    rest.address_marker = null
  }
  return rest
}

router.get('/', (_req, res) => {
  const rows = db.prepare(SELECT_PERSON + 'ORDER BY p.name').all()
  res.json(rows.map(formatPerson))
})

router.post('/', (req, res) => {
  const { first_name, last_name, color, address_marker_id } = req.body
  if (!first_name?.trim()) return res.status(400).json({ error: 'First name required' })

  const displayName = [first_name.trim(), last_name?.trim()].filter(Boolean).join(' ')

  const { lastInsertRowid } = db
    .prepare("INSERT INTO persons (name, first_name, last_name, color, address_marker_id, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))")
    .run(displayName, first_name.trim(), last_name?.trim() || null, color || '#8b5cf6', address_marker_id || null)

  res.status(201).json(formatPerson(db.prepare(SELECT_PERSON + 'WHERE p.id = ?').get(lastInsertRowid)))
})

router.put('/:id', (req, res) => {
  const { id } = req.params
  const existing = db.prepare('SELECT id FROM persons WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Not found' })

  const { first_name, last_name, color, address_marker_id } = req.body
  if (!first_name?.trim()) return res.status(400).json({ error: 'First name required' })

  const displayName = [first_name.trim(), last_name?.trim()].filter(Boolean).join(' ')

  db.prepare('UPDATE persons SET name=?, first_name=?, last_name=?, color=?, address_marker_id=? WHERE id=?')
    .run(displayName, first_name.trim(), last_name?.trim() || null, color || '#8b5cf6', address_marker_id || null, id)

  res.json(formatPerson(db.prepare(SELECT_PERSON + 'WHERE p.id = ?').get(id)))
})

router.delete('/:id', (req, res) => {
  const { id } = req.params
  const existing = db.prepare('SELECT id FROM persons WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Not found' })

  db.prepare('DELETE FROM persons WHERE id = ?').run(id)
  res.json({ ok: true })
})

export default router
