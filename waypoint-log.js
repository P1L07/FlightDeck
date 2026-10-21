/* ==============================================================
 * WAYPOINT-LOG · Waypoint data + popup + GPS-proximity
 * ==============================================================
 * - Tallentaa ETO/ATO/FOB/EFOB/remarks/RVSM per waypoint
 * - Popup kartalta klikattaessa
 * - GPS: jos lähellä (<0.5 NM) → auto-open + ATO esitäyttö
 * - Data luettavissa myöhempää OFP-printtiä varten
 * ============================================================== */
'use strict';

const WP_LOG_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 vrk
const WP_PROXIMITY_NM = 5;
const WP_CHECK_INTERVAL_MS = 20000;

let _wpWatchStarted = false;
let _wpAutoOpenedNames = new Set();
let _wpLastCheck = 0;
let _wpActiveFlightId = null;
let _wpActiveWaypoints = null;
let _wpPopupOpen = false;

/* ---------------- Tallennus ---------------- */
function _wpKey(flightId, name) {
  return `waypoint:log:${flightId}:${String(name || '').toUpperCase()}`;
}

function getWaypointLog(flightId, name) {
  if (!flightId || !name) return null;
  return Cache.get(_wpKey(flightId, name), { mode: 'persist' })?.value || null;
}

function saveWaypointLog(flightId, name, data) {
  if (!flightId || !name) return;
  Cache.set(_wpKey(flightId, name), {
    ...data,
    updatedAt: new Date().toISOString()
  }, { ttlMs: WP_LOG_TTL_MS, mode: 'persist' });
}

function getAllWaypointLogs(flightId) {
  const out = {};
  if (!flightId) return out;
  try {
    const prefix = 'fdcache:waypoint:log:' + flightId + ':';
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(prefix)) {
        const name = key.substring(prefix.length);
        try {
          const entry = JSON.parse(localStorage.getItem(key));
          if (entry?.value) out[name] = entry.value;
        } catch (e) {}
      }
    }
  } catch (e) {}
  return out;
}

window.getWaypointLog = getWaypointLog;
window.saveWaypointLog = saveWaypointLog;
window.getAllWaypointLogs = getAllWaypointLogs;

