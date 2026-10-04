// Shared Nominatim access. The usage policy allows at most one request per second per client,
// so every caller goes through one queue, and repeated lookups are answered from a small cache.
const BASE = 'https://nominatim.openstreetmap.org'
const MIN_INTERVAL_MS = 1100
const CACHE_SIZE = 300

const cache = new Map()
let queue = Promise.resolve()
let lastRequest = 0

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
  })
}

export async function nominatim(endpoint, params, { signal } = {}) {
  const url = `${BASE}/${endpoint}?${new URLSearchParams({ format: 'json', ...params })}`
  if (cache.has(url)) {
    const hit = cache.get(url)
    cache.delete(url)
    cache.set(url, hit)
    return hit
  }
  const run = async () => {
    signal?.throwIfAborted()
    await wait(Math.max(0, lastRequest + MIN_INTERVAL_MS - Date.now()), signal)
    lastRequest = Date.now()
    const res = await fetch(url, { signal })
    if (!res.ok) throw new Error(`Nominatim ${res.status}`)
    return res.json()
  }
  const result = queue.then(run, run)
  queue = result.catch(() => {})
  const data = await result
  cache.set(url, data)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value)
  return data
}

// Coordinates are rounded to ~10 cm so the same spot hits the cache.
export function reverseGeocode(lat, lng, params = {}, options) {
  return nominatim('reverse', { lat: Number(lat).toFixed(6), lon: Number(lng).toFixed(6), ...params }, options)
}

export function formatAddress(a, fallback = '') {
  if (!a) return fallback
  const street = [a.house_number, a.road].filter(Boolean).join(' ')
  const city = a.city || a.town || a.village || a.hamlet || a.municipality
  const place = [a.postcode, city].filter(Boolean).join(' ')
  return [street, place, a.country].filter(Boolean).join(', ') || fallback
}

// Countries are stored by English name regardless of the browser language, so statistics group consistently.
const englishRegions = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null
export function countryName(address) {
  const code = address?.country_code?.toUpperCase()
  if (code && englishRegions) {
    try { return englishRegions.of(code) } catch { /* unknown code */ }
  }
  return address?.country ?? null
}
