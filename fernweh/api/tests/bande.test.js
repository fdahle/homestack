// The import of friends from Bande, against a fake Bande server and a fake geocoder.
import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

process.env.MAPPER_DB_PATH = ':memory:'
process.env.SESSION_SECRET = 'bande-test-secret-'.repeat(3)
const { default: db } = await import('../db.js')
const { runBandeSync, createGeocoder, bandeConfig, bandeStatus, placeText } = await import('../utils/bande.js')
const { saveMarker } = await import('../utils/markers.js')

// --- a fake Bande ---
const TOKEN = 'link-token-for-tests'
let people = []
let bandeHasToken = true
const bande = createServer((req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (req.url !== '/api/link/people') return send(404, { error: 'not_found' })
  if (!bandeHasToken) return send(404, { error: 'not_found' })
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'unauthorized' })
  send(200, { people })
})
let config
before(async () => {
  await new Promise((resolve) => bande.listen(0, '127.0.0.1', resolve))
  config = bandeConfig({ BANDE_URL: `http://127.0.0.1:${bande.address().port}/`, BANDE_LINK_TOKEN: TOKEN, BANDE_PUBLIC_URL: 'https://friends.example/' })
})
after(async () => { bande.closeAllConnections(); await new Promise((resolve) => bande.close(resolve)); db.close() })

// --- a fake geocoder: known places, a log of what was asked ---
const PLACES = {
  'Hauptstraße 1, Berlin': { lat: 52.52, lng: 13.40, country: 'Germany' },
  'Seestraße 9, Berlin': { lat: 52.55, lng: 13.35, country: 'Germany' },
  Hamburg: { lat: 53.55, lng: 9.99, country: 'Germany' },
  'Rue de Rivoli 5, Paris': { lat: 48.86, lng: 2.35, country: 'France' },
}
let asked = []
let geocoderDown = false
async function geocode(text) {
  asked.push(text)
  if (geocoderDown) throw new Error('timeout')
  return PLACES[text] ?? null
}
const sync = (extra = {}) => runBandeSync({ config, geocode, ...extra })

const friend = (id, name, fields = {}) => ({ id, name, nickname: null, city: null, address: null, archived: false, updated_at: '2026-11-01T10:00:00Z', ...fields })
const person = (friendId) => db.prepare('SELECT * FROM persons WHERE bande_friend_id=?').get(friendId)
const markerOf = (p) => db.prepare('SELECT * FROM markers WHERE id=?').get(p.address_marker_id)
const collectionsOf = (markerId) => db.prepare('SELECT c.* FROM collections c JOIN marker_collections mc ON mc.collection_id=c.id WHERE mc.marker_id=?').all(markerId)

beforeEach(() => {
  db.exec('DELETE FROM trip_waypoints; DELETE FROM markers; DELETE FROM persons; DELETE FROM collections; DELETE FROM app_settings; DELETE FROM bande_ignored; DELETE FROM geocode_cache')
  people = []
  asked = []
  geocoderDown = false
  bandeHasToken = true
})

test('the address text combines address and city, or falls back to the city', () => {
  assert.equal(placeText({ address: 'Hauptstraße 1', city: 'Berlin' }), 'Hauptstraße 1, Berlin')
  assert.equal(placeText({ address: 'Hauptstraße 1, 10115 Berlin', city: 'Berlin' }), 'Hauptstraße 1, 10115 Berlin')
  assert.equal(placeText({ address: '  ', city: 'Hamburg' }), 'Hamburg')
  assert.equal(placeText({ address: null, city: null }), null)
})

