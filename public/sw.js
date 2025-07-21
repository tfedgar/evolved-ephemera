const CACHE_NAME = 'edgar-coaching-v2';
const STATIC_CACHE_NAME = 'edgar-static-v2';

// Critical assets to cache immediately
const CRITICAL_ASSETS = [
  '/',
  '/styles/global.css',
  '/images/optimized/coach-425.webp',
  '/images/optimized/coach-850.webp'
];

// Additional assets to cache on first visit
const ADDITIONAL_ASSETS = [
  '/pay',
  '/privacy',
  '/favicon.svg',
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png'
];

// Install event - cache critical assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // Cache critical assets first
        return cache.addAll(CRITICAL_ASSETS);
      })
      .then(() => {
        // Skip waiting to activate immediately
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== STATIC_CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Claim all clients immediately
      return self.clients.claim();
    })
  );
});

// Fetch event - serve from cache with network fallback
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip external requests
  if (url.origin !== location.origin) return;

  // Skip API routes
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Serve from cache and update in background
        event.waitUntil(updateCache(request));
        return cachedResponse;
      }

      // Not in cache, fetch from network
      return fetch(request).then((response) => {
        // Don't cache non-successful responses
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        // Cache the response
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache);
        });

        return response;
      }).catch(() => {
        // Network failed, try to serve a fallback
        if (request.destination === 'document') {
          return caches.match('/');
        }
        return new Response('Network error', { status: 408 });
      });
    })
  );
});

// Update cache in background
async function updateCache(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type === 'basic') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
  } catch (error) {
    // Ignore network errors in background updates
  }
}

// Cache additional assets on first idle time
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CACHE_ADDITIONAL') {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.addAll(ADDITIONAL_ASSETS);
      })
    );
  }
}); 