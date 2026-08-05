/* Simplex service worker (phase 6d) — offline app shell.
   ---------------------------------------------------------------------------
   Update strategy, chosen against the stale-app trap:
   - NAVIGATIONS are network-first: while online, every reload gets the
     freshest index.html, which references the newest hashed assets — the
     installed app can never silently stay on an old version. Offline falls
     back to the cached shell.
   - HASHED ASSETS (/assets/*) are cache-first: their names change with
     content, so a cached copy is immutable by construction.
   - Everything else same-origin (icons, manifest) is stale-while-revalidate.
   - IndexedDB (autosave, recents) is untouched by design — the worker only
     ever handles GET requests.
   Offline capability starts with the SECOND visit (a worker only controls
   pages loaded after its installation) — normal PWA behavior.
   Bump CACHE when the caching logic itself changes.

   Base path (0.32.0): this file is served from Vite's base directory
   ('/' locally, /<repo>/app/ on GitHub Pages), so its OWN location IS the
   base — every path below roots there instead of hardcoding '/'. */

const BASE = new URL('./', self.location).pathname;
const CACHE = 'simplex-shell-v2'; // v2: paths learned the base directory
const CORE = [BASE, BASE + 'index.html', BASE + 'manifest.webmanifest', BASE + 'icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

/** Fetch, and on success store a copy in the shell cache. */
function fetchAndCache(request) {
  return fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetchAndCache(request).catch(() =>
        caches.match(request).then((cached) => cached ?? caches.match(BASE + 'index.html'))
      )
    );
    return;
  }

  if (url.pathname.startsWith(BASE + 'assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetchAndCache(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const refreshed = fetchAndCache(request).catch(() => cached);
      return cached ?? refreshed;
    })
  );
});
