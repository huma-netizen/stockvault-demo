/* =========================================================
   StockVault — Service Worker
   Cache-first for versioned static assets. Network-first for
   navigations. Never caches IndexedDB records (they live in
   the database, not the network layer).
   ========================================================= */

const CACHE_VERSION = 'stockvault-v1.1.1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

/* Assets required for the app shell to work offline.
   Every file listed here must exist on disk. */
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',

  './css/variables.css',
  './css/base.css',
  './css/neumorphism.css',
  './css/layout.css',
  './css/components.css',
  './css/tables.css',
  './css/forms.css',
  './css/dashboard.css',
  './css/responsive.css',

  './js/app.js',
  './js/router.js',
  './js/ui.js',
  './js/database.js',
  './js/repositories.js',
  './js/settings.js',
  './js/notifications.js',
  './js/csv.js',
  './js/backup.js',
  './js/theme.js',
  './js/i18n.js',

  './js/views/_helpers.js',
  './js/views/onboarding.js',
  './js/views/dashboard.js',
  './js/views/products.js',
  './js/views/categories.js',
  './js/views/suppliers.js',
  './js/views/stock.js',
  './js/views/low-stock.js',
  './js/views/purchases.js',
  './js/views/reports.js',
  './js/views/data.js',
  './js/views/settings.js',
  './js/views/import-csv.js',

  './js/locales/en.json',
  './js/locales/ar.json',
  './js/locales/ur.json',
  './js/locales/es.json',
  './js/locales/fa.json',
  './js/locales/hi.json',
  './js/locales/zh.json',
  './js/locales/ja.json',
  './js/locales/ko.json',

  './assets/icons/favicon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
];

/* ---------- Install: cache the app shell ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const failed = [];
      await Promise.all(SHELL_ASSETS.map(async (url) => {
        try {
          await cache.add(url);
        } catch (err) {
          failed.push(url);
        }
      }));
      if (failed.length) {
        console.warn('[sw] could not cache these shell assets:', failed);
      } else {
        console.log('[sw] all shell assets cached');
      }
      await self.skipWaiting();
    })()
  );
});

/* ---------- Activate: clean up old caches ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('stockvault-') && !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

/* ---------- Fetch: cache-first for static, network-first for the rest ---------- */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (!url.protocol.startsWith('http')) return;

  // Navigation requests: network-first, fall back to cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Static assets: cache-first.
  const isStatic = /\.(js|css|json|svg|png|jpg|jpeg|webp|woff2?)$/i.test(url.pathname);
  if (isStatic) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response && response.status === 200) {
            const copy = response.clone();
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put(request, copy);
          }
          return response;
        } catch (err) {
          return new Response('', { status: 504, statusText: 'Offline' });
        }
      })()
    );
    return;
  }

  // Everything else: network-first.
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

/* ---------- Update notification ---------- */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});