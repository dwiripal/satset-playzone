const CACHE_NAME = 'satset-playzone-v2-0-0';
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(()=>self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE_NAME ? caches.delete(k) : null))).then(()=>self.clients.claim())); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then(res => { const copy = res.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)); return res; }).catch(() => caches.match(event.request).then(cached => cached || caches.match('/index.html'))));
});
