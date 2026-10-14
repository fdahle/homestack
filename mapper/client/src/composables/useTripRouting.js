import { loadSettings } from '../utils/settings.js'
import { apiFetch } from '../api.js'
import { fetchJson } from '../utils/fetchJson.js'

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
const ROUTE_TIMEOUT_MS = 15000
const routeCache = new Map()

function cacheRoute(key, route) {
  routeCache.set(key, route)
  if (routeCache.size > ROUTE_CACHE_SIZE) routeCache.delete(routeCache.keys().next().value)
}

const routeKey = (service, mode, points) => JSON.stringify([service, mode, points.map(p => [+p.lat.toFixed(6), +p.lng.toFixed(6)])])

// Resolves to { path, distance, duration, warning? }. A rejected ORS key falls back to OSRM
// (with a warning) so a typo in Settings does not take every route down.
export async function fetchSegmentRoute(from, to, viaPoints, mode, signal) {
  const orsKey = getOrsApiKey()
  const all = [{ lat: from.lat, lng: from.lng }, ...(viaPoints || []), { lat: to.lat, lng: to.lng }]
  const osrmKey = routeKey('osrm', mode, all)
  if (orsKey) {
    const key = routeKey('ors', mode, all)
    if (routeCache.has(key)) return routeCache.get(key)
    try {
      const route = await fetchOrsRoute(all, mode, orsKey, signal)
      cacheRoute(key, route)
      return route
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) throw err
    }
    // Cached under the OSRM key only, so ORS is asked again once the key is fixed.
    const route = routeCache.get(osrmKey) ?? await fetchOsrmRoute(all, mode, signal)
    cacheRoute(osrmKey, route)
    return { ...route, warning: 'OpenRouteService rejected the API key (check it in Settings); using OSRM instead.' }
  }
  if (routeCache.has(osrmKey)) return routeCache.get(osrmKey)
  const route = await fetchOsrmRoute(all, mode, signal)
  cacheRoute(osrmKey, route)
  return route
}

// Turns transport failures into messages a user can act on; keeps .status for callers.
function routingError(err, service, messages) {
  if (err.name === 'AbortError') return err
  const message = err.name === 'TimeoutError' ? `${service} did not respond within ${ROUTE_TIMEOUT_MS / 1000} s.`
    : err.status ? messages[err.status] ?? `${service} failed (error ${err.status}).`
    : `${service} is unreachable.`
  return Object.assign(new Error(message), { status: err.status })
}

// Routes resolve to { path: [[lat, lng], ...], distance (m), duration (s) }.
// The OSRM demo server only has a car profile, so walking and cycling routes (and their
// durations) were really driving routes. The FOSSGIS servers run one OSRM per profile.
const OSRM_PROFILES = { walk: ['routed-foot', 'foot'], hike: ['routed-foot', 'foot'], bike: ['routed-bike', 'bike'], drive: ['routed-car', 'driving'] }
async function fetchOsrmRoute(points, mode, signal) {
  const [server, profile] = OSRM_PROFILES[mode] || OSRM_PROFILES.walk
  const coords = points.map(p => `${+p.lng.toFixed(6)},${+p.lat.toFixed(6)}`).join(';')
  let data
  try {
    data = await fetchJson(`https://routing.openstreetmap.de/${server}/route/v1/${profile}/${coords}?overview=full&geometries=geojson`, { signal, timeoutMs: ROUTE_TIMEOUT_MS, label: 'OSRM' })
  } catch (err) {
    // OSRM answers 400 when a point cannot be snapped to a road or path.
    throw routingError(err, 'The routing service (OSRM)', {
      400: 'No route found between these points.',
      404: 'No route found between these points.',
      429: 'The routing service (OSRM) is busy; try again in a minute.',
    })
  }
  const route = data?.routes?.[0]
  if (!route) throw new Error('No route found between these points.')
  return { path: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]), distance: route.distance, duration: route.duration }
}

async function fetchOrsRoute(points, mode, apiKey, signal) {
  const profile = { walk: 'foot-walking', hike: 'foot-hiking', bike: 'cycling-regular', drive: 'driving-car' }[mode] || 'foot-walking'
  const coordinates = points.map(p => [+p.lng.toFixed(6), +p.lat.toFixed(6)])
  let data
  try {
    data = await fetchJson(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
      signal,
      timeoutMs: ROUTE_TIMEOUT_MS,
      label: 'OpenRouteService',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
      body: JSON.stringify({ coordinates }),
    })
  } catch (err) {
    throw routingError(err, 'OpenRouteService', {
      400: 'OpenRouteService could not route this leg (too long, or a point is far from any road).',
      401: 'OpenRouteService rejected the API key.',
      403: 'OpenRouteService rejected the API key.',
      404: 'No route found between these points (a point may be far from any road).',
      429: 'The OpenRouteService quota is used up; try again later.',
    })
  }
  const feature = data?.features?.[0]
  if (!feature) throw new Error('No route found between these points.')
  const summary = feature.properties?.summary ?? {}
  return { path: feature.geometry.coordinates.map(([lng, lat]) => [lat, lng]), distance: summary.distance ?? null, duration: summary.duration ?? null }
}
