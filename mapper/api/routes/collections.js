import { Router } from 'express'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

router.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM collections ORDER BY name').all())
})

function normDate(d, isEnd = false) {
  if (/^\d{4}$/.test(d)) return d + (isEnd ? '-12-31' : '-01-01')
  if (/^\d{4}-\d{2}$/.test(d)) {
    if (!isEnd) return d + '-01'
    const [y, m] = d.split('-').map(Number)
    const lastDay = new Date(y, m, 0).getDate()
    return `${d}-${String(lastDay).padStart(2, '0')}`
  }
  return d
}

function validateDates(start_date, end_date) {
  if (start_date && end_date && normDate(start_date, false) > normDate(end_date, true)) {
    return 'start_date must be before end_date'
  }
  return null
}

router.post('/', (req, res) => {
  const { name, description, is_trip, start_date, end_date, color, show_route_line, show_exact_route } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' })
  const dateErr = validateDates(start_date, end_date)
  if (dateErr) return res.status(400).json({ error: dateErr })

  const { lastInsertRowid } = db
    .prepare('INSERT INTO collections (name, description, is_trip, start_date, end_date, color, show_route_line, show_exact_route) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(name.trim(), description || null, is_trip ? 1 : 0, start_date || null, end_date || null, color || '#10b981', is_trip && show_route_line ? 1 : 0, is_trip && show_exact_route ? 1 : 0)

  res.status(201).json(db.prepare('SELECT * FROM collections WHERE id = ?').get(lastInsertRowid))
})

router.put('/:id', (req, res) => {
  const { id } = req.params
  const existing = db.prepare('SELECT id FROM collections WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Not found' })

  const { name, description, is_trip, start_date, end_date, color, show_route_line, show_exact_route } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' })
  const dateErr = validateDates(start_date, end_date)
  if (dateErr) return res.status(400).json({ error: dateErr })

  db.prepare('UPDATE collections SET name=?, description=?, is_trip=?, start_date=?, end_date=?, color=?, show_route_line=?, show_exact_route=? WHERE id=?').run(
    name.trim(), description || null, is_trip ? 1 : 0, start_date || null, end_date || null, color || '#10b981', is_trip && show_route_line ? 1 : 0, is_trip && show_exact_route ? 1 : 0, id
  )
  res.json(db.prepare('SELECT * FROM collections WHERE id = ?').get(id))
})

router.put('/:id/positions', (req, res) => {
  const col = db.prepare('SELECT id, is_trip FROM collections WHERE id = ?').get(req.params.id)
  if (!col) return res.status(404).json({ error: 'Not found' })
  if (!col.is_trip) return res.status(400).json({ error: 'Not a trip' })

  const { positions } = req.body
  if (!Array.isArray(positions)) return res.status(400).json({ error: 'positions must be an array' })

  const seen = new Set()
  for (const { position } of positions) {
    if (position === null || position === undefined) continue
    if (seen.has(position)) return res.status(400).json({ error: `Stop #${position} is used more than once` })
    seen.add(position)
  }

  const update = db.prepare('UPDATE marker_collections SET position = ? WHERE marker_id = ? AND collection_id = ?')
  for (const { marker_id, position } of positions) update.run(position ?? null, marker_id, col.id)

  res.json({ ok: true })
})

router.get('/:id/segments', (req, res) => {
  const col = db.prepare('SELECT id, is_trip FROM collections WHERE id = ?').get(req.params.id)
  if (!col) return res.status(404).json({ error: 'Not found' })
  if (!col.is_trip) return res.status(400).json({ error: 'Not a trip' })
  const rows = db.prepare('SELECT from_marker_id, to_marker_id, mode, via_points FROM trip_waypoints WHERE collection_id = ?').all(req.params.id)
  res.json(rows.map(r => ({ ...r, via_points: JSON.parse(r.via_points) })))
})

router.put('/:id/segments/:fromId/:toId', (req, res) => {
  const col = db.prepare('SELECT id, is_trip FROM collections WHERE id = ?').get(req.params.id)
  if (!col) return res.status(404).json({ error: 'Not found' })
  if (!col.is_trip) return res.status(400).json({ error: 'Not a trip' })
  const { mode = 'walk', via_points = [] } = req.body
  if (!['walk', 'hike', 'bike', 'drive'].includes(mode)) return res.status(400).json({ error: 'Invalid mode' })
  if (!Array.isArray(via_points)) return res.status(400).json({ error: 'via_points must be an array' })
  db.prepare(`
    INSERT INTO trip_waypoints (collection_id, from_marker_id, to_marker_id, mode, via_points)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(collection_id, from_marker_id, to_marker_id) DO UPDATE SET mode = excluded.mode, via_points = excluded.via_points
  `).run(col.id, req.params.fromId, req.params.toId, mode, JSON.stringify(via_points))
  res.json({ ok: true })
})

router.delete('/:id', (req, res) => {
  const { id } = req.params
  const existing = db.prepare('SELECT id FROM collections WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Not found' })

  db.prepare('DELETE FROM collections WHERE id = ?').run(id)
  res.json({ ok: true })
})

export default router
