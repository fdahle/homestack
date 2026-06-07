import db from '../db.js'

export function resolveMarkerIds(filter) {
  if (filter.all) {
    return db.prepare('SELECT id FROM markers').all().map((r) => r.id)
  }

  const catIds    = (filter.categories || []).filter(Number.isInteger)
  const colIds    = (filter.collections || []).filter(Number.isInteger)
  const personIds = (filter.persons    || []).filter(Number.isInteger)
  const markerIds = (filter.markers    || []).filter(Number.isInteger)

  if (!catIds.length && !colIds.length && !personIds.length && !markerIds.length) {
    return []
  }

  const conditions = []
  const params = []

  if (catIds.length) {
    conditions.push(`mc.category_id IN (${catIds.map(() => '?').join(',')})`)
    params.push(...catIds)
  }
  if (colIds.length) {
    conditions.push(`mcol.collection_id IN (${colIds.map(() => '?').join(',')})`)
    params.push(...colIds)
  }
  if (personIds.length) {
    conditions.push(`mp.person_id IN (${personIds.map(() => '?').join(',')})`)
    params.push(...personIds)
  }
  if (markerIds.length) {
    conditions.push(`m.id IN (${markerIds.map(() => '?').join(',')})`)
    params.push(...markerIds)
  }

  const sql = `
    SELECT DISTINCT m.id FROM markers m
    LEFT JOIN marker_categories mc ON mc.marker_id = m.id
    LEFT JOIN marker_collections mcol ON mcol.marker_id = m.id
    LEFT JOIN marker_persons mp ON mp.marker_id = m.id
    WHERE ${conditions.join(' OR ')}
  `
  return db.prepare(sql).all(...params).map((r) => r.id)
}

export function buildMarkersPayload(markerIds) {
  if (!markerIds.length) return []

  const placeholders = markerIds.map(() => '?').join(',')
  const markers = db
    .prepare(`SELECT * FROM markers WHERE id IN (${placeholders}) ORDER BY created_at DESC`)
    .all(...markerIds)

  const allMarkerCollections = db
    .prepare(`SELECT mc.marker_id, c.*, mc.position FROM collections c JOIN marker_collections mc ON c.id = mc.collection_id WHERE mc.marker_id IN (${placeholders})`)
    .all(...markerIds)

  const allMarkerCategories = db
    .prepare(`SELECT mc.marker_id, c.* FROM categories c JOIN marker_categories mc ON c.id = mc.category_id WHERE mc.marker_id IN (${placeholders})`)
    .all(...markerIds)

  const allMarkerPersons = db
    .prepare(`SELECT mp.marker_id, p.* FROM persons p JOIN marker_persons mp ON p.id = mp.person_id WHERE mp.marker_id IN (${placeholders})`)
    .all(...markerIds)

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

  const personsByMarkerId = {}
  for (const row of allMarkerPersons) {
    const { marker_id, ...person } = row
    if (!personsByMarkerId[marker_id]) personsByMarkerId[marker_id] = []
    personsByMarkerId[marker_id].push(person)
  }

  return markers.map((m) => ({
    ...m,
    categories:  categoriesByMarkerId[m.id]  ?? [],
    collections: collectionsByMarkerId[m.id] ?? [],
    persons:     personsByMarkerId[m.id]     ?? [],
  }))
}
