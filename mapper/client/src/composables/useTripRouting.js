import { loadSettings } from '../utils/settings.js'
import { apiFetch } from '../api.js'

export function getOrsApiKey() { return loadSettings().orsApiKey?.trim() || '' }

export async function loadSegments(collectionId, signal) {
  const res = await apiFetch(`/api/collections/${collectionId}/segments`, { signal })
  if (!res.ok) throw new Error('Failed to load segments')
  const rows = await res.json()
  return Object.fromEntries(rows.map(r => [`${r.from_marker_id}-${r.to_marker_id}`, r]))
}

export async function saveSegment(collectionId, fromId, toId, mode, viaPoints) {
  const res = await apiFetch(`/api/collections/${collectionId}/segments/${fromId}/${toId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, via_points: viaPoints }),
  })
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to save segment')
}

// Routed paths are cached so re-rendering a trip does not query the routing service again.
const ROUTE_CACHE_SIZE = 200
const routeCache = new Map()

export async function fetchSegmentRoute(from, to, viaPoints, mode, signal) {
  const orsKey = getOrsApiKey()
  const all = [{ lat: from.lat, lng: from.lng }, ...(viaPoints || []), { lat: to.lat, lng: to.lng }]
  const key = JSON.stringify([orsKey ? 'ors' : 'osrm', mode, all.map(p => [+p.lat.toFixed(6), +p.lng.toFixed(6)])])
  if (routeCache.has(key)) return routeCache.get(key)
  const route = await (orsKey ? fetchOrsRoute(all, mode, orsKey, signal) : fetchOsrmRoute(all, mode, signal))
  routeCache.set(key, route)
  if (routeCache.size > ROUTE_CACHE_SIZE) routeCache.delete(routeCache.keys().next().value)
  return route
}

async function fetchOsrmRoute(points, mode, signal) {
  const profile = { walk: 'foot', hike: 'foot', bike: 'bike', drive: 'car' }[mode] || 'foot'
  const coords = points.map(p => `${+p.lng.toFixed(6)},${+p.lat.toFixed(6)}`).join(';')
  const res = await fetch(`https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson`, { signal })
  if (!res.ok) throw new Error('OSRM routing failed')
  const data = await res.json()
  if (!data.routes?.[0]) throw new Error('No route found')
  return data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng])
}

async function fetchOrsRoute(points, mode, apiKey, signal) {
  const profile = { walk: 'foot-walking', hike: 'foot-hiking', bike: 'cycling-regular', drive: 'driving-car' }[mode] || 'foot-walking'
  const coordinates = points.map(p => [+p.lng.toFixed(6), +p.lat.toFixed(6)])
  const res = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
    signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
    body: JSON.stringify({ coordinates }),
  })
  if (!res.ok) throw new Error('ORS routing failed')
  const data = await res.json()
  return data.features[0].geometry.coordinates.map(([lng, lat]) => [lat, lng])
}
