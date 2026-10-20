/* ==============================================================
 * APP · FlightDeck sovelluslogiikka
 * ==============================================================
 * Sisältää:
 *   - Autentikointi (Skyplan access token + refresh token)
 *   - Rosterin haku (loadAssignedFlights)
 *   - Journey-log haku (fetchJourneyLog)
 *   - OFP-tavujen haku (fetchSkyplanOFPBytes)
 *   - previewOFPFromSkyplan
 *   - Jaetut apurit: createModal, hhmmFromIso, yyyymmddFromIso, blockToHHMM
 *   - Auto-import päättyneille lennoille
 *
 * Latausjärjestys (index.html):
 *   1. version.js, db.js
 *   2. app.js          ← tämä tiedosto
 *   3. LogBook.js      ← käyttää createModalia, fetchJourneyLogia
 *   4. Muut moduulit
 *
 * Riippuvuudet:
 *   - LogBook.js: importLogbookFromJourneyLog (kutsutaan auto-importissa)
 *   - activeflight.js: extractPdfFromZipOrRaw (OFP-purku)
 * ============================================================== */
'use strict';

/* ==============================================================
 * JAKOVIESTINTÄ · de-duplikointi
 * ============================================================== */
let _lastRosterAPIResponse = null;
window._lastRosterAPIResponse = null;

/* ==============================================================
 * AIKA-APURIT
 * ============================================================== */
const hhmmFromIso = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
};
window.hhmmFromIso = hhmmFromIso;

const yyyymmddFromIso = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
};
window.yyyymmddFromIso = yyyymmddFromIso;

// "01:35:00" → "1:35"
const blockToHHMM = (hhmmss) => {
  if (!hhmmss) return '';
  const [h, m] = String(hhmmss).split(':');
  return `${parseInt(h, 10)}:${String(m).padStart(2,'0')}`;
};
window.blockToHHMM = blockToHHMM;

/* ==============================================================
 * MODAALI · createModal
 * ==============================================================
 * Käyttö:
 *   await createModal({title, message, icon, confirmText, cancelText, ...})
 *   await createModal('Otsikko', 'Viesti')   // legacy
 * ============================================================== */