test('friends with an address are added with a pin in "Freunde"; others are left out', async () => {
  people = [
    friend(1, 'Anna Schmidt', { address: 'Hauptstraße 1', city: 'Berlin' }),
    friend(2, 'Ben', { city: 'Hamburg' }),
    friend(3, 'Carla Ohne Adresse'),
    friend(4, 'Dora Archiv', { city: 'Hamburg', archived: true }),
  ]
  const report = await sync()
  assert.deepEqual(report.added, ['Anna Schmidt', 'Ben'])
  assert.equal(report.skipped, 1)
  assert.deepEqual(report.errors, [])
  assert.equal(db.prepare('SELECT count(*) AS n FROM persons').get().n, 2)

  const anna = person(1)
  assert.equal(anna.first_name, 'Anna')
  assert.equal(anna.last_name, 'Schmidt')
  const pin = markerOf(anna)
  assert.deepEqual([pin.lat, pin.lng, pin.address, pin.country, pin.label, pin.source], [52.52, 13.40, 'Hauptstraße 1, Berlin', 'Germany', 'Anna Schmidt', 'bande'])
  assert.deepEqual(collectionsOf(pin.id).map((c) => c.name), ['Freunde'])
  assert.ok(db.prepare('SELECT 1 FROM marker_persons WHERE marker_id=? AND person_id=?').get(pin.id, anna.id))
  assert.equal(markerOf(person(2)).address, 'Hamburg')
  assert.equal(person(3), undefined)
  assert.equal(person(4), undefined)

  // The same list again changes nothing and asks the geocoder nothing
  asked = []
  const again = await sync()
  assert.deepEqual([again.added, again.moved, again.unchanged], [[], [], 2])
  assert.deepEqual(asked, [])
  assert.equal(db.prepare('SELECT count(*) AS n FROM markers').get().n, 2)
  assert.equal(bandeStatus(config).last.unchanged, 2)
})

test('an unlinked person with the same name is linked instead of duplicated, and keeps their pin', async () => {
  const own = saveMarker({ lat: 52.5, lng: 13.3, label: 'Annas Wohnung' })
  const anna = db.prepare("INSERT INTO persons (name, first_name, last_name, address_marker_id) VALUES ('anna schmidt', 'anna', 'schmidt', ?)").run(own.id).lastInsertRowid
  db.prepare("INSERT INTO persons (name, first_name) VALUES ('Ben', 'Ben')").run()
  people = [friend(1, 'Anna Schmidt', { address: 'Hauptstraße 1', city: 'Berlin' }), friend(2, 'BEN', { city: 'Hamburg' })]

  const report = await sync()
  assert.deepEqual(report.linked, ['Anna Schmidt', 'BEN'])
  assert.deepEqual(report.added, [])
  assert.equal(db.prepare('SELECT count(*) AS n FROM persons').get().n, 2)
  const linked = person(1)
  assert.equal(linked.id, Number(anna))
  assert.equal(linked.name, 'Anna Schmidt') // the name follows Bande
  assert.equal(linked.address_marker_id, own.id)
  assert.equal(markerOf(linked).lat, 52.5) // the own pin stays
  // Ben had no pin: he gets one
  assert.deepEqual(asked, ['Hamburg'])
  assert.equal(markerOf(person(2)).address, 'Hamburg')
})

test('a changed address moves the pin; an unchanged one keeps a pin moved by hand', async () => {
  people = [friend(1, 'Anna Schmidt', { address: 'Hauptstraße 1', city: 'Berlin' })]
  await sync()
  const pinId = person(1).address_marker_id

  // Moved by hand, and edited: Bande's unchanged address leaves all of it alone
  saveMarker({ lat: 52.6, lng: 13.5, label: 'Anna (Hinterhaus)', description: 'Klingel 3' }, pinId)
  asked = []
  let report = await sync()
  assert.deepEqual(asked, [])
  assert.equal(report.unchanged, 1)
  let pin = markerOf(person(1))
  assert.deepEqual([pin.lat, pin.lng, pin.label, pin.description], [52.6, 13.5, 'Anna (Hinterhaus)', 'Klingel 3'])

  // Anna moves in Bande: the same pin moves, the user's label and notes stay
  people = [friend(1, 'Anna Schmidt', { address: 'Seestraße 9', city: 'Berlin' })]
  report = await sync()
  assert.deepEqual(report.moved, ['Anna Schmidt'])
  pin = markerOf(person(1))
  assert.equal(pin.id, pinId)
  assert.deepEqual([pin.lat, pin.lng, pin.address, pin.label, pin.description], [52.55, 13.35, 'Seestraße 9, Berlin', 'Anna (Hinterhaus)', 'Klingel 3'])
})

test('a pin shared with another person is not moved; the friend gets a new one', async () => {
  people = [friend(1, 'Anna Schmidt', { address: 'Hauptstraße 1', city: 'Berlin' })]
  await sync()
  const shared = person(1).address_marker_id
  db.prepare("INSERT INTO persons (name, first_name, address_marker_id) VALUES ('Partner', 'Partner', ?)").run(shared)
  people = [friend(1, 'Anna Schmidt', { address: 'Seestraße 9', city: 'Berlin' })]
  await sync()
  assert.notEqual(person(1).address_marker_id, shared)
  assert.equal(db.prepare('SELECT lat FROM markers WHERE id=?').get(shared).lat, 52.52)
})

test('friends gone from Bande or archived stay, marked as no longer linked, and come back', async () => {
  people = [friend(1, 'Anna Schmidt', { address: 'Hauptstraße 1', city: 'Berlin' }), friend(2, 'Ben', { city: 'Hamburg' })]
  await sync()
  people = [friend(2, 'Ben', { city: 'Hamburg', archived: true })]
  const report = await sync()
  assert.deepEqual(report.gone.sort(), ['Anna Schmidt', 'Ben'])
  for (const id of [1, 2]) {
    assert.equal(person(id).bande_gone, 1)
    assert.ok(markerOf(person(id)), 'the pin stays')
  }
  // Said once, not on every sync
  assert.deepEqual((await sync()).gone, [])
  // Unarchived in Bande: linked again
  people = [friend(2, 'Ben', { city: 'Hamburg' })]
  assert.deepEqual((await sync()).linked, ['Ben'])
  assert.equal(person(2).bande_gone, 0)
})

test('names follow Bande', async () => {
  people = [friend(1, 'Anna Schmidt', { city: 'Hamburg' })]
  await sync()
  people = [friend(1, 'Anna Müller', { city: 'Hamburg' })]
  const report = await sync()
  assert.deepEqual(report.renamed, ['Anna Müller'])
  assert.deepEqual([person(1).name, person(1).first_name, person(1).last_name], ['Anna Müller', 'Anna', 'Müller'])
})

test('an address that is not found leaves the person without a pin and is reported', async () => {
  people = [friend(1, 'Anna Schmidt', { address: 'Nirgendwo 7' })]
  let report = await sync()
  assert.deepEqual(report.added, ['Anna Schmidt'])
  assert.deepEqual(report.not_found, [{ name: 'Anna Schmidt', address: 'Nirgendwo 7' }])
  assert.equal(person(1).address_marker_id, null)
  // Still reported on the next sync
  report = await sync()
  assert.deepEqual(report.not_found, [{ name: 'Anna Schmidt', address: 'Nirgendwo 7' }])
  // Fixed in Bande: placed
  people = [friend(1, 'Anna Schmidt', { address: 'Rue de Rivoli 5', city: 'Paris' })]
  report = await sync()
  assert.deepEqual(report.not_found, [])
  assert.equal(markerOf(person(1)).country, 'France')
})

test('a failing geocoder is an error, and the next sync tries again', async () => {
  people = [friend(1, 'Anna Schmidt', { address: 'Hauptstraße 1', city: 'Berlin' })]
  geocoderDown = true
  let report = await sync()
  assert.equal(report.errors.length, 1)
  assert.match(report.errors[0], /Anna Schmidt.*timeout/)
  assert.equal(person(1).address_marker_id, null)
  geocoderDown = false
  report = await sync()
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.moved, ['Anna Schmidt'])
  assert.ok(markerOf(person(1)))
})

