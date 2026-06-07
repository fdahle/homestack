import { Router } from 'express'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

router.get('/', (_req, res) => {
  const categories = db.prepare('SELECT id, name, color, created_at FROM categories').all()
  const collections = db.prepare('SELECT id, name, description, start_date, end_date, color, is_trip, show_route_line, show_exact_route, created_at FROM collections').all()
  const persons = db.prepare('SELECT id, name, color, created_at FROM persons').all()
  const rawMarkers = db.prepare('SELECT id, lat, lng, label, description, visited_at, planned_at, color, image_url, address, country, rating, is_favorite, external_url, source, created_at, updated_at FROM markers').all()

  const catLinks = db.prepare('SELECT marker_id, category_id FROM marker_categories').all()
  const colLinks = db.prepare('SELECT marker_id, collection_id, position FROM marker_collections').all()
  const perLinks = db.prepare('SELECT marker_id, person_id FROM marker_persons').all()

  const catsByMarker = {}
  for (const r of catLinks) {
    if (!catsByMarker[r.marker_id]) catsByMarker[r.marker_id] = []
    catsByMarker[r.marker_id].push(r.category_id)
  }
  const colsByMarker = {}
  for (const r of colLinks) {
    if (!colsByMarker[r.marker_id]) colsByMarker[r.marker_id] = []
    colsByMarker[r.marker_id].push({ id: r.collection_id, position: r.position ?? null })
  }
  const persByMarker = {}
  for (const r of perLinks) {
    if (!persByMarker[r.marker_id]) persByMarker[r.marker_id] = []
    persByMarker[r.marker_id].push(r.person_id)
  }

  const markers = rawMarkers.map((m) => ({
    ...m,
    category_ids:      catsByMarker[m.id] ?? [],
    collection_links:  colsByMarker[m.id] ?? [],
    person_ids:        persByMarker[m.id] ?? [],
  }))

  const trip_waypoints = db.prepare(
    'SELECT collection_id, from_marker_id, to_marker_id, mode, via_points FROM trip_waypoints'
  ).all()

  res.json({
    type: 'backup',
    created_at: new Date().toISOString(),
    categories,
    collections,
    persons,
    markers,
    trip_waypoints,
  })
})

router.post('/restore', (req, res) => {
  const data = req.body
  if (data?.type !== 'backup' || !Array.isArray(data.markers)) {
    return res.status(400).json({ error: 'Invalid backup file' })
  }

  const categories    = data.categories    ?? []
  const collections   = data.collections   ?? []
  const persons       = data.persons       ?? []
  const markers       = data.markers       ?? []
  const tripWaypoints = data.trip_waypoints ?? []

  db.exec('BEGIN')
  try {
    db.exec('DELETE FROM share_links')
    db.exec('DELETE FROM trip_waypoints')
    db.exec('DELETE FROM marker_persons')
    db.exec('DELETE FROM marker_categories')
    db.exec('DELETE FROM marker_collections')
    db.exec('DELETE FROM markers')
    db.exec('DELETE FROM persons')
    db.exec('DELETE FROM collections')
    db.exec('DELETE FROM categories')

    const catMap = {}
    const insCategory = db.prepare("INSERT INTO categories (name, color, created_at) VALUES (?, ?, ?)")
    for (const c of categories) {
      const { lastInsertRowid } = insCategory.run(c.name, c.color ?? '#3b82f6', c.created_at ?? null)
      catMap[c.id] = lastInsertRowid
    }

    const colMap = {}
    const insCollection = db.prepare(
      'INSERT INTO collections (name, description, start_date, end_date, color, is_trip, show_route_line, show_exact_route, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    for (const c of collections) {
      const { lastInsertRowid } = insCollection.run(
        c.name, c.description ?? null, c.start_date ?? null, c.end_date ?? null,
        c.color ?? '#10b981', c.is_trip ?? 0, c.show_route_line ?? 0, c.show_exact_route ?? 0, c.created_at ?? null
      )
      colMap[c.id] = lastInsertRowid
    }

    const perMap = {}
    const insPerson = db.prepare('INSERT INTO persons (name, color, created_at) VALUES (?, ?, ?)')
    for (const p of persons) {
      const { lastInsertRowid } = insPerson.run(p.name, p.color ?? '#8b5cf6', p.created_at ?? null)
      perMap[p.id] = lastInsertRowid
    }

    const markerMap = {}
    const insMarker = db.prepare(
      'INSERT INTO markers (lat, lng, label, description, visited_at, planned_at, color, image_url, address, country, rating, is_favorite, external_url, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    const insMarkerCat = db.prepare('INSERT OR IGNORE INTO marker_categories (marker_id, category_id) VALUES (?, ?)')
    const insMarkerCol = db.prepare('INSERT OR IGNORE INTO marker_collections (marker_id, collection_id, position) VALUES (?, ?, ?)')
    const insMarkerPer = db.prepare('INSERT OR IGNORE INTO marker_persons (marker_id, person_id) VALUES (?, ?)')

    for (const m of markers) {
      const { lastInsertRowid } = insMarker.run(
        m.lat, m.lng, m.label ?? null, m.description ?? null, m.visited_at ?? null, m.planned_at ?? null,
        m.color ?? null, m.image_url ?? null, m.address ?? null, m.country ?? null,
        m.rating ?? null, m.is_favorite ?? 0, m.external_url ?? null, m.source ?? 'manual',
        m.created_at ?? new Date().toISOString(), m.updated_at ?? null
      )
      markerMap[m.id] = lastInsertRowid

      for (const cid of (m.category_ids ?? [])) {
        if (catMap[cid] != null) insMarkerCat.run(lastInsertRowid, catMap[cid])
      }
      for (const link of (m.collection_links ?? [])) {
        if (colMap[link.id] != null) insMarkerCol.run(lastInsertRowid, colMap[link.id], link.position ?? null)
      }
      for (const pid of (m.person_ids ?? [])) {
        if (perMap[pid] != null) insMarkerPer.run(lastInsertRowid, perMap[pid])
      }
    }

    const insWaypoint = db.prepare(
      'INSERT OR IGNORE INTO trip_waypoints (collection_id, from_marker_id, to_marker_id, mode, via_points) VALUES (?, ?, ?, ?, ?)'
    )
    for (const w of tripWaypoints) {
      const newCol  = colMap[w.collection_id]
      const newFrom = markerMap[w.from_marker_id]
      const newTo   = markerMap[w.to_marker_id]
      if (newCol != null && newFrom != null && newTo != null) {
        insWaypoint.run(newCol, newFrom, newTo, w.mode ?? 'walk', w.via_points ?? '[]')
      }
    }

    db.exec('COMMIT')
    res.json({
      ok: true,
      counts: {
        categories: categories.length,
        collections: collections.length,
        persons: persons.length,
        markers: markers.length,
      },
    })
  } catch (err) {
    db.exec('ROLLBACK')
    console.error('Restore failed:', err)
    res.status(500).json({ error: 'Restore failed: ' + err.message })
  }
})

export default router