/* ---------------- Apurit ---------------- */
function _wpDistNM(lat1, lon1, lat2, lon2) {
  const R = 3440.065;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _wpNowUtc() {
  const d = new Date();
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/* ---------------- Popup ---------------- */
async function showWaypointPopup(waypoint, flightId, options = {}) {
  if (!waypoint || !flightId) return;
  // FIX #9: Sulje edellinen popup ennen uuden avaamista
  if (_wpPopupOpen) {
    const existing = document.querySelector('div[style*="position: fixed"]');
    if (existing) existing.remove();
  }

  const { autoOpened = false, prefillAto = null, distanceNM = null } = options;
  const name = String(waypoint.name || '').toUpperCase();
  if (!name) return;

  let waited = 0;
  while (typeof window.createModal !== 'function' && waited < 5000) {
    await new Promise(r => setTimeout(r, 100));
    waited += 100;
  }
  if (typeof window.createModal !== 'function') {
    console.error('[WaypointPopup] createModal puuttuu');
    return;
  }

  _wpPopupOpen = true;

  const existing = getWaypointLog(flightId, name) || {};
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Esitäytä ETO laskennalla (jos ei vielä käyttäjän syöttämä)
  const prefill = (typeof getWaypointPrefill === 'function')
    ? getWaypointPrefill(flightId, waypoint) : {};
  const etoValue = existing.eto || prefill.eto || '';
  const atoValue = prefillAto || existing.ato || '';
  const fobValue = existing.fob != null ? existing.fob
                 : (waypoint.fob != null && waypoint.fob > 0 ? waypoint.fob : '');
  const efobValue = existing.efob != null
    ? existing.efob
    : (prefill.efob != null ? prefill.efob : '');
  const remarksValue = existing.remarks || '';
  const rvsmChecked = !!existing.rvsm;

  const distText = distanceNM != null ? ` · ${distanceNM.toFixed(1)} NM` : '';
  const autoTag = autoOpened
    ? `<div style="font-size:11px; color:var(--success); padding:6px 10px;
                   background:rgba(50,215,75,0.08); border-radius:6px;
                   border:1px solid rgba(50,215,75,0.35); margin-bottom:10px;">
         📍 Avattu GPS perusteella ${distText}
       </div>`
    : '';

  const inputStyle = 'width:100%; padding:8px 10px; border-radius:6px; background:var(--input);' +
                     'color:var(--text); border:1px solid var(--border); box-sizing:border-box;';

  const bodyHTML = `
    <div style="display:flex; flex-direction:column; gap:12px;">
      ${autoTag}
      <div style="font-size:11.5px; color:var(--dim);">
        <strong style="color:var(--accent); font-size:15px;">${esc(name)}</strong>
        ${waypoint.awy && waypoint.awy !== '-' ? ` · ${esc(waypoint.awy)}` : ''}
        ${!autoOpened && distText ? ` · ${distText}` : ''}
      </div>

      <div style="display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1fr); gap:10px;">
        <div>
          <label style="display:block; font-size:11px; font-weight:600; color:var(--dim); margin-bottom:4px;">ETO (UTC)</label>
          <input type="time" id="wp-eto" value="${esc(etoValue)}"
                 style="${inputStyle} font-family:var(--font-mono); font-size:13px;">
        </div>
        <div>
          <label style="display:block; font-size:11px; font-weight:600; color:var(--dim); margin-bottom:4px;">ATO (UTC)</label>
          <input type="time" id="wp-ato" value="${esc(atoValue)}"
                 style="${inputStyle} font-family:var(--font-mono); font-size:13px;">
        </div>
        <div>
          <label style="display:block; font-size:11px; font-weight:600; color:var(--dim); margin-bottom:4px;">FOB (kg)</label>
          <input type="number" id="wp-fob" value="${esc(fobValue)}" placeholder="0"
                 style="${inputStyle} font-family:var(--font-mono); font-size:13px;">
        </div>
        <div>
          <label style="display:block; font-size:11px; font-weight:600; color:var(--dim); margin-bottom:4px;">EFOB (kg)</label>
          <input type="number" id="wp-efob" value="${esc(efobValue)}" placeholder="0"
                 style="${inputStyle} font-family:var(--font-mono); font-size:13px;">
        </div>
      </div>

      <div>
        <label style="display:block; font-size:11px; font-weight:600; color:var(--dim); margin-bottom:4px;">Remarks</label>
        <textarea id="wp-remarks" rows="2" placeholder="Valinnainen"
              style="${inputStyle} font-size:12.5px; resize:vertical; min-height:44px; max-height:120px;">${esc(remarksValue)}</textarea>
      </div>

      <label style="display:flex; align-items:center; gap:10px; cursor:pointer; padding:8px 10px;
                    background:var(--input); border-radius:6px; border:1px solid var(--border);">
        <input type="checkbox" id="wp-rvsm" ${rvsmChecked ? 'checked' : ''}
               style="width:18px; height:18px; accent-color:var(--accent); cursor:pointer;">
        <span style="flex:1; font-size:12.5px; font-weight:600;">RVSM check OK</span>
      </label>
    </div>
  `;

  window.createModal({
    title: `Waypoint · ${name}`,
    icon: '📍',
    bodyHTML,
    confirmText: 'Tallenna',
    cancelText: 'Peruuta',
    maxWidth: '540px',
    compact: true,
    onConfirm: () => {
      _wpPopupOpen = false;

      const eto = document.getElementById('wp-eto')?.value || '';
      const ato = document.getElementById('wp-ato')?.value || '';
      const fobRaw = document.getElementById('wp-fob')?.value || '';
      const efobRaw = document.getElementById('wp-efob')?.value || '';
      const remarks = (document.getElementById('wp-remarks')?.value || '').trim();
      const rvsm = !!document.getElementById('wp-rvsm')?.checked;

      saveWaypointLog(flightId, name, {
        name,
        eto,
        ato,
        fob: fobRaw === '' ? null : parseInt(fobRaw, 10),
        efob: efobRaw === '' ? null : parseInt(efobRaw, 10),
        remarks,
        rvsm
      });

      if (typeof showToast === 'function') {
        showToast(`Waypoint ${name} tallennettu.`, 'success', 2000);
      }

      // Refresh map to show updated waypoint color
      const mapEl = document.getElementById('fc-map');
      const last = mapEl?._lastFlight;
      if (last && typeof renderFlightMap === 'function') {
        renderFlightMap(mapEl, last.dep, last.arr, last.options || {})
          .catch(() => {});
      }
    },
    onCancel: () => {
      _wpPopupOpen = false;
    }
  });
}

window.showWaypointPopup = showWaypointPopup;

/* ---------------- GPS Proximity ---------------- */
let _wpCheckInterval = null;

function startWaypointGPSWatch(flightId, waypoints) {
  if (!flightId || !Array.isArray(waypoints)) return;

  _wpActiveFlightId = flightId;
  _wpActiveWaypoints = waypoints.filter(w => w?.lat && w?.lon);
  _wpAutoOpenedNames.clear();

  // 1. Oikea GPS-watch (vain kerran)
  if (!_wpWatchStarted && typeof LocationService !== 'undefined' && LocationService.isSupported()) {
    _wpWatchStarted = true;
    LocationService.watch(
      (pos) => _checkWaypointProximity(pos),
      (err) => console.warn('[Waypoint GPS]', err.message)
    );
  }

  // 2. Interval-pohjainen tarkistus (toimii sekä GPS:llä että mockilla)
  if (_wpCheckInterval) clearInterval(_wpCheckInterval);
  _wpCheckInterval = setInterval(() => {
    if (typeof LocationService === 'undefined' || !LocationService.getLast) return;
    const pos = LocationService.getLast();
    if (pos) _checkWaypointProximity(pos);
  }, 10000);

  console.log(`[Waypoint GPS] Started · ${_wpActiveWaypoints.length} waypoints`);
}

function _checkWaypointProximity(pos) {
  if (!pos || !_wpActiveFlightId || !_wpActiveWaypoints) return;
  
  // FIX #7: FOB tarkistetaan vain 30 min välein
  const lastCheck = Cache.get(`waypoint:lastcheck:${_wpActiveFlightId}`, { mode: 'persist' })?.value || 0;
  if (Date.now() - lastCheck < 30 * 60 * 1000) return; 
  if (_wpPopupOpen) return;

  const now = Date.now();
  // 3 s cooldown (oli 20 s) — sallii nopean testauksen
  if (now - _wpLastCheck < 3000) return;
  _wpLastCheck = now;

  // Etsi lähin
  let nearest = null;
  let nearestDist = Infinity;

  for (const wp of _wpActiveWaypoints) {
    const name = String(wp.name || '').toUpperCase();
    if (!name || _wpAutoOpenedNames.has(name)) continue;

    const dist = _wpDistNM(pos.lat, pos.lon, wp.lat, wp.lon);
    if (dist <= WP_PROXIMITY_NM && dist < nearestDist) {
      nearest = wp;
      nearestDist = dist;
    }
  }

  if (!nearest) return;

  const name = String(nearest.name || '').toUpperCase();
  _wpAutoOpenedNames.add(name);
  console.log(`[Waypoint GPS] Near ${name} (${nearestDist.toFixed(2)} NM) — auto-open`);

  showWaypointPopup(nearest, _wpActiveFlightId, {
    autoOpened: true,
    prefillAto: _wpNowUtc(),
    distanceNM: nearestDist
  }).catch(e => console.warn('[Waypoint GPS] popup failed:', e));

  Cache.set(`waypoint:lastcheck:${flightId}`, Date.now(), { ttlMs: 24 * 60 * 60 * 1000, mode: 'persist' });
}

function stopWaypointGPSWatch() {
  if (_wpCheckInterval) {
    clearInterval(_wpCheckInterval);
    _wpCheckInterval = null;
  }
  if (typeof LocationService !== 'undefined') {
    LocationService.stopWatch();
  }
  _wpWatchStarted = false;
  _wpAutoOpenedNames.clear();
  _wpActiveFlightId = null;
  _wpActiveWaypoints = null;
}

window.startWaypointGPSWatch = startWaypointGPSWatch;
window.stopWaypointGPSWatch = stopWaypointGPSWatch;

/* Debug-apurit */
window._checkWaypointProximity = _checkWaypointProximity;
window._resetWaypointCooldown = function() {
  _wpLastCheck = 0;
  console.log('[Waypoint GPS] Cooldown nollattu');
};
window._resetAutoOpened = function() {
  _wpAutoOpenedNames.clear();
  console.log('[Waypoint GPS] Auto-opened reset');
};

/* ==============================================================
 * ETO / EFOB LASKENNAT
 * ==============================================================
 * - calcETO: takeoff-aika + waypoint.totalMins → "HH:MM"
 * - calcEFOB: takeoffFuel - kulunut polttoaine
 * ============================================================== */

function calcETO(takeoffIso, cumulativeMinutes) {
  if (!takeoffIso) return '';
  const t = new Date(new Date(takeoffIso).getTime() + (Number(cumulativeMinutes) || 0) * 60000);
  if (isNaN(t.getTime())) return '';
  return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
}

function calcEFOB(takeoffFuelKg, consumedKg) {
  if (takeoffFuelKg == null || isNaN(takeoffFuelKg)) return null;
  return Math.max(0, Math.round(Number(takeoffFuelKg) - (Number(consumedKg) || 0)));
}

/**
 * Hakee lennon kontekstin (takeoff-aika ja -fuel) ja laskee ETO/EFOB
 * prefill-arvot waypointille.
 */
function getWaypointPrefill(flightId, waypoint) {
  const out = { eto: '', efob: null };

  try {
    // 1. Takeoff ISO: skyplan syöttää sen cacheen
    let takeoffIso = null;
    let takeoffFuelKg = null;

    // Yritä lukea Cache
    if (typeof Cache !== 'undefined') {
      const mk = Cache.get(`flight:context:${flightId}`, { mode: 'persist' });
      if (mk?.value) {
        takeoffIso = mk.value.takeoffIso || null;
        takeoffFuelKg = mk.value.takeoffFuelKg || null;
      }
    }

    // Fallback: journey-log ATD
    if (!takeoffIso && typeof getCachedJourneyLog === 'function') {
      const log = getCachedJourneyLog(flightId);
      takeoffIso = log?.takeoff || log?.atd || null;
    }

    // 2. ETO
    if (takeoffIso && waypoint.totalMins) {
      out.eto = calcETO(takeoffIso, waypoint.totalMins);
    }

    // 3. EFOB
    if (takeoffFuelKg != null && waypoint.fob != null) {
      // OFP:n fuel consumption up to this waypoint = takeoffFuel (wpt[0]) - wpt.fob
      // Etsi takeoff wpt:n fob
      const wp0 = (window._lastWaypoints || [])[0];
      if (wp0 && wp0.fob != null) {
        const consumed = Math.max(0, Number(wp0.fob) - Number(waypoint.fob));
        out.efob = calcEFOB(takeoffFuelKg, consumed);
      }
    }
  } catch (e) {
    console.warn('[Prefill]', e);
  }

  return out;
}

window.calcETO = calcETO;
window.calcEFOB = calcEFOB;
window.getWaypointPrefill = getWaypointPrefill;

/* ==============================================================
 * TAKEOFF PROMPT · kysy ATO + takeoff fuel
 * ============================================================== */
let _takeoffPromptShown = new Set();

async function showTakeoffModal(flight, fid, prefillAto = null) {
  const { current, next } = (typeof _findCurrentAndNextFlights === 'function')
    ? _findCurrentAndNextFlights() : {};
  const f = flight || current || next;
  if (!f) {
    if (typeof showToast === 'function') showToast('Ei aktiivista lentoa.', 'warning');
    return;
  }

  const flightId = fid || String(f.ID || f.id || f.FlightID || '');
  if (!flightId) return;

  const carrier = String(f.CarrierCode || '').trim();
  const fltNo = String(f.FlightNumber || '').trim();
  const flightNum = (carrier && fltNo.startsWith(carrier)) ? fltNo : `${carrier}${fltNo}`;

  const now = new Date();
  // Käytetään prefillAto jos annettu, muuten nykyistä UTC-aikaa
  const defaultAto = prefillAto || `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;

  let waited = 0;
  while (typeof window.createModal !== 'function' && waited < 5000) {
    await new Promise(r => setTimeout(r, 100));
    waited += 100;
  }
  if (typeof window.createModal !== 'function') return;

  const inputStyle = 'width:100%; padding:10px 12px; border-radius:8px; background:var(--input); color:var(--text); border:1px solid var(--border); font-size:14px; box-sizing:border-box; font-family:var(--font-mono);';

  const bodyHTML = `
    <div style="display:flex; flex-direction:column; gap:14px;">
      <div style="font-size:13px; color:var(--dim);">
        <strong style="color:var(--accent);">${_esc(flightNum)}</strong>
        ${_esc(f.DepartureStationIcaoCode || '')} → ${_esc(f.ArrivalStationIcaoCode || '')}
      </div>
      ${prefillAto ? `
        <div style="font-size:11.5px; color:var(--success); padding:8px 10px; background:rgba(50,215,75,0.08); border-radius:6px; border:1px solid rgba(50,215,75,0.3);">
          📡 Journey-logista haettu ATO: <b>${prefillAto}</b>
        </div>
      ` : ''}
      <div style="font-size:12px; color:var(--warning); padding:10px; background:rgba(255,179,0,0.08); border-radius:8px; border:1px solid rgba(255,179,0,0.25);">
        Syötä toteutunut lähtöaika ja takeoff-polttoaine. Nämä tallennetaan lennon kontekstiin ja käytetään waypoint-EFOB- ja ETO-laskennoissa.
      </div>
      <div>
        <label style="display:block; font-size:11.5px; font-weight:600; color:var(--dim); margin-bottom:4px;">ATO (UTC)</label>
        <input type="time" id="tk-ato" value="${defaultAto}" style="${inputStyle}">
      </div>
      <div>
        <label style="display:block; font-size:11.5px; font-weight:600; color:var(--dim); margin-bottom:4px;">Takeoff Fuel (kg)</label>
        <input type="number" id="tk-fuel" placeholder="esim. 7500" style="${inputStyle}">
      </div>
    </div>
  `;

  window.createModal({
    title: '✈️ Takeoff',
    icon: '✈️',
    type: 'info',
    confirmText: 'Tallenna',
    cancelText: 'Peruuta',
    maxWidth: '440px',
    compact: true,
    bodyHTML,
    onConfirm: () => {
      const ato = document.getElementById('tk-ato')?.value || '';
      const fuel = parseInt(document.getElementById('tk-fuel')?.value, 10) || null;

      // Haetaan olemassa oleva context tai luodaan uusi
      const ctx = (typeof Cache !== 'undefined')
        ? (Cache.get(`flight:context:${flightId}`, { mode: 'persist' })?.value || {})
        : {};

      if (ato) {
        const dateStr = String(f.StdLt || f.Std || '').split('T')[0] || new Date().toISOString().split('T')[0];
        ctx.takeoffIso = `${dateStr}T${ato}:00.000Z`; // Pakotetaan uusi ATO
      }
      if (fuel) ctx.takeoffFuelKg = fuel;

      if (typeof Cache !== 'undefined') {
        Cache.set(`flight:context:${flightId}`, ctx, {
          ttlMs: 24 * 60 * 60 * 1000, mode: 'persist'
        });
      }

      _takeoffPromptShown.add(flightId);

      if (typeof showToast === 'function') {
        showToast(`Takeoff tallennettu: ${ato}${fuel ? ' · ' + fuel + ' kg' : ''}`, 'success');
      }

      // Päivitetään vain lähin kenttä, ei koko dashboardia
      if (typeof window._updateNearestAirport === 'function') {
        try { window._updateNearestAirport(); } catch (e) {}
      }
    }
  });
}

window.showTakeoffModal = showTakeoffModal;

/* GPS-nopeuden tarkkailu */
async function _checkTakeoffSpeed(pos) {
  if (!pos || pos.speed == null) return;
  
  const speedKts = pos.speed * 1.94384;
  if (speedKts < 35) return;

  const { current, next } = (typeof _findCurrentAndNextFlights === 'function')
    ? _findCurrentAndNextFlights() : {};
  const flight = current || next;
  if (!flight) return;

  const fid = String(flight.ID || flight.id || flight.FlightID || '');
  if (!fid || _takeoffPromptShown.has(fid)) return;

  // Tarkistetaan, ollaanko lennon aikaikkunassa
  const stdMs = new Date(flight.StdLt || flight.Std || 0).getTime();
  const staMs = new Date(flight.StaLt || flight.Sta || 0).getTime();
  const nowMs = Date.now();
  if (nowMs < stdMs - 15 * 60 * 1000 || nowMs > staMs + 15 * 60 * 1000) return;

  // Estetään tuplalaukaisu
  _takeoffPromptShown.add(fid);

  let autoAto = null;

  // Yritetään hakea takeoff aika journey-logista
  if (navigator.onLine && typeof fetchJourneyLog === 'function') {
    try {
      const log = await fetchJourneyLog(fid);
      if (log?.takeoff || log?.atd) {
        const timeIso = log.takeoff || log.atd;
        if (typeof hhmmFromIso === 'function') {
          autoAto = hhmmFromIso(timeIso);
        }
        
        // Päivitetään context suoraan, jotta kartta saa oikean ajan
        const ctx = Cache.get(`flight:context:${fid}`, { mode: 'persist' })?.value || {};
        ctx.takeoffIso = timeIso;
        Cache.set(`flight:context:${fid}`, ctx, { ttlMs: 24 * 60 * 60 * 1000, mode: 'persist' });
        
        if (typeof showToast === 'function') {
          showToast(`Takeoff-aika haettu automaattisesti: ${autoAto} UTC`, 'success');
        }
      }
    } catch (e) {
      console.warn('[Auto ATO] Journey log fetch failed:', e);
    }
  }

  // Avataan modaali (joko autoAto esitäytettynä tai ilman)
  showTakeoffModal(flight, fid, autoAto);
}
window._checkTakeoffSpeed = _checkTakeoffSpeed;

/* ---------------- Tulevaa print-logiikkaa varten ---------------- */
// Nämä täytetään myöhemmin:
// - calcETO(takeoffIso, cumulativeMinutes) → "HH:MM"
// - calcEFOB(takeoffFuelKg, cumulativeFuelBurn) → number
//
// Print-funktio voi lukea tallennetut arvot:
//   const logs = getAllWaypointLogs(flightId);
//   waypoints.forEach(wp => {
//     const log = logs[wp.name.toUpperCase()];
//     // log?.eto, log?.ato, log?.fob, log?.efob, log?.remarks, log?.rvsm
//   });