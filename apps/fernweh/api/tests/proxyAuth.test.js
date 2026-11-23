// Signing in through the homestack login (Authelia in front, AUTH_PROXY_SECRET set), against the
// real app (api/index.js). The secret is read on every request, so the tests switch it.
import test, { before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.MAPPER_DB_PATH = ':memory:'
process.env.SESSION_SECRET = 'proxy-test-secret-'.repeat(3)
process.env.PORT = '0'
delete process.env.AUTH_PROXY_SECRET
delete process.env.STAMMTISCH_URL
const { server } = await import('../index.js')
const { default: db } = await import('../db.js')
const { announceSetupCode } = await import('../utils/setupCode.js')

const SECRET = 'the-shared-secret-from-nginx'
let base
before(async () => {
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) })
afterEach(() => { delete process.env.AUTH_PROXY_SECRET; delete process.env.AUTH_PROXY_USERS })

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
  // The code the server printed on start
  const setup = await call('/api/auth/setup', { method: 'POST', body: { password: 'a-long-enough-password', setupCode: announceSetupCode() } })
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

test('AUTH_PROXY_USERS lets only the listed names in, in any case', async () => {
  process.env.AUTH_PROXY_SECRET = SECRET
  process.env.AUTH_PROXY_USERS = ' Felix , anna'
  assert.equal((await call('/api/markers', { headers: viaProxy(SECRET, 'felix') })).status, 200)
  assert.equal((await call('/api/markers', { headers: viaProxy(SECRET, 'ANNA') })).status, 200)
  const other = await call('/api/markers', { headers: viaProxy(SECRET, 'mallory') })
  assert.equal(other.status, 403)
  assert.match(other.data.error, /AUTH_PROXY_USERS/)
  assert.equal((await call('/api/markers', { method: 'POST', headers: viaProxy(SECRET, 'mallory'), body: { lat: 1, lng: 1 } })).status, 403)
  process.env.AUTH_PROXY_USERS = ''
  assert.equal((await call('/api/markers', { headers: viaProxy(SECRET, 'mallory') })).status, 200)
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
  assert.equal((await call('/api/stammtisch')).status, 403)
  assert.deepEqual((await call('/api/stammtisch', { headers: viaProxy() })).data, { enabled: false })
})

test('writes from other origins are refused; same-origin, headerless and share-password requests pass', async () => {
  const user = db.prepare('SELECT id, session_version FROM users').get()
  const { setAuthCookie } = await import('../utils/session.js')
  let header = ''
  setAuthCookie({ setHeader: (_k, v) => { header = v } }, { sub: user.id, version: user.session_version })
  const cookie = header.split(';')[0]
  const host = new URL(base).host
  const restore = (headers) => call('/api/markers/trash/999999/restore', { method: 'POST', headers: { Cookie: cookie, ...headers } })
  // A sibling subdomain shares the site, so SameSite=Strict sends the cookie: refused here instead
  for (const headers of [{ 'Sec-Fetch-Site': 'same-site' }, { 'Sec-Fetch-Site': 'cross-site' }, { Origin: 'https://evil.fdahle.de' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'same-site', Origin: base }]) {
    const res = await restore(headers)
    assert.equal(res.status, 403, JSON.stringify(headers))
    assert.match(res.data.error, /other sites/)
  }
  assert.equal((await call('/api/auth/logout-all', { method: 'POST', headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-site' } })).status, 403)
  assert.equal((await call('/api/markers', { headers: { Cookie: cookie } })).status, 200, 'the session survived')
  // Same origin, typed into the address bar, or no browser at all: on to the route (404: no such trashed marker)
  for (const headers of [{ 'Sec-Fetch-Site': 'same-origin' }, { 'Sec-Fetch-Site': 'none' }, { Origin: `http://${host}` }, {}]) {
    assert.equal((await restore(headers)).status, 404, JSON.stringify(headers))
  }
  // Reading stays possible from anywhere the cookie goes; only writes are checked
  assert.equal((await call('/api/markers', { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } })).status, 200)
  // A share link's password may come from anywhere
  const marker = (await call('/api/markers', { method: 'POST', headers: { Cookie: cookie }, body: { lat: 1, lng: 2, label: 'Shared' } })).data
  const share = (await call('/api/share-links', { method: 'POST', headers: { Cookie: cookie }, body: { filter: { markers: [marker.id] }, password: 'a share password' } })).data
  assert.equal((await call(`/api/public/share/${share.token}/data`, { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' }, body: { password: 'a share password' } })).status, 200)
})
