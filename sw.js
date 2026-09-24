/* Service worker: powłoka aplikacji offline.
   WERSJA musi być zgodna z tą w app.js — jej zmiana uruchamia aktualizację
   u wszystkich, którzy mają aplikację zainstalowaną. */
const WERSJA = '1.6.0';
const CACHE = `viridarium-${WERSJA}`;

const POWLOKA = [
  './', './index.html', './app.css', './app.js', './recognize.js',
  './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  // Świadomie bez skipWaiting: nowa wersja czeka, aż użytkownik ją przyjmie.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(POWLOKA)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Aplikacja prosi o wpuszczenie nowej wersji, gdy użytkownik stuknie „Odśwież".
self.addEventListener('message', e => {
  if(e.data?.typ === 'WPUSC_NOWA') self.skipWaiting();
  if(e.data?.typ === 'JAKA_WERSJA') e.source?.postMessage({ typ: 'WERSJA', wersja: WERSJA });
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if(e.request.method !== 'GET') return;
  if(url.origin !== location.origin && !url.hostname.endsWith('gstatic.com') && !url.hostname.endsWith('googleapis.com')) return;
  if(url.hostname === 'generativelanguage.googleapis.com') return;

  e.respondWith(
    caches.match(e.request).then(trafienie =>
      trafienie || fetch(e.request).then(res => {
        const kopia = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, kopia)).catch(() => {});
        return res;
      }).catch(() => trafienie)
    )
  );
});
