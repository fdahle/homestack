import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import express from 'express'
import cookieParser from 'cookie-parser'
import jwt from 'jsonwebtoken'
import { initializeDatabase } from '../schema.js'

process.env.MAPPER_DB_PATH = ':memory:'
process.env.SESSION_SECRET = 'regression-test-secret-'.repeat(3)
const { default: db } = await import('../db.js')
const app = express()
app.use(express.json(), cookieParser())
for (const [path, file] of [['markers','markers'],['categories','categories'],['collections','collections'],['persons','persons'],['backup','backup'],['auth','auth'],['share-links','shareLinks'],['public/share','publicShare']]) app.use('/api/' + path, (await import('../routes/' + file + '.js')).default)
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }))
let server, origin, token
before(async () => {
  server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
})
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close() })
beforeEach(() => {
  db.exec('DELETE FROM share_links; DELETE FROM trip_waypoints; DELETE FROM markers; DELETE FROM persons; DELETE FROM categories; DELETE FROM collections; DELETE FROM users')
  db.prepare('INSERT INTO users (id,password_hash,session_version) VALUES (1,?,?)').run('unused', 'test-version')
  token = jwt.sign({ sub: 1, version: 'test-version' }, process.env.SESSION_SECRET)
})
async function request(path, method = 'GET', body, cookie = token) {
  const res = await fetch(origin + '/api/' + path, { method, headers: { 'Content-Type': 'application/json', Cookie: `mapper_token=${cookie}` }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.match(/mapper_token=([^;]+)/)?.[1] }
}
const marker = { lat: 52, lng: 5, label: 'Place', country: 'Netherlands', planned_at: '2026-10-01', rating: 5, external_url: 'https://example.com', use_coords: true, source: 'csv' }
async function createTrip() { return (await request('collections', 'POST', { name: 'Trip', is_trip: true })).data }

test('partial updates preserve fields and trip positions; null explicitly clears a field', async () => {
  const trip = await createTrip()
  const initial = (await request('markers', 'POST', { ...marker, collection_ids: [trip.id], collection_positions: { [trip.id]: 1 } })).data
  const updated = await request('markers/' + initial.id, 'PUT', { label: 'Edited', collection_ids: [trip.id] })
  assert.equal(updated.status, 200)
  for (const key of ['country', 'planned_at', 'rating', 'external_url', 'use_coords', 'source']) assert.equal(updated.data[key], initial[key])
  assert.equal(updated.data.collections[0].position, 1)
  const cleared = await request('markers/' + initial.id, 'PATCH', { country: null, image_url: 'https://example.com/photo.jpg' })
  assert.equal(cleared.data.country, null)
  assert.equal(cleared.data.rating, 5)
})

test('invalid relationships never insert or partially update markers', async () => {
  assert.equal((await request('markers', 'POST', { ...marker, category_ids: [99999] })).status, 400)
  assert.equal((await request('markers')).data.length, 0)
  const initial = (await request('markers', 'POST', marker)).data
  assert.equal((await request('markers/' + initial.id, 'PATCH', { label: 'Must roll back', person_ids: [99999] })).status, 400)
  assert.equal((await request('markers')).data[0].label, 'Place')
})

test('a database error after marker insertion rolls back the complete write', async () => {
  const category = (await request('categories', 'POST', { name: 'Category' })).data
  db.exec("CREATE TRIGGER fail_link BEFORE INSERT ON marker_categories BEGIN SELECT RAISE(ABORT, 'simulated failure'); END")
  try {
    assert.equal((await request('markers', 'POST', { ...marker, category_ids: [category.id] })).status, 500)
    assert.equal((await request('markers')).data.length, 0)
  } finally { db.exec('DROP TRIGGER fail_link') }
})

test('backup round-trip retains marker fields, relations, addresses and waypoints', async () => {
  const trip = await createTrip()
  const category = (await request('categories', 'POST', { name: 'Museum' })).data
  const a = (await request('markers', 'POST', { ...marker, category_ids: [category.id], collection_ids: [trip.id], collection_positions: { [trip.id]: 1 } })).data
  const b = (await request('markers', 'POST', { ...marker, label: 'Second', collection_ids: [trip.id], collection_positions: { [trip.id]: 2 } })).data
  const person = (await request('persons', 'POST', { first_name: 'Review', last_name: 'Person', address_marker_id: a.id })).data
  await request('markers/' + a.id, 'PATCH', { person_ids: [person.id] })
  await request(`collections/${trip.id}/segments/${a.id}/${b.id}`, 'PUT', { mode: 'bike', via_points: [{ lat: 51, lng: 4 }] })
  const backup = (await request('backup')).data
  assert.equal(backup.version, 2)
  assert.equal((await request('backup/restore', 'POST', backup)).status, 200)
  const restored = (await request('markers')).data.find(m => m.label === 'Place')
  for (const key of ['lat', 'lng', 'country', 'planned_at', 'rating', 'external_url', 'source']) assert.equal(restored[key], marker[key])
  assert.equal(restored.use_coords, 1)
  assert.equal(restored.categories[0].name, 'Museum')
  assert.equal(restored.persons[0].name, 'Review Person')
  const persons = (await request('persons')).data
  assert.equal(persons[0].address_marker_id, restored.id)
  const segments = (await request(`collections/${restored.collections[0].id}/segments`)).data
  assert.equal(segments[0].mode, 'bike')
  assert.deepEqual(segments[0].via_points, [{ lat: 51, lng: 4 }])
})

test('invalid backups are rejected before replacing data', async () => {
  await request('markers', 'POST', marker)
  const backup = (await request('backup')).data
  for (const patch of [{ lat: 100 }, { planned_at: '2026-02-30' }, { category_ids: [99999] }]) {
    const bad = structuredClone(backup)
    Object.assign(bad.markers[0], patch)
    assert.equal((await request('backup/restore', 'POST', bad)).status, 400)
    assert.equal((await request('markers')).data[0].label, 'Place')
  }
})

test('trip updates validate the final positions and save modes atomically', async () => {
  const trip = await createTrip()
  const a = (await request('markers', 'POST', { ...marker, collection_ids: [trip.id], collection_positions: { [trip.id]: 1 } })).data
  const b = (await request('markers', 'POST', { ...marker, collection_ids: [trip.id], collection_positions: { [trip.id]: 2 } })).data
  assert.equal((await request(`collections/${trip.id}/positions`, 'PUT', { positions: [{ marker_id: a.id, position: 2 }] })).status, 400)
  const positions = [{ marker_id: a.id, position: 2 }, { marker_id: b.id, position: 1 }]
  const segment = { from_marker_id: b.id, to_marker_id: a.id, mode: 'bike', via_points: [] }
  assert.equal((await request(`collections/${trip.id}/route`, 'PUT', { positions, segments: [{ ...segment, via_points: [{ lat: 100, lng: 1 }] }] })).status, 400)
  assert.equal((await request('markers')).data.find(m => m.id === a.id).collections[0].position, 1)
  assert.equal((await request(`collections/${trip.id}/route`, 'PUT', { positions, segments: [segment] })).status, 200)
  assert.equal((await request(`collections/${trip.id}/segments`)).data[0].mode, 'bike')
})

test('setup is single-user under concurrency and old sessions fail after password change/reset', async () => {
  db.exec('DELETE FROM users')
  const password = 'review-password-alpha'
  const results = await Promise.all([request('auth/setup', 'POST', { password }, ''), request('auth/setup', 'POST', { password }, '')])
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409])
  assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 1)
  const old = results.find(r => r.status === 200).cookie
  const changed = await request('auth/change-password', 'POST', { currentPassword: password, newPassword: 'new-review-password' }, old)
  assert.equal(changed.status, 200)
  assert.equal((await request('markers', 'GET', undefined, old)).status, 401)
  assert.equal((await request('markers', 'GET', undefined, changed.cookie)).status, 200)
  db.exec('DELETE FROM users')
  assert.equal((await request('markers', 'GET', undefined, changed.cookie)).status, 401)
  await request('auth/setup', 'POST', { password }, '')
  assert.equal((await request('markers', 'GET', undefined, changed.cookie)).status, 401)
})

