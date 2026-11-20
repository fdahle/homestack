// One-way import of friends and their addresses from Bande (the homestack friends app).
//
// Bande serves GET {BANDE_URL}/api/link/people with "Authorization: Bearer {BANDE_LINK_TOKEN}".
// Each friend that isn't archived and has an address or a city becomes a Fernweh person, with the
// address as the person's address marker in the collection "Freunde". The rules:
//
// - A friend not linked yet takes over an unlinked person with the same name (case-insensitive)
//   instead of creating a duplicate. A person that already has an address marker keeps it.
// - The address is geocoded (Nominatim, cached) only when Bande's text changed since the last
//   sync, so a pin moved by hand stays where it was put.
// - Nothing is ever deleted because of Bande: a friend that is gone or archived stays, marked as
//   no longer linked. Names follow Bande; nothing else the user edited here is overwritten.
// - A linked person deleted in Fernweh is not imported again (bande_ignored).

import db from '../db.js'
import { saveMarker } from './markers.js'
import { transaction } from './transaction.js'

export const FRIENDS_COLLECTION = 'Freunde'
const FRIENDS_COLOR = '#b2482a' // Bande's terracotta
const PERSON_COLOR = '#8b5cf6'
const LAST_SYNC_KEY = 'bande_last_sync'
const COLLECTION_KEY = 'bande_collection_id'

export function bandeConfig(env = process.env) {
  const url = String(env.BANDE_URL || '').trim().replace(/\/+$/, '')
  const token = String(env.BANDE_LINK_TOKEN || '').trim()
  const publicUrl = String(env.BANDE_PUBLIC_URL || '').trim().replace(/\/+$/, '') || null
  const hours = Number(env.BANDE_SYNC_HOURS)
  return { enabled: Boolean(url && token), url, token, publicUrl, hours: hours > 0 ? hours : 6 }
}

// --- settings ---

export function getSetting(key) {
  return db.prepare('SELECT value FROM app_settings WHERE key=?').get(key)?.value ?? null
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value == null ? null : String(value))
}

// --- Bande ---

export async function fetchBandePeople({ url, token }, { fetch = globalThis.fetch, timeoutMs = 20_000 } = {}) {
  let res
  try {
    res = await fetch(`${url}/api/link/people`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw new Error(`Bande can’t be reached at ${url} (${err.cause?.code || err.cause?.errors?.[0]?.code || err.message})`, { cause: err })
  }
  if (res.status === 401) throw new Error('Bande rejected the link token: BANDE_LINK_TOKEN differs from Bande’s.')
  if (res.status === 404) throw new Error('Bande has no link token set up (or BANDE_URL points elsewhere).')
  if (!res.ok) throw new Error(`Bande answered with HTTP ${res.status}.`)
  let data
  try { data = await res.json() } catch { data = null }
  if (!Array.isArray(data?.people)) throw new Error('Bande sent an answer Fernweh doesn’t understand.')
  return data.people
}

// --- geocoding ---

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const normName = (s) => clean(s).toLocaleLowerCase('de')

// What gets geocoded and written to the marker: the address, with the city added when the
// address doesn't name it already; just the city when there is no address.
export function placeText(friend) {
  const address = clean(friend.address)
  const city = clean(friend.city)
  if (!address) return city || null
  if (!city || address.toLocaleLowerCase('de').includes(city.toLocaleLowerCase('de'))) return address
  return `${address}, ${city}`
}

// Countries are stored by English name, like the client does (utils/nominatim.js).
const englishRegions = new Intl.DisplayNames(['en'], { type: 'region' })
function countryName(address) {
  const code = address?.country_code?.toUpperCase()
  if (code) {
    try { return englishRegions.of(code) } catch { /* unknown code */ }
  }
  return address?.country ?? null
}

// Nominatim search with its usage policy: one request per second, a proper User-Agent, and
// every answer cached by its query (addresses not found are asked again after a month).
// Resolves to { lat, lng, country } or null when nothing was found; network errors throw.
export function createGeocoder({
  fetch = globalThis.fetch,
  base = 'https://nominatim.openstreetmap.org',
  userAgent = 'Fernweh (self-hosted)',
  minIntervalMs = 1100,
  retryNotFoundDays = 30,
} = {}) {
  let queue = Promise.resolve()
  let last = 0

  async function ask(query) {
    const wait = last + minIntervalMs - Date.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    last = Date.now()
    const url = `${base}/search?${new URLSearchParams({ format: 'jsonv2', limit: '1', addressdetails: '1', q: query })}`
    const res = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`the address search answered with HTTP ${res.status}`)
    const hits = await res.json()
    return Array.isArray(hits) ? hits[0] ?? null : null
  }

  return async function geocode(text) {
    const query = clean(text)
    if (!query) return null
    const cached = db.prepare('SELECT * FROM geocode_cache WHERE query=?').get(query)
    const fresh = cached && (cached.lat != null || Date.now() - Date.parse(cached.fetched_at) < retryNotFoundDays * 86_400_000)
    if (fresh) return cached.lat == null ? null : { lat: cached.lat, lng: cached.lng, country: cached.country }
    const run = queue.then(() => ask(query))
    queue = run.catch(() => {})
    const hit = await run
    const lat = Number(hit?.lat)
    const lng = Number(hit?.lon)
    const found = hit && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, country: countryName(hit.address) } : null
    db.prepare(`INSERT INTO geocode_cache (query, lat, lng, address, country, fetched_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(query) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, address=excluded.address, country=excluded.country, fetched_at=excluded.fetched_at`)
      .run(query, found?.lat ?? null, found?.lng ?? null, hit?.display_name ?? null, found?.country ?? null, new Date().toISOString())
    return found
  }
}

