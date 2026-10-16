/* ==============================================================
 * VERSION · sovelluksen versionumero ja päivitystarkistus
 * ============================================================== */

const APP_VERSION = '1.0.0';
const APP_BUILD   = '2026-10-16';
const APP_KEY     = '_app_version';

/* ---------------- Versiotarkistus ---------------- */
function checkAppVersion() {
  let stored = null;
  try { stored = localStorage.getItem(APP_KEY); } catch (e) {}

  if (stored !== APP_VERSION) {
    console.log(`[Version] Päivitetty ${stored || '?'} → ${APP_VERSION}`);
    try { localStorage.setItem(APP_KEY, APP_VERSION); } catch (e) {}

    // Näytä toast jos ei ensimmäinen käynnistys
    if (stored) {
      setTimeout(() => {
        if (typeof showToast === 'function') {
          showToast(`Sovellus päivitetty: ${stored} → ${APP_VERSION}`, 'success', 6000);
        }
      }, 2000);
    }
  }
}

/* ---------------- Force refresh — tyhjentää cachet ---------------- */
async function forceAppRefresh() {
  if (!confirm('Pakota päivitys? Cache tyhjennetään ja sivu ladataan uudelleen.')) return;

  try {
    // 1. Kerro SW:lle että nollaa cache
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage('clearCache');
    }

    // 2. Rekisteröinnit pois
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) await reg.unregister();
    }

    // 3. Cachet pois
    if ('caches' in window) {
      const names = await caches.keys();
      for (const name of names) await caches.delete(name);
    }

    // 4. Reload
    const url = new URL(window.location.href);
    url.searchParams.set('_v', Date.now());
    window.location.replace(url.toString());
  } catch (e) {
    console.error('[Refresh]', e);
    window.location.reload();
  }
}
window.forceAppRefresh = forceAppRefresh;

/* ---------------- Expose ---------------- */
window.APP_VERSION = APP_VERSION;
window.APP_BUILD = APP_BUILD;
window.checkAppVersion = checkAppVersion;

/* ---------------- Aja käynnistyksessä ---------------- */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkAppVersion);
} else {
  checkAppVersion();
}

/* ---------------- Data-skeeman migraatiot ---------------- */
const DATA_SCHEMA_KEY = '_data_schema';

function migrateDataIfNeeded() {
  let current = 0;
  try { current = parseInt(localStorage.getItem(DATA_SCHEMA_KEY) || '0', 10); }
  catch (e) {}

  const TARGET = 2;   // ← kasvata kun skeema muuttuu

  if (current === TARGET) return;

  console.log(`[Migration] ${current} → ${TARGET}`);

  try {
    // Migraatio 0 → 1: ei muutoksia
    if (current < 1) {
      // esim. lisää uusi kenttä olemassa oleviin entryihin
    }

    // Migraatio 1 → 2: esim. lokikirja-entry muuttuu
    if (current < 2) {
      // Esimerkki: lisää missing kenttiä
      const lb = JSON.parse(localStorage.getItem('easa_logbook_v1') || '[]');
      lb.forEach(e => {
        if (!e.skyplan) e.skyplan = {};
        if (e.skyplan.takeoffPending === undefined) e.skyplan.takeoffPending = false;
      });
      localStorage.setItem('easa_logbook_v1', JSON.stringify(lb));
    }

    localStorage.setItem(DATA_SCHEMA_KEY, String(TARGET));
    console.log(`[Migration] Valmis`);
  } catch (e) {
    console.error('[Migration] Virhe:', e);
  }
}

// Aja migraatiot ennen muuta muuta
migrateDataIfNeeded();

/* ---------------- Service Worker rekisteröinti ---------------- */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    console.log('[SW] Rekisteröity, scope:', reg.scope);

    // Kuuntele päivityksiä
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          console.log('[SW] Uusi versio saatavilla');
          if (typeof showToast === 'function') {
            showToast('Uusi versio ladattu — päivitä sivu.', 'info', 6000);
          }
        }
      });
    });

    // Tarkista päivitys 30 min välein
    setInterval(() => reg.update(), 30 * 60 * 1000);
  } catch (e) {
    console.warn('[SW] Rekisteröinti epäonnistui:', e);
  }
}

// Aja heti jos ei olla ladattu
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', registerServiceWorker);
} else {
  registerServiceWorker();
}