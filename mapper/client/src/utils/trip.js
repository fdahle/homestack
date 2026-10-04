// Pure helpers for trip summaries and GPX export.

export function haversineMeters(a, b) {
  const R = 6371000
  const rad = (d) => d * Math.PI / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function formatDistance(meters) {
  if (meters == null) return ''
  if (meters < 1000) return `${Math.round(meters)} m`
  const km = meters / 1000
  return `${km < 100 ? km.toFixed(1) : Math.round(km)} km`
}

export function formatDuration(seconds) {
  if (seconds == null) return ''
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

// legs: [{ distance, duration }] — duration is null when a leg was not routed.
export function summarizeLegs(legs) {
  return {
    distance: legs.reduce((sum, leg) => sum + (leg.distance ?? 0), 0),
    duration: legs.length && legs.every((leg) => leg.duration != null) ? legs.reduce((sum, leg) => sum + leg.duration, 0) : null,
  }
}

const escapeXml = (value) => String(value ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]))
const coord = (n) => Number(n).toFixed(6)

// stops: markers in trip order; legs: [{ path: [[lat, lng], ...] }] between consecutive stops.
export function buildGpx(name, stops, legs) {
  const waypoints = stops.map((m, i) => [
    `  <wpt lat="${coord(m.lat)}" lon="${coord(m.lng)}">`,
    `    <name>${escapeXml(`${i + 1}. ${m.label || `${coord(m.lat)}, ${coord(m.lng)}`}`)}</name>`,
    m.description ? `    <desc>${escapeXml(m.description)}</desc>` : null,
    '  </wpt>',
  ].filter(Boolean).join('\n'))
  const segments = legs.map((leg) => [
    '    <trkseg>',
    ...leg.path.map(([lat, lng]) => `      <trkpt lat="${coord(lat)}" lon="${coord(lng)}"/>`),
    '    </trkseg>',
  ].join('\n'))
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Mapper" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${escapeXml(name)}</name></metadata>`,
    ...waypoints,
    '  <trk>',
    `    <name>${escapeXml(name)}</name>`,
    ...segments,
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n')
}

export function gpxFilename(name) {
  return `${(name || 'trip').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'trip'}.gpx`
}