// --- the sync ---

function splitName(name) {
  const [first, ...rest] = clean(name).split(' ')
  return { first, last: rest.join(' ') || null }
}

const fullName = (p) => [p.first_name, p.last_name].filter(Boolean).join(' ') || p.name

// The collection new address markers go into: the one remembered (even if renamed), else one
// called "Freunde", else a new one.
function friendsCollection() {
  const remembered = Number(getSetting(COLLECTION_KEY))
  if (remembered && db.prepare('SELECT id FROM collections WHERE id=?').get(remembered)) return remembered
  const named = db.prepare('SELECT id, name FROM collections ORDER BY id').all().find((c) => normName(c.name) === normName(FRIENDS_COLLECTION))
  const id = named?.id ?? Number(db.prepare("INSERT INTO collections (name, description, color, created_at) VALUES (?, ?, ?, datetime('now'))")
    .run(FRIENDS_COLLECTION, 'Addresses of friends from Bande', FRIENDS_COLOR).lastInsertRowid)
  setSetting(COLLECTION_KEY, id)
  return id
}

// Puts the person's address on the map: moves their address marker, or creates one when they
// have none (or share it with someone else, who keeps it where it is).
function placeAddress(personId, text, hit) {
  return transaction(db, () => {
    const person = db.prepare('SELECT * FROM persons WHERE id=?').get(personId)
    if (!person) return null
    const markerId = person.address_marker_id
    const shared = markerId && db.prepare('SELECT 1 FROM persons WHERE address_marker_id=? AND id!=?').get(markerId, personId)
    if (markerId && !shared && db.prepare('SELECT id FROM markers WHERE id=?').get(markerId)) {
      saveMarker({ lat: hit.lat, lng: hit.lng, address: text, country: hit.country ?? null }, markerId)
    } else {
      const marker = saveMarker({
        lat: hit.lat, lng: hit.lng, label: fullName(person), address: text, country: hit.country ?? null, source: 'bande',
        collection_ids: [friendsCollection()], person_ids: [personId],
      })
      db.prepare('UPDATE persons SET address_marker_id=? WHERE id=?').run(marker.id, personId)
    }
    db.prepare('UPDATE persons SET bande_address=?, bande_address_found=1 WHERE id=?').run(text, personId)
    return person
  })
}

