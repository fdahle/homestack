// Signing in through the homestack login (Authelia in front, AUTH_PROXY_SECRET set), against the
// real app (api/index.js). The secret is read on every request, so the tests switch it.
import test, { before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.MAPPER_DB_PATH = ':memory:'
process.env.SESSION_SECRET = 'proxy-test-secret-'.repeat(3)
process.env.PORT = '0'
delete process.env.AUTH_PROXY_SECRET
delete process.env.LEUTE_URL
const { server } = await import('../index.js')
const { default: db } = await import('../db.js')

const SECRET = 'the-shared-secret-from-nginx'
let base
before(async () => {
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) })
afterEach(() => { delete process.env.AUTH_PROXY_SECRET })

async function call(path, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  let data = null
  try { data = await res.json() } catch { /* not JSON */ }
  return { status: res.status, data, cookie: res.headers.get('set-cookie') }
}
const viaProxy = (secret = SECRET, user = 'felix') => ({ 'X-Auth-Proxy-Secret': secret, ...(user ? { 'Remote-User': user } : {}) })

test('without AUTH_PROXY_SECRET the own password login works as before and proxy headers mean nothing', async () => {
  assert.deepEqual((await call('/api/auth/config')).data, { setupRequired: true, proxyLogin: false })
  assert.equal((await call('/api/markers', { headers: viaProxy() })).status, 401)
  const setup = await call('/api/auth/setup', { method: 'POST', body: { password: 'a-long-enough-password' } })
  assert.equal(setup.status, 200)
  const cookie = setup.cookie.split(';')[0]
  assert.equal((await call('/api/markers', { headers: { Cookie: cookie } })).status, 200)
  assert.equal((await call('/api/auth/me', { headers: { Cookie: cookie } })).data.viaProxy, false)
})

test('with AUTH_PROXY_SECRET only the right secret together with Remote-User gets in', async () => {
  process.env.AUTH_PROXY_SECRET = SECRET
  assert.equal((await call('/api/markers')).status, 403)
  assert.equal((await call('/api/markers', { headers: viaProxy('wrong') })).status, 403)
  assert.equal((await call('/api/markers', { headers: viaProxy(SECRET + 'x') })).status, 403)
  assert.equal((await call('/api/markers', { headers: { 'Remote-User': 'felix' } })).status, 403)
  assert.equal((await call('/api/markers', { headers: viaProxy(SECRET, null) })).status, 403)
  const ok = await call('/api/markers', { headers: viaProxy() })
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.data, [])
  assert.equal((await call('/api/auth/me', { headers: viaProxy() })).data.viaProxy, true)
  // Writes work as the single owner
  const created = await call('/api/markers', { method: 'POST', headers: viaProxy(), body: { lat: 52, lng: 13, label: 'Via proxy' } })
  assert.equal(created.status, 201)
})

test('behind the proxy a session cookie alone is not enough, and password routes are closed', async () => {
  // A cookie from before the switch (the account from the first test)
  const user = db.prepare('SELECT id, session_version FROM users').get()
  const { setAuthCookie } = await import('../utils/session.js')
  let header = ''
  setAuthCookie({ setHeader: (_k, v) => { header = v } }, { sub: user.id, version: user.session_version })
  const cookie = header.split(';')[0]
  assert.equal((await call('/api/markers', { headers: { Cookie: cookie } })).status, 200)

  process.env.AUTH_PROXY_SECRET = SECRET
  assert.equal((await call('/api/markers', { headers: { Cookie: cookie } })).status, 403)
  assert.deepEqual((await call('/api/auth/config')).data, { setupRequired: false, proxyLogin: true })
  for (const path of ['/api/auth/login', '/api/auth/setup', '/api/auth/logout', '/api/auth/logout-all', '/api/auth/change-password']) {
    assert.equal((await call(path, { method: 'POST', headers: viaProxy(), body: { password: 'a-long-enough-password' } })).status, 400, path)
  }
})

test('share links and the health check stay public behind the proxy', async () => {
  process.env.AUTH_PROXY_SECRET = SECRET
  const marker = (await call('/api/markers', { method: 'POST', headers: viaProxy(), body: { lat: 48, lng: 11, label: 'Shared' } })).data
  const share = await call('/api/share-links', { method: 'POST', headers: viaProxy(), body: { filter: { markers: [marker.id] } } })
  assert.equal(share.status, 201)
  // No secret, no user: Authelia lets these through without a login (deploy/authelia.yml)
  const data = await call(`/api/public/share/${share.data.token}/data`)
  assert.equal(data.status, 200)
  assert.deepEqual(data.data.markers.map((m) => m.label), ['Shared'])
  assert.equal((await call('/api/health')).status, 200)
  assert.equal((await call('/api/leute')).status, 403)
  assert.deepEqual((await call('/api/leute', { headers: viaProxy() })).data, { enabled: false })
})
