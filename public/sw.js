const CACHE_NAME = 'pilotcode-v28';
const ASSETS = [
  '/',
  '/index.html',
  '/css/app.css',
  '/css/easter-egg.css',
  '/js/app.js',
  '/js/ws-client.js',
  '/js/chat.js',
  '/js/markdown.js',
  '/js/permissions.js',
  '/js/sessions.js',
  '/js/images.js',
  '/js/easter-egg.js',
  '/img/ufo.png',
  '/manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Only handle http/https requests
  if (!e.request.url.startsWith('http')) return;
  // Skip API calls and WebSocket
  if (e.request.url.includes('/api/') || e.request.url.includes('/ws')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
