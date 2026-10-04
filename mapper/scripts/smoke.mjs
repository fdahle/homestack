import assert from 'node:assert/strict'
// Explicitly isolate storage and authentication before importing the application.
process.env.MAPPER_DB_PATH = ':memory:'
process.env.SESSION_SECRET = 'smoke-test-secret-'.repeat(4)
process.env.RESET_PASSWORD = ''
process.env.PORT = '0'
process.env.NODE_ENV = 'production'
const { server } = await import('../api/index.js')
if (!server.listening) await new Promise(resolve => server.once('listening', resolve))
const base = `http://localhost:${server.address().port}`
try {
  const page = await fetch(base)
  assert.equal(page.status, 200)
  assert.ok(page.headers.get('content-security-policy'))
  assert.equal(page.headers.get('referrer-policy'), 'strict-origin-when-cross-origin')
  assert.equal(page.headers.get('cache-control'), 'no-cache')
  const html = await page.text()
  const script = html.match(/src="([^"]+\.js)"/)[1]
  const asset = await fetch(base + script)
  assert.equal(asset.status, 200)
  assert.match(asset.headers.get('cache-control'), /immutable/)
  // An outdated chunk after a redeploy must fail loudly instead of returning index.html.
  assert.equal((await fetch(base + '/assets/MapView-outdated.js')).status, 404)
  assert.equal((await fetch(base + '/share/some-token')).status, 200)
  const oversized = JSON.stringify({ password: 'x'.repeat(3 * 1024 * 1024) })
  assert.equal((await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: oversized })).status, 413)
  assert.equal((await fetch(base + '/api/unknown')).status, 404)
  assert.equal((await fetch(base + '/api/markers')).status, 401)
  const setup = await fetch(base + '/api/auth/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'smoke-test-password' }) })
  assert.equal(setup.status, 200)
  assert.match(setup.headers.get('set-cookie'), /; Secure/)
  const cookie = setup.headers.get('set-cookie').split(';')[0]
  const markers = await fetch(base + '/api/markers', { headers: { Cookie: cookie } })
  assert.equal(markers.status, 200)
  assert.deepEqual(await markers.json(), [])
  console.log('Production HTTP smoke check passed: HTML/assets, caching, referrer policy, body limit, CSP, secure auth cookie, protected API and JSON 404.')
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
