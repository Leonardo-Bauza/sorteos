// Service worker: permite instalar la app y abrirla sin internet.
//
// Estrategia "primero la red": si hay conexión siempre se baja la versión
// más nueva (importante para una app que se usa una vez por mes) y se
// guarda una copia; si no hay conexión, se usa la copia guardada.
// Los pedidos a la API (otro dominio) NO pasan por acá ni se guardan.

const CACHE = 'sorteos-caseros-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/api.js',
  './js/audit.js',
  './js/dom.js',
  './js/links.js',
  './js/participants.js',
  './js/pwa.js',
  './js/raffle.js',
  './js/reveal.js',
  './js/storage.js',
  './js/text.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // no-cache: revalida con el servidor en vez de usar la caché HTTP del navegador.
      const fresh = await fetch(request, { cache: 'no-cache' });
      if (fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    } catch {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === 'navigate') return (await cache.match('./index.html')) ?? Response.error();
      return Response.error();
    }
  })());
});
