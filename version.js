/* ==============================================================
 * VERSION · sovelluksen versio, migraatiot, SW-rekisteröinti
 * ==============================================================
 * - Versiotarkistus (toast jos muuttunut)
 * - Data-skeeman migraatiot (db.js-yhteensopiva)
 * - Service Worker rekisteröinti + päivitysseuranta
 * - Force refresh (odottaa cache-clear:ia ennen reloadia)
 * ============================================================== */
'use strict';

const APP_VERSION = '1.0.1';
const APP_BUILD   = '2026-10-16';
const APP_KEY     = '_app_version';

/* ==============================================================
 * VERSIOTARKISTUS
 * ============================================================== */
function checkAppVersion() {
  let stored = null;
  try { stored = localStorage.getItem(APP_KEY); } catch (e) {}

  if (stored === APP_VERSION) return;

  try { localStorage.setItem(APP_KEY, APP_VERSION); } catch (e) {}

  // Näytä toast vain jos tämä ei ole ensimmäinen käynnistys
  if (!stored) return;

  // Odota että boot-overlay on piilotettu (n. 1,5 s)
  const showVersionToast = () => {
    if (typeof showToast !== 'function') return;
    if (!document.querySelector('#boot-overlay')) {
      showToast(`Sovellus päivitetty: ${stored} → ${APP_VERSION}`, 'success', 6000);
      return;
    }
    // Boot-overlay vielä näkyvissä → yritä myöhemmin
    setTimeout(showVersionToast, 500);
  };
  setTimeout(showVersionToast, 2000);
}

/* ==============================================================
 * FORCE REFRESH · tyhjentää cachet
 * ============================================================== */
async function forceAppRefresh() {
  if (!confirm('Pakota päivitys? Cache tyhjennetään ja sivu ladataan uudelleen.')) return;

  try {
    // 1. Kerro SW:lle että nollaa cache — ja odota 500 ms
    if (navigator.serviceWorker?.controller) {
      try {
        navigator.serviceWorker.controller.postMessage({ type: 'clearCache' });
      } catch (e) {
        // Fallback: vanha string-viesti jos SW on vanha
        try { navigator.serviceWorker.controller.postMessage('clearCache'); } catch (e2) {}
      }
      await new Promise(r => setTimeout(r, 500));
    }

    // 2. Rekisteröinnit pois
    if ('serviceWorker' in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) await reg.unregister();
      } catch (e) {
        console.warn('[Refresh] SW unregister failed:', e);
      }
    }

    // 3. Cache Storage pois
    if ('caches' in window) {
      try {
        const names = await caches.keys();
        for (const name of names) {
          try { await caches.delete(name); } catch (e) {}
        }
      } catch (e) {
        console.warn('[Refresh] Cache delete failed:', e);
      }
    }

    // 4. Reload cache-busterilla
    const url = new URL(window.location.href);
    url.searchParams.set('_v', Date.now());
    window.location.replace(url.toString());
  } catch (e) {
    console.error('[Refresh]', e);
    window.location.reload();
  }
}

/* ==============================================================
 * DATA-SKEEMAN MIGRAATIOT
 * ==============================================================
 * HUOM: db.js ja app.js ladataan ENNEN tätä tiedostoa.
 * Migraatio ajetaan DOMContentLoaded-tapahtuman jälkeen, jolloin
 * dbInit() on todennäköisesti jo käynnistynyt (mutta ei välttämättä
 * valmis). Siksi migraatio odottaa db:n valmistumista jos mahdollista.
 * ============================================================== */
const DATA_SCHEMA_KEY = '_data_schema';
const TARGET_SCHEMA = 2;