test('batch imports report valid and invalid rows and enforce a bound', async () => {
  const result = await request('markers/import', 'POST', { markers: [marker, { ...marker, lat: 100 }, { ...marker, label: 'Third' }] })
  assert.equal(result.status, 200)
  assert.equal(result.data.results[1].index, 1)
  assert.ok(result.data.results[1].error)
  assert.equal((await request('markers')).data.length, 2)
  assert.equal((await request('markers/import', 'POST', { markers: Array(101).fill(marker) })).status, 400)
})

test('public shares expose a fixed projection without private person address references', async () => {
  const saved = (await request('markers', 'POST', marker)).data
  const person = (await request('persons', 'POST', { first_name: 'Review', address_marker_id: saved.id })).data
  await request('markers/' + saved.id, 'PATCH', { person_ids: [person.id] })
  const share = (await request('share-links', 'POST', { filter: { markers: [saved.id] } })).data
  const data = (await request(`public/share/${share.token}/data`, 'GET', undefined, '')).data
  assert.equal(data.persons[0].first_name, 'Review')
  assert.equal(Object.hasOwn(data.persons[0], 'address_marker_id'), false)
  assert.equal(Object.hasOwn(data.markers[0].persons[0], 'address_marker_id'), false)
})

test('legacy trip migrations are transactional, preserve links and only run once', () => {
  for (const both of [false, true]) {
    const legacy = new DatabaseSync(':memory:')
    legacy.exec(`CREATE TABLE trips (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, start_date TEXT, end_date TEXT, color TEXT DEFAULT '#10b981'); INSERT INTO trips (id,name) VALUES (1,'Old trip');
      CREATE TABLE markers (id INTEGER PRIMARY KEY, lat REAL, lng REAL, label TEXT, description TEXT, category_id INTEGER, created_at TEXT DEFAULT (datetime('now')), visited_at TEXT); INSERT INTO markers (id,lat,lng) VALUES (1,52,5);
      CREATE TABLE marker_trips (marker_id INTEGER REFERENCES markers(id),trip_id INTEGER REFERENCES trips(id),position INTEGER); INSERT INTO marker_trips VALUES (1,1,1);`)
    if (both) legacy.exec("CREATE TABLE collections (id INTEGER PRIMARY KEY, name TEXT, description TEXT, start_date TEXT, end_date TEXT, color TEXT); INSERT INTO collections (id,name) VALUES (1,'New trip')")
    initializeDatabase(legacy)
    const old = legacy.prepare("SELECT * FROM collections WHERE name='Old trip'").get()
    assert.ok(old)
    assert.equal(legacy.prepare('SELECT collection_id FROM marker_collections WHERE marker_id=1').get().collection_id, old.id)
    const count = legacy.prepare('SELECT count(*) AS n FROM collections').get().n
    initializeDatabase(legacy)
    assert.equal(legacy.prepare('SELECT count(*) AS n FROM collections').get().n, count)
    assert.equal(legacy.prepare('PRAGMA foreign_key_check').all().length, 0)
    legacy.close()
  }
})

