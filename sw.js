// Service worker. Required for Chrome's "install as app" prompt to surface
// (Chrome wants a SW with a fetch listener). While the project moves fast
// we bypass the browser's HTTP cache by setting cache: 'no-cache' on every
// fetch — that still validates with ETag / Last-Modified so unchanged files
// don't re-download, but changed files always come back fresh.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = new Request(e.request, { cache: 'no-cache' });
  e.respondWith(
    fetch(req).catch(() => new Response('', { status: 503 })),
  );
});
