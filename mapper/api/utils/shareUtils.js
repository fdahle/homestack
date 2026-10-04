import { getMarkers, publicMarker } from './markers.js'
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

export function buildMarkersPayload(ids) { return getMarkers(ids).map(publicMarker) }
