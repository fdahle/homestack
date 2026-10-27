import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { findGoogleMapsLink, parseGoogleMapsUrl, resolveGoogleMapsPlace } from '../src/utils/googleMaps.js'

const nativeFetch = globalThis.fetch
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
afterEach(() => { globalThis.fetch = nativeFetch })

// Expanded forms of real maps.app.goo.gl links.
const SHARED_FROM_DESKTOP = 'https://www.google.com/maps/place/Naka+Sushi/@35.831881,139.6412587,17.49z/data=!4m6!3m5!1s0x6018ea5b569b2b8f:0xc03fc1e2e25499d1!8m2!3d35.8324217!4d139.6404505!16s%2Fg%2F1tlndgnn?entry=tts'
const SHARED_FROM_PHONE = 'https://www.google.com/maps/place/Museo+Nacional+Centro+de+Arte+Reina+Sof%C3%ADa,+C.+de+Sta.+Isabel,+52,+Centro,+28012+Madrid,+Spain/data=!4m2!3m1!1s0xd422628db3a07bd:0x309814d159babf71?utm_source=mstt_1&entry=gps'

test('finds Google Maps links in shared text', () => {
  assert.equal(findGoogleMapsLink('Naka Sushi\nhttps://maps.app.goo.gl/nWx4HL35gqPhHrif8 '), 'https://maps.app.goo.gl/nWx4HL35gqPhHrif8')
  assert.equal(findGoogleMapsLink('https://goo.gl/maps/sXnse1erRvkA6aV99'), 'https://goo.gl/maps/sXnse1erRvkA6aV99')
  assert.equal(findGoogleMapsLink(SHARED_FROM_DESKTOP), SHARED_FROM_DESKTOP)
  assert.equal(findGoogleMapsLink('https://maps.google.de/?q=52.1,5.2'), 'https://maps.google.de/?q=52.1,5.2')
  for (const other of ['Bakery Amsterdam', 'https://www.google.com/search?q=maps', 'https://evil.example/maps.app.goo.gl/x', 'https://goo.gl/xyz']) {
    assert.equal(findGoogleMapsLink(other), null, other)
  }
})

test('reads the place pin, not the view centre, and the name from expanded links', () => {
  assert.deepEqual(parseGoogleMapsUrl(SHARED_FROM_DESKTOP), { lat: 35.8324217, lng: 139.6404505, text: 'Naka Sushi' })
  assert.deepEqual(parseGoogleMapsUrl(SHARED_FROM_PHONE), { lat: null, lng: null, text: 'Museo Nacional Centro de Arte Reina Sofía, C. de Sta. Isabel, 52, Centro, 28012 Madrid, Spain' })
  assert.deepEqual(parseGoogleMapsUrl('https://www.google.com/maps/search/5.811698,+-55.118891?entry=tts'), { lat: 5.811698, lng: -55.118891, text: null })
  assert.deepEqual(parseGoogleMapsUrl('https://www.google.com/maps/search/?api=1&query=47.5951518,-122.3316393'), { lat: 47.5951518, lng: -122.3316393, text: null })
  assert.deepEqual(parseGoogleMapsUrl('https://maps.google.com/?q=Bakkerij+Jan,+Markt+1,+Delft&ftid=0x1:0x2'), { lat: null, lng: null, text: 'Bakkerij Jan, Markt 1, Delft' })
  assert.deepEqual(parseGoogleMapsUrl('https://www.google.com/maps/@52.3731,4.8926,15z'), { lat: 52.3731, lng: 4.8926, text: null })
})

test('a short link is expanded by the API; coordinates are taken as they are', async () => {
  const calls = []
  globalThis.fetch = async (url) => { calls.push(String(url)); return response({ url: SHARED_FROM_DESKTOP }) }
  const place = await resolveGoogleMapsPlace('https://maps.app.goo.gl/nWx4HL35gqPhHrif8')
  assert.deepEqual(place, { lat: 35.8324217, lng: 139.6404505, name: 'Naka Sushi', approximate: false })
  assert.deepEqual(calls, ['/api/links/google-maps?url=' + encodeURIComponent('https://maps.app.goo.gl/nWx4HL35gqPhHrif8')])
})

test('a link without coordinates is found by its address, the name split off', async () => {
  const queries = []
  globalThis.fetch = async (url) => {
    const q = new URL(url).searchParams.get('q')
    queries.push(q)
    return response(q.startsWith('C. de Sta. Isabel') ? [{ lat: '40.4080495', lon: '-3.6944216' }] : [])
  }
  const place = await resolveGoogleMapsPlace(SHARED_FROM_PHONE)
  assert.deepEqual(place, { lat: 40.4080495, lng: -3.6944216, name: 'Museo Nacional Centro de Arte Reina Sofía', approximate: true })
  assert.deepEqual(queries, ['C. de Sta. Isabel, 52, Centro, 28012 Madrid, Spain'])
})

test('a short link that cannot be expanded reports why', async () => {
  globalThis.fetch = async () => response({ error: 'This Google Maps link doesn’t exist (anymore).' }, 404)
  await assert.rejects(resolveGoogleMapsPlace('https://maps.app.goo.gl/gone'), /doesn’t exist/)
})
