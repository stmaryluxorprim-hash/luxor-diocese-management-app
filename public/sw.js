// Service Worker — Diocese Management PWA
// Network-first for pages (realtime app), cache-first for static assets.
//
// Rules that matter (learned the hard way):
//  • respondWith() MUST always resolve to a real Response. Returning
//    `undefined` (cache miss) makes the browser fail the request with
//    «Failed to convert value to 'Response'» — pages went blank and images
//    disappeared on phones with flaky connections.
//  • Never touch cross-origin requests (Supabase storage / API / realtime,
//    Google fonts): let the browser handle them natively.
//  • Never serve an HTML fallback for an image / script / style request.
const CACHE_NAME = 'diocese-v3';
const OFFLINE_URL = '/offline.html';
const STATIC_ASSETS = [
  OFFLINE_URL,
  '/manifest.json',
  '/icons/icon-96.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => Promise.allSettled(STATIC_ASSETS.map((u) => cache.add(u))))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isStaticAsset = (url) =>
  url.pathname.startsWith('/icons/') ||
  url.pathname.startsWith('/_next/static/') ||
  url.pathname === '/manifest.json' ||
  url.pathname === '/favicon.ico' ||
  /\.(png|jpg|jpeg|webp|gif|svg|ico|woff2?)$/i.test(url.pathname);

const offlineResponse = () =>
  new Response('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>غير متصل</title>' +
    '<body style="font-family:sans-serif;text-align:center;padding:3rem 1rem;color:#334155">' +
    '<h1 style="font-size:1.25rem">لا يوجد اتصال بالإنترنت</h1><p>تأكد من الاتصال ثم أعد المحاولة.</p>' +
    '<button onclick="location.reload()" style="padding:.6rem 1.2rem;border-radius:.75rem;border:0;background:#1e3a8a;color:#fff;font-weight:700">إعادة المحاولة</button>' +
    '</body></html>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch { return; }

  // Only same-origin. Supabase (storage / rest / realtime), fonts, etc. are
  // left entirely to the browser.
  if (url.origin !== self.location.origin) return;
  // Never intercept API routes or Next's image optimizer.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/image')) return;

  // Cache-first for immutable static assets
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((res) => {
            if (res && res.ok && res.type === 'basic') {
              const clone = res.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
            }
            return res;
          })
          .catch(() => new Response('', { status: 504, statusText: 'offline' }));
      })
    );
    return;
  }

  // Network-first for navigations / pages; cached copy or offline page as fallback
  if (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match(OFFLINE_URL).then((o) => o || offlineResponse()))
        )
    );
    return;
  }

  // Everything else (RSC payloads, data, …): plain network, never `undefined`
  event.respondWith(
    fetch(request).catch(() =>
      caches.match(request).then((cached) => cached || new Response('', { status: 504, statusText: 'offline' }))
    )
  );
});
