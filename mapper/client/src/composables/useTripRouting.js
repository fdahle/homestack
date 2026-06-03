const SETTINGS_KEY = 'mapper_settings'

export function getOrsApiKey() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}').orsApiKey?.trim() || '' } catch { return '' }
}

export async function loadSegments(collectionId) {
  const res = await fetch(`/api/collections/${collectionId}/segments`)
  if (!res.ok) throw new Error('Failed to load segments')
  const rows = await res.json()
  return Object.fromEntries(rows.map(r => [`${r.from_marker_id}-${r.to_marker_id}`, r]))
}

export async function saveSegment(collectionId, fromId, toId, mode, viaPoints) {
  const res = await fetch(`/api/collections/${collectionId}/segments/${fromId}/${toId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, via_points: viaPoints }),
  })
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to save segment')
}

export async function fetchSegmentRoute(from, to, viaPoints, mode) {
  const orsKey = getOrsApiKey()
  const all = [{ lat: from.lat, lng: from.lng }, ...(viaPoints || []), { lat: to.lat, lng: to.lng }]
  if (orsKey) return fetchOrsRoute(all, mode, orsKey)
  return fetchOsrmRoute(all, mode)
}

async function fetchOsrmRoute(points, mode) {
  const profile = { walk: 'foot', hike: 'foot', bike: 'bike', drive: 'car' }[mode] || 'foot'
  const coords = points.map(p => `${+p.lng.toFixed(6)},${+p.lat.toFixed(6)}`).join(';')
  const res = await fetch(`https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson`)
  if (!res.ok) throw new Error('OSRM routing failed')
  const data = await res.json()
  if (!data.routes?.[0]) throw new Error('No route found')
  return data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng])
}

async function fetchOrsRoute(points, mode, apiKey) {
  const profile = { walk: 'foot-walking', hike: 'foot-hiking', bike: 'cycling-regular', drive: 'driving-car' }[mode] || 'foot-walking'
  const coordinates = points.map(p => [+p.lng.toFixed(6), +p.lat.toFixed(6)])
  const res = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
    body: JSON.stringify({ coordinates }),
  })
  if (!res.ok) throw new Error('ORS routing failed')
  const data = await res.json()
  return data.features[0].geometry.coordinates.map(([lng, lat]) => [lat, lng])
}
