// Shared input validators (kept dependency-free so they're easy to unit-test).

function validUsername(u) { return /^[a-z0-9_-]{3,32}$/.test(u || '') }

function validPassword(p) { return typeof p === 'string' && p.length >= 12 }

// A notes DB id is always a crypto.randomUUID() minted by the API. The user doc
// that stores it is writable by its owner through CouchDB, so every read must be
// checked before the id is used to build a database path with admin credentials.
function validDbId(id) {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
}

// A push endpoint is a URL the server will later POST to, so only accept the
// real browser push services (SSRF protection). Exact hosts or `.suffix` matches.
const PUSH_HOSTS = [
  'fcm.googleapis.com',           // Chrome, Edge (Chromium), Opera, Samsung
  'android.googleapis.com',       // legacy GCM endpoints
  '.push.services.mozilla.com',   // Firefox
  '.notify.windows.com',          // legacy Edge / Windows (WNS)
  'web.push.apple.com',           // Safari
  '.push.apple.com',
]

function isValidPushEndpoint(endpoint) {
  let url
  try { url = new URL(endpoint) } catch { return false }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false
  const host = url.hostname.toLowerCase()
  return PUSH_HOSTS.some(h => h.startsWith('.') ? host.endsWith(h) : host === h)
}

module.exports = { validUsername, validPassword, validDbId, isValidPushEndpoint }
