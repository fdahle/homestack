// Only here so the app is installable (needed for the Android share target).
// No offline caching: the list should always be the server's current state.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
