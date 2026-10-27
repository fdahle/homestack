// Parsers for place files from other map apps: KML/KMZ (Google My Maps, Google Earth), GeoJSON
// (incl. Google Takeout "Saved Places.json") and GPX. Pure functions producing rows like the
// Google Maps CSV import: { title, label, description, coords, address, country, external_url,
// image_url, group, source }. `title` is what geocoding searches for when a row has no coords.
// Only points become places; lines, areas, tracks and routes are counted as skipped, since a
// representative point of a shape (or a track) is rarely a place anyone bookmarked.
import { validLatLng } from '../../../shared/markers.js'
import { countryName } from './nominatim.js'

const MAX_KMZ_BYTES = 100 * 1024 * 1024

// ── Format detection ──────────────────────────────────────────────────────────

const stripBom = text => text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

// Content wins over the extension: a ".json" can be GeoJSON or a Mapper export, and files get renamed.
export function detectFormat(name, text) {
  const ext = /\.([a-z]+)$/i.exec(name || '')?.[1]?.toLowerCase()
  const head = stripBom(text).trimStart()
  if (head.startsWith('<')) {
    const root = /<(?:[\w.-]+:)?(kml|gpx)[\s>/]/i.exec(head.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/gi, ''))?.[1]?.toLowerCase()
    return root || (ext === 'kml' || ext === 'gpx' ? ext : 'xml')
  }
  if (head.startsWith('{') || head.startsWith('[')) return 'json'
  return 'csv'
}

const GEOJSON_TYPES = new Set(['FeatureCollection', 'Feature', 'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'])
export const isGeoJson = data => !!data && !Array.isArray(data) && GEOJSON_TYPES.has(data.type)
export const isMapperJson = data => Array.isArray(data) || data?.type === 'export' || data?.type === 'backup' || Array.isArray(data?.markers)

// ── Shared helpers ────────────────────────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function decodeEntities(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? match
    const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match
  })
}

// Descriptions are shown as text, never as HTML: tags are dropped (line breaks kept) and entities decoded.
// Plain text is left alone, so "a < b" survives.
export function htmlToText(value) {
  let text = String(value ?? '')
  if (/<\/?[a-z][^>]*>|&(#x?[\da-f]+|[a-z]+);/i.test(text)) {
    text = decodeEntities(text
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]*>/g, ''))
  }
  return text.split('\n').map(line => line.replace(/[^\S\n]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim() || null
}

const clean = value => (typeof value === 'string' || typeof value === 'number') ? String(value).replace(/\s+/g, ' ').trim() || null : null
const httpUrl = value => {
  const url = clean(value)
  try { return url && ['http:', 'https:'].includes(new URL(url).protocol) ? url : null } catch { return null }
}
function point(lat, lng) {
  const coords = { lat: Number(lat), lng: Number(lng) }
  return validLatLng(coords.lat, coords.lng) ? coords : null
}

function row(fields, source) {
  const r = { source }
  for (const [key, value] of Object.entries(fields)) if (value != null) r[key] = value
  r.label ??= null
  r.description ??= null
  r.coords ??= null
  r.title = r.address || r.label || ''
  return r
}

// Properties are matched case-insensitively and ignoring spaces/underscores ("Google Maps URL" = google_maps_url).
const keyOf = key => key.toLowerCase().replace(/[\s_-]+/g, '')
function lookup(props) {
  const map = new Map()
  for (const [key, value] of Object.entries(props ?? {})) if (value != null && value !== '') map.set(keyOf(key), value)
  return (...keys) => { for (const key of keys) if (map.has(key)) return map.get(key) }
}

// ── XML (KML, GPX) ────────────────────────────────────────────────────────────

function parseXml(text, DOMParserImpl) {
  if (!DOMParserImpl) throw new Error('XML files cannot be read in this browser')
  const doc = new DOMParserImpl().parseFromString(stripBom(text), 'application/xml')
  if (!doc?.documentElement || doc.getElementsByTagName('parsererror').length) throw new Error('The file is not valid XML')
  return doc.documentElement
}

// Namespaces (kml 2.2, gx, gpx 1.0/1.1) are ignored by matching local names.
const kids = (el, name) => Array.prototype.filter.call(el.children, c => c.localName === name)
const kid = (el, name) => Array.prototype.find.call(el.children, c => c.localName === name)
const kidText = (el, name) => { const c = kid(el, name); return c ? c.textContent : null }

function kmlCoords(text) {
  const [lng, lat] = String(text ?? '').trim().split(/\s+/)[0].split(',')
  return lng != null && lat != null && lng.trim() !== '' && lat.trim() !== '' ? point(lat, lng) : null
}

// Data/value pairs (Google My Maps) and SchemaData/SimpleData (Google Earth, converters).
function extendedData(placemark) {
  const data = []
  const ext = kid(placemark, 'ExtendedData')
  if (!ext) return data
  for (const d of kids(ext, 'Data')) data.push([d.getAttribute('name') || kidText(d, 'displayName') || '', kidText(d, 'value') ?? ''])
  for (const schema of kids(ext, 'SchemaData')) for (const d of kids(schema, 'SimpleData')) data.push([d.getAttribute('name') || '', d.textContent])
  return data.filter(([key, value]) => key && value.trim())
}

// Returns the Point of a Placemark (also inside MultiGeometry), false for other shapes, null for none.
function placemarkPoint(placemark) {
  let shape = false
  const stack = [placemark]
  while (stack.length) {
    const el = stack.pop()
    for (const c of el.children) {
      if (c.localName === 'Point') return kmlCoords(kidText(c, 'coordinates')) ?? false
      if (c.localName === 'MultiGeometry') stack.push(c)
      else if (['LineString', 'LinearRing', 'Polygon', 'Track', 'MultiTrack', 'Model'].includes(c.localName)) shape = true
    }
  }
  return shape ? false : null
}

function parseKml(text, DOMParserImpl) {
  const root = parseXml(text, DOMParserImpl)
  if (root.localName !== 'kml') throw new Error('Not a KML file')
  const rows = []
  let skipped = 0
  // One pass in file order; each Placemark takes its innermost Folder (a My Maps layer) as its group.
  const walk = (el, group) => {
    for (const c of el.children) {
      if (c.localName === 'Placemark') {
        const r = kmlPlacemark(c, group)
        if (r) rows.push(r)
        else skipped++
      } else if (c.localName === 'Folder') walk(c, clean(kidText(c, 'name')) ?? group)
      else if (c.localName === 'Document') walk(c, group)
    }
  }
  walk(root, null)
  return { rows, skipped }
}

const DESCRIPTION_KEYS = new Set(['description', 'beschreibung', 'desc', 'note', 'notes', 'notiz', 'comment'])
const ADDRESS_KEYS = new Set(['address', 'adresse'])
const URL_KEYS = new Set(['url', 'website', 'link', 'webseite'])

function kmlPlacemark(placemark, group) {
  const coords = placemarkPoint(placemark)
  if (coords === false) return null
  let description = htmlToText(kidText(placemark, 'description'))
  let address = clean(kidText(placemark, 'address'))
  let external_url = null, image_url = null
  const rest = []
  for (const [name, value] of extendedData(placemark)) {
    const key = keyOf(name)
    if (key === 'gxmedialinks') image_url ??= value.split(/\s+/).map(httpUrl).find(Boolean) ?? null
    else if (DESCRIPTION_KEYS.has(key)) description ??= htmlToText(value)
    else if (ADDRESS_KEYS.has(key)) address ??= clean(value)
    else if (URL_KEYS.has(key) && httpUrl(value)) external_url ??= httpUrl(value)
    else if (key !== 'name') rest.push(name + ': ' + (htmlToText(value) ?? ''))
  }
  // My Maps repeats data columns in the description; they are only spelled out when it has none.
  description ??= rest.length ? rest.join('\n') : null
  const label = clean(kidText(placemark, 'name'))
  // Without a position an address can still be geocoded like a CSV row.
  if (!coords && !address) return null
  return row({ label, description, coords, address, external_url, image_url, group }, 'kml')
}

function parseGpx(text, DOMParserImpl) {
  const root = parseXml(text, DOMParserImpl)
  if (root.localName !== 'gpx') throw new Error('Not a GPX file')
  const rows = []
  let skipped = 0
  for (const c of root.children) {
    if (c.localName === 'trk' || c.localName === 'rte') { skipped++; continue }
    if (c.localName !== 'wpt') continue
    const coords = point(c.getAttribute('lat'), c.getAttribute('lon'))
    if (!coords) { skipped++; continue }
    const link = kid(c, 'link')?.getAttribute('href') ?? kidText(c, 'url') // GPX 1.1 / 1.0
    rows.push(row({
      label: clean(kidText(c, 'name')),
      description: htmlToText(kidText(c, 'desc') ?? kidText(c, 'cmt')),
      coords,
      external_url: httpUrl(link),
      group: clean(kidText(c, 'type')),
    }, 'gpx'))
  }
  return { rows, skipped }
}

// ── GeoJSON ───────────────────────────────────────────────────────────────────

// Positions of a geometry: { lat, lng }, null when invalid, false for a line or area.
// Exactly [0, 0] is how Takeout writes "no coordinates", so it counts as no position at all.
function geoJsonPoints(geometry) {
  if (!geometry) return []
  const pos = p => !Array.isArray(p) || p.length < 2 ? null : p[0] === 0 && p[1] === 0 ? undefined : point(p[1], p[0]) // [lng, lat]
  if (geometry.type === 'Point') return [pos(geometry.coordinates)].filter(p => p !== undefined)
  if (geometry.type === 'MultiPoint') return Array.isArray(geometry.coordinates) ? geometry.coordinates.map(pos).filter(p => p !== undefined) : [null]
  if (geometry.type === 'GeometryCollection') return Array.isArray(geometry.geometries) ? geometry.geometries.flatMap(geoJsonPoints) : [null]
  return [false]
}

function parseGeoJson(data) {
  if (!isGeoJson(data)) throw new Error('Not a GeoJSON file')
  const features = data.type === 'FeatureCollection' ? (Array.isArray(data.features) ? data.features : [])
    : data.type === 'Feature' ? [data] : [{ type: 'Feature', geometry: data, properties: {} }]
  const rows = []
  let skipped = 0
  for (const feature of features) {
    const get = lookup(feature?.properties)
    // Google Takeout: { Title, "Google Maps URL", Location: { Address, "Business Name", "Geo Coordinates" } }
    // or newer { google_maps_url, location: { name, address, country_code } }.
    const location = get('location')
    const loc = lookup(typeof location === 'object' ? location : null)
    const geo = lookup(loc('geocoordinates'))
    const points = geoJsonPoints(feature?.geometry)
    let coords = points.filter(Boolean)
    skipped += points.length - coords.length // lines, areas, invalid positions
    // No position: Takeout's own coordinates, else geocoding by address or name.
    if (!points.length) coords = [point(geo('latitude'), geo('longitude'))]
    const fields = {
      label: clean(get('name', 'title', 'label')) ?? clean(loc('name', 'businessname')),
      description: htmlToText(get('description', 'desc', 'note', 'notes', 'comment') ?? ''),
      address: clean(get('address')) ?? clean(loc('address')) ?? (typeof location === 'string' ? clean(location) : null),
      country: clean(get('country')) ?? (loc('countrycode') ? countryName({ country_code: String(loc('countrycode')) }) : null),
      external_url: httpUrl(get('url', 'website', 'link', 'googlemapsurl')),
      group: clean(get('category', 'folder', 'layer', 'group', 'collection')),
    }
    for (const c of coords) {
      if (c || fields.address || fields.label) rows.push(row({ ...fields, coords: c }, 'geojson'))
      else skipped++
    }
  }
  return { rows, skipped }
}

// ── Entry points ──────────────────────────────────────────────────────────────

// text: file contents (a KMZ is unpacked first with readKmz). Returns { format, rows, skipped }.
export function parsePlaces(text, name = '', { DOMParser: DOMParserImpl = globalThis.DOMParser } = {}) {
  const format = detectFormat(name, text)
  if (format === 'kml') return { format, ...parseKml(text, DOMParserImpl) }
  if (format === 'gpx') return { format, ...parseGpx(text, DOMParserImpl) }
  if (format === 'json') {
    let data
    try { data = JSON.parse(stripBom(text)) } catch { throw new Error('The file is not valid JSON') }
    if (isMapperJson(data)) throw new Error('This is a Mapper export or backup; import it in Settings → Data with "Mapper export" or "Restore"')
    return { format: 'geojson', ...parseGeoJson(data) }
  }
  throw new Error(format === 'xml' ? 'Unknown XML file (expected KML or GPX)' : 'Unknown file format')
}

// ── KMZ (a zip with doc.kml) ──────────────────────────────────────────────────

async function inflateRaw(bytes, limit) {
  if (typeof DecompressionStream !== 'function') throw new Error('KMZ files cannot be unpacked in this browser; extract doc.kml and import that')
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > limit) { reader.cancel().catch(() => {}); throw new Error('The KMZ file is too large') }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length }
  return out
}

// Reads the zip's central directory and returns the text of its main KML (doc.kml, else the first .kml).
export async function readKmz(buffer) {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break }
  }
  if (end < 0) throw new Error('The KMZ file is not a valid zip archive')
  const count = view.getUint16(end + 10, true)
  let p = view.getUint32(end + 16, true)
  const entries = []
  for (let n = 0; n < count && p + 46 <= bytes.length && view.getUint32(p, true) === 0x02014b50; n++) {
    const nameLength = view.getUint16(p + 28, true)
    entries.push({
      name: new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLength)),
      flags: view.getUint16(p + 8, true),
      method: view.getUint16(p + 10, true),
      size: view.getUint32(p + 20, true),
      offset: view.getUint32(p + 42, true),
    })
    p += 46 + nameLength + view.getUint16(p + 30, true) + view.getUint16(p + 32, true)
  }
  const kmls = entries.filter(e => /\.kml$/i.test(e.name))
  const entry = kmls.find(e => e.name.toLowerCase() === 'doc.kml') ?? kmls.find(e => !e.name.includes('/')) ?? kmls[0]
  if (!entry) throw new Error('The KMZ file contains no KML')
  if (entry.flags & 1) throw new Error('Encrypted KMZ files are not supported')
  const h = entry.offset
  if (h + 30 > bytes.length || view.getUint32(h, true) !== 0x04034b50) throw new Error('The KMZ file is damaged')
  const start = h + 30 + view.getUint16(h + 26, true) + view.getUint16(h + 28, true)
  const data = bytes.subarray(start, start + entry.size)
  if (entry.method === 0) return new TextDecoder().decode(data)
  if (entry.method !== 8) throw new Error('Unsupported compression in the KMZ file')
  return new TextDecoder().decode(await inflateRaw(data, MAX_KMZ_BYTES))
}
