import { Router } from 'express'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

router.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM persons ORDER BY name').all())
})

router.post('/', (req, res) => {
  const { name, color } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' })

  const { lastInsertRowid } = db
    .prepare('INSERT INTO persons (name, color) VALUES (?, ?)')
    .run(name.trim(), color || '#8b5cf6')

  res.status(201).json(db.prepare('SELECT * FROM persons WHERE id = ?').get(lastInsertRowid))
})

router.put('/:id', (req, res) => {
  const { id } = req.params
  const existing = db.prepare('SELECT id FROM persons WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Not found' })

  const { name, color } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' })

  db.prepare('UPDATE persons SET name=?, color=? WHERE id=?').run(name.trim(), color || '#8b5cf6', id)
  res.json(db.prepare('SELECT * FROM persons WHERE id = ?').get(id))
})

router.delete('/:id', (req, res) => {
  const { id } = req.params
  const existing = db.prepare('SELECT id FROM persons WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Not found' })

  db.prepare('DELETE FROM persons WHERE id = ?').run(id)
  res.json({ ok: true })
})

export default router
