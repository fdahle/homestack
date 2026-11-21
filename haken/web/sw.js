// Haken's service worker: it keeps the app itself on the device, so it opens without a
// network, and shows the reminders. The tasks are kept by the app (IndexedDB), not here.
// vite.config.js fills in the list of built files and the version when it builds dist/sw.js.
//
// - Pages: from the network when there is one (so a login proxy can step in), else the kept copy.
// - The built files: kept per version; a new build brings a new version and drops the old one.
// - /api and /ics: never touched, always the network.

const VERSION = '__VERSION__';
const FILES = __FILES__;
const APP_CACHE = `haken-app-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await cache.addAll(FILES);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('haken-app-') && key !== APP_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function page(request) {
  try {
    return await fetch(request);
  } catch {
    return (await caches.match('/index.html', { cacheName: APP_CACHE })) || Response.error();
  }
}

async function kept(request) {
  const cache = await caches.open(APP_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/ics/')) return;
  if (request.mode === 'navigate') return event.respondWith(page(request));
  if (FILES.includes(url.pathname)) return event.respondWith(kept(request));
});

// --- reminders ---

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // shown with the defaults below
  }
  event.waitUntil(self.registration.showNotification(data.title || 'Haken', {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || data.url || 'haken',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => w.url.startsWith(self.location.origin));
    if (open) {
      await open.focus();
      return open.navigate(url);
    }
    return self.clients.openWindow(url);
  })());
});
