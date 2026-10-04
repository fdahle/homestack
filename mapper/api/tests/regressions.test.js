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
