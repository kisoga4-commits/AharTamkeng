// sw.js - FAKDU Offline-First App Shell
const SW_VERSION = '10.30.1';
const APP_SHELL_CACHE = `fakdu-app-shell-v${SW_VERSION}`;
const RUNTIME_CACHE = `fakdu-runtime-v${SW_VERSION}`;
const OFFLINE_FALLBACK_URL = './offline.html';

const APP_SHELL = [
  './',
  './index.html',
  './offline.html',
  './style.css',
  './manifest.json',
  './icon.png',
  './js/db.js',
  './js/core.js',
  './js/vault.js',
  './js/firebase-init.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_SHELL_CACHE);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => ![APP_SHELL_CACHE, RUNTIME_CACHE].includes(key))
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

async function networkFirstForNavigation(request) {
  const shellCache = await caches.open(APP_SHELL_CACHE);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      await shellCache.put('./index.html', networkResponse.clone());
    }
    return networkResponse;
  } catch (_) {
    return (await shellCache.match('./index.html'))
      || (await shellCache.match(OFFLINE_FALLBACK_URL))
      || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function cacheFirstForStaticAssets(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const runtime = await caches.open(RUNTIME_CACHE);
      await runtime.put(request, response.clone());
    }
    return response;
  } catch (_) {
    if (request.mode === 'navigate') {
      const shell = await caches.open(APP_SHELL_CACHE);
      return (await shell.match(OFFLINE_FALLBACK_URL))
        || (await shell.match('./index.html'))
        || new Response('Offline', { status: 503 });
    }
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstForNavigation(event.request));
    return;
  }

  event.respondWith(cacheFirstForStaticAssets(event.request));
});
