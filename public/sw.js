// ============================================
// DFF! – Service Worker
// Network-first strategy to avoid stale cache
// ============================================

const CACHE_NAME = 'dff-v2';

// Install – clear old caches immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate – delete ALL old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch – NETWORK FIRST, fall back to cache only if offline
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Never cache socket.io or API requests
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses for offline use
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        // Offline fallback – try cache
        return caches.match(event.request);
      })
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length > 0) {
        return clients[0].focus();
      }
      return self.clients.openWindow('/');
    })
  );
});
