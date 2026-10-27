import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

// Google Maps "Share" gives a short link (maps.app.goo.gl/…) that the browser cannot expand itself
// (no CORS), so the server follows its redirects. Only Google's short-link hosts are ever requested,
// so this cannot be used to reach other servers.
const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl'])
const MAX_HOPS = 5
const TIMEOUT_MS = 8000

export function isGoogleMapsUrl(url) {
  const google = /^(www\.|maps\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(url.hostname)
  return google && (url.hostname.startsWith('maps.') || url.pathname === '/maps' || url.pathname.startsWith('/maps/'))
}

router.get('/google-maps', async (req, res) => {
  let url
  try { url = new URL(String(req.query.url ?? '')) } catch { return res.status(400).json({ error: 'Not a valid link' }) }
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') break
    if (isGoogleMapsUrl(url)) return res.json({ url: url.href })
    // Visitors from the EU may be sent to the cookie banner first; the place is in its "continue" link.
    if (url.hostname === 'consent.google.com' && url.searchParams.has('continue')) {
      try { url = new URL(url.searchParams.get('continue')) } catch { break }
      continue
    }
    if (!SHORT_HOSTS.has(url.hostname) || hop === MAX_HOPS) break
    let response
    try {
      response = await fetch(url.href, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch {
      return res.status(502).json({ error: 'Google didn’t answer — try again shortly.' })
    }
    response.body?.cancel().catch(() => {})
    const location = response.headers.get('location')
    if (!location) return res.status(404).json({ error: 'This Google Maps link doesn’t exist (anymore).' })
    url = new URL(location, url)
  }
  res.status(400).json({ error: 'Not a Google Maps link' })
})

export default router
