/* ==============================================================
 * TRIP INFO · Kortin sisäinen lomake briefing-sivulle
 * ==============================================================
 * - Kapteenin nimi Skyplanista (crewData)
 * - Painot ja polttoaineet OFP:stä (jaettu PDF-cache)
 * - Overlay jos OFP ei saatavilla
 * - Race-safe: vanha lataus ei kirjoita uuteen DOMiin
 * ============================================================== */
'use strict';

const TRIP_CAPTAIN_KEY = 'efb_captain_name';

/* In-flight dedup */
const _tripOFPInFlight  = new Map();   // fid → Promise
const _tripCrewInFlight = new Map();   // fid → Promise

/* Race-condition esto */
let _tripRenderGen = 0;

/* ==============================================================
 * OFP-parseri (ennallaan)
 * ============================================================== */
function _parseOFPFuelAndWeights(lines) {
  if (!Array.isArray(lines)) return null;

  const clean = s => String(s || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\t/g, ' ')
    .trim();

  const R = {
    mtow: 0, mlw: 0, mzfw: 0,
    tow: 0, lw: 0, zfw: 0,
    blockFuel: 0, minBlockFuel: 0,
    taxiFuel: 0, tripFuel: 0,
    tripTime: '', blockTime: '',
    requestNumber: ''
  };

  for (const raw of lines) {
    const line = clean(raw);

    if (/MTOW/i.test(line)) {
      const m1 = line.match(/MTOW\s+(\d+)/i); if (m1) R.mtow = parseInt(m1[1], 10);
      const m2 = line.match(/MLW\s+(\d+)/i);  if (m2) R.mlw  = parseInt(m2[1], 10);
      const m3 = line.match(/MZFW\s+(\d+)/i); if (m3) R.mzfw = parseInt(m3[1], 10);
    }

    if (/^\s*TOW\s+\d+/i.test(line)) {
      const m1 = line.match(/TOW\s+(\d+)/i); if (m1) R.tow = parseInt(m1[1], 10);
      const m2 = line.match(/LW\s+(\d+)/i);  if (m2) R.lw  = parseInt(m2[1], 10);
      const m3 = line.match(/ZFW\s+(\d+)/i); if (m3) R.zfw = parseInt(m3[1], 10);
    }

    if (!R.requestNumber && /REQUEST\s*#/i.test(line)) {
      const m = line.match(/REQUEST\s*#\s*(\d+)/i);
      if (m) R.requestNumber = m[1];
    }

    if (/BLOCK\s+FUEL/i.test(line)) {
      const m = line.match(/BLOCK\s+FUEL\s+(\d{1,2}[.:]\d{2})\s+(\d+)/i);
      if (m) {
        R.blockTime = m[1].replace('.', ':');
        R.blockFuel = parseInt(m[2], 10);
      } else {
        const m2 = line.match(/BLOCK\s+FUEL[^\d]*(\d+)/i);
        if (m2) R.blockFuel = parseInt(m2[1], 10);
      }
    }

    if (/MINIMUM\s+BLOCK/i.test(line)) {
      const m = line.match(/MINIMUM\s+BLOCK\s+(\d+)/i);
      if (m) R.minBlockFuel = parseInt(m[1], 10);
    }

    if (/^TAXI\s+\d/i.test(line)) {
      const m = line.match(/^TAXI\s+(\d+)/i);
      if (m) R.taxiFuel = parseInt(m[1], 10) || 0;
    }

    if (/^TRIP\s+/i.test(line)) {
      const m = line.match(/TRIP\s+(\d{1,2}[.:]\d{2})\s+(\d+)/i);
      if (m) {
        R.tripTime = m[1].replace('.', ':');
        R.tripFuel = parseInt(m[2], 10);
      }
    }
  }

  return R;
}

/* ==============================================================
 * Hae OFP-data — jaettu PDF-cache
 * ============================================================== */
async function _getTripOFPData(fid) {
  if (!fid) return null;
  const key = String(fid);

  // localStorage-cache (6h)
  const cacheKey = `jarvis_ofp_weights_${key}`;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const c = JSON.parse(raw);
      if (c?.at && Date.now() - new Date(c.at).getTime() < 6 * 60 * 60 * 1000) {
        return c.data;
      }
    }
  } catch (e) {}

  // In-flight dedup
  if (_tripOFPInFlight.has(key)) return await _tripOFPInFlight.get(key);

  const p = (async () => {
    try {
      if (typeof getPDFLinesForFlight !== 'function') return null;

      // Sama rivivälimuisti kuin NOTAM- ja waypoint-parsereilla
      const lines = await getPDFLinesForFlight(key);
      const parsed = _parseOFPFuelAndWeights(lines);

      try {
        localStorage.setItem(cacheKey, JSON.stringify({
          at: new Date().toISOString(),
          data: parsed
        }));
      } catch (e) {}

      return parsed;
    } catch (e) {
      const msg = String(e?.message || '');
      if (!msg.includes('422') && !msg.includes('not generated')) {
        console.warn('[TripInfo] OFP parse failed:', e.message);
      }
      return null;
    }
  })();

  _tripOFPInFlight.set(key, p);
  try {
    return await p;
  } finally {
    _tripOFPInFlight.delete(key);
  }
}

