/* ==============================================================
 * TRIP INFO · Kortin sisäinen lomake briefing-sivulle
 * ==============================================================
 * - Kapteenin nimi haetaan Skyplanista (crewData)
 * - Painot ja polttoaineet parsitaan OFP:stä
 * - Esitäyttää lomakkeen automaattisesti
 * - Lähetä-nappi kortin sisällä
 * - Ei allekirjoitusta
 * ============================================================== */

const TRIP_CAPTAIN_KEY = 'efb_captain_name';

/* ==============================================================
 * OFP-parseri
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

        // OFP Request number: "... REQUEST # 43621 ---"
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

    // TAXI — vaadi numero heti sanan jälkeen (ei "TAXI IN")
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
 * Hae OFP-data
 * ============================================================== */
async function _getTripOFPData(fid) {
  if (!fid) return null;

  const cacheKey = `jarvis_ofp_weights_${fid}`;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const c = JSON.parse(raw);
      if (c?.at && Date.now() - new Date(c.at).getTime() < 6 * 60 * 60 * 1000) {
        return c.data;
      }
    }
  } catch (e) {}

  if (typeof fetchSkyplanOFPBytes !== 'function') return null;
  if (typeof _extractPDFLines !== 'function') return null;

  try {
    const token = (typeof getValidSkyplanToken === 'function')
      ? await getValidSkyplanToken().catch(() => null)
      : null;
    const r = await fetchSkyplanOFPBytes(fid, token);
    if (!r?.pdfBytes) return null;

    const lines = await _extractPDFLines(r.pdfBytes);
    const parsed = _parseOFPFuelAndWeights(lines);

    try {
      localStorage.setItem(cacheKey, JSON.stringify({
        at: new Date().toISOString(),
        data: parsed
      }));
    } catch (e) {}

    return parsed;
  } catch (e) {
    console.warn('[TripInfo] OFP parse failed:', e.message);
    return null;
  }
}

/* ==============================================================
 * Hae crew
 * ============================================================== */
async function _getTripCrew(fid) {
  if (!fid) return { captain: '', fc: 0, cc: 0, dhc: 0 };

  // 1. Yritä cache
  let log = (typeof getCachedJourneyLog === 'function')
    ? getCachedJourneyLog(fid)
    : null;

  // 2. Jos cachessa ei ole crewDuty:tä → hae API:sta
  if (!log || !log.crewDuty || !log.crewDuty.length) {
    log = null;
    try {
      const token = (typeof getValidSkyplanToken === 'function')
        ? await getValidSkyplanToken().catch(() => null)
        : null;
      if (token) {
        console.log('[TripCrew] Haetaan journey-log API:sta:', fid);
        log = await fetchJourneyLog(fid, token);
        if (log?.crewDuty?.length) {
          if (typeof _cacheJourneyLog === 'function') _cacheJourneyLog(fid, log);
        } else {
          console.warn('[TripCrew] API palautti ilman crewDuty:', log);
        }
      }
    } catch (e) {
      console.warn('[TripCrew] journey-log failed:', e.message);
      return { captain: '', fc: 0, cc: 0, dhc: 0 };
    }
  }

  if (!log?.crewDuty?.length) {
    console.warn('[TripCrew] Ei crewDuty-dataa lennolle', fid);
    return { captain: '', fc: 0, cc: 0, dhc: 0 };
  }

  // 3. Käytä olemassa olevaa parseria
  if (typeof parseCrewFromJourneyLog === 'function') {
    const parsed = parseCrewFromJourneyLog(log);
    const captain = parsed?.pic?.name || '';
    const fc = (parsed?.pic ? 1 : 0) + (parsed?.fo ? 1 : 0);
    const cc = (parsed?.ifs ? 1 : 0) + (parsed?.cabin?.length || 0);

    console.log('[TripCrew] parseCrewFromJourneyLog:', {
      captain,
      fc, cc,
      pic: parsed?.pic?.name,
      fo: parsed?.fo?.name,
      ifs: parsed?.ifs?.name,
      cabinCount: parsed?.cabin?.length,
      crewDutyLen: log.crewDuty.length
    });

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

  // Hae crew + OFP rinnakkain
  const [crew, ofp] = await Promise.all([
    _getTripCrew(fid),
    _getTripOFPData(fid)
  ]);

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

  const ofpReq = ofp?.requestNumber
                || window.ofpRequestNumber
                || document.getElementById('j-ofp-req')?.value
                || '01';

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  el.innerHTML = `
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

      ${!ofp ? `
        <div class="trip-warning">
          ⚠ OFP ei ole vielä saatavilla — täytä tiedot käsin.
        </div>
      ` : ''}

      <div class="trip-actions">
        <button class="btn-primary" id="ti-submit" onclick="submitTripInfo('${esc(fid)}', ${dhc})">
          ✈️ Lähetä
        </button>
      </div>
    </div>
  `;

  // Auto-laske TakeOff Fuel
  setTimeout(() => {
    const rampEl = document.getElementById('ti-ramp');
    const taxiEl = document.getElementById('ti-taxi');
    const tofEl  = document.getElementById('ti-tof');
    if (!rampEl || !taxiEl || !tofEl) return;

    const update = () => {
      const r = parseInt(rampEl.value, 10) || 0;
      const t = parseInt(taxiEl.value, 10) || 0;
      tofEl.value = Math.max(0, r - t);
    };
    rampEl.addEventListener('input', update);
    taxiEl.addEventListener('input', update);
  }, 50);
}
window.renderTripInfoCard = renderTripInfoCard;

/* ==============================================================
 * Lähetä Skyplanille
 * ============================================================== */
async function submitTripInfo(fid, dhcCount) {
  const btn = document.getElementById('ti-submit');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Lähetetään…';
  }

  const token = (typeof getValidSkyplanToken === 'function')
    ? await getValidSkyplanToken().catch(() => null)
    : null;

  if (!token) {
    if (btn) { btn.disabled = false; btn.textContent = '✈️ Lähetä Skyplanille'; }
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
    if (btn) { btn.disabled = false; btn.textContent = '✈️ Lähetä Skyplanille'; }
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
      throw new Error(`HTTP ${resp.status}${txt ? ': ' + txt : ''}`);
    }
  } catch (e) {
    console.error('[TripInfo] send failed:', e);
    if (typeof showToast === 'function') {
      showToast('Lähetys epäonnistui: ' + e.message, 'error', 6000);
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = '✈️ Lähetä Skyplanille';
    }
  }
}
window.submitTripInfo = submitTripInfo;