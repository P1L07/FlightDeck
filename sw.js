/* ==============================================================
 * SERVICE WORKER · Flight Deck
 * ==============================================================
 * Strategia:
 *   - HTML: network-first (aina tuore)
 *   - JS/CSS: network-first, cache-fallback
 *   - Muu: cache-first
 *   - Cache-versio sidottu APP_VERSION:iin → automaattinen nollaus
 *   - Yksittäinen 404 ei kaada koko installia
 *   - Tukee sekä objekti- että string-viestejä
 * ============================================================== */

const CACHE_VERSION = 'v1.0.1';   // ← pidä samana kuin version.js:APP_VERSION
const CACHE_NAME = `flightdeck-${CACHE_VERSION}`;

const NETWORK_TIMEOUT_MS = 4000;   // yhteysaikaraja ennen cache-fallbackia

// ==============================================================
// STAATTISET RESURSSIT
// ==============================================================
const LOCAL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './styles.css',

  // Sovellusmoduulit
  './version.js',
  './db.js',
  './app.js',
  './logbook.js',
  './airport-db.js',
  './map.js',
  './ofp-parser.js',
  './ofp-data.js',
  './ofp-map.js',
  './weather.js',
  './weekview.js',
  './roster.js',
  './audit.js',
  './offline.js',
  './flight-utils.js',
  './friends.js',
  './favorites.js',
  './defects.js',
  './briefing.js',
  './tripinfo.js',
  './notam.js',

  // PWA-ikonit
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png'
];

const CDN_ASSETS = [
  'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  'https://cdn.jsdelivr.net/npm/suncalc@1.9.0/suncalc.min.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js',
  'https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js',
  'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json'
];

const STATIC_ASSETS = [...LOCAL_ASSETS, ...CDN_ASSETS];

// ==============================================================
// ASENNUS
// ==============================================================
self.addEventListener('install', (event) => {
  console.log('[SW] Asennetaan', CACHE_VERSION);

  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Käytä allSettled → yksittäinen 404 ei kaada koko installia
      const results = await Promise.allSettled(
        STATIC_ASSETS.map(async (url) => {
          try {
            const resp = await fetch(url, { cache: 'no-cache' });
            if (resp.ok || resp.type === 'opaque') {
              await cache.put(url, resp);
              return { url, ok: true };
            }
            return { url, ok: false, status: resp.status };
          } catch (e) {
            return { url, ok: false, error: e.message };
          }
        })
      );

      const failed = results
        .filter(r => r.status === 'fulfilled' && r.value && !r.value.ok)
        .map(r => r.value);

      if (failed.length) {
        console.warn(
          `[SW] ${failed.length}/${STATIC_ASSETS.length} asset(ia) epäonnistui:`,
          failed.map(f => f.url.split('/').pop()).join(', ')
        );
      }

      await self.skipWaiting();
    })()
  );
});

// ==============================================================
// AKTIVOINTI
// ==============================================================
self.addEventListener('activate', (event) => {

  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const oldKeys = keys.filter(k =>
        k.startsWith('flightdeck-') && k !== CACHE_NAME
      );

      await Promise.all(
        oldKeys.map(k => {
          console.log('[SW] Poistetaan vanha cache:', k);
          return caches.delete(k);
        })
      );

      await self.clients.claim();
    })()
  );
});

// ==============================================================
// FETCH
// ==============================================================
self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Ohita ulkoiset API:t (Skyplan, sää-proxy, OurAirports-data)
  const ALLOWED_ORIGINS = [
    self.location.origin,
    'unpkg.com',
    'jsdelivr.net'
  ];

  const isAllowed = ALLOWED_ORIGINS.some(o =>
    url.hostname.includes(o) || url.origin === o
  );

  if (!isAllowed) return;

  // HTML → network-first
  if (req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      _networkFirst(req, true)
    );
    return;
  }

  // JS, CSS, JSON → network-first
  const isCode = /\.(js|css|json)(\?|$)/i.test(url.pathname)
              || /\.(js|css|json)/i.test(url.href);

  if (isCode) {
    event.respondWith(_networkFirst(req, false));
    return;
  }

  // Kuvat, fontit, muu → cache-first
  event.respondWith(_cacheFirst(req));
});

/* ---------------- Strategiat ---------------- */

async function _networkFirst(req, isHtml) {
  const cache = await caches.open(CACHE_NAME);

  try {
    // Timeout: älä odota verkkoa ikuisesti offline-tilassa
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);

    const resp = await fetch(req, { signal: controller.signal });
    clearTimeout(timeoutId);

    // Cachetetaan basic + cors (CDN:t)
    if (resp && (resp.ok || resp.type === 'opaque')) {
      try {
        cache.put(req, resp.clone());
      } catch (e) {}
    }
    return resp;
  } catch (e) {
    // Verkko ei vastaa → cache
    const cached = await cache.match(req);
    if (cached) return cached;

    // HTML-fallback
    if (isHtml) {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }

    // Tyhjä vastaus (ei kaada)
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

async function _cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) return cached;

  try {
    const resp = await fetch(req);
    if (resp && (resp.ok || resp.type === 'opaque')) {
      try {
        cache.put(req, resp.clone());
      } catch (e) {}
    }
    return resp;
  } catch (e) {
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

// ==============================================================
// VIESTIT SIVULTA
// ==============================================================
self.addEventListener('message', (event) => {
  const data = event.data;

  // Tuki sekä objekti- että string-viesteille
  const type = (typeof data === 'string') ? data : (data && data.type);

  // Skip waiting
  if (type === 'skipWaiting' || type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  // Clear cache — vastaa takaisin kun valmis
  if (type === 'clearCache' || type === 'CLEAR_CACHE') {
    event.waitUntil(
      (async () => {
        try {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
          console.log(`[SW] ${keys.length} cache(a) tyhjennetty`);

          // Vastaa takaisin jos client on saatavilla
          if (event.source && event.source.postMessage) {
            event.source.postMessage({ type: 'clearCacheDone', count: keys.length });
          }
        } catch (e) {
          console.warn('[SW] clearCache epäonnistui:', e);
        }
      })()
    );
    return;
  }

  // Tuntematon viesti — kirjaa debug-tarkoituksiin
  if (data) {
    console.log('[SW] Tuntematon viesti:', typeof data === 'object' ? data.type : data);
  }
});