test('a renamed "Freunde" collection keeps being used; a deleted person is not imported again', async () => {
  people = [friend(1, 'Anna Schmidt', { address: 'Hauptstraße 1', city: 'Berlin' })]
  await sync()
  const collection = collectionsOf(person(1).address_marker_id)[0]
  db.prepare("UPDATE collections SET name='Leute' WHERE id=?").run(collection.id)
  people.push(friend(2, 'Ben', { city: 'Hamburg' }))
  await sync()
  assert.deepEqual(collectionsOf(person(2).address_marker_id).map((c) => c.id), [collection.id])
  assert.equal(db.prepare('SELECT count(*) AS n FROM collections').get().n, 1)

  // Deleted through the API: remembered, so the next sync doesn't bring Ben back
  const { default: express } = await import('express')
  const { default: cookieParser } = await import('cookie-parser')
  const { default: jwt } = await import('jsonwebtoken')
  const { default: personRoutes } = await import('../routes/persons.js')
  db.exec('DELETE FROM users')
  db.prepare("INSERT INTO users (id, password_hash, session_version) VALUES (1, 'unused', 'v')").run()
  const app = express().use(express.json(), cookieParser()).use('/api/persons', personRoutes)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  try {
    const cookie = `mapper_token=${jwt.sign({ sub: 1, version: 'v' }, process.env.SESSION_SECRET)}`
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/persons/${person(2).id}`, { method: 'DELETE', headers: { Cookie: cookie } })
    assert.equal(res.status, 200)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
  const report = await sync()
  assert.deepEqual(report.added, [])
  assert.equal(person(2), undefined)
})

test('Bande refusing the token or having none is reported, and nothing changes', async () => {
  db.prepare("INSERT INTO persons (name, first_name, bande_friend_id) VALUES ('Anna', 'Anna', 1)").run()
  let report = await sync({ config: { ...config, token: 'wrong' } })
  assert.match(report.errors[0], /rejected the link token/)
  assert.equal(person(1).bande_gone, 0)
  bandeHasToken = false
  report = await sync()
  assert.match(report.errors[0], /no link token/)
  report = await sync({ config: { ...config, url: 'http://127.0.0.1:1' } })
  assert.match(report.errors[0], /can’t be reached/)
})

test('without BANDE_URL and token the import is off', () => {
  assert.equal(bandeConfig({}).enabled, false)
  assert.equal(bandeConfig({ BANDE_URL: 'http://bande:3000' }).enabled, false)
  assert.deepEqual(bandeStatus(bandeConfig({})), { enabled: false })
  assert.equal(bandeConfig({ BANDE_URL: 'http://bande:3000', BANDE_LINK_TOKEN: 'x' }).hours, 6)
  assert.equal(bandeConfig({ BANDE_URL: 'http://bande:3000', BANDE_LINK_TOKEN: 'x', BANDE_SYNC_HOURS: '12' }).hours, 12)
})

test('the Nominatim geocoder sends a User-Agent, waits between requests and caches by query', async () => {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url: new URL(url), at: Date.now(), agent: init.headers['User-Agent'] })
    const q = new URL(url).searchParams.get('q')
    const body = q === 'Hamburg' ? [{ lat: '53.55', lon: '9.99', display_name: 'Hamburg, Deutschland', address: { country_code: 'de' } }] : []
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
  }
  const lookup = createGeocoder({ fetch, minIntervalMs: 120 })
  const [a, b] = await Promise.all([lookup('Hamburg'), lookup('Atlantis')])
  assert.deepEqual(a, { lat: 53.55, lng: 9.99, country: 'Germany' })
  assert.equal(b, null)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].agent, 'Fernweh (self-hosted)')
  assert.equal(calls[0].url.searchParams.get('format'), 'jsonv2')
  assert.ok(calls[1].at - calls[0].at >= 110, 'one request at a time, with a pause')
  // Cached, found or not
  assert.deepEqual(await lookup('  Hamburg '), a)
  assert.equal(await lookup('Atlantis'), null)
  assert.equal(calls.length, 2)
  // An error is not cached
  const failing = createGeocoder({ fetch: async () => new Response('busy', { status: 503 }), minIntervalMs: 0 })
  await assert.rejects(failing('Berlin'), /HTTP 503/)
  assert.equal(db.prepare("SELECT count(*) AS n FROM geocode_cache WHERE query='Berlin'").get().n, 0)
})
