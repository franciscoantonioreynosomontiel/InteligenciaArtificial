const CACHE_NAME = 'ia-agente-pwa-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './aprender.html',
  './css/styles.css',
  './js/app.js',
  './js/three-scene.js',
  './js/gemini.js',
  './js/cloudinary.js',
  './js/aprender.js',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Network first strategy with fallback to cache for HTML/API, Cache first for assets
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.status === 200) {
          const resCopy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resCopy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Handle Notification Clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        let client = clientList[0];
        for (let i = 0; i < clientList.length; i++) {
          if (clientList[i].focused) {
            client = clientList[i];
            break;
          }
        }
        return client.focus();
      }
      return clients.openWindow('./index.html');
    })
  );
});
