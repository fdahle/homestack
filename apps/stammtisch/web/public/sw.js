// No offline caching: the data should always be the server's current state.
// The service worker shows push reminders and takes shares from other apps.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// The share target (manifest.webmanifest) POSTs the shared text here, so a WhatsApp chat never
// ends up in a URL (and so in proxy logs or a login redirect). It is kept in a cache for a moment
// and the page at /share picks it up (views/ShareView.vue). Every other request goes to the
// network as before. Without this worker the POST reaches the server, which sends you to /share.
const SHARE_CACHE = 'stammtisch-share'; // read by views/ShareView.vue too
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.origin !== self.location.origin || url.pathname !== '/share') return;
  event.respondWith((async () => {
    try {
      const form = await event.request.formData();
      const field = (name) => String(form.get(name) ?? '').slice(0, 100_000);
      const cache = await caches.open(SHARE_CACHE);
      await cache.put('/share/shared.json', new Response(JSON.stringify({ title: field('title'), text: field('text'), url: field('url') }), {
        headers: { 'Content-Type': 'application/json' },
      }));
    } catch {
      // Nothing kept: the page opens empty and the text can still be pasted
    }
    return Response.redirect(new URL('/share', self.location.origin).href, 303);
  })());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // shown with the defaults below
  }
  event.waitUntil(self.registration.showNotification(data.title || 'Stammtisch', {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.url || 'stammtisch',
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
