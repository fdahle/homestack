import { validateBackup, MARKER_BACKUP_FIELDS } from '../utils/backup.js'
import { Router } from 'express'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { rm } from 'node:fs/promises'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

router.get('/', (_req, res) => {
  const categories = db.prepare('SELECT id, name, color, created_at FROM categories').all()
  const collections = db.prepare('SELECT id, name, description, start_date, end_date, color, is_trip, show_route_line, show_exact_route, created_at FROM collections').all()
  const persons = db.prepare('SELECT id, name, first_name, last_name, color, address_marker_id, created_at FROM persons').all()
  const rawMarkers = db.prepare('SELECT ' + MARKER_BACKUP_FIELDS.join(',') + ' FROM markers').all()

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
    version: 2,
    created_at: new Date().toISOString(),
    categories,
    collections,
    persons,
    markers,
    trip_waypoints,
  })
})

// Consistent snapshot of the whole SQLite database (account and share links included),
// safe to take while the app is running.
router.get('/database', (_req, res, next) => {
  const file = join(tmpdir(), `mapper-snapshot-${randomBytes(8).toString('hex')}.db`)
  try {
    db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`)
  } catch (err) {
    rm(file, { force: true }).catch(() => {})
    return next(err)
  }
  res.download(file, `mapper-${new Date().toISOString().slice(0, 10)}.db`, () => rm(file, { force: true }).catch(() => {}))
})

router.post('/restore', (req, res) => {
  const data = req.body
  validateBackup(data)

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
        c.color ?? '#10b981', c.is_trip ? 1 : 0, c.show_route_line ? 1 : 0, c.show_exact_route ? 1 : 0, c.created_at ?? null
      )
      colMap[c.id] = lastInsertRowid
    }

    const perMap = {}
    const insPerson = db.prepare('INSERT INTO persons (name, first_name, last_name, color, created_at) VALUES (?, ?, ?, ?, ?)')
    for (const p of persons) {
      const { lastInsertRowid } = insPerson.run(p.name, p.first_name ?? p.name, p.last_name ?? null, p.color ?? '#8b5cf6', p.created_at ?? null)
      perMap[p.id] = lastInsertRowid
    }

    const markerMap = {}
    const markerFields = MARKER_BACKUP_FIELDS.filter(field => field !== 'id')
    const insMarker = db.prepare(`INSERT INTO markers (${markerFields.join(',')}) VALUES (${markerFields.map(() => '?').join(',')})`)
    const insMarkerCat = db.prepare('INSERT OR IGNORE INTO marker_categories (marker_id, category_id) VALUES (?, ?)')
    const insMarkerCol = db.prepare('INSERT OR IGNORE INTO marker_collections (marker_id, collection_id, position) VALUES (?, ?, ?)')
    const insMarkerPer = db.prepare('INSERT OR IGNORE INTO marker_persons (marker_id, person_id) VALUES (?, ?)')

    for (const m of markers) {
      const row = { ...m, is_favorite: m.is_favorite ? 1 : 0, use_coords: m.use_coords ? 1 : 0, source: m.source ?? 'manual', created_at: m.created_at ?? new Date().toISOString() }
      const { lastInsertRowid } = insMarker.run(...markerFields.map(field => row[field] ?? null))
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

    const updPersonAddr = db.prepare('UPDATE persons SET address_marker_id=? WHERE id=?')
    for (const p of persons) {
      if (p.address_marker_id != null && markerMap[p.address_marker_id] != null) {
        updPersonAddr.run(markerMap[p.address_marker_id], perMap[p.id])
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
        insWaypoint.run(newCol, newFrom, newTo, w.mode ?? 'walk', typeof w.via_points === 'string' ? w.via_points : JSON.stringify(w.via_points ?? []))
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
    res.status(500).json({ error: 'Restore failed' })
  }
})

export default router