function createModal(options, legacyMessage = '', legacyConfirm = 'OK', legacyCancel = null) {
  let opts = {};
  if (typeof options === 'string') {
    opts = {
      title: options,
      message: legacyMessage,
      confirmText: legacyConfirm,
      cancelText: legacyCancel
    };
  } else if (options && typeof options === 'object') {
    opts = options;
  }

  const {
    title = 'Notice',
    message = '',
    confirmText = 'OK',
    cancelText = null,
    onConfirm,
    onCancel,
    type = 'info',
    icon = '📋',
    showVersion = null,
    listItems = null,
    bodyHTML = '',
    centered = true,
    compact = false,
    maxWidth = null
  } = opts;

  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.style.cssText = `position: fixed; inset: 0; background: rgba(0,0,0,0.8);
      display: flex; justify-content: center; align-items: center; z-index: 10001;
      backdrop-filter: blur(5px); animation: fadeIn 0.2s ease;`;

    const color = type === 'error' ? 'var(--error, #ff3b30)' : 'var(--accent, #007aff)';
    const align = centered ? 'text-align: center;' : 'text-align: left;';
    const width = maxWidth || (compact ? '400px' : '500px');

    const listHTML = (listItems && listItems.length)
      ? `<div style="margin-bottom: 25px; max-height: 400px; overflow-y: auto; ${align}">
          <ul style="list-style: none; padding: 0; margin: 0;">
            ${listItems.map(item => `<li style="margin-bottom: 8px; color: var(--text);">${item}</li>`).join('')}
          </ul>
        </div>`
      : '';

    dialog.innerHTML = `
      <div style="background: var(--panel, #1c1c1e); border-radius: 20px;
                  padding: ${compact ? '15px' : '30px'}; max-width: ${width}; width: 90%;
                  border: 2px solid ${color}; box-shadow: 0 20px 40px rgba(0,0,0,0.5);
                  text-align: left;">
        <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 20px;">
          <span style="font-size: 40px;">${icon}</span>
          <div>
            <h2 style="color: ${color}; margin: 0; font-size: 24px;">${title || 'Notice'}</h2>
            ${showVersion ? `<p style="color: var(--dim, #8e8e93); margin: 5px 0 0 0;">Version ${showVersion}</p>` : ''}
          </div>
        </div>
        ${message ? `<div style="color: var(--text, #ffffff); margin-bottom: 25px; line-height: 1.5; ${align}">${message}</div>` : ''}
        ${listHTML}
        ${bodyHTML ? `<div style="margin-bottom: 25px;">${bodyHTML}</div>` : ''}
        <div style="display: flex; gap: 15px; margin-top: 25px;">
          ${cancelText ? `<button id="modal-cancel" style="flex:1; padding:14px;
            background:var(--input, #2c2c2e); border:1px solid var(--border, #38383a);
            color:var(--text, #ffffff); border-radius:12px; font-weight:600; cursor:pointer;">
            ${cancelText}</button>` : ''}
          <button id="modal-confirm" style="flex:1; padding:14px; background:${color};
            border:none; color:white; border-radius:12px; font-weight:800; cursor:pointer;">
            ${confirmText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    const confirmBtn = dialog.querySelector('#modal-confirm');
    if (confirmBtn) {
      confirmBtn.onclick = () => {
        if (onConfirm) onConfirm();
        dialog.remove();
        resolve(true);
      };
    }
    if (cancelText) {
      const cancelBtn = dialog.querySelector('#modal-cancel');
      if (cancelBtn) {
        cancelBtn.onclick = () => {
          if (onCancel) onCancel();
          dialog.remove();
          resolve(false);
        };
      }
    }
  });
}
window.createModal = createModal;

/* ==============================================================
 * FLIGHT ID ROSTERISTA · haku lennon numerolla + päivällä
 * ============================================================== */
async function fetchFlightIdFromRoster(flightDateStr, flightNumberRaw, depIcaoRaw) {
  const token = typeof getValidSkyplanToken === 'function'
    ? await getValidSkyplanToken() : null;
  if (!token) {
    console.error('Valid Skyplan token unavailable.');
    return null;
  }

  let employeeId = null;
  if (typeof decodeJWT === 'function') {
    try {
      const employee = decodeJWT(token) || {};
      employeeId = employee.employeeid || employee.EmployeeID || employee.employeeId ||
                   employee.nameid || employee.sub ||
                   employee['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'] || null;
    } catch (e) {
      console.warn('Failed to decode JWT for EmployeeID', e);
    }
  }

  // Clean inputs
  const flightDigits = String(flightNumberRaw || '').replace(/\D/g, '');
  const cleanFlightNum = flightDigits ? String(parseInt(flightDigits, 10)) : '';
  const depIcao = String(depIcaoRaw || '').replace(/[^A-Za-z]/g, '').toUpperCase();

  // Local Date Parsing (avoiding UTC timezone shift)
  let baseDate = new Date();
  if (flightDateStr) {
    const parts = String(flightDateStr).split(/[-/.]/);
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        baseDate = new Date(parts[0], parseInt(parts[1], 10) - 1, parts[2]);
      } else if (parts[2].length === 4 || parts[2].length === 2) {
        const yr = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
        baseDate = new Date(yr, parseInt(parts[1], 10) - 1, parts[0]);
      }
    }
  }

  const formatLocalDate = (d) => {
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    return `${yr}-${mo}-${dy}`;
  };

  const fromDate = new Date(baseDate);
  fromDate.setDate(fromDate.getDate() - 1);
  const toDate = new Date(baseDate);
  toDate.setDate(toDate.getDate() + 1);

  const payload = {
    EmployeeID: String(employeeId || ''),
    From: formatLocalDate(fromDate),
    To: formatLocalDate(toDate)
  };

  try {
    const resp = await fetch('https://kcskyplanapi.airastana.com/api/v1/crew-roster-flights-details', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error(`Roster Error (HTTP ${resp.status}):`, errText);
      return null;
    }

    const data = await resp.json();
    const flights = Array.isArray(data.Flights) ? data.Flights : [];

    const allowedCarriers = ['KC', 'KZR', 'AYN', 'FS'];

    const match = flights.find(f => {
      if (!f) return false;
      const carrier = String(f.CarrierCode || '').trim().toUpperCase();
      const rawApiFlt = String(f.FlightNumber || '').replace(/\D/g, '');
      const apiFltNum = rawApiFlt ? String(parseInt(rawApiFlt, 10)) : '';

      const apiIcao = String(f.DepartureStationIcaoCode || '').toUpperCase();
      const apiIata = String(f.DepartureStationCode || '').toUpperCase();

      return allowedCarriers.includes(carrier) &&
             apiFltNum === cleanFlightNum &&
             (apiIcao === depIcao || apiIata === depIcao);
    });

    return match ? (match.ID || match.id || match.FlightID || null) : null;
  } catch (e) {
    console.error("fetchFlightIdFromRoster exception:", e);
    return null;
  }
}
window.fetchFlightIdFromRoster = fetchFlightIdFromRoster;

/* ==============================================================
 * REFRESH SINGLE FLIGHT · hakee yhden lennon tuoreet tiedot
 * ==============================================================
 * Käytetään aktiivisen lennon stand-päivitykseen.
 * Palauttaa tuoreen flight-objektin tai null.
 * ============================================================== */
async function refreshSingleFlightFromRoster(fid, stdIso) {
  if (!fid || !navigator.onLine) return null;

  try {
    const token = await getValidSkyplanToken().catch(() => null);
    if (!token) return null;

    let empId = null;
    if (typeof decodeJWT === 'function') {
      const emp = decodeJWT(token) || {};
      empId = emp.employeeid || emp.EmployeeID || emp.employeeId
           || emp.nameid || emp.sub;
    }
    if (!empId) return null;

    const stdDate = stdIso ? new Date(stdIso) : new Date();
    const from = new Date(stdDate.getTime() - 2 * 24 * 3600 * 1000);
    const to   = new Date(stdDate.getTime() + 2 * 24 * 3600 * 1000);

    const fmt = (d) =>
      `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    const resp = await fetch('https://kcskyplanapi.airastana.com/api/v1/crew-roster-flights-details', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        EmployeeID: String(empId),
        From: fmt(from),
        To: fmt(to)
      })
    });

    if (!resp.ok) {
      console.warn('[RefreshFlight] HTTP', resp.status);
      return null;
    }
    const data = await resp.json();
    const flights = Array.isArray(data.Flights) ? data.Flights : [];
    return flights.find(f =>
      String(f.ID || f.id || f.FlightID) === String(fid)
    ) || null;
  } catch (e) {
    console.warn('[RefreshFlight] error:', e);
    return null;
  }
}
window.refreshSingleFlightFromRoster = refreshSingleFlightFromRoster;


/* ==============================================================
 * REFRESH TOKEN · uusi access token refresh tokenilla
 * ==============================================================
 * Endpoint: POST /api/v1/auth/refresh-token
 * Header:   mobile-version: 1.2.0.94
 * Body:     { RefreshToken: "<current>" }
 * Response: { AccessToken, RefreshToken } ← molemmat uusia
 * ============================================================== */

/* ==============================================================
 * REFRESH TOKEN · uusi access token refresh tokenilla
 * ==============================================================
 * Endpoint: POST /api/v1/auth/refresh-token
 * Header:   mobile-version: 1.2.0.94
 * Body:     { RefreshToken: "<current>" }
 * Response: { AccessToken, RefreshToken } ← molemmat uusia
 *
 * Parannukset:
 *   - Cooldown 5 min epäonnistumisen jälkeen (estää 500-myrskyn)
 *   - Erottaa transientin (5xx/network) ja pysyvän (401/403) virheen
 *   - Logittaa serverin vastauksen 5xx-tapauksessa (debug)
 *   - Tallentaa uuden refresh tokenin backup-avaimeen
 *   - Ei poista refresh tokenia 500-tapauksessa
 * ============================================================== */

let _refreshInFlight = null;
let _lastModalShownAt = 0;
const MODAL_COOLDOWN_MS = 10 * 1000;   // 10 s

/* ==============================================================
 * GET VALID TOKEN · älykäs tokenin haku + refresh
 * ============================================================== */
window.getValidSkyplanToken = async function() {
  /* ==========================================================
   * 0. Offline — palauta cached token hiljaisesti
   * ========================================================== */
  if (!navigator.onLine) {
    try {
      const cached = localStorage.getItem('skyplan_token');
      if (cached && cached.length > 20) return cached;
    } catch (e) {}
    return null;
  }

  /* ==========================================================
   * 1. Cooldown-tila — HILJAINEN early return
   * ==========================================================
   * Jos refresh on epäonnistunut äskettäin, älä yritä uudelleen
   * äläkä logita. Tämä estää konsolin tulvimisen.
   * ========================================================== */
  if (_refreshFailedAt && (Date.now() - _refreshFailedAt) < REFRESH_FAIL_COOLDOWN_MS) {
    return null;
  }

  /* ==========================================================
   * 2. Jos refresh on jo käynnissä → odota
   * ========================================================== */
  if (window._skyplanTokenPromise) {
    return await window._skyplanTokenPromise;
  }

  /* ==========================================================
   * 3. Apurit
   * ========================================================== */
  const parseJwt = (t) => {
    if (typeof decodeJWT === 'function') {
      try {
        const res = decodeJWT(t);
        if (res) return res;
      } catch (e) {}
    }
    try {
      const parts = t.split('.');
      if (parts.length !== 3) return null;
      const base64Url = parts[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64).split('').map(c =>
          '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
        ).join('')
      );
      return JSON.parse(jsonPayload);
    } catch (e) { return null; }
  };

  /* ==========================================================
   * 4. Hae tokenit
   * ========================================================== */
  let token = null;
  let refreshToken = null;
  try {
    token = localStorage.getItem('skyplan_token');
    refreshToken = localStorage.getItem('skyplan_refresh_token');
    if (!refreshToken) {
      const backup = localStorage.getItem('skyplan_refresh_token_backup');
      if (backup) {
        refreshToken = backup;
        try { localStorage.setItem('skyplan_refresh_token', backup); } catch (e) {}
      }
    }
  } catch (e) {
    console.warn("localStorage access restricted:", e);
  }

  if (token) {
    token = token.trim().replace(/^Bearer\s+/i, '').replace(/^"+|"+$/g, '').trim();
    if (token === 'null' || token === 'undefined' || token === '') {
      token = null;
    } else {
      try { localStorage.setItem('skyplan_token', token); } catch (e) {}
    }
  }

  /* ==========================================================
   * 5. Access token vielä voimassa (>5 min jäljellä)
   * ========================================================== */
  if (token) {
    const decoded = parseJwt(token);
    if (decoded && typeof decoded.exp === 'number') {
      const now = Math.floor(Date.now() / 1000);
      if (decoded.exp > now + 300) return token;
    }
  }

  /* ==========================================================
   * 6. Ei access tokenia → ensimmäinen käyttö
   * ========================================================== */
  if (!token) {
    if (Date.now() - _lastModalShownAt < MODAL_COOLDOWN_MS) return null;
    
    if (typeof promptForTokenModal === 'function') {
      try {
        _lastModalShownAt = Date.now();
        window._skyplanTokenPromise = promptForTokenModal();
        const newToken = await window._skyplanTokenPromise;
        return newToken ? String(newToken).trim()
          .replace(/^Bearer\s+/i, '').replace(/^"+|"+$/g, '').trim() : null;
      } finally {
        window._skyplanTokenPromise = null;
      }
    }
    return null;
  }

  /* ==========================================================
   * 7. Access vanhentunut — tarkista refresh token
   * ========================================================== */
  if (refreshToken && refreshToken.length > 10) {
    const decodedRefresh = parseJwt(refreshToken);
    const refreshExpired = decodedRefresh && decodedRefresh.exp
      && (decodedRefresh.exp * 1000 < Date.now());
    
    if (refreshExpired) {
      // Refresh token oikeasti vanhentunut → käyttäjän pakko syöttää uusi
      console.log('[Token] Refresh token vanhentunut — pyydetään käyttäjältä');
      if (Date.now() - _lastModalShownAt < MODAL_COOLDOWN_MS) return null;
      
      if (typeof promptForTokenModal === 'function') {
        try {
          _lastModalShownAt = Date.now();
          window._skyplanTokenPromise = promptForTokenModal();
          const newToken = await window._skyplanTokenPromise;
          return newToken ? String(newToken).trim()
            .replace(/^Bearer\s+/i, '').replace(/^"+|"+$/g, '').trim() : null;
        } finally {
          window._skyplanTokenPromise = null;
        }
      }
      return null;
    }
    
    // Refresh token on voimassa → yritä refresh
    // HUOM: tämä logitus on tarkoituksella vain kerran — _refreshSkyplanToken
    // hoitaa tarkemman logiikan ja cooldownin asetuksen.
    try {
      const newToken = await _refreshSkyplanToken(refreshToken);
      if (newToken) return newToken;
    } catch (e) {
      console.warn('[Token] Refresh poikkeus:', e.message);
    }
    
    // Refresh epäonnistui → cooldown on nyt asetettu, ei logiteta
    return null;
  }

  /* ==========================================================
   * 8. Ei refresh tokenia → pakko hakea uusi
   * ========================================================== */
  if (Date.now() - _lastModalShownAt < MODAL_COOLDOWN_MS) return null;
  
  if (typeof promptForTokenModal === 'function') {
    try {
      _lastModalShownAt = Date.now();
      window._skyplanTokenPromise = promptForTokenModal();
      const newToken = await window._skyplanTokenPromise;
      return newToken ? String(newToken).trim()
        .replace(/^Bearer\s+/i, '').replace(/^"+|"+$/g, '').trim() : null;
    } finally {
      window._skyplanTokenPromise = null;
    }
  }
  return null;
};

/* ==============================================================
 * ROSTER · loadAssignedFlights
 * ============================================================== */
window.loadAssignedFlights = async function(isManualSearch = false, forceOnlineSync = false) {
  const container = document.getElementById('assigned-flights-container');
  const badgeEl = document.getElementById('assigned-cache-badge');
  if (!container) return;

  const cacheKey = 'assigned_flights_cache';
  const cacheTimeKey = 'assigned_flights_cache_time';

  const formatDateLocal = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const escapeQuotes = (str) => String(str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');

  const getCachedFlights = () => {
    try {
      const raw = localStorage.getItem(cacheKey);
      const rawTime = localStorage.getItem(cacheTimeKey) || '';
      const flights = raw ? JSON.parse(raw) : null;
      return { flights: Array.isArray(flights) ? flights : null, lastSyncTime: rawTime };
    } catch (e) {
      return { flights: null, lastSyncTime: '' };
    }
  };

  /* ==============================================================
   * renderTable — päivittää OFFLINE-badgen ja viikkonäkymän
   * ==============================================================
   * Taulukkonäkymä on poistettu. Tämä funktio:
   *   - Päivittää OFFLINE-badgen
   *   - Triggeröi viikkonäkymän uudelleenrenderöinnin (se lukee cachen)
   * ============================================================== */
  const renderTable = async (flights, isCached = false, lastSyncTime = '') => {
    // 1. OFFLINE-badge
    if (badgeEl) {
      if (isCached) {
        badgeEl.style.display = 'inline-block';
        badgeEl.textContent = `OFFLINE SINCE: ${lastSyncTime ? '(' + lastSyncTime + ')' : ''}`;
      } else {
        badgeEl.style.display = 'none';
      }
    }

    // 2. Tyhjennä piilotettu container (ei enää käytössä)
    if (container) {
      container.innerHTML = '';
    }

    // 3. Päivitä viikkonäkymä seuraavalla mikrotaskilla
    //    (ettei nykyinen kutsupino häiriinny)
    if (typeof renderWeekView === 'function') {
      setTimeout(() => {
        try { renderWeekView(); } catch (e) {
          console.warn('[Roster] WeekView render failed:', e);
        }
      }, 0);
    }

    // 4. Jos data on tyhjä ja online → käyttäjä näkee viikkonäkymän
    //    "Roster ei ole synkattu" -viestin. Ei lisätoimenpiteitä.
  };

  // Offline early exit
  if (!navigator.onLine && !forceOnlineSync) {
    const { flights, lastSyncTime } = getCachedFlights();
    if (flights && flights.length > 0) {
      await renderTable(flights, true, lastSyncTime);
      return;
    } else {
      if (badgeEl) badgeEl.style.display = 'none';
      container.innerHTML = '<div style="color: var(--error); text-align: center; padding: 40px; font-family: sans-serif;">⚡ Offline: No cached flights available. Please connect online to sync roster.</div>';
      return;
    }
  }

  const token = typeof getValidSkyplanToken === 'function'
    ? await getValidSkyplanToken().catch(() => null) : null;

  if (!token) {
    const { flights, lastSyncTime } = getCachedFlights();
    if (flights && flights.length > 0) {
      await renderTable(flights, true, lastSyncTime);
    } else {
      if (badgeEl) badgeEl.style.display = 'none';
      container.innerHTML = '<div style="color: var(--error); text-align: center; padding: 40px; font-family: sans-serif;">⚠️ No Skyplan token found. Please add it in Settings.</div>';
    }
    return;
  }

  const fromInput = document.getElementById('assigned-date-from');
  const toInput = document.getElementById('assigned-date-to');

  let fromStr = fromInput?.value;
  let toStr = toInput?.value;

  if (!fromStr || !toStr || !isManualSearch) {
    const today = new Date();
    const fromDate = new Date(today.getFullYear(), today.getMonth(), 1);
    const toDate   = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    fromStr = formatDateLocal(fromDate);
    toStr   = formatDateLocal(toDate);

    if (fromInput) fromInput.value = fromStr;
    if (toInput)   toInput.value   = toStr;
  }

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; gap: 12px; background: var(--panel); border: 1px solid var(--border); border-radius: 14px; margin: 10px 0;">
      <div style="width: 32px; height: 32px; border: 3px solid rgba(255,255,255,0.15); border-top-color: var(--accent, #007aff); border-radius: 50%; animation: efbSpin 0.9s linear infinite;"></div>
      <div style="font-size: 14px; font-weight: 700; color: var(--text); letter-spacing: 0.3px;">Syncing roster with Skyplan...</div>
      <div style="font-size: 12px; color: var(--dim);">Fetching latest flight schedules and status</div>
      <style>@keyframes efbSpin { 100% { transform: rotate(360deg); } }</style>
    </div>
  `;

  try {
    let employeeId = null;
    if (typeof decodeJWT === 'function') {
      try {
        const employee = decodeJWT(token) || {};
        employeeId = employee.employeeid || employee.EmployeeID || employee.employeeId ||
                    employee.nameid || employee.sub ||
                    employee['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'];
      } catch (e) {
        console.warn('Failed to decode JWT for employee ID:', e);
      }
    }

    if (!employeeId) {
      const { flights, lastSyncTime } = getCachedFlights();
      if (flights && flights.length > 0) {
        await renderTable(flights, true, lastSyncTime);
      } else {
        if (badgeEl) badgeEl.style.display = 'none';
        container.innerHTML = '<div style="color: var(--error); text-align: center; padding: 40px; font-family: sans-serif;">⚠️ Could not resolve Employee ID from token.</div>';
      }
      return;
    }

    const payload = {
      EmployeeID: String(employeeId),
      From: fromStr,
      To: toStr
    };

    const resp = await fetch('https://kcskyplanapi.airastana.com/api/v1/crew-roster-flights-details', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    }).catch(() => null);

    if (!resp || !resp.ok) {
      const { flights, lastSyncTime } = getCachedFlights();
      if (flights && flights.length > 0) {
        await renderTable(flights, true, lastSyncTime);
        if (typeof showToast === 'function') showToast('OFFLINE: Displaying cached roster.', 'info');
        return;
      }
      throw new Error(resp ? `API Error: ${resp.status}` : "Network connection error");
    }

    const data = await resp.json();
    let flights = Array.isArray(data.Flights) ? data.Flights : [];

    const allowedCarriers = ['KC', 'KZR', 'AYN', 'FS'];
    flights = flights.filter(f => f && allowedCarriers.includes(String(f.CarrierCode || '').trim().toUpperCase()));

    // Tallenna raaka API-vastaus
    window._lastRosterAPIResponse = flights.slice();
    try {
      localStorage.setItem('assigned_flights_last_api', JSON.stringify({
        from: fromStr,
        to: toStr,
        at: new Date().toISOString(),
        flights: flights
      }));
    } catch (e) {
      console.warn('[Roster] API-vastauksen tallennus epäonnistui:', e);
    }

    flights.sort((a, b) => {
      const tA = new Date(a.StdLt || a.Std || 0).getTime();
      const tB = new Date(b.StdLt || b.Std || 0).getTime();
      return tA - tB;
    });

    const syncTimeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    try {
      const existing = JSON.parse(localStorage.getItem(cacheKey) || '[]');
      const merged = (typeof window.mergeRosterFlights === 'function')
        ? window.mergeRosterFlights(existing, flights)
        : flights;
      localStorage.setItem(cacheKey, JSON.stringify(merged));
      localStorage.setItem(cacheTimeKey, syncTimeString);
      localStorage.setItem('assigned_flights_cache_range', JSON.stringify({
        from: fromStr,
        to:   toStr,
        at:   new Date().toISOString()
      }));
    } catch (e) {
      console.warn("Could not write roster cache:", e);
    }

    await renderTable(flights, false);

    // Background OFP caching
    if (typeof preloadAssignedOFPs === 'function') {
      setTimeout(() => {
        try {
          preloadAssignedOFPs(flights, token);
        } catch (preErr) {
          console.warn("Background preloading failed:", preErr);
        }
      }, 500);
    }

  } catch (e) {
    console.error("Schedule fetch failed:", e);
    const { flights, lastSyncTime } = getCachedFlights();
    if (flights && flights.length > 0) {
      await renderTable(flights, true, lastSyncTime);
    } else {
      if (badgeEl) badgeEl.style.display = 'none';
      container.innerHTML = `<div style="color: var(--error); text-align: center; padding: 40px; font-family: sans-serif;">Error: ${e.message}</div>`;
    }
  }
};

/* ==============================================================
 * OFP · fetchSkyplanOFPBytes
 * ============================================================== */
async function fetchSkyplanOFPBytes(flightId, token, flightNum = '', dateStr = '') {
  if (!flightId) {
    throw new Error("Cannot fetch OFP: Missing flightId.");
  }

  const safeGetOffline = async () => {
    if (typeof getPdfFromOfflineCache === 'function') {
      try {
        const cached = await getPdfFromOfflineCache(flightId, flightNum, dateStr);
        if (cached && cached.pdfBytes && (cached.pdfBytes.byteLength || cached.pdfBytes.length) > 0) {
          return cached;
        }
      } catch (e) {
        console.warn("[Offline Cache Read Error]", e);
      }
    }
    return null;
  };

  if (!navigator.onLine) {
    const offlineData = await safeGetOffline();
    if (offlineData) return offlineData;
    throw new Error(`Device offline. ${flightNum || 'Flight'} has not been cached for offline use yet.`);
  }

  const authToken = token || (typeof getValidSkyplanToken === 'function'
    ? await getValidSkyplanToken().catch(() => null) : null);
  if (!authToken) {
    const offlineData = await safeGetOffline();
    if (offlineData) return offlineData;
    throw new Error("Skyplan authentication token missing or expired.");
  }

  // 1. Käynnistä molemmat verkkopyynnöt HETI rinnakkain
  const v2Promise = fetch(`https://kcskyplanapi.airastana.com/api/v2/flights/${flightId}/ofp`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  }).catch(() => null);

  const v1Promise = fetch(`https://kcskyplanapi.airastana.com/api/v1/flights/${flightId}/ofp`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  }).catch(() => null);

  // 2. Käsittele v2 (metadata)
  let isFinalizedOnServer = false;
  let v2Status = null;

  try {
    const v2Resp = await v2Promise;
    if (v2Resp) {
      v2Status = v2Resp.status;
      if (v2Resp.ok) {
        const v2Data = await v2Resp.json();
        const filledObj = v2Data['Filled Document'] || v2Data.FilledDocument || v2Data.filledDocument;
        const hasFilledFlag = v2Data.HasFilledDocument || v2Data.hasFilledDocument ||
                              v2Data.isFinalized || v2Data.IsFinalized;

        if ((filledObj && typeof filledObj === 'object') || hasFilledFlag === true || hasFilledFlag === 'true') {
          isFinalizedOnServer = true;
          try {
            localStorage.setItem(`skyplan_finalized_${flightId}`, 'true');
          } catch (e) {}
        }
      }
    }
  } catch (e) {
    console.warn('[Skyplan v2 Metadata Warning]', e);
  }

    if (v2Status === 422) {
    const err = new Error(`OFP not generated by flight dispatch yet (HTTP 422).`);
    err.code = 'OFP_NOT_AVAILABLE';
    throw err;
  }

  // 3. Käsittele v1 (PDF)
  let v1Resp = null;
  try {
    v1Resp = await v1Promise;
  } catch (netErr) {
    console.warn("[Skyplan v1 Network Error]", netErr);
    const offlineData = await safeGetOffline();
    if (offlineData) return offlineData;
    throw new Error("Network request failed while downloading OFP.");
  }

  if (!v1Resp) throw new Error("No response from v1 OFP endpoint.");

  if (v1Resp.status === 401 || v1Resp.status === 403) {
    const offlineData = await safeGetOffline();
    if (offlineData) return offlineData;
    throw new Error("Skyplan authentication rejected (HTTP " + v1Resp.status + "). Please re-login.");
  }

  if (v1Resp.status === 422) {
    const err = new Error(`OFP not generated by flight dispatch yet (HTTP 422).`);
    err.code = 'OFP_NOT_AVAILABLE';
    err.isExpected = true;
    throw err;
  }

  if (!v1Resp.ok) {
    const offlineData = await safeGetOffline();
    if (offlineData) return offlineData;
    throw new Error(`Skyplan server error (HTTP ${v1Resp.status})`);
  }

  let rawPayload = null;
  const contentType = v1Resp.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const v1Data = await v1Resp.json();
    rawPayload = v1Data.FileContent || v1Data.File || v1Data.fileContent || v1Data.file;
  } else {
    rawPayload = await v1Resp.arrayBuffer();
  }

  if (!rawPayload) {
    throw new Error("No OFP document content returned by Skyplan.");
  }

  // 4. Pura ZIP tai käsittele raaka PDF
  const extractFn = (typeof extractPdfFromZipOrRaw === 'function')
    ? extractPdfFromZipOrRaw
    : (typeof window._extractPdfBytes === 'function' ? window._extractPdfBytes : null);

  if (!extractFn) {
    throw new Error("PDF decompression utility missing.");
  }

  const pdfBytes = await extractFn(rawPayload);
  const byteLength = pdfBytes ? (pdfBytes.byteLength || pdfBytes.length || 0) : 0;

  if (!pdfBytes || byteLength < 500) {
    throw new Error("Failed to extract valid PDF from Skyplan response (document corrupted or empty).");
  }

  // 5. Tallenna offline-cacheen
  if (typeof savePdfToOfflineCache === 'function') {
    try {
      await savePdfToOfflineCache(flightId, flightNum, dateStr, pdfBytes, isFinalizedOnServer);
    } catch (cacheErr) {
      console.warn("[Offline Cache Write Warning]", cacheErr);
    }
  }

  return {
    pdfBytes,
    isFinalized: isFinalizedOnServer,
    isServerFilled: isFinalizedOnServer,
    isCached: false
  };
}
window.fetchSkyplanOFPBytes = fetchSkyplanOFPBytes;

/* ==============================================================
 * JOURNEY LOG · _deepPick + fetchJourneyLog
 * ============================================================== */
function _deepPick(obj, keys, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return null;
  for (const k of keys) {
    const v = obj[k];
    if (v != null && v !== '') return v;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const found = _deepPick(v, keys, depth + 1);
      if (found != null && found !== '') return found;
    }
  }
  return null;
}

async function fetchJourneyLog(flightId, token) {
  if (!flightId) throw new Error("Cannot fetch journey log: Missing flightId.");

  const authToken = token || (typeof getValidSkyplanToken === 'function'
    ? await getValidSkyplanToken().catch(() => null) : null);
  if (!authToken) throw new Error("Skyplan authentication token missing or expired.");

  const url = `https://kcskyplanapi.airastana.com/api/v1/flights/${flightId}/journey-log`;
  const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${authToken}` } });

  if (resp.status === 401 || resp.status === 403)
    throw new Error("Skyplan authentication rejected. Please re-login.");
  if (resp.status === 422)
    throw new Error("Journey log not available yet (flight may not be completed).");
  if (!resp.ok)
    throw new Error(`Skyplan server error (HTTP ${resp.status})`);

  const data = await resp.json();

  const crewRaw = _deepPick(data, ['CrewDuty', 'crewDuty', 'crew']);
  const crewDuty = Array.isArray(crewRaw) ? crewRaw.map(c => ({
    staffId:   _deepPick(c, ['StaffID', 'StaffId', 'staffId', 'Id', 'id']),
    firstName: _deepPick(c, ['FirstName', 'firstName', 'firstname']) || '',
    lastName:  _deepPick(c, ['LastName',  'lastName',  'lastname'])  || '',
    position:  _deepPick(c, ['PositionCode', 'Position', 'position']) || '',
    fdp:       _deepPick(c, ['FDP', 'fdp']),
    maxFdp:    _deepPick(c, ['MaxFPD', 'MaxFdp', 'maxFdp'])
  })) : [];

  const result = {
    flightId:     _deepPick(data, ['FlightID', 'FlightId', 'flightId']) || flightId,
    flightNumber: _deepPick(data, ['FlightNumber', 'flightNumber']) || '',
    atd:          _deepPick(data, ['ATD', 'Atd', 'atd']),
    ata:          _deepPick(data, ['ATA', 'Ata', 'ata']),
    takeoff:      _deepPick(data, ['TakeOff', 'Takeoff', 'takeoff', 'Take_Off']),
    touchdown:    _deepPick(data, ['TouchDown', 'Touchdown', 'touchdown', 'Touch_Down']),
    blockTime:    _deepPick(data, ['BlockTime', 'blockTime', 'Block_Time']),
    flightTime:   _deepPick(data, ['FlightTime', 'flightTime', 'Flight_Time']),
    crewDuty,
    raw: data
  };

  return result;
}
window.fetchJourneyLog = fetchJourneyLog;

/* ==============================================================
 * AUTO-IMPORT · päättyneet lennot lokikirjaan
 * ============================================================== */
async function autoImportCompletedFlights(assignedFlights, token, ownStaffId) {
  const imported = [];

  for (const f of assignedFlights) {
    const flightId = f.ID || f.id || f.FlightID;
    if (!flightId) continue;

    if (typeof getLogbookEntryByFlightId === 'function' &&
        getLogbookEntryByFlightId(flightId)) continue;

    const sta = new Date(f.StaLt || f.Sta || 0).getTime();
    if (!sta || Date.now() < sta + 10 * 60 * 1000) continue;

    try {
      const log = await fetchJourneyLog(flightId, token);
      if (!log.ata) continue;

      if (typeof mapJourneyLogToEntry !== 'function') {
        console.warn('[AutoImport] mapJourneyLogToEntry puuttuu — ohitetaan');
        continue;
      }

      const entry = mapJourneyLogToEntry(log, {
        depIcao: f.DepartureStationIcaoCode,
        arrIcao: f.ArrivalStationIcaoCode,
        aircraftModel: f.AircraftDescription,
        aircraftReg: f.RegistrationNumber
      }, ownStaffId);

      if (typeof saveLogbookEntry === 'function') {
        saveLogbookEntry(entry);
        imported.push(entry);
      }
    } catch (e) {
      console.warn(`[Logbook AutoImport] Skip ${flightId}:`, e.message);
    }
  }

  if (imported.length && typeof showToast === 'function') {
    showToast(`${imported.length} lento(a) tuotu lokikirjaan — allekirjoita lopuksi.`, 'success');
  }
  return imported;
}
window.autoImportCompletedFlights = autoImportCompletedFlights;

/* ==============================================================
 * OFP PREVIEW · avaa OFP PDF-modaalissa
 * ============================================================== */
window.previewOFPFromSkyplan = async function(flightId, flightNum, dateStr, tailNumber = '', options = {}) {
  const { forceRefresh = false } = options;
  let pdfUrl = null;
  let downloadedBytes = null;

  const cleanupUrl = () => {
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
      pdfUrl = null;
    }
  };

  showModalLoader("Loading OFP",
    `Fetching flight plan for ${flightNum || 'Flight'} (${dateStr || ''})...`);

  try {
    let pdfBlob = null;
    let isFinalized = false;
    let isCached = false;

    // 0. Tarkistetaan RAM-muisti (0 millisekuntia)
    if (!forceRefresh && typeof window._getCachedPDFBytes === 'function') {
      const memBytes = window._getCachedPDFBytes(flightId);
      if (memBytes && (memBytes.byteLength || memBytes.length || 0) > 500) {
        downloadedBytes = memBytes;
        pdfBlob = new Blob([memBytes], { type: 'application/pdf' });
        isCached = true;
        console.log('[OFP] Ladataan RAM-muistista (välitön)');
      }
    }

    // 1. Jos ei RAM-muistissa, yritetään offline-cachea (IndexedDB)
    const tryReadOffline = async () => {
      if (forceRefresh) return null;
      if (typeof getPdfFromOfflineCache !== 'function') return null;
      try {
        const cached = await getPdfFromOfflineCache(flightId, flightNum, dateStr);
        if (cached && cached.pdfBytes && (cached.pdfBytes.byteLength || cached.pdfBytes.length || 0) > 500) {
          return cached;
        }
      } catch (e) {
        console.warn("[Offline Cache Read Warning]", e);
      }
      return null;
    };

    if (!pdfBlob) {
      const cached = await tryReadOffline();
      if (cached) {
        downloadedBytes = cached.pdfBytes;
        pdfBlob = new Blob([cached.pdfBytes], { type: 'application/pdf' });
        isFinalized = Boolean(cached.isFinalized);
        isCached = true;
        console.log('[OFP] Ladataan IndexedDB:stä');
      }
    }

    // 2. Jos ei vieläkään löytynyt, haetaan verkosta
    if (!pdfBlob) {
      if (typeof _getPDFBytesForFlight !== 'function') {
        throw new Error('PDF-cache puuttuu (ofp-data.js ei latautunut)');
      }
      // KORJAUS: Välitetään flightNum ja dateStr, jotta tallennus onnistuu oikein!
      const entry = await _getPDFBytesForFlight(flightId, { forceRefresh, flightNum, dateStr });
      downloadedBytes = entry.bytes;
      isFinalized = Boolean(entry.isFinalized);

      if (!downloadedBytes || (downloadedBytes.byteLength || downloadedBytes.length || 0) < 500) {
        throw new Error("Unable to retrieve valid OFP PDF data.");
      }

      // Varmistetaan, että tallennus onnistuu
      if (typeof savePdfToOfflineCache === 'function') {
        savePdfToOfflineCache(flightId, flightNum, dateStr, downloadedBytes, isFinalized).catch(() => {});
      }

      pdfBlob = new Blob([downloadedBytes], { type: 'application/pdf' });
    }

    if (!pdfBlob || pdfBlob.size < 500) {
      throw new Error("Document data is empty or corrupt.");
    }

    pdfUrl = URL.createObjectURL(pdfBlob);

    let statusTag = '';
    if (isCached) {
      statusTag = ' <span style="color: #ffb300; font-size: 11px; font-weight: bold; margin-left: 8px;">⚡Cache</span>';
    } else if (isFinalized) {
      statusTag = ' <span style="color: var(--success, #32d74b); font-size: 11px; font-weight: bold; margin-left: 8px;">✔ (Finalized)</span>';
    }

    const bodyHTML = `
      <div style="width: 100%; height: 75vh; position: relative; background: var(--bg, #000); border-radius: 8px; overflow: hidden;">
        <object data="${pdfUrl}" type="application/pdf" style="width: 100%; height: 100%; border: none;">
          <iframe src="${pdfUrl}" style="width: 100%; height: 100%; border: none;"></iframe>
        </object>
      </div>
    `;

    hideModalLoader();

    const modalConfig = {
      title: `${flightNum || 'FLT'} (${dateStr || ''})${statusTag}`,
      bodyHTML: bodyHTML,
      maxWidth: '92%',
      compact: true
    };

    modalConfig.confirmText = 'Sulje';
    modalConfig.onConfirm = () => cleanupUrl();

    if (typeof createModal === 'function') {
      createModal(modalConfig);
    }

    } catch (error) {
    cleanupUrl();
    hideModalLoader();
    
    const is422 = error.code === 'OFP_NOT_AVAILABLE' || String(error.message).includes('422');

    // Tulostetaan konsoliin vain oikeat virheet, ei 422-tilaa
    if (!is422) {
      console.error("Preview failed:", error);
    }

    if (is422) {
      if (typeof createModal === 'function') {
        createModal({ title: 'OFP ei ole vielä saatavilla', icon: '✈', type: 'info', message: 'Lennon OFP:tä ei ole vielä generoitu. Dispatch julkaisee sen yleensä 12–24 h ennen lähtöä.', confirmText: 'OK', compact: true });
      } else if (typeof showToast === 'function') {
        showToast('OFP ei ole vielä saatavilla.', 'info', 4000);
      }
      return;
    }

    if (typeof createModal === 'function') {
      createModal({
        title: 'Preview Failed',
        message: error.message || "Failed to load OFP preview.",
        type: 'error',
        icon: '⚠️',
        confirmText: 'OK',
        compact: true
      });
    } else {
      alert(error.message || "Failed to load OFP preview.");
    }
  }
};