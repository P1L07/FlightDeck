/* ==============================================================
 * OFFLINE MODE · Taustatoiminnot ilman UI-elementtejä
 * ==============================================================
 * Yläpalkin ONLINE/OFFLINE-merkki hoitaa visuaalisen indikoinnin.
 * Tämä moduuli hoitaa:
 *   - safeFetch (estää verkkokutsut offline-tilassa)
 *   - Token-suojaus (ei turhia token-modaleja offline-tilassa)
 *   - Automaattinen datan päivitys kun yhteys palaa
 * ============================================================== */

let _offlineBooted = false;

/* ---------------- Viimeisin synkkaus ---------------- */
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

/* ---------------- Verkkokutsujen esto ---------------- */
async function safeFetch(url, options) {
  if (!navigator.onLine) {
    console.warn('[Offline] Estetty verkkokutsu (offline):', url);
    return null;
  }
  return fetch(url, options);
}
window.safeFetch = safeFetch;

/* ---------------- Token expiry ---------------- */
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

/* ---------------- Online-tilan palautuminen ---------------- */
async function _onBackOnline() {
  console.log('[Offline] Yhteys palautui — päivitetään data…');

  if (typeof showToast === 'function') {
    showToast('Yhteys palautui — päivitetään data.', 'success');
  }

  const tasks = [];

  if (typeof forceRosterSync === 'function') {
    tasks.push(forceRosterSync({ silent: true, forceCompare: true }).catch(() => {}));
  }

  if (typeof renderHomeDashboard === 'function') {
    tasks.push(Promise.resolve(renderHomeDashboard()).catch(() => {}));
  }

  await Promise.allSettled(tasks);

  if (typeof showToast === 'function') {
    showToast('Data päivitetty.', 'success');
  }
}

/* ---------------- Eventit ---------------- */
window.addEventListener('offline', () => {
  console.log('[Offline] Yhteys katkesi');
  if (typeof showToast === 'function') {
    showToast('Yhteys katkesi — siirrytty offline-tilaan.', 'warning', 4000);
  }
});

window.addEventListener('online', () => {
  console.log('[Offline] Yhteys palautui');
  setTimeout(_onBackOnline, 500);
});

/* ---------------- Boot ---------------- */
function _offlineBoot() {
  if (_offlineBooted) return;
  _offlineBooted = true;

  console.log('[Offline] Moduuli valmis');

  // Wrap getValidSkyplanToken → offline-suojaus
  if (typeof window.getValidSkyplanToken === 'function') {
    const orig = window.getValidSkyplanToken;
    window.getValidSkyplanToken = async function (...args) {
      if (!navigator.onLine) {
        console.log('[Token] Offline — palautetaan null ilman token-modalia');
        return null;
      }
      return orig.apply(this, args);
    };
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _offlineBoot);
} else {
  _offlineBoot();
}