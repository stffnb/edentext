// Offline support. Nothing here talks to a server at runtime — the document lives in
// localStorage/IndexedDB — so a cached shell is the whole working editor: dictionaries,
// fonts and the WASM speller included, each kept the first time it is asked for.

const CACHE = 'edentext-v1';
// The entry document under one key, whichever path asked for it.
const SHELL = '/';

// The build's asset names carry a content hash, and the entry document is the only
// place they are written down — so reading them out of it precaches the shell with no
// build step. What the app loads later (the speller, a dictionary, a picture decoder)
// is kept as it is asked for, which is from the **second** visit on: on the first the
// worker is still installing while those requests go out.
async function precache(cache) {
  const response = await fetch(SHELL, { cache: 'reload' });
  await cache.put(SHELL, response.clone());
  const html = await response.text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  await cache.addAll([...new Set(assets), '/favicon.svg', '/manifest.webmanifest']);
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(precache).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The document is network-first: served from the cache it would keep naming the assets
// of the build it was cached with, and a new one would never be fetched.
async function documentFrom(request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(CACHE)).put(SHELL, response.clone());
    return response;
  } catch {
    const cached = await caches.match(SHELL, { ignoreVary: true });
    if (cached) return cached;
    throw new Error('offline and no cached shell');
  }
}

// Everything else is cache-first: the build's own files carry a content hash, so a
// cached one can never be stale.
// ponytail: the cache is never version-swept, so a redeploy's old assets stay in it
// until the browser evicts them. Sweeping needs the build id, which needs a build step.
async function assetFrom(request) {
  // ignoreVary: a precached asset was fetched without the page's `Origin`, and a
  // static server that answers `Vary: Origin` would make the two never match.
  const cached = await caches.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  // An opaque response hides its status, so only a real same-origin one is kept.
  if (response.ok && response.type === 'basic') (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(request.mode === 'navigate' ? documentFrom(request) : assetFrom(request));
});
