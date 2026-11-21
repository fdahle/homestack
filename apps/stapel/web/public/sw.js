// Only here so the app can be installed on a phone's home screen.
// No offline caching: the collection should always be the server's current state.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