/* ==============================================================
 * Hae crew — in-flight dedup + hiljaisempi
 * ============================================================== */
async function _getTripCrew(fid) {
  const empty = { captain: '', fc: 0, cc: 0, dhc: 0 };
  if (!fid) return empty;
  const key = String(fid);

  if (_tripCrewInFlight.has(key)) return await _tripCrewInFlight.get(key);

  const p = (async () => {
    let log = (typeof getCachedJourneyLog === 'function')
      ? getCachedJourneyLog(key)
      : null;

    if (!log?.crewDuty?.length) {
      try {
        const token = (typeof getValidSkyplanToken === 'function')
          ? await getValidSkyplanToken().catch(() => null)
          : null;
        if (token && typeof fetchJourneyLog === 'function') {
          log = await fetchJourneyLog(key, token);
          if (log?.crewDuty?.length && typeof _cacheJourneyLog === 'function') {
            _cacheJourneyLog(key, log);
          }
        }
      } catch (e) {
        const msg = String(e?.message || '');
        if (!msg.includes('422') && !msg.includes('not available') && !msg.includes('not been completed')) {
          console.warn('[TripCrew] journey-log failed:', e.message);
        }
        return empty;
      }
    }

    if (!log?.crewDuty?.length) return empty;

    // Käytä olemassa olevaa parseria
    if (typeof parseCrewFromJourneyLog === 'function') {
      const parsed = parseCrewFromJourneyLog(log);
      const captain = parsed?.pic?.name || '';
      const fc = (parsed?.pic ? 1 : 0) + (parsed?.fo ? 1 : 0);
      const cc = (parsed?.ifs ? 1 : 0) + (parsed?.cabin?.length || 0);
      return { captain, fc, cc, dhc: 0 };
    }

    // Fallback
    const FLIGHT_DECK = ['CP','CAPT','PIC','P1','FO','SIC','P2','SO'];
    const CAPTAIN_POS = ['CP','CAPT','PIC','P1'];
    const DHC_POS     = ['DHC','DEADHEAD'];

    let captain = '';
    let fc = 0, cc = 0, dhc = 0;

    log.crewDuty.forEach(c => {
      const pos = String(c.position || '').toUpperCase().trim();
      if (DHC_POS.includes(pos)) {
        dhc++;
      } else if (FLIGHT_DECK.includes(pos)) {
        fc++;
        if (CAPTAIN_POS.includes(pos) && !captain) {
          captain = [c.firstName, c.lastName].filter(Boolean).join(' ').toUpperCase();
        }
      } else {
        cc++;
      }
    });

    return { captain, fc, cc, dhc };
  })();

  _tripCrewInFlight.set(key, p);
  try {
    return await p;
  } finally {
    _tripCrewInFlight.delete(key);
  }
}

/* ==============================================================
 * Renderöi Trip Info -kortti
 * ============================================================== */
