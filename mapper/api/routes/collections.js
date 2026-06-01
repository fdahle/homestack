import { Router } from 'express'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

router.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM collections ORDER BY name').all())
})

router.post('/', (req, res) => {
  const { name, description, is_trip, start_date, end_date, color } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' })

  const { lastInsertRowid } = db
    .prepare('INSERT INTO collections (name, description, is_trip, start_date, end_date, color) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name.trim(), description || null, is_trip ? 1 : 0, start_date || null, end_date || null, color || '#10b981')

  res.status(201).json(db.prepare('SELECT * FROM collections WHERE id = ?').get(lastInsertRowid))
})

router.put('/:id', (req, res) => {
  const { id } = req.params
  const existing = db.prepare('SELECT id FROM collections WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Not found' })

  const { name, description, is_trip, start_date, end_date, color } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' })

  db.prepare('UPDATE collections SET name=?, description=?, is_trip=?, start_date=?, end_date=?, color=? WHERE id=?').run(
    name.trim(), description || null, is_trip ? 1 : 0, start_date || null, end_date || null, color || '#10b981', id
  )
  res.json(db.prepare('SELECT * FROM collections WHERE id = ?').get(id))
})

router.delete('/:id', (req, res) => {
  const { id } = req.params
  const existing = db.prepare('SELECT id FROM collections WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Not found' })

  db.prepare('DELETE FROM collections WHERE id = ?').run(id)
  res.json({ ok: true })
})

export default router