test('existing junction-table edits remain authoritative during migration and after restart', () => {
  const legacy = new DatabaseSync(':memory:')
  legacy.exec("CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, color TEXT); INSERT INTO categories VALUES (1,'Old','#123456'); CREATE TABLE markers (id INTEGER PRIMARY KEY, lat REAL, lng REAL, label TEXT, description TEXT,category_id INTEGER,created_at TEXT,visited_at TEXT); INSERT INTO markers (id,lat,lng,category_id) VALUES (1,52,5,1); CREATE TABLE marker_categories (marker_id INTEGER,category_id INTEGER, PRIMARY KEY(marker_id,category_id));")
  initializeDatabase(legacy)
  initializeDatabase(legacy)
  assert.equal(legacy.prepare('SELECT count(*) AS n FROM marker_categories').get().n, 0)
  assert.equal(legacy.prepare('SELECT category_id FROM markers').get().category_id, null)
  legacy.close()
})

test('legacy values stored before validation do not block unrelated edits', async () => {
  const saved = (await request('markers', 'POST', marker)).data
  db.prepare("UPDATE markers SET external_url='example.com', color='#fff', visited_at='2024-03-15T10:00:00Z' WHERE id=?").run(saved.id)
  const edited = await request('markers/' + saved.id, 'PATCH', { label: 'Renamed' })
  assert.equal(edited.status, 200)
  assert.equal((await request(`markers/${saved.id}/country`, 'PATCH', { country: 'Belgium' })).status, 200)
  assert.equal((await request('markers/' + saved.id, 'PATCH', { external_url: 'still not a url' })).status, 400)
})

