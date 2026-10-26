/* Service worker: powłoka aplikacji offline.
   WERSJA musi być zgodna z app.js i z dopiskami ?v= w index.html.
   Pliki mają wersję w adresie, więc strona nigdy nie dostanie
   stylu ani kodu z innego wydania niż ona sama. */
const WERSJA = '1.8.6';
const CACHE = `viridarium-${WERSJA}`;
const V = `?v=${WERSJA}`;

const POWLOKA = [
  './', './index.html',
  `./app.css${V}`, `./app.js${V}`, `./recognize.js${V}`,
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
  if(e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Strona: najpierw sieć — świeży HTML wskazuje pliki we właściwej wersji.
  // Bez sieci: strona z pamięci, razem z plikami z tego samego wydania.
  if(e.request.mode === 'navigate'){
    e.respondWith(
      fetch(e.request).catch(() => caches.open(CACHE).then(c => c.match('./index.html')))
    );
    return;
  }

  const czcionki = url.hostname.endsWith('gstatic.com') || url.hostname === 'fonts.googleapis.com';
  if(url.origin !== location.origin && !czcionki) return;   // serwer analiz i Google AI zawsze z sieci

  // Pozostałe pliki: tylko z pamięci TEGO wydania, inaczej z sieci.
  e.respondWith(
    caches.open(CACHE).then(c =>
      c.match(e.request).then(trafienie =>
        trafienie || fetch(e.request).then(res => {
          if(res.ok) c.put(e.request, res.clone()).catch(() => {});
          return res;
        })
      )
    )
  );
});