async function migrateDataIfNeeded() {
  let current = 0;
  try { current = parseInt(localStorage.getItem(DATA_SCHEMA_KEY) || '0', 10); }
  catch (e) {}

  if (current === TARGET_SCHEMA) return;

  // Odota db-init:iä jos se on käynnissä tai saatavilla
  if (typeof dbInit === 'function') {
    try {
      await dbInit();
    } catch (e) {
      console.warn('[Migration] dbInit epäonnistui — jatketaan localStorage-fallbackilla:', e.message);
    }
  }

  try {
    /* ---------- Migraatio 0 → 1 ---------- */
    if (current < 1) {
      // Ei muutoksia
    }

    /* ---------- Migraatio 1 → 2 ---------- */
    if (current < 2) {
      // Käytä db.js:n APIa jos saatavilla (muuten localStorage)
      const useDb = (typeof dbReadAll === 'function' && typeof dbReplaceAll === 'function');

      let entries;
      if (useDb) {
        entries = dbReadAll();
      } else {
        try {
          entries = JSON.parse(localStorage.getItem('easa_logbook_v1') || '[]');
        } catch (e) { entries = []; }
      }

      if (!Array.isArray(entries)) entries = [];

      let changed = 0;
      entries.forEach(e => {
        if (!e) return;
        if (!e.skyplan) { e.skyplan = {}; changed++; }
        if (e.skyplan.takeoffPending === undefined) {
          e.skyplan.takeoffPending = false;
          changed++;
        }
        if (e.skyplan.landingPending === undefined) {
          e.skyplan.landingPending = false;
          changed++;
        }
      });

      if (changed > 0) {
        if (useDb) {
          dbReplaceAll(entries);
        } else {
          try {
            localStorage.setItem('easa_logbook_v1', JSON.stringify(entries));
          } catch (e) {
            console.warn('[Migration] localStorage-tallennus epäonnistui:', e.message);
          }
        }
      }
    }

    /* ---------- Valmis ---------- */
    try { localStorage.setItem(DATA_SCHEMA_KEY, String(TARGET_SCHEMA)); } catch (e) {}

  } catch (e) {
    console.error('[Migration] Virhe:', e);
    // ÄLÄ merkitse migraatiota valmiiksi jos se epäonnistui
  }
}

/* ==============================================================
 * SERVICE WORKER REKISTERÖINTI
 * ============================================================== */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    // Kuuntele päivityksiä
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          console.log('[SW] Uusi versio saatavilla');
          if (typeof showToast === 'function') {
            showToast('Uusi versio ladattu', 'info', 6000);
          }
        }
      });
    });

    // Tarkista päivitys 30 min välein — hae tuore reg-referenssi joka kerta
    setInterval(async () => {
      try {
        const freshReg = await navigator.serviceWorker.getRegistration();
        if (freshReg) await freshReg.update();
      } catch (e) {
        // Hiljainen — ei kriittinen
      }
    }, 30 * 60 * 1000);
  } catch (e) {
    console.warn('[SW] Rekisteröinti epäonnistui:', e);
  }
}

/* ==============================================================
 * EXPOSE
 * ============================================================== */
window.APP_VERSION = APP_VERSION;
window.APP_BUILD = APP_BUILD;
window.checkAppVersion = checkAppVersion;
window.forceAppRefresh = forceAppRefresh;
window.migrateDataIfNeeded = migrateDataIfNeeded;

/* ==============================================================
 * KÄYNNISTYS
 * ==============================================================
 * Järjestys:
 *   1. Versiotarkistus (synkroninen)
 *   2. Migraatiot (async, odottaa dbInit:iä)
 *   3. SW-rekisteröinti (async, ei blokkaa)
 *
 * HUOM: migrateDataIfNeeded ajetaan vasta DOMContentLoaded
 * jälkeen, jotta db.js on ehtinyt latautua.
 * ============================================================== */
async function _versionBoot() {
  checkAppVersion();

  // Migraatio — odottaa db-init:iä
  try {
    await migrateDataIfNeeded();
  } catch (e) {
    console.error('[Version] Migration failed:', e);
  }

  // SW-rekisteröinti
  registerServiceWorker();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _versionBoot);
} else {
  _versionBoot();
}