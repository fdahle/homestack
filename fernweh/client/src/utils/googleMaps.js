// Places shared from Google Maps: its "Share" button gives a short link (maps.app.goo.gl/…), sometimes
// with the place's name and address in front. The server expands the short link; the expanded link
// carries the coordinates, or — when shared from the phone app — only the name and address, which
// are then looked up in OpenStreetMap.
import { apiJson } from '../api.js'
import { nominatim } from './nominatim.js'

const LINK_RE = /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.|maps\.)?google\.[a-z]{2,3}(?:\.[a-z]{2})?\/maps|maps\.google\.[a-z]{2,3}(?:\.[a-z]{2})?)[^\s<>"']*/i
const SHORT_RE = /^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl)\//i
// Also the Arabic comma, as in "Rijal Almaa Museum، 677F+2G9 …".
const SEPARATOR_RE = /\s*[,،]\s*/
const COORDS_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*\+?(-?\d{1,3}(?:\.\d+)?)\s*$/

export function findGoogleMapsLink(text) {
  return String(text ?? '').match(LINK_RE)?.[0] ?? null
}

function coords(lat, lng) {
  lat = Number(lat)
  lng = Number(lng)
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng) ? { lat, lng } : null
}

function coordsOf(text) {
  const m = text?.match(COORDS_RE)
  return m ? coords(m[1], m[2]) : null
}

function decode(segment) {
  try { return decodeURIComponent(segment.replace(/\+/g, ' ')).trim() } catch { return segment.trim() }
}

// → { lat, lng, text } from an expanded link; lat/lng are null when it only names the place.
// `text` is what Google shows for the place: just its name when the link has coordinates,
// "Name, Street 1, City, Country" otherwise.
export function parseGoogleMapsUrl(href) {
  let url
  try { url = new URL(href) } catch { return null }
  const path = url.pathname
  const segment = path.match(/\/maps\/(?:place|search)\/([^/]+)/)?.[1]
  const pathText = segment ? decode(segment) : null
  const queryText = ['q', 'query', 'daddr', 'destination'].map(k => url.searchParams.get(k)).find(Boolean)?.trim() || null
  const text = [pathText, queryText].find(t => t && !coordsOf(t)) ?? null
  // The place's own position is in the data part (!3d…!4d…, the last pair if several); "@lat,lng"
  // is only the centre of the view, so it comes last.
  const pins = [...path.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)]
  const pin = pins.length ? coords(pins.at(-1)[1], pins.at(-1)[2]) : null
  const at = path.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
  const position = pin ?? coordsOf(pathText) ?? coordsOf(queryText) ?? coordsOf(url.searchParams.get('ll')) ??
    (at && coords(at[1], at[2]))
  return { lat: position?.lat ?? null, lng: position?.lng ?? null, text }
}

// "Name, Street 1, City" → searches from most to least precise. Nominatim finds the address, rarely
// the name in front of it; dropping further parts ends up at the street or town.
function geocodeQueries(text) {
  const parts = text.split(SEPARATOR_RE).filter(Boolean)
  if (parts.length < 2) return [text]
  return [parts.slice(1).join(', '), text, parts.slice(2).join(', ')].filter((q, i, all) => q && all.indexOf(q) === i)
}

// The text shared along with the link ("Name\nAddress\nhttps://…"): its first line is the name.
function nameFromSharedText(text, link) {
  return String(text).replace(link, '').split('\n').map(s => s.trim()).find(Boolean) ?? null
}

// → { lat, lng, name, approximate }; `approximate` when the position was looked up from the address.
// Throws an Error with a message for the user.
export async function resolveGoogleMapsPlace(sharedText, { signal } = {}) {
  const link = findGoogleMapsLink(sharedText)
  if (!link) throw new Error('No Google Maps link found.')
  const expanded = SHORT_RE.test(link)
    ? (await apiJson(`/api/links/google-maps?url=${encodeURIComponent(link)}`, { signal })).url
    : link
  const place = parseGoogleMapsUrl(expanded)
  if (!place) throw new Error('This Google Maps link couldn’t be read.')
  const hasCoords = place.lat != null
  const name = (hasCoords ? place.text : place.text?.split(SEPARATOR_RE)[0]) || nameFromSharedText(sharedText, link)
  if (hasCoords) return { lat: place.lat, lng: place.lng, name, approximate: false }
  if (!place.text) throw new Error('This Google Maps link has no place in it.')
  for (const q of geocodeQueries(place.text)) {
    const [hit] = await nominatim('search', { q, limit: 1 }, { signal })
    if (hit) return { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon), name, approximate: true }
  }
  throw new Error(`Couldn’t find “${place.text}” on the map — Google’s link has no coordinates, only this address.`)
}