test('migration 2 repairs legacy marker values and removes stale route segments', () => {
  const legacy = new DatabaseSync(':memory:')
  initializeDatabase(legacy)
  legacy.exec(`DELETE FROM schema_migrations WHERE version=2;
    INSERT INTO collections (id,name,is_trip) VALUES (1,'Trip',1),(2,'Former trip',0);
    INSERT INTO markers (id,lat,lng,color,external_url,visited_at,planned_at,rating) VALUES
      (1,52,5,'#abc','example.com/page','2024-03-15T10:00:00Z','15.03.2025',7),
      (2,52,5,'red','not a url','someday','never',3),
      (3,52,5,NULL,'https://ok.example/',NULL,NULL,NULL);
    INSERT INTO marker_collections VALUES (1,1,1),(2,1,2),(1,2,NULL),(2,2,NULL);
    INSERT INTO trip_waypoints (collection_id,from_marker_id,to_marker_id) VALUES (1,1,2),(1,1,3),(2,1,2);`)
  initializeDatabase(legacy)
  const rows = legacy.prepare('SELECT * FROM markers ORDER BY id').all()
  assert.deepEqual([rows[0].color, rows[0].external_url, rows[0].visited_at, rows[0].planned_at, rows[0].rating], ['#aabbcc', 'https://example.com/page', '2024-03-15', '2025-03-15', null])
  assert.deepEqual([rows[1].color, rows[1].external_url, rows[1].visited_at, rows[1].planned_at, rows[1].rating], [null, null, 'yes', null, 3])
  assert.equal(rows[2].external_url, 'https://ok.example/')
  assert.deepEqual(legacy.prepare('SELECT collection_id, to_marker_id FROM trip_waypoints').all().map(r => ({ ...r })), [{ collection_id: 1, to_marker_id: 2 }])
  legacy.close()
})

