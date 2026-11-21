// Shared Nominatim access. The usage policy allows at most one request per second per client,
// so every caller goes through one queue, and repeated lookups are answered from a small cache.
import { fetchJson } from './fetchJson.js'

const BASE = 'https://nominatim.openstreetmap.org'
const MIN_INTERVAL_MS = 1100
const CACHE_SIZE = 300
// Without a deadline one stalled request would block the queue, and with it every later lookup.
const TIMEOUT_MS = 10000

const cache = new Map()
// url → { promise, ctrl, users }: identical lookups (e.g. the panel and the marker form) share one request
const inflight = new Map()
let queue = Promise.resolve()
let lastRequest = 0

const abortError = () => new DOMException('Aborted', 'AbortError')

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const onAbort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function request(url, endpoint) {
  const ctrl = new AbortController()
  const run = async () => {
    ctrl.signal.throwIfAborted()
    await wait(Math.max(0, lastRequest + MIN_INTERVAL_MS - Date.now()), ctrl.signal)
    lastRequest = Date.now()
    return fetchJson(url, { signal: ctrl.signal, timeoutMs: TIMEOUT_MS, label: 'Nominatim' })
  }
  const entry = { ctrl, users: 0 }
  entry.promise = queue.then(run, run)
    .then(data => {
      // Nothing found (e.g. a click at sea) comes back as 200 {"error": "Unable to geocode"}. Not cached:
      // the same answer can also mean a temporary problem.
      if (data && !Array.isArray(data) && data.error) return endpoint === 'reverse' ? null : []
      cache.set(url, data)
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value)
      return data
    })
    .finally(() => { if (inflight.get(url) === entry) inflight.delete(url) })
  queue = entry.promise.catch(() => {})
  inflight.set(url, entry)
  return entry
}

// Resolves to the parsed answer; "nothing found" is null for reverse and [] otherwise.
export async function nominatim(endpoint, params, { signal } = {}) {
  signal?.throwIfAborted()
  const url = `${BASE}/${endpoint}?${new URLSearchParams({ format: 'json', ...params })}`
  if (cache.has(url)) {
    const hit = cache.get(url)
    cache.delete(url)
    cache.set(url, hit)
    return hit
  }
  const entry = inflight.get(url) ?? request(url, endpoint)
  entry.users++
  if (!signal) return entry.promise
  // One caller cancelling must not cancel the others; the request itself stops once all have left.
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      if (--entry.users === 0) {
        if (inflight.get(url) === entry) inflight.delete(url)
        entry.ctrl.abort()
      }
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    entry.promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
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
