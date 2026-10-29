const CACHE_NAME = 'toto-pwa-v4';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './aprender.html',
  './notas.html',
  './alarmas.html',
  './recordatorios.html',
  './musica.html',
  './css/styles.css',
  './js/app.js',
  './js/three-scene.js',
  './js/gemini.js',
  './js/cloudinary.js',
  './js/aprender.js',
  './js/notas.js',
  './js/alarmas.js',
  './js/recordatorios.js',
  './js/ubicacion.js',
  './js/musica.js',
  './assets/img/logopwa.png',
  './assets/img/icon-192.png',
  './assets/img/icon-512.png',
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
  if (event.request.method !== 'GET') return;

  // For JS scripts, HTML and API, strictly attempt fresh network fetch first to ensure immediate PWA updates
  const url = new URL(event.request.url);
  const isScriptOrHtml = url.pathname.endsWith('.js') || url.pathname.endsWith('.html') || url.pathname.endsWith('/');

  if (isScriptOrHtml) {
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
  } else {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          fetch(event.request).then((response) => {
            if (response.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response));
            }
          }).catch(() => {});
          return cachedResponse;
        }
        return fetch(event.request).then((response) => {
          if (response.status === 200) {
            const resCopy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resCopy));
          }
          return response;
        });
      })
    );
  }
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'location-sync') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'BACKGROUND_LOCATION_TICK' });
        });
      })
    );
  }
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
