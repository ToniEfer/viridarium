/* Service worker: powłoka aplikacji offline. Zapytania do silników
   rozpoznawania zawsze idą do sieci — nie są i nie mogą być cache'owane. */
const CACHE = 'viridarium-v1';
const POWLOKA = [
  './', './index.html', './app.css', './app.js', './recognize.js',
  './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(POWLOKA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
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