async function renderTripInfoCard(containerId, flight) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!flight) {
    el.innerHTML = '<div class="empty">Ei valittua lentoa</div>';
    return;
  }

  const fid = String(flight.ID || flight.id || flight.FlightID || '');
  if (!fid) {
    el.innerHTML = '<div class="empty">Ei Flight ID:tä</div>';
    return;
  }

  const myGen = ++_tripRenderGen;

  // Loading-viesti
  el.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px; padding:16px 4px;">
      <div class="loader-spinner" style="transform:scale(0.7);"><span></span><span></span><span></span></div>
      <span style="font-size:12px; color:var(--dim);">Ladataan tietoja…</span>
    </div>`;

  // Hae rinnakkain
  const [crew, ofp] = await Promise.all([
    _getTripCrew(fid),
    _getTripOFPData(fid)
  ]);

  // Race-condition check
  if (myGen !== _tripRenderGen || !el.isConnected) return;

  const hasOFP = !!ofp;

  // Fallbackit
  const captain = crew.captain || localStorage.getItem(TRIP_CAPTAIN_KEY) || '';
  const fc = crew.fc || 2;
  const cc = crew.cc || 4;
  const dhc = crew.dhc || 0;

  const mtow  = ofp?.mtow  || 0;
  const mlw   = ofp?.mlw   || 0;
  const ramp  = ofp?.blockFuel || 0;
  const taxi  = ofp?.taxiFuel  || 0;
  const tof   = Math.max(0, ramp - taxi);
  const trip  = ofp?.tripFuel  || 0;
  const tripT = ofp?.tripTime  || '00:00';
  const ofpReq = ofp?.requestNumber || '';

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Overlay jos OFP puuttuu
  const overlayHTML = !hasOFP ? `
    <div id="ti-ofp-overlay"
         style="position:absolute; inset:0; z-index:10;
                background:rgba(6,10,21,0.92);
                backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
                display:flex; flex-direction:column;
                align-items:center; justify-content:center;
                gap:16px; padding:24px; border-radius:12px;
                text-align:center; animation:tiFadeIn 0.3s ease;">
      <div style="font-size:32px;">✈</div>
      <div>
        <div style="font-weight:700; color:var(--text); font-size:15px; margin-bottom:8px;">
          OFP ei ole vielä julkaistu.
        </div>
      </div>
      <style>@keyframes tiFadeIn{from{opacity:0}to{opacity:1}}</style>
    </div>
  ` : '';

  el.innerHTML = `
    <div style="position:relative;">
      ${overlayHTML}
      <div class="trip-grid">
        <div class="trip-field trip-field-full">
          <label>Captain Name</label>
          <input type="text" id="ti-capt" value="${esc(captain)}"
                 readonly
                 style="background:rgba(0,194,255,0.04); color:var(--accent);
                        font-weight:700; cursor:not-allowed;">
        </div>

        <div class="trip-field">
          <label>MTOW (kg)</label>
          <input type="number" id="ti-mtow" value="${mtow}">
        </div>
        <div class="trip-field">
          <label>MLW (kg)</label>
          <input type="number" id="ti-mlw" value="${mlw}">
        </div>

        <div class="trip-field">
          <label>Ramp Fuel (kg)</label>
          <input type="number" id="ti-ramp" value="${ramp}">
        </div>
        <div class="trip-field">
          <label>Taxi Fuel (kg)</label>
          <input type="number" id="ti-taxi" value="${taxi}">
        </div>

        <div class="trip-field">
          <label>TakeOff Fuel (kg)</label>
          <input type="number" id="ti-tof" value="${tof}">
        </div>
        <div class="trip-field">
          <label>Trip Fuel (kg)</label>
          <input type="number" id="ti-tripfuel" value="${trip}">
        </div>

        <div class="trip-field">
          <label>Trip Time (HH:MM)</label>
          <input type="text" id="ti-triptime" value="${esc(tripT)}" maxlength="5">
        </div>
        <div class="trip-field">
          <label>OFP Request</label>
          <input type="text" id="ti-ofp" value="${esc(ofpReq)}">
        </div>

        <div class="trip-field">
          <label>Flight Crew</label>
          <input type="number" id="ti-fc" value="${fc}">
        </div>
        <div class="trip-field">
          <label>Cabin Crew</label>
          <input type="number" id="ti-cc" value="${cc}">
        </div>

        <div class="trip-actions">
          <button class="btn-primary" id="ti-submit"
                  onclick="submitTripInfo('${esc(fid)}', ${dhc})">
            ✈️ Lähetä Skyplanille
          </button>
        </div>
      </div>
    </div>
  `;

  // Auto-laske TakeOff Fuel
  const rampEl = document.getElementById('ti-ramp');
  const taxiEl = document.getElementById('ti-taxi');
  const tofEl  = document.getElementById('ti-tof');
  if (rampEl && taxiEl && tofEl) {
    const update = () => {
      const r = parseInt(rampEl.value, 10) || 0;
      const t = parseInt(taxiEl.value, 10) || 0;
      tofEl.value = Math.max(0, r - t);
    };
    rampEl.addEventListener('input', update);
    taxiEl.addEventListener('input', update);
  }
}
window.renderTripInfoCard = renderTripInfoCard;

/* ==============================================================
 * Lähetä Skyplanille
 * ============================================================== */
async function submitTripInfo(fid, dhcCount) {
  const btn = document.getElementById('ti-submit');
  const setBtn = (txt, disabled = false) => {
    if (!btn) return;
    btn.disabled = disabled;
    btn.textContent = txt;
    if (!disabled) btn.style.background = '';
  };

  setBtn('⏳ Lähetetään…', true);

  const token = (typeof getValidSkyplanToken === 'function')
    ? await getValidSkyplanToken().catch(() => null)
    : null;

  if (!token) {
    setBtn('✈️ Lähetä Skyplanille');
    if (typeof showToast === 'function') showToast('Token puuttuu.', 'error');
    return;
  }

  const val = (id) => document.getElementById(id)?.value || '';
  const num = (id) => parseInt(document.getElementById(id)?.value, 10) || 0;

  const captain = val('ti-capt').trim().toUpperCase();
  const mtowV   = num('ti-mtow');
  const mlwV    = num('ti-mlw');
  const rampV   = num('ti-ramp');
  const taxiV   = num('ti-taxi');
  const tofV    = num('ti-tof');
  const tripFV  = num('ti-tripfuel');
  const tripTV  = val('ti-triptime').trim() || '00:00';
  const ofpV    = val('ti-ofp').trim();
  const fcV     = num('ti-fc');
  const ccV     = num('ti-cc');

  if (!captain) {
    setBtn('✈️ Lähetä Skyplanille');
    if (typeof showToast === 'function') showToast('Kapteenin nimi puuttuu.', 'warning');
    return;
  }

  const payload = {
    ExternalFlightID: Number(fid),
    CaptainFullName: captain,
    MaximumTakeOffWeightKg: mtowV,
    MaximumLandingWeightKg: mlwV,
    TripTimeDuration: tripTV,
    RampFuelKg: rampV,
    TaxiFuelKg: taxiV,
    TakeOffFuelKg: tofV,
    TripFuelKg: tripFV,
    OperationalFlightPlanRequestNumber: ofpV,
    DeadheadQuantity: `0/${dhcCount}`,
    CrewQuantity: `${fcV}/${ccV}`,
    CaptainCrewQuantity: fcV,
    OtherCrewQuantity: ccV,
    CaptainDeadheadQuantity: 0,
    OtherDeadheadQuantity: dhcCount,
    CreatedBy: (() => {
      try {
        const d = decodeJWT(token);
        return d?.preferred_username || d?.sub || d?.name || 'unknown_user';
      } catch (e) { return 'unknown_user'; }
    })(),
    CreatedDateTime: new Date().toISOString(),
    Base64SignImage: 'iVBORw0KGgoAAAANSU5EUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  };

  try {
    const resp = await fetch('https://kcskyplanapi.airastana.com/api/v1/trip-info', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    if (resp.ok) {
      if (typeof showToast === 'function') {
        showToast('Trip Info lähetetty Skyplanille.', 'success', 4000);
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = '✔️ Lähetetty';
        btn.style.background = 'var(--success)';
        setTimeout(() => {
          btn.textContent = '✈️ Lähetä Skyplanille';
          btn.style.background = '';
        }, 3000);
      }
    } else {
      const txt = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}${txt ? ': ' + txt.slice(0, 200) : ''}`);
    }
  } catch (e) {
    console.error('[TripInfo] send failed:', e);
    if (typeof showToast === 'function') {
      showToast('Lähetys epäonnistui: ' + e.message, 'error', 6000);
    }
    setBtn('✈️ Lähetä Skyplanille');
  }
}
window.submitTripInfo = submitTripInfo;