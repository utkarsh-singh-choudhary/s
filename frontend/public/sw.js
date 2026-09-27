// Service worker for the technician mobile view.
//
// Scope is deliberately narrow: this is NOT a full offline-first app.
// It caches (a) the static app shell so /technician loads with no network,
// and (b) the last successful response for the handful of GET endpoints the
// technician screen needs, so a tech who lost signal mid-shift still sees
// their task list (as of the last sync) instead of a blank error page.
//
// Writes (PM completions, work-order updates) are NOT handled here — those
// go through the IndexedDB queue in lib/offline-queue.ts and are POSTed
// explicitly when connectivity returns. A service worker silently retrying
// a "complete PM" POST in the background is exactly the kind of surprise
// that erodes trust in an offline system; queued writes are visible to the
// user and synced deliberately instead.

const CACHE_VERSION = "pm-technician-v1";
const APP_SHELL = ["/technician", "/manifest.json", "/icon.svg"];

// GET endpoints worth serving stale-from-cache when offline. Keep this list
// short and specific to what the technician view actually needs.
const CACHEABLE_API_PATTERNS = [/\/api\/pm\/mine$/, /\/api\/work-orders\/mine$/, /\/api\/machines(\?.*)?$/];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isCacheableApiRequest(url) {
  return CACHEABLE_API_PATTERNS.some((pattern) => pattern.test(url.pathname + url.search));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never intercept writes

  const url = new URL(req.url);

  // Network-first, cache-fallback for the small set of API calls the
  // technician screen depends on.
  if (isCacheableApiRequest(url)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // The technician page itself: network-first (so a normal visit always
  // gets the current build), falling back to the cached shell when offline.
  if (url.origin === self.location.origin && url.pathname === "/technician") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Cache-first for content-hashed static assets and the small manifest —
  // safe to cache-first since these never change without a new URL.
  const isStaticAsset =
    url.pathname === "/manifest.json" ||
    url.pathname === "/icon.svg" ||
    url.pathname.startsWith("/_next/static/");

  if (url.origin === self.location.origin && isStaticAsset) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        });
      })
    );
  }
});
