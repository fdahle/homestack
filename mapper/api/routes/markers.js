import { Router } from 'express'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

function getMarkerWithRelations(id) {
  const marker = db.prepare('SELECT * FROM markers WHERE id = ?').get(id)
  if (!marker) return null

  const categories = db
    .prepare('SELECT c.* FROM categories c JOIN marker_categories mc ON c.id = mc.category_id WHERE mc.marker_id = ?')
    .all(id)

  const collections = db
    .prepare('SELECT c.*, mc.position FROM collections c JOIN marker_collections mc ON c.id = mc.collection_id WHERE mc.marker_id = ?')
    .all(id)

  return { ...marker, categories, collections }
}

router.get('/', (_req, res) => {
  const markers = db.prepare('SELECT * FROM markers ORDER BY created_at DESC').all()

  const allMarkerCollections = db
    .prepare('SELECT mc.marker_id, c.*, mc.position FROM collections c JOIN marker_collections mc ON c.id = mc.collection_id')
    .all()

  const allMarkerCategories = db
    .prepare('SELECT mc.marker_id, c.* FROM categories c JOIN marker_categories mc ON c.id = mc.category_id')
    .all()

  const collectionsByMarkerId = {}
  for (const row of allMarkerCollections) {
    const { marker_id, ...collection } = row
    if (!collectionsByMarkerId[marker_id]) collectionsByMarkerId[marker_id] = []
    collectionsByMarkerId[marker_id].push(collection)
  }

  const categoriesByMarkerId = {}
  for (const row of allMarkerCategories) {
    const { marker_id, ...category } = row
    if (!categoriesByMarkerId[marker_id]) categoriesByMarkerId[marker_id] = []
    categoriesByMarkerId[marker_id].push(category)
  }

  const result = markers.map((m) => ({
    ...m,
    categories: categoriesByMarkerId[m.id] ?? [],
    collections: collectionsByMarkerId[m.id] ?? [],
  }))

  res.json(result)
})

function validLatLng(lat, lng) {
  return typeof lat === 'number' && typeof lng === 'number' &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

function checkDuplicatePositions(collection_ids, collection_positions, excludeMarkerId) {
  if (!collection_positions || typeof collection_positions !== 'object') return null
  for (const [cidStr, pos] of Object.entries(collection_positions)) {
    if (pos === null || pos === undefined || pos === '') continue
    const cid = Number(cidStr)
    if (!collection_ids.includes(cid)) continue
    const col = db.prepare('SELECT is_trip FROM collections WHERE id = ?').get(cid)
    if (!col?.is_trip) continue
    const conflict = excludeMarkerId
      ? db.prepare('SELECT marker_id FROM marker_collections WHERE collection_id = ? AND position = ? AND marker_id != ?').get(cid, Number(pos), excludeMarkerId)
      : db.prepare('SELECT marker_id FROM marker_collections WHERE collection_id = ? AND position = ?').get(cid, Number(pos))
    if (conflict) return `Stop #${pos} is already used in this trip`
  }
  return null
}

router.post('/', (req, res) => {
  const { lat, lng, label, description, visited_at, color, image_url, category_ids, collection_ids, collection_positions } = req.body

  if (lat == null || lng == null) {
    return res.status(400).json({ error: 'lat and lng are required' })
  }
  if (!validLatLng(lat, lng)) {
    return res.status(400).json({ error: 'lat must be in [-90, 90] and lng in [-180, 180]' })
  }

  if (Array.isArray(collection_ids)) {
    const dupErr = checkDuplicatePositions(collection_ids, collection_positions, null)
    if (dupErr) return res.status(400).json({ error: dupErr })
  }

  const { lastInsertRowid } = db
    .prepare('INSERT INTO markers (lat, lng, label, description, visited_at, color, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(lat, lng, label || null, description || null, visited_at || null, color || null, image_url || null)

  if (Array.isArray(category_ids)) {
    const insert = db.prepare('INSERT OR IGNORE INTO marker_categories (marker_id, category_id) VALUES (?, ?)')
    for (const cid of category_ids) insert.run(lastInsertRowid, cid)
  }

  if (Array.isArray(collection_ids)) {
    const insert = db.prepare('INSERT OR IGNORE INTO marker_collections (marker_id, collection_id, position) VALUES (?, ?, ?)')
    for (const cid of collection_ids) insert.run(lastInsertRowid, cid, collection_positions?.[cid] ?? null)
  }

  res.status(201).json(getMarkerWithRelations(lastInsertRowid))
})

router.put('/:id', (req, res) => {
  const { id } = req.params
  const existing = db.prepare('SELECT * FROM markers WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Not found' })

  const { label, description, visited_at, color, image_url, category_ids, collection_ids, collection_positions } = req.body
  const lat = req.body.lat ?? existing.lat
  const lng = req.body.lng ?? existing.lng

  if (!validLatLng(lat, lng)) {
    return res.status(400).json({ error: 'lat must be in [-90, 90] and lng in [-180, 180]' })
  }

  if (Array.isArray(collection_ids)) {
    const dupErr = checkDuplicatePositions(collection_ids, collection_positions, Number(id))
    if (dupErr) return res.status(400).json({ error: dupErr })
  }

  db.prepare(
    'UPDATE markers SET lat=?, lng=?, label=?, description=?, visited_at=?, color=?, image_url=? WHERE id=?'
  ).run(lat, lng, label ?? null, description ?? null, visited_at ?? null, color ?? null, image_url ?? null, id)

  if (Array.isArray(category_ids)) {
    db.prepare('DELETE FROM marker_categories WHERE marker_id = ?').run(id)
    const insert = db.prepare('INSERT OR IGNORE INTO marker_categories (marker_id, category_id) VALUES (?, ?)')
    for (const cid of category_ids) insert.run(id, cid)
  }

  if (Array.isArray(collection_ids)) {
    db.prepare('DELETE FROM marker_collections WHERE marker_id = ?').run(id)
    const insert = db.prepare('INSERT OR IGNORE INTO marker_collections (marker_id, collection_id, position) VALUES (?, ?, ?)')
    for (const cid of collection_ids) insert.run(id, cid, collection_positions?.[cid] ?? null)
  }

  res.json(getMarkerWithRelations(id))
})

router.patch('/:id/country', (req, res) => {
  const existing = db.prepare('SELECT id FROM markers WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Not found' })
  db.prepare('UPDATE markers SET country = ? WHERE id = ?').run(req.body.country ?? null, req.params.id)
  res.json({ ok: true })
})

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM markers WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Not found' })

  db.prepare('DELETE FROM markers WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router
