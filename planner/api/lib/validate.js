// Shared input validators (kept dependency-free so they're easy to unit-test).

function validUsername(u) { return /^[a-z0-9_-]{3,32}$/.test(u || '') }

function validPassword(p) { return typeof p === 'string' && p.length >= 12 }

// A push endpoint is a URL the server will later POST to, so validate it to
// avoid being pointed at internal/loopback hosts (SSRF). Real push services are
// always public HTTPS endpoints.
function isValidPushEndpoint(endpoint) {
  let url
  try { url = new URL(endpoint) } catch { return false }
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return false
  // Block obvious private / loopback / link-local IPv4 literals.
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false
  // IPv6 loopback / unique-local (fc00::/7). Only applies to IPv6 literals
  // (which contain ':'), not hostnames like "fcm.googleapis.com".
  if (host.includes(':') && (host === '::1' || host.startsWith('fc') || host.startsWith('fd'))) return false
  return true
}

module.exports = { validUsername, validPassword, isValidPushEndpoint }
