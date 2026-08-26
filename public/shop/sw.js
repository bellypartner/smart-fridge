// Minimal by design: this is a live-payment app, so correctness matters far
// more than offline capability. We only cache the static shell (HTML/CSS/JS/
// icons) for fast repeat loads — every /api/ call always goes to the network.
const CACHE_NAME = "smart-fridge-shell-v1";
const SHELL_FILES = ["/shop/", "/shop/index.html", "/shop/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls, camera streams, or anything cross-origin (CDN scripts).
  if (url.pathname.startsWith("/api/") || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