test('backups with stale route segments or legacy formats still restore', async () => {
  const trip = await createTrip()
  const a = (await request('markers', 'POST', { ...marker, collection_ids: [trip.id], collection_positions: { [trip.id]: 1 } })).data
  const b = (await request('markers', 'POST', { ...marker, label: 'B', collection_ids: [trip.id], collection_positions: { [trip.id]: 2 } })).data
  await request(`collections/${trip.id}/segments/${a.id}/${b.id}`, 'PUT', { mode: 'bike', via_points: [] })
  await request('collections/' + trip.id, 'PUT', { name: 'Trip', is_trip: false })
  assert.equal(db.prepare('SELECT count(*) AS n FROM trip_waypoints').get().n, 0)
  const backup = (await request('backup')).data
  backup.trip_waypoints.push({ collection_id: trip.id, from_marker_id: a.id, to_marker_id: b.id, mode: 'walk', via_points: '[]' })
  backup.markers[0].color = '#fff'
  backup.markers[0].visited_at = '2024-03-15T10:00:00Z'
  const restored = await request('backup/restore', 'POST', backup)
  assert.equal(restored.status, 200)
  assert.ok((await request('markers')).data.some(m => m.color === '#ffffff' && m.visited_at === '2024-03-15'))
  backup.markers[0].external_url = 'not a url'
  const rejected = await request('backup/restore', 'POST', backup)
  assert.equal(rejected.status, 400)
  assert.match(rejected.data.error, /markers #1/)
})

test('share links: date-only expiry lasts the whole day, passwords travel in the body and lock out guessing', async () => {
  const { shareExpired } = await import('../utils/validation.js')
  assert.equal(shareExpired('2026-10-04', Date.parse('2026-10-04T23:00:00+02:00')), false)
  assert.equal(shareExpired('2026-10-03', Date.parse('2026-10-05T12:00:00Z')), true)
  assert.equal(shareExpired('2026-10-04T21:59:59.999Z', Date.parse('2026-10-04T22:00:00Z')), true)
  const saved = (await request('markers', 'POST', marker)).data
  assert.equal((await request('share-links', 'POST', { filter: { markers: [saved.id] }, password: '12345' })).status, 400)
  const password = 'Пароль-äöü'
  const share = (await request('share-links', 'POST', { filter: { markers: [saved.id] }, password })).data
  assert.equal((await request(`public/share/${share.token}/data`, 'GET', undefined, '')).status, 401)
  assert.equal((await request(`public/share/${share.token}/data`, 'POST', { password }, '')).data.markers.length, 1)
  for (let i = 0; i < 10; i++) assert.equal((await request(`public/share/${share.token}/data`, 'POST', { password: 'wrong-guess' }, '')).status, 403)
  assert.equal((await request(`public/share/${share.token}/data`, 'POST', { password }, '')).status, 429)
})

test('public shares include route segments of shared trips between shared markers only', async () => {
  const trip = await createTrip()
  const ids = []
  for (const position of [1, 2, 3]) ids.push((await request('markers', 'POST', { ...marker, label: 'Stop ' + position, collection_ids: [trip.id], collection_positions: { [trip.id]: position } })).data.id)
  await request(`collections/${trip.id}/segments/${ids[0]}/${ids[1]}`, 'PUT', { mode: 'bike', via_points: [{ lat: 52.1, lng: 5.1 }] })
  await request(`collections/${trip.id}/segments/${ids[1]}/${ids[2]}`, 'PUT', { mode: 'drive', via_points: [] })
  const share = (await request('share-links', 'POST', { filter: { markers: [ids[0], ids[1]] } })).data
  const data = (await request(`public/share/${share.token}/data`, 'GET', undefined, '')).data
  assert.equal(data.segments.length, 1)
  assert.deepEqual(data.segments[0].via_points, [{ lat: 52.1, lng: 5.1 }])
  assert.equal(data.segments[0].mode, 'bike')
})

test('signing out everywhere revokes every existing session', async () => {
  const other = token
  const result = await request('auth/logout-all', 'POST', {})
  assert.equal(result.status, 200)
  assert.equal((await request('markers', 'GET', undefined, other)).status, 401)
})

test('the complete database can be downloaded as a consistent SQLite snapshot', async () => {
  await request('markers', 'POST', marker)
  const res = await fetch(origin + '/api/backup/database', { headers: { Cookie: `mapper_token=${token}` } })
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-disposition'), /attachment; filename="mapper-\d{4}-\d{2}-\d{2}\.db"/)
  const bytes = Buffer.from(await res.arrayBuffer())
  assert.equal(bytes.subarray(0, 15).toString(), 'SQLite format 3')
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'mapper-test-'))
  writeFileSync(join(dir, 'copy.db'), bytes)
  const copy = new DatabaseSync(join(dir, 'copy.db'))
  assert.equal(copy.prepare('SELECT label FROM markers').get().label, 'Place')
  assert.equal(copy.prepare('SELECT count(*) AS n FROM users').get().n, 1)
  copy.close()
  rmSync(dir, { recursive: true, force: true })
  assert.equal((await request('backup/database', 'GET', undefined, '')).status, 401)
})
