import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkOnly } from 'workbox-strategies'

// Replace precache manifest injected by vite-plugin-pwa
precacheAndRoute(self.__WB_MANIFEST)

// Clean up outdated caches from previous SW versions
cleanupOutdatedCaches()

// Never cache API calls or CouchDB sync — these must always hit the network.
// PouchDB handles its own offline strategy via IndexedDB.
registerRoute(({ url }) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/db/'), new NetworkOnly())

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// ─── Web Push ────────────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    // malformed payload — show generic notification
  }

  const title = data.title || 'Zettel reminder'
  const body  = data.body  || 'You have a task due.'
  const tag   = data.noteId ? `note-${data.noteId}` : 'zettel-reminder'
  const url   = data.noteId ? `/?open=${data.noteId}` : '/'

  const options = {
    body,
    tag,
    icon:   '/icon-192.png',
    badge:  '/icon-192.png',
    data:   { url },
    requireInteraction: false,
  }

  // After showing, tell open tabs to mark this key as fired so the local
  // poller doesn't show a duplicate notification.
  const firedKey = data.noteId && data.notificationAt
    ? `${data.noteId}::${data.notificationAt}`
    : null

  event.waitUntil(
    self.registration.showNotification(title, options).then(() => {
      if (!firedKey) return
      return self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then(clients => clients.forEach(c => c.postMessage({ type: 'NOTIFICATION_FIRED', key: firedKey })))
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing window if one is open
        for (const client of clientList) {
          const clientUrl = new URL(client.url)
          if (clientUrl.origin === self.location.origin && 'focus' in client) {
            client.navigate(targetUrl)
            return client.focus()
          }
        }
        // Otherwise open a new window
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl)
        }
      }),
  )
})
