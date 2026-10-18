/* ==============================================================
 * OFFLINE MODE · Keskittetty online/offline-orkestrointi
 * ==============================================================
 * - safeFetch (estää verkkokutsut offline-tilassa)
 * - Toast-debounce (WiFi flapping ei spammi)
 * - Online-sync debounce (ei 4× samaa kutsua)
 * - KESKITETTY: kaikki online-tapahtumat orkestroidaan täällä
 *   (weather.js ja LogBook.js eivät enää kuuntele 'online')
 * - EI ylikirjoita getValidSkyplanToken (app.js hoitaa oikein)
 * ============================================================== */
'use strict';

let _offlineBooted = false;

/* Toast-debounce */
let _lastOfflineToastTime = 0;
let _lastOnlineToastTime  = 0;
const TOAST_DEBOUNCE_MS = 5000;

/* Online-sync debounce */
let _backOnlineTimer = null;
const BACK_ONLINE_DEBOUNCE_MS = 1500;

/* ==============================================================
 * Viimeisin synkkaus
 * ============================================================== */
function _getLastSyncInfo() {
  try {
    const rangeRaw = localStorage.getItem('assigned_flights_cache_range');
    const range = rangeRaw ? JSON.parse(rangeRaw) : null;
    const timeStr = localStorage.getItem('assigned_flights_cache_time') || '';
    const ofpCount = (() => {
      try {
        const raw = localStorage.getItem('skyplan_offline_pdfs_v1')
                 || localStorage.getItem('offline_pdfs')
                 || '[]';
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.length : 0;
      } catch (e) { return 0; }
    })();
    return { range, timeStr, ofpCount };
  } catch (e) {
    return { range: null, timeStr: '', ofpCount: 0 };
  }
}
window.getLastSyncInfo = _getLastSyncInfo;

/* ==============================================================
 * Verkkokutsujen esto
 * ============================================================== */
async function safeFetch(url, options) {
  if (!navigator.onLine) {
    console.warn('[Offline] Estetty verkkokutsu (offline):', url);
    return null;
  }
  try {
    return await fetch(url, options);
  } catch (e) {
    console.warn('[Offline] safeFetch virhe:', e.message);
    return null;
  }
}
window.safeFetch = safeFetch;

/* ==============================================================
 * Token expiry
 * ============================================================== */
function isTokenExpiredOrExpiring() {
  try {
    const token = localStorage.getItem('skyplan_token');
    if (!token) return true;

    const parts = token.split('.');
    if (parts.length !== 3) return true;

    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    const payload = JSON.parse(
      decodeURIComponent(atob(padded).split('').map(c =>
        '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
      ).join(''))
    );

    if (typeof payload.exp !== 'number') return true;
    const now = Math.floor(Date.now() / 1000);
    return payload.exp <= now + 300;
  } catch (e) {
    return true;
  }
}
window.isTokenExpiredOrExpiring = isTokenExpiredOrExpiring;

/* ==============================================================
 * ONLINE-ORKESTROINTI
 * ==============================================================
 * Kaikki 'online'-tapahtuman jälkeiset toiminnot:
 *
 *   1. forceRosterSync         — hakee rosterin
 *        └─ loadAssignedFlights wrapper (LogBook.js)
 *              └─ scanForCompletedFlights +1500 ms
 *        └─ forceRosterSync wrapper (LogBook.js)
 *              └─ autoSyncLogbook +3000 ms
 *
 *   2. _initHomeDashboard      — päivittää kotisivun kartan
 *
 *   3. scanForCompletedFlights — varmuuskopio (jos wrapper ei lauennut)
 *
 * HUOM: forceRosterSync hoitaa suurimman osan. Tämä funktio on
 * vain orkestroija, ei duplikoi alitoimintoja.
 * ============================================================== */
async function _onBackOnline(showToastMsg) {

  if (showToastMsg && typeof showToast === 'function') {
    showToast('Yhteys palautui', 'success', 3000);
  }

  const tasks = [];

  // 1. Roster-sync (triggaa autoSyncLogbook + scanForCompletedFlights wrappereiden kautta)
  if (typeof forceRosterSync === 'function') {
    tasks.push(
      Promise.resolve(forceRosterSync({ silent: true, forceCompare: true }))
        .catch(err => console.warn('[Offline] forceRosterSync failed:', err?.message))
    );
  } else if (typeof loadAssignedFlights === 'function') {
    // Fallback jos forceRosterSync puuttuu (roster.js ei ladattu)
    tasks.push(
      loadAssignedFlights(false, true)
        .catch(err => console.warn('[Offline] loadAssignedFlights failed:', err?.message))
    );
  }

  // 2. Kotisivun kartta (dedup estää tuplat weather.js:n initin kanssa)
  if (typeof _initHomeDashboard === 'function') {
    tasks.push(
      _initHomeDashboard('back-online')
        .catch(err => console.warn('[Offline] HomeDashboard failed:', err?.message))
    );
  } else if (typeof renderHomeDashboard === 'function') {
    tasks.push(
      Promise.resolve(renderHomeDashboard())
        .catch(err => console.warn('[Offline] HomeDashboard failed:', err?.message))
    );
  }

  await Promise.allSettled(tasks);

  // 3. Turvaverkko: varmista että päättyneet lennot skannataan
  //    (yleensä wrapper hoitaa, mutta jos forceRosterSync epäonnistui)
  if (typeof scanForCompletedFlights === 'function') {
    setTimeout(() => {
      scanForCompletedFlights().catch(() => {});
    }, 2500);
  }
}

/* ==============================================================
 * EVENTIT
 * ============================================================== */
window.addEventListener('offline', () => {

  // Peruuta mahdollinen käynnissä oleva online-sync (flapping)
  if (_backOnlineTimer) {
    clearTimeout(_backOnlineTimer);
    _backOnlineTimer = null;
  }

  const now = Date.now();
  if (now - _lastOfflineToastTime < TOAST_DEBOUNCE_MS) return;
  _lastOfflineToastTime = now;

  if (typeof showToast === 'function') {
    showToast('Yhteys katkesi — siirrytty offline-tilaan.', 'warning', 4000);
  }
});

window.addEventListener('online', () => {
  // Debounce: peruuta edellinen timer jos nopea toggle
  clearTimeout(_backOnlineTimer);
  _backOnlineTimer = setTimeout(() => {
    _backOnlineTimer = null;

    const now = Date.now();
    const wasJustOffline = (now - _lastOfflineToastTime) < TOAST_DEBOUNCE_MS;
    const wasJustOnline  = (now - _lastOnlineToastTime)  < TOAST_DEBOUNCE_MS;

    // Jos ollut äskettäin offline/online → älä näytä toastia (flapping)
    const showToastMsg = !wasJustOffline && !wasJustOnline;

    if (showToastMsg) {
      _lastOnlineToastTime = now;
    }

    _onBackOnline(showToastMsg).catch(err => {
      console.warn('[Offline] _onBackOnline failed:', err);
    });
  }, BACK_ONLINE_DEBOUNCE_MS);
});

/* ==============================================================
 * BOOT
 * ============================================================== */
function _offlineBoot() {
  if (_offlineBooted) return;
  _offlineBooted = true;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _offlineBoot);
} else {
  _offlineBoot();
}