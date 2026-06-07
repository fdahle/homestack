import { Router } from 'express'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

router.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY name').all())
})

router.post('/', (req, res) => {
  const { name, color } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' })

  const { lastInsertRowid } = db
    .prepare("INSERT INTO categories (name, color, created_at) VALUES (?, ?, datetime('now'))")
    .run(name.trim(), color || '#3b82f6')

  res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(lastInsertRowid))
})

router.put('/:id', (req, res) => {
  const { id } = req.params
  const existing = db.prepare('SELECT id FROM categories WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Not found' })

  const { name, color } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' })

  db.prepare('UPDATE categories SET name=?, color=? WHERE id=?').run(name.trim(), color || '#3b82f6', id)
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(id))
})

router.delete('/:id', (req, res) => {
  const { id } = req.params
  const existing = db.prepare('SELECT id FROM categories WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Not found' })

  db.prepare('DELETE FROM categories WHERE id = ?').run(id)
  res.json({ ok: true })
})

export default router
