// No offline caching: the data should always be the server's current state.
// The service worker is only here so the app can be installed.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
