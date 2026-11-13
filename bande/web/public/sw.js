// No offline caching: the data should always be the server's current state.
// The service worker receives shares from other apps and shows push reminders.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Share target (manifest): text and WhatsApp chat exports arrive as a POST to /share.
// A file waits in the cache for the page; text goes along in the URL.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === '/share') event.respondWith(receiveShare(event.request));
});

async function receiveShare(request) {
  const params = new URLSearchParams();
  try {
    const form = await request.formData();
    for (const key of ['title', 'text', 'url']) {
      const value = form.get(key);
      if (typeof value === 'string' && value) params.set(`share_${key}`, value);
    }
    const file = form.getAll('files').find((f) => typeof f !== 'string' && f.size);
    if (file) {
      const cache = await caches.open('bande-share');
      await cache.put('/shared-file', new Response(file, {
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name || '') },
      }));
      params.set('file', '1');
    }
  } catch {
    params.set('lost', '1');
  }
  return Response.redirect(`/share?${params}`, 303);
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // shown with the defaults below
  }
  event.waitUntil(self.registration.showNotification(data.title || 'Bande', {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.url || 'bande',
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
