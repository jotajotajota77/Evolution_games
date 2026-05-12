// Minimal service worker. Chrome's PWA install prompt requires a SW with a
// fetch event listener (even a pass-through one). We don't cache anything
// here — the simulation logic changes often and stale assets would surprise
// users. Static-asset caching can be added later if needed.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  // Pass through to the network. With no e.respondWith here Chrome may
  // not count this as a "with fetch handler" SW; the empty handler that
  // touches the event satisfies the requirement.
  e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
});
