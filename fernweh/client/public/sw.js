// Service worker: makes the app installable and opens it quickly.
// - App pages: network first, falling back to the cached app shell (index.html) when offline.
// - Hashed build assets: cache first (their URLs change on every build); assets of older builds
//   are pruned whenever a new index.html arrives.
// - Icons and manifest: stale-while-revalidate, so a changed icon shows up on the next visit.
// - API calls, map tiles and other sites: never cached here.
const CACHE = 'fernweh-v1'
const STATIC = ['/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/', ...STATIC])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

const assetPaths = (html) => new Set([...html.matchAll(/["'(](\/assets\/[^"')\s]+)/g)].map((m) => m[1]))

// Stores a freshly fetched index.html as the offline shell. When it belongs to a new build, drop
// cached assets the new page does not reference (lazy chunks of the new build are re-cached as
// they load), so old builds do not pile up.
async function updateShell(response) {
  const cache = await caches.open(CACHE)
  const html = await response.clone().text()
  const previous = await cache.match('/')
  const changed = !previous || (await previous.text()) !== html
  await cache.put('/', response)
  if (!changed) return
  const keep = assetPaths(html)
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname
    if (path.startsWith('/assets/') && !keep.has(path)) await cache.delete(request)
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          // Only the app's HTML may become the shell: opening /icon-512.png or /sw.js directly
          // is a navigation too.
          const isHtml = (response.headers.get('Content-Type') || '').includes('text/html')
          if (response.ok && isHtml && !response.redirected) {
            try { await updateShell(response.clone()) } catch { /* caching is best effort */ }
          }
          return response
        })
        .catch(async () => (await caches.match('/')) || Response.error()),
    )
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })),
    )
    return
  }

  if (STATIC.includes(url.pathname)) {
    const refresh = fetch(request).then(async (response) => {
      if (response.ok) await (await caches.open(CACHE)).put(request, response.clone())
      return response
    })
    event.respondWith(caches.match(request).then((cached) => {
      if (cached) { event.waitUntil(refresh.catch(() => {})); return cached }
      return refresh
    }))
  }
})
