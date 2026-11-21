// Zettel's service worker: it keeps the app itself on the device, so it opens without a
// network. The notes are kept by the app (IndexedDB), not here. vite.config.js fills in the
// list of built files and the version when it builds dist/sw.js from this file.
//
// - Pages: from the network when there is one (so a login proxy can step in), else the kept copy.
// - The built files: kept per version; a new build brings a new version and drops the old one.
// - Attached files (/files/…): never change under their id, so once seen they're kept for offline.
// - /api: never touched, always the network.

const VERSION = '__VERSION__';
const FILES = __FILES__;
const APP_CACHE = `zettel-app-${VERSION}`;
const FILE_CACHE = 'zettel-files';

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
      if (key.startsWith('zettel-app-') && key !== APP_CACHE) await caches.delete(key);
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

async function kept(request, cacheName) {
  const cache = await caches.open(cacheName);
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
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') return event.respondWith(page(request));
  if (url.pathname.startsWith('/files/')) return event.respondWith(kept(request, FILE_CACHE));
  if (FILES.includes(url.pathname)) return event.respondWith(kept(request, APP_CACHE));
});
