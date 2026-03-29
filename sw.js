// sw.js - Service Worker (FAKDU v9.46)

const SW_VERSION = '9.49.4';
const CACHE_NAME = `fakdu-cache-v${SW_VERSION}`;
const META_CACHE_NAME = `fakdu-cache-meta-v${SW_VERSION}`;
const CACHE_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
let lastCleanupAt = 0;
const EXTERNAL_CACHE_HOSTS = new Set([
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
]);

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './icon.png',
  './js/db.js',
  './js/core.js',
  './js/vault.js',
  './js/machine-id.js',
  './launchericon-48x48.png',
  './launchericon-72x72.png',
  './launchericon-96x96.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE)),
      caches.open(META_CACHE_NAME)
    ])
  );
  self.skipWaiting();
});

async function stampCacheEntry(request) {
  const metaCache = await caches.open(META_CACHE_NAME);
  await metaCache.put(request.url, new Response(String(Date.now())));
}

async function cleanupExpiredCacheEntries() {
  const [dataCache, metaCache] = await Promise.all([
    caches.open(CACHE_NAME),
    caches.open(META_CACHE_NAME)
  ]);
  const [requests, metaRequests] = await Promise.all([
    dataCache.keys(),
    metaCache.keys()
  ]);
  const now = Date.now();
  await Promise.all(requests.map(async (request) => {
    const metaResponse = await metaCache.match(request.url);
    const cachedAt = Number((await metaResponse?.text?.()) || 0);
    if (!cachedAt || (now - cachedAt) > CACHE_MAX_AGE_MS) {
      await Promise.all([
        dataCache.delete(request),
        metaCache.delete(request.url)
      ]);
    }
  }));
  const urlSet = new Set(requests.map((request) => request.url));
  await Promise.all(metaRequests
    .filter((request) => !urlSet.has(request.url))
    .map((request) => metaCache.delete(request)));
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (names) => {
      await Promise.all(
        names
          .filter((name) => name !== CACHE_NAME && name !== META_CACHE_NAME)
          .map((name) => caches.delete(name))
      );
      await cleanupExpiredCacheEntries();
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;
  const isAllowedExternal = EXTERNAL_CACHE_HOSTS.has(requestUrl.hostname);
  if (!isSameOrigin && !isAllowedExternal) return;
  if ((Date.now() - lastCleanupAt) > (12 * 60 * 60 * 1000)) {
    lastCleanupAt = Date.now();
    event.waitUntil(cleanupExpiredCacheEntries().catch(() => {}));
  }

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    const isNavigation = event.request.mode === 'navigate';

    if (isNavigation && isSameOrigin) {
      if (cached) return cached;
      try {
        const networkResponse = await fetch(event.request);
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, networkResponse.clone());
          stampCacheEntry(event.request).catch(() => {});
        }
        return networkResponse;
      } catch (_) {
        const fallback = await caches.match('./index.html')
          || await caches.match('/FAKDU3/index.html')
          || await caches.match('./');
        if (fallback) return fallback;
        return new Response(
          '<!doctype html><html><body style="font-family:sans-serif;padding:16px">Offline และยังไม่มี cache หน้าเริ่มต้น</body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    }

    if (cached) return cached;
    try {
      const networkRequest = (!isSameOrigin && isAllowedExternal)
        ? new Request(event.request, { mode: 'no-cors' })
        : event.request;
      const response = await fetch(networkRequest);
      const canCache = isSameOrigin
        ? (response && response.status === 200 && response.type === 'basic')
        : (response && (response.status === 0 || response.type === 'opaque' || response.status === 200));
      if (canCache) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(networkRequest, response.clone());
        stampCacheEntry(networkRequest).catch(() => {});
      }
      return response;
    } catch (_) {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
