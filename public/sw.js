// Offline support. Nothing here talks to a server at runtime — the document lives in
// localStorage/IndexedDB — so a cached shell is the whole working editor: dictionaries,
// fonts and the WASM speller included, each kept the first time it is asked for.

const CACHE = 'edentext-v4';
// The entry document under one key, whichever path asked for it. Relative, so it
// resolves against this script's own directory — the app root under any base path.
const SHELL = './';

// The build's asset names carry a content hash, and the entry document is the only
// place they are written down — so reading them out of it precaches the shell with no
// build step. What the app loads later (the speller, a dictionary, a picture decoder)
// is kept as it is asked for, which is from the **second** visit on: on the first the
// worker is still installing while those requests go out. The document is stored last,
// so a cached one never names an asset the cache lacks.
async function precache(cache, mode = 'reload') {
  const response = await fetch(SHELL, { cache: mode });
  if (!response.ok || response.type !== 'basic') throw new Error('no shell');
  const html = await response.clone().text();
  const assets = [...html.matchAll(/"(\.?\/assets\/[^"]+)"/g)].map((m) => m[1]);
  const wanted = [...new Set(assets), './favicon.svg', './manifest.webmanifest'];
  const missing = [];
  for (const url of wanted) if (!(await cache.match(url, { ignoreVary: true }))) missing.push(url);
  await cache.addAll(missing);
  await cache.put(SHELL, response);
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

// Only the app's own entry is the shell; another page opened here (the licence list) is
// fetched and cached as an asset, so it can never stand in for the editor.
const isShell = (url) => {
  const root = new URL(SHELL, self.location).pathname;
  const { pathname } = new URL(url);
  return pathname === root || pathname === `${root}index.html`;
};

// The cached document answers at once, so a start waits for no network; the network's
// copy and the assets it names are stored behind it, and a new release shows from the
// start after. Without a cached one the network answers.
async function documentFrom(event) {
  const { request } = event;
  const cached = await caches.match(SHELL, { ignoreVary: true });
  if (cached) {
    event.waitUntil(caches.open(CACHE).then((cache) => precache(cache, 'no-cache')).catch(() => {}));
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') (await caches.open(CACHE)).put(SHELL, response.clone());
    return response;
  } catch {
    throw new Error('offline and no cached shell');
  }
}

// The build's own files carry a content hash, so a cached one can never be stale and is
// served first. The rest (dictionaries, embed.js, the manifest) keep their names across
// releases: the cached copy answers at once and the network refreshes it for next time.
// ponytail: the cache is never version-swept, so a redeploy's old assets stay in it
// until the browser evicts them. Sweeping needs the build id, which needs a build step.
async function assetFrom(event) {
  const { request } = event;
  const refresh = () => fetch(request).then(async (response) => {
    // An opaque response hides its status, so only a real same-origin one is kept.
    if (response.ok && response.type === 'basic') await (await caches.open(CACHE)).put(request, response.clone());
    return response;
  });
  // ignoreVary: a precached asset was fetched without the page's `Origin`, and a
  // static server that answers `Vary: Origin` would make the two never match.
  const cached = await caches.match(request, { ignoreVary: true });
  if (!cached) return refresh();
  if (!new URL(request.url).pathname.includes('/assets/')) event.waitUntil(refresh().catch(() => {}));
  return cached;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  // A request that asks to revalidate (embed.config.json) means it: no cached answer.
  if (['no-cache', 'no-store', 'reload'].includes(request.cache)) return;
  if (new URL(request.url).origin !== self.location.origin) return;
  // The installation's presets are never kept: a changed file holds from the next start.
  if (new URL(request.url).pathname.endsWith('/edentext.config.json')) return;
  event.respondWith(request.mode === 'navigate' && isShell(request.url) ? documentFrom(event) : assetFrom(event));
});