// people: Bande's list. geocode(text) → { lat, lng, country } | null. Returns the report.
export async function syncPeople(people, { geocode }) {
  const report = { added: [], linked: [], moved: [], renamed: [], unchanged: 0, gone: [], not_found: [], skipped: 0, errors: [] }
  const ignored = new Set(db.prepare('SELECT friend_id FROM bande_ignored').all().map((r) => r.friend_id))
  const active = new Set()

  for (const friend of people) {
    if (!Number.isSafeInteger(friend?.id) || typeof friend.name !== 'string' || !clean(friend.name)) {
      report.errors.push('Bande sent a friend without id or name; skipped.')
      continue
    }
    if (friend.archived) continue
    active.add(friend.id)
    if (ignored.has(friend.id)) continue
    const name = clean(friend.name)
    try {
      const place = placeText(friend)
      let person = db.prepare('SELECT * FROM persons WHERE bande_friend_id=?').get(friend.id)
      let isNew = false
      let linkedNow = false

      if (!person) {
        if (!place) { report.skipped++; continue }
        const sameName = db.prepare('SELECT * FROM persons WHERE bande_friend_id IS NULL ORDER BY id').all().find((p) => normName(fullName(p)) === normName(name))
        if (sameName) {
          // A person with an address marker keeps it: the address counts as placed already.
          const placed = sameName.address_marker_id ? place : null
          db.prepare('UPDATE persons SET bande_friend_id=?, bande_gone=0, bande_address=?, bande_address_found=? WHERE id=?')
            .run(friend.id, placed, placed ? 1 : null, sameName.id)
          report.linked.push(name)
          linkedNow = true
          person = db.prepare('SELECT * FROM persons WHERE id=?').get(sameName.id)
        } else {
          const { first, last } = splitName(name)
          const id = db.prepare("INSERT INTO persons (name, first_name, last_name, color, created_at, bande_friend_id) VALUES (?, ?, ?, ?, datetime('now'), ?)")
            .run(name, first, last, PERSON_COLOR, friend.id).lastInsertRowid
          report.added.push(name)
          isNew = true
          person = db.prepare('SELECT * FROM persons WHERE id=?').get(id)
        }
      } else if (person.bande_gone) {
        // Back in Bande (e.g. no longer archived)
        db.prepare('UPDATE persons SET bande_gone=0 WHERE id=?').run(person.id)
        report.linked.push(name)
        linkedNow = true
      }
      const reported = isNew || linkedNow

      // Names follow Bande; the user's split into first and last name stays while it adds up.
      if (fullName(person) !== name) {
        const { first, last } = splitName(name)
        db.prepare('UPDATE persons SET name=?, first_name=?, last_name=? WHERE id=?').run(name, first, last, person.id)
        if (!reported) report.renamed.push(name)
      }

      // A friend whose address was removed in Bande keeps the pin they had.
      const changed = place && place !== person.bande_address
      const retry = place && place === person.bande_address && person.bande_address_found === 0
      if (!changed && !retry) {
        if (!reported && fullName(person) === name) report.unchanged++
        continue
      }

      let hit
      try {
        hit = await geocode(place)
      } catch (err) {
        // Not remembered as placed, so the next sync tries again
        report.errors.push(`${name}: the address couldn’t be looked up (${err.message}).`)
        continue
      }
      if (!hit) {
        db.prepare('UPDATE persons SET bande_address=?, bande_address_found=0 WHERE id=?').run(place, person.id)
        report.not_found.push({ name, address: place })
        continue
      }
      if (!placeAddress(person.id, place, hit)) continue
      if (!reported) report.moved.push(name)
    } catch (err) {
      report.errors.push(`${name}: ${err.message}`)
    }
  }

  // Gone from Bande or archived there: stays here, no longer linked
  for (const person of db.prepare('SELECT id, name, first_name, last_name, bande_friend_id FROM persons WHERE bande_friend_id IS NOT NULL AND bande_gone=0').all()) {
    if (active.has(person.bande_friend_id)) continue
    db.prepare('UPDATE persons SET bande_gone=1 WHERE id=?').run(person.id)
    report.gone.push(fullName(person))
  }
  return report
}

// Fetches Bande's friends, syncs them and remembers the report (shown in the settings).
export async function runBandeSync({ config = bandeConfig(), geocode = defaultGeocoder(), fetch } = {}) {
  const started = new Date().toISOString()
  let report
  try {
    const people = await fetchBandePeople(config, { fetch })
    report = await syncPeople(people, { geocode })
  } catch (err) {
    report = { added: [], linked: [], moved: [], renamed: [], unchanged: 0, gone: [], not_found: [], skipped: 0, errors: [err.message] }
  }
  report = { started_at: started, finished_at: new Date().toISOString(), ...report }
  setSetting(LAST_SYNC_KEY, JSON.stringify(report))
  const n = (list) => (Array.isArray(list) ? list.length : list)
  console.log(`Bande sync: ${n(report.added)} added, ${n(report.linked)} linked, ${n(report.moved)} moved, ${report.unchanged} unchanged, ${n(report.gone)} no longer in Bande, ${n(report.not_found)} addresses not found, ${n(report.errors)} errors`)
  for (const error of report.errors) console.warn(`Bande sync: ${error}`)
  return report
}

let geocoder = null
const defaultGeocoder = () => (geocoder ??= createGeocoder())

// --- running it ---

let running = null

export function bandeStatus(config = bandeConfig()) {
  if (!config.enabled) return { enabled: false }
  let last = null
  try { last = JSON.parse(getSetting(LAST_SYNC_KEY)) } catch { /* none yet */ }
  return { enabled: true, publicUrl: config.publicUrl, running: Boolean(running), every_hours: config.hours, last }
}

// One sync at a time; a second call while one runs gets the running one.
export function startBandeSync(options) {
  running ??= runBandeSync(options).finally(() => { running = null })
  return running
}

// At start (after a moment, so the server is up first) and every BANDE_SYNC_HOURS.
export function scheduleBandeSync(config = bandeConfig()) {
  if (!config.enabled) return
  const run = () => startBandeSync({ config }).catch((err) => console.error('Bande sync failed:', err))
  setTimeout(run, 5_000).unref()
  setInterval(run, config.hours * 3_600_000).unref()
}
