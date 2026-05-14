// Service worker. Required for Chrome's "install as app" prompt to surface
// (Chrome wants a SW with a fetch listener).
//
// v1.44: kept extremely passive — the previous version intercepted every
// request with cache: 'no-cache', which appears to have been blocking the
// PWA install flow on some devices (the "Instalando..." notification would
// hang indefinitely because the manifest or icon fetch never resolved). We
// now skip intercepting the manifest + icon entirely, and the fetch handler
// for the rest is a no-op — Chrome only needs the listener to *exist* for
// installability, it doesn't have to respond. The browser handles caching
// with normal HTTP headers.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Never intercept the manifest or icons: any error here can stall a
  // PWA install on Chrome.
  if (
    url.pathname.endsWith('/manifest.webmanifest') ||
    url.pathname.endsWith('/icon.svg')
  ) {
    return; // fall through to default browser handling
  }
  // For everything else, also fall through. The listener still exists so
  // PWA installability criteria are satisfied.
});
