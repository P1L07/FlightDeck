/* ==============================================================
 * SERVICE WORKER · Flight Deck
 * ==============================================================
 * Strategia:
 *   - HTML: network-first (aina tuore)
 *   - JS/CSS: network-first, cache-fallback
 *   - Muu (kuvat, fontit): cache-first
 *   - Cache-versio sidottu APP_VERSION:iin → automaattinen nollaus
 * ============================================================== */

const CACHE_VERSION = 'v1.0.0';   // ← päivitä version.js:n kanssa
const CACHE_NAME = `flightdeck-${CACHE_VERSION}`;

// Staattiset resurssit jotka cachetetaan asennuksessa
const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './LogBook.js',
  './activeflight.js',
  './audit.js',
  './briefing.js',
  './defects.js',
  './favorites.js',
  './friends.js',
  './notam.js',
  './offline.js',
  './roster.js',
  './tripinfo.js',
  './version.js',
  './weather.js',
  './weekview.js',
  './map.js',                                 
  'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js',
  'https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js'
];

/* ---------------- Asennus ---------------- */
self.addEventListener('install', (event) => {
  console.log('[SW] Asennetaan', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

/* ---------------- Aktivointi: vanhat cachet pois ---------------- */
self.addEventListener('activate', (event) => {
  console.log('[SW] Aktivoidaan', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('flightdeck-') && k !== CACHE_NAME)
          .map(k => {
            console.log('[SW] Poistetaan vanha cache:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

/* ---------------- Fetch ---------------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Vain GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Ohita ulkoiset API:t (Skyplan, sää, Worker)
  if (
    url.origin !== self.location.origin &&
    !url.hostname.includes('unpkg.com') &&
    !url.hostname.includes('jsdelivr.net')
  ) {
    return;
  }

  // HTML → network-first
  if (req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then(resp => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // JS / CSS / muut staattiset → network-first, fallback cache
  event.respondWith(
    fetch(req)
      .then(resp => {
        if (!resp || resp.status !== 200 || resp.type !== 'basic') return resp;
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, clone)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(req))
  );
});

/* ---------------- Viestit sivulta ---------------- */
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data === 'clearCache') {
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    );
  }
});