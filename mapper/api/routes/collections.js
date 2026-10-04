import { validateCollection, invalid } from '../utils/validation.js'
import { saveTrip } from '../utils/trips.js'
import { Router } from 'express'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

router.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM collections ORDER BY name').all())
})

router.post('/', (req, res) => {
  const { name, description, is_trip, start_date, end_date, color, show_route_line, show_exact_route } = req.body
  validateCollection(req.body)

  const { lastInsertRowid } = db
    .prepare("INSERT INTO collections (name, description, is_trip, start_date, end_date, color, show_route_line, show_exact_route, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))")
    .run(name.trim(), description || null, is_trip ? 1 : 0, start_date || null, end_date || null, color || '#10b981', is_trip && show_route_line ? 1 : 0, is_trip && show_exact_route ? 1 : 0)

  res.status(201).json(db.prepare('SELECT * FROM collections WHERE id = ?').get(lastInsertRowid))
})

router.put('/:id', (req, res) => {
  const { id } = req.params
  const existing = db.prepare('SELECT id FROM collections WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Not found' })

  const { name, description, is_trip, start_date, end_date, color, show_route_line, show_exact_route } = req.body
  validateCollection(req.body)

  if (is_trip && db.prepare('SELECT position FROM marker_collections WHERE collection_id=? AND position IS NOT NULL GROUP BY position HAVING count(*) > 1').get(id)) throw invalid('Reorder duplicate stops before enabling trip mode')
  db.prepare('UPDATE collections SET name=?, description=?, is_trip=?, start_date=?, end_date=?, color=?, show_route_line=?, show_exact_route=? WHERE id=?').run(
    name.trim(), description || null, is_trip ? 1 : 0, start_date || null, end_date || null, color || '#10b981', is_trip && show_route_line ? 1 : 0, is_trip && show_exact_route ? 1 : 0, id
  )
  if (!is_trip) db.prepare('DELETE FROM trip_waypoints WHERE collection_id = ?').run(id)
  res.json(db.prepare('SELECT * FROM collections WHERE id = ?').get(id))
})

router.put('/:id/positions', (req, res) => res.json(saveTrip(Number(req.params.id), req.body.positions ?? null)))
router.put('/:id/route', (req, res) => res.json(saveTrip(Number(req.params.id), req.body.positions ?? null, req.body.segments)))

router.get('/:id/segments', (req, res) => {
  const col = db.prepare('SELECT id, is_trip FROM collections WHERE id = ?').get(req.params.id)
  if (!col) return res.status(404).json({ error: 'Not found' })
  if (!col.is_trip) return res.status(400).json({ error: 'Not a trip' })
  const rows = db.prepare('SELECT from_marker_id, to_marker_id, mode, via_points FROM trip_waypoints WHERE collection_id = ?').all(req.params.id)
  res.json(rows.map(r => {
    let via_points
    try { via_points = JSON.parse(r.via_points) } catch { via_points = [] }
    return { ...r, via_points }
  }))
})

router.put('/:id/segments/:fromId/:toId', (req, res) => res.json(saveTrip(Number(req.params.id), undefined, [{
  from_marker_id: Number(req.params.fromId), to_marker_id: Number(req.params.toId), mode: req.body.mode ?? 'walk', via_points: req.body.via_points ?? [],
}])))

router.delete('/:id', (req, res) => {
  const { id } = req.params
  const existing = db.prepare('SELECT id FROM collections WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Not found' })

  db.prepare('DELETE FROM collections WHERE id = ?').run(id)
  res.json({ ok: true })
})

export default router
