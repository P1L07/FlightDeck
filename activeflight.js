/* ==============================================================
 * ACTIVE FLIGHT · Työpäivän logiikka
 * ==============================================================
 *  - Tunnistaa aktiivisen lennon automaattisesti
 *  - ACARS-tila: ATD asetettu, ATA ei → lennolla
 *  - Aikapohjainen: STD-2h … STA+1h
 *  - Manuaalinen override
 *  - Turnaround + crew + fuel
 * ============================================================== */

const ACTIVE_OVERRIDE_KEY   = '_active_flight_override';
const JOURNEY_LOG_CACHE_KEY = '_journey_log_cache';
const ACTIVE_BEFORE_MS      = 2 * 60 * 60 * 1000;   // 2 h ennen STD
const ACTIVE_AFTER_MS       = 1 * 60 * 60 * 1000;   // 1 h jälkeen STA
const JOURNEY_LOG_TTL_MS    = 6 * 60 * 60 * 1000;

/* ---------------- Roster-apurit ---------------- */
function _afGetRoster() {
  try {
    const raw = localStorage.getItem('assigned_flights_cache');
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function _afFmtTime(iso) {
  if (!iso) return '--:--';
  const s = String(iso);
  return s.includes('T') ? s.split('T')[1].substring(0, 5) : s;
}

function _afFmtDuration(ms) {
  if (!ms || ms < 0) ms = 0;
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/* ---------------- Journey-log-cache ---------------- */
function _cacheJourneyLog(flightId, data) {
  try {
    const cache = JSON.parse(localStorage.getItem(JOURNEY_LOG_CACHE_KEY) || '{}');
    cache[flightId] = { at: new Date().toISOString(), data };
    localStorage.setItem(JOURNEY_LOG_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {}
}
function _getCachedJourneyLog(flightId) {
  try {
    const cache = JSON.parse(localStorage.getItem(JOURNEY_LOG_CACHE_KEY) || '{}');
    const entry = cache[flightId];
    if (!entry) return null;
    if (Date.now() - new Date(entry.at).getTime() > JOURNEY_LOG_TTL_MS) return null;
    return entry.data;
  } catch (e) { return null; }
}
window.getCachedJourneyLog = _getCachedJourneyLog;

/* ---------------- Override ---------------- */
function getActiveFlightOverride() {
  try { return localStorage.getItem(ACTIVE_OVERRIDE_KEY); } catch (e) { return null; }
}
function setActiveFlightOverride(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_OVERRIDE_KEY, String(id));
    else localStorage.removeItem(ACTIVE_OVERRIDE_KEY);
    if (typeof renderHomeDashboard === 'function') renderHomeDashboard();
  } catch (e) {}
}
function clearActiveFlightOverride() {
  setActiveFlightOverride(null);
}
window.setActiveFlightOverride   = setActiveFlightOverride;
window.clearActiveFlightOverride = clearActiveFlightOverride;

/* ---------------- Aktiivisen lennon tunnistus ---------------- */
function findActiveFlight() {
  const roster = _afGetRoster();
  if (!roster.length) return null;

  const sorted = roster.slice().sort((a, b) =>
    new Date(a.StdLt || a.Std || 0) - new Date(b.StdLt || b.Std || 0));

  // 1. Manuaalinen override
  const overrideId = getActiveFlightOverride();
  if (overrideId) {
    const f = sorted.find(x => String(x.ID || x.id || x.FlightID) === String(overrideId));
    if (f) return { flight: f, state: 'manual', reason: 'Manuaalinen valinta', isManual: true };
  }

  const now = Date.now();

  // 2. ACARS-tila: ATD asetettu, ATA ei → lennolla
  for (const f of sorted) {
    const fid = String(f.ID || f.id || f.FlightID || '');
    if (!fid) continue;
    const log = _getCachedJourneyLog(fid);
    if (log?.atd && !log?.ata) {
      return { flight: f, state: 'inflight', log, reason: 'ACARS: lennolla' };
    }
  }

  // 3. Aikapohjainen — kerää KAIKKI ehdokkaat, valitse paras
  const candidates = [];
  for (const f of sorted) {
    const std = new Date(f.StdLt || f.Std || 0).getTime();
    const sta = new Date(f.StaLt || f.Sta || 0).getTime();
    if (!std || !sta) continue;
    if (now >= std - ACTIVE_BEFORE_MS && now <= sta + ACTIVE_AFTER_MS) {
      candidates.push({ f, std, sta });
    }
  }

  if (!candidates.length) return null;

  // 3a. Jos olemme lennon aikana → palauta se heti
  const inFlight = candidates.find(c => now >= c.std && now <= c.sta);
  if (inFlight) {
    return { flight: inFlight.f, state: 'inflight', reason: 'Lennolla' };
  }

  // 3b. Muuten valitaan se jonka STD on MYÖHEMMIN = seuraava lähtevä
  //     (tämä on se mitä turnaround näyttää)
  candidates.sort((a, b) => b.std - a.std);
  const next = candidates[0];

  return {
    flight: next.f,
    state: now < next.std ? 'preflight' : 'inflight',
    reason: now < next.std
      ? `Alkaa ${_afFmtDuration(next.std - now)} päästä`
      : 'Lennolla'
  };
}
window.findActiveFlight = findActiveFlight;

async function _extractPdfBytes(rawPayload) {
  if (rawPayload == null) throw new Error('Tyhjä payload');

  let bytes;

  // 1. Jos payload on string → base64-dekoodaus
  if (typeof rawPayload === 'string') {
    const s = rawPayload.trim();

    // Jos alkaa "data:application/pdf;base64," → poista prefix
    const b64 = s.replace(/^data:[^;]+;base64,/, '');

    try {
      // atob → binary string → Uint8Array
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
    } catch (e) {
      throw new Error('Base64-dekoodaus epäonnistui: ' + e.message);
    }
  }
  // 2. ArrayBuffer
  else if (rawPayload instanceof ArrayBuffer) {
    bytes = new Uint8Array(rawPayload);
  }
  // 3. Uint8Array tai muu typed array
  else if (ArrayBuffer.isView(rawPayload)) {
    bytes = new Uint8Array(
      rawPayload.buffer,
      rawPayload.byteOffset,
      rawPayload.byteLength
    );
  }
  // 4. Array of bytes
  else if (Array.isArray(rawPayload)) {
    bytes = new Uint8Array(rawPayload);
  }
  else {
    throw new Error(`Tuntematon payload-tyyppi: ${typeof rawPayload}`);
  }

  if (!bytes.length) throw new Error('Tyhjä payload dekoodauksen jälkeen');

  // --- Tunnista PDF vs ZIP ---
  const isPDF = bytes[0] === 0x25 && bytes[1] === 0x50
             && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (isPDF) return bytes;

  const isZIP = bytes[0] === 0x50 && bytes[1] === 0x4B;
  if (isZIP) {
    if (typeof JSZip === 'undefined') {
      throw new Error('ZIP-paketti vastaanotettu mutta JSZip ei ole ladattu');
    }
    const zip = await JSZip.loadAsync(bytes);
    const pdfEntry = Object.values(zip.files).find(f => /\.pdf$/i.test(f.name));
    if (!pdfEntry) throw new Error('ZIP ei sisällä PDF:ää');
    return await pdfEntry.async('uint8array');
  }

  // Tuntematon — näytä ensimmäiset tavut debugia varten
  const head = Array.from(bytes.slice(0, 8))
    .map(b => b.toString(16).padStart(2, '0')).join(' ');
  throw new Error(`Tuntematon payload-tyyppi (ensimmäiset tavut: ${head})`);
}

/* --- Rekisteröi fallback jos app.js:n versio puuttuu --- */
if (typeof window.extractPdfFromZipOrRaw !== 'function') {
  window.extractPdfFromZipOrRaw = _extractPdfBytes;
}

/* ---------------- Crew-parsinta journey-logista ---------------- */
function parseCrewFromJourneyLog(log) {
  const out = { pic: null, fo: null, ifs: null, cabin: [] };
  if (!log || !Array.isArray(log.crewDuty)) return out;

  const isPic = p => ['CP','CAPT','PIC','P1'].includes(String(p||'').toUpperCase());
  const isFo  = p => ['FO','SIC','P2','SO'].includes(String(p||'').toUpperCase());
  const isIfs = p => ['IFS','IS','SCC','CS','PURSER'].includes(String(p||'').toUpperCase());

  log.crewDuty.forEach(c => {
    const role = String(c.position || '').toUpperCase();
    const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || '';
    const item = { ...c, name };
    if (isPic(role) && !out.pic) out.pic = item;
    else if (isFo(role) && !out.fo) out.fo = item;
    else if (isIfs(role) && !out.ifs) out.ifs = item;
    else out.cabin.push(item);
  });

  return out;
}

/* ---------------- Turnaround ---------------- */
function computeTurnaround(currentFlight, currentLog) {
  const roster = _afGetRoster()
    .sort((a, b) => new Date(a.StdLt || a.Std || 0) - new Date(b.StdLt || b.Std || 0));

  const curId = String(currentFlight.ID || currentFlight.id || currentFlight.FlightID || '');
  const idx = roster.findIndex(x =>
    String(x.ID || x.id || x.FlightID || '') === curId);
  if (idx < 0 || idx >= roster.length - 1) return null;

  // Vain seuraava lento
  const next = roster[idx + 1];
  const nextId = String(next.ID || next.id || next.FlightID || '');
  const nextLog = _getCachedJourneyLog(nextId);

  // Tämän lennon lasku (actual ATA jos olemassa, muuten scheduled STA)
  const curArrActual    = currentLog?.ata;
  const curArrScheduled = currentFlight.StaLt || currentFlight.Sta;
  const curArr = curArrActual || curArrScheduled;

  // Seuraavan lennon lähtö (actual ATD jos olemassa, muuten scheduled STD)
  const nextDepActual    = nextLog?.atd;
  const nextDepScheduled = next.StdLt || next.Std;
  const nextDep = nextDepActual || nextDepScheduled;

  if (!curArr || !nextDep) return null;

  const curArrT  = new Date(curArr).getTime();
  const nextDepT = new Date(nextDep).getTime();
  if (isNaN(curArrT) || isNaN(nextDepT)) return null;

  const diffMs = nextDepT - curArrT;

  // Vain 10 min – 5 h. Yli 5 h = eri päivä / pitkä tauko
  if (diffMs < 10 * 60 * 1000) return null;
  if (diffMs > 5 * 60 * 60 * 1000) return null;

  // Scheduled turnaround
  let scheduledMs = null;
  if (curArrScheduled && nextDepScheduled) {
    const t1 = new Date(curArrScheduled).getTime();
    const t2 = new Date(nextDepScheduled).getTime();
    if (!isNaN(t1) && !isNaN(t2) && t2 > t1) scheduledMs = t2 - t1;
  }

  // ATA-delta (vain jos actual ATA on olemassa)
  let arrDeltaMs = null;
  if (curArrActual && curArrScheduled) {
    const a = new Date(curArrActual).getTime();
    const s = new Date(curArrScheduled).getTime();
    if (!isNaN(a) && !isNaN(s)) arrDeltaMs = a - s;
  }

  const now = Date.now();
  const remainingMs = nextDepT - now;

  return {
    nextFlight: next,
    arrTime: curArr,
    arrActual: curArrActual,
    arrScheduled: curArrScheduled,
    arrDeltaMs,
    depTime: nextDep,
    depActual: nextDepActual,
    depScheduled: nextDepScheduled,
    scheduledMs,
    expectedMs: diffMs,
    remainingMs: Math.max(0, remainingMs),
    isInProgress: now >= curArrT && now < nextDepT,
    isFinished: now >= nextDepT
  };
}

/* ---------------- Fuel (kytke oma funktio) ---------------- */
async function _getBlockFuel(flight) {
  const fid = flight?.ID || flight?.id || flight?.FlightID;
  if (!fid) return null;

  // 1) Käyttäjän oma funktio
  if (typeof window.getBlockFuelFromOFP === 'function') {
    try {
      const fuel = await window.getBlockFuelFromOFP(fid);
      if (fuel) return fuel;
    } catch (e) { /* ohita */ }
  }
  // 2) OFP-cache (jos tallennettu)
  if (typeof window.getBlockFuelFromCache === 'function') {
    try { return await window.getBlockFuelFromCache(fid); } catch (e) {}
  }
  return null;
}

/* ==============================================================
 * RENDER · Aktiivisen lennon kortti
 * ============================================================== */
async function renderActiveFlightCard() {
  const container = document.getElementById('active-flight-card');
  if (!container) return;

  // A) Piilota aina ensin
  container.style.display = 'none';
  container.innerHTML = '';

  if (window._afCountdownTimer) {
    clearInterval(window._afCountdownTimer);
    window._afCountdownTimer = null;
  }

  // B) Etsi aktiivinen lento
  const active = findActiveFlight();
  if (!active || !active.flight) return;

  const f = active.flight;
  const fid = String(f.ID || f.id || f.FlightID || '');
  const carrier = String(f.CarrierCode || '').trim();
  const fltNo = String(f.FlightNumber || '').trim();
  const flightNum = (carrier && fltNo.startsWith(carrier)) ? fltNo : `${carrier}${fltNo}`;
  const dep = String(f.DepartureStationIcaoCode || f.DepartureStationCode || 'XXXX');
  const arr = String(f.ArrivalStationIcaoCode   || f.ArrivalStationCode   || 'XXXX');
  const std = _afFmtTime(f.StdLt || f.Std);
  const sta = _afFmtTime(f.StaLt || f.Sta);
  const date = String(f.StdLt || f.Std || '').split('T')[0];
  const reg = String(f.RegistrationNumber || f.AircraftDescription || 'TBA');

  // C) Hae journey-log (crew + ATD/ATA)
  let log = active.log;
  if (!log && fid) log = _getCachedJourneyLog(fid);
  if (!log && fid) {
    try {
      const token = (typeof getValidSkyplanToken === 'function')
        ? await getValidSkyplanToken()
        : null;
      if (token) {
        log = await fetchJourneyLog(fid, token);
        _cacheJourneyLog(fid, log);
      }
    } catch (e) {
      console.warn('[ActiveFlight] journey log failed:', e);
    }
  }

  const crew = parseCrewFromJourneyLog(log);
  const turnaround = computeTurnaround(f, log);
  const fuelData = await _getBlockFuel(f);

  // D) Tila
  const stateLabel = {
    preflight: 'VALMISTELU',
    inflight:  'LENNOLLA',
    manual:    'MANUAALINEN'
  }[active.state] || 'AKTIIVINEN';

  const stateColor = active.state === 'inflight' ? 'var(--success)'
                   : active.state === 'preflight' ? 'var(--accent)'
                   : 'var(--warning)';

  // E) Rakenna HTML
  let html;
  try {
    html = `
      <div class="af-head">
        <div class="af-head-left">
          <span class="af-state" style="color:${stateColor}; border-color:${stateColor};">
            <span class="af-dot" style="background:${stateColor};"></span>
            ${stateLabel}
          </span>
          <span class="af-reason">${active.reason || ''}</span>
        </div>
        <div class="af-head-right">
          <select class="af-override-select"
                  onchange="onActiveFlightOverrideChange(this.value)"
                  title="Valitse aktiivinen lento">
            <option value="">— Automaattinen —</option>
            ${_afGetRoster()
              .filter(x => {
                const staMs = new Date(x.StaLt || x.Sta || 0).getTime();
                return staMs && staMs > Date.now() - 24 * 60 * 60 * 1000;
              })
              .slice(0, 20)
              .map(x => {
                const xid = String(x.ID || x.id || x.FlightID || '');
                const xc = String(x.CarrierCode || '').trim();
                const xfl = String(x.FlightNumber || '').trim();
                const xnum = (xc && xfl.startsWith(xc)) ? xfl : `${xc}${xfl}`;
                const xd = String(x.StdLt || x.Std || '').split('T')[0];
                const xt = _afFmtTime(x.StdLt || x.Std);
                const selected = (xid === fid && active.isManual) ? ' selected' : '';
                return `<option value="${xid}"${selected}>${xnum} · ${xd} ${xt}</option>`;
              }).join('')}
          </select>
          ${active.isManual ? `
            <button class="af-override-clear" onclick="clearActiveFlightOverride()"
                    title="Palauta automaattinen">✕</button>
          ` : ''}
        </div>
      </div>

      <div class="af-route">
        <div class="af-route-icao">${dep}</div>
        <div class="af-route-arrow">→</div>
        <div class="af-route-icao">${arr}</div>
      </div>

      <div class="af-meta">
        <span class="af-flt">${flightNum}</span>
        <span class="af-sep">·</span>
        <span class="af-date">${date}</span>
        <span class="af-sep">·</span>
        <span class="af-reg af-reg-clickable"
              onclick="showDefectsPopup('${reg}')"
              title="Näytä koneen viat">${reg}</span>
        ${(() => {
          const stand = (typeof extractStandNumber === 'function')
            ? extractStandNumber(f, log)
            : null;
          return stand ? `
            <span class="af-sep">·</span>
            <span class="af-stand">STAND <b>${stand.value}</b></span>
          ` : '';
        })()}
      </div>

      <div class="af-times">
        <div class="af-time">
          <span class="af-time-label">STD</span>
          <span class="af-time-value">${std}</span>
        </div>
        <div class="af-time">
          <span class="af-time-label">STA</span>
          <span class="af-time-value">${sta}</span>
        </div>
      </div>

      ${turnaround ? (() => {
        // Delta: aikaisin/myöhässä
        const deltaStr = (() => {
          if (turnaround.arrDeltaMs == null) return '';
          const mins = Math.round(Math.abs(turnaround.arrDeltaMs) / 60000);
          if (mins < 1) return '';
          const sign = turnaround.arrDeltaMs < 0 ? '−' : '+';
          const color = turnaround.arrDeltaMs < 0 ? 'var(--success)' : 'var(--error)';
          const lbl = turnaround.arrDeltaMs < 0 ? 'aikaisin' : 'myöhässä';
          return `<span class="af-ta-delta" style="color:${color};">${sign}${mins} min ${lbl}</span>`;
        })();

        // Scheduled-erotus
        const scheduledStr = (() => {
          if (!turnaround.scheduledMs) return '';
          const actualMins = Math.round(turnaround.expectedMs / 60000);
          const schedMins = Math.round(turnaround.scheduledMs / 60000);
          if (Math.abs(actualMins - schedMins) < 2) return '';
          return `<span class="af-ta-scheduled">suunniteltu ${_afFmtDuration(turnaround.scheduledMs)}</span>`;
        })();

        const isWaiting  = !turnaround.isInProgress && !turnaround.isFinished;
        const isActive   = turnaround.isInProgress;
        const isFinished = turnaround.isFinished;

        let pct = isFinished ? 100
                : isWaiting  ? 0
                : Math.min(100, Math.max(0,
                    100 - (turnaround.remainingMs / turnaround.expectedMs) * 100));

        const label = isWaiting  ? 'Arvioitu turnaround'
                    : isActive   ? 'Turnaround · jäljellä'
                    :              'Turnaround · päättynyt';

        const value = isActive ? _afFmtDuration(turnaround.remainingMs)
                               : _afFmtDuration(turnaround.expectedMs);

        const stateClass = isActive ? 'af-ta-active'
                         : isFinished ? 'af-ta-finished'
                         : 'af-ta-expected';

        return `
          <div class="af-turnaround ${stateClass}">
            <div class="af-ta-row">
              <span class="af-ta-label">${label}</span>
              <span class="af-ta-value ${isActive ? 'af-ta-countdown' : ''}">
                <b>${value}</b>
                ${scheduledStr}
              </span>
            </div>
            <div class="af-ta-progress">
              <div class="af-ta-bar">
                <div class="af-ta-fill" style="width:${pct}%"></div>
              </div>
              <div class="af-ta-info">
                <span>Lasku ${_afFmtTime(turnaround.arrTime)} ${deltaStr}</span>
                <span>Lähtö ${_afFmtTime(turnaround.depTime)}</span>
              </div>
            </div>
          </div>`;
      })() : ''}


      ${fuelData ? `
        <div class="af-fuel">
          <div class="af-fuel-row">
            <span class="af-fuel-label">Block fuel</span>
            <span class="af-fuel-value">${fuelData.display || '–'}</span>
          </div>
          <div class="af-fuel-row">
            <span class="af-fuel-label">MIN BLOCK FUEL</span>
            <span class="af-fuel-value af-fuel-min">${fuelData.minDisplay || fuelData.display || '–'}</span>
          </div>
        </div>
      ` : ''}

    `;
  } catch (renderErr) {
    console.error('[ActiveFlight] HTML render failed:', renderErr);
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  // F) Näytä kortti vasta kun HTML on valmis
  container.className = 'card card-accent af-card';
  container.innerHTML = html;
  container.style.display = '';

  // G) Turnaround-countdown
  window._afCountdownTimer = setInterval(() => {
    const taEl = document.querySelector('.af-ta-countdown b');
    if (!document.getElementById('active-flight-card')?.innerHTML) {
      clearInterval(window._afCountdownTimer);
      window._afCountdownTimer = null;
      return;
    }
    if (taEl && turnaround?.isInProgress) {
      const ms = Math.max(0, new Date(turnaround.depTime).getTime() - Date.now());
      taEl.textContent = _afFmtDuration(ms);
    }
  }, 30000);
}
window.renderActiveFlightCard = renderActiveFlightCard;

function onActiveFlightOverrideChange(id) {
  if (!id) {
    clearActiveFlightOverride();
    return;
  }
  setActiveFlightOverride(id);
}
window.onActiveFlightOverrideChange = onActiveFlightOverrideChange;

/* ---------------- Päivitä automaattisesti ---------------- */
setInterval(() => {
  const tab = document.querySelector('.tab-btn[data-tab="home"].active');
  if (tab) renderActiveFlightCard().catch(() => {});
}, 5 * 60 * 1000);   // 5 min välein

window.addEventListener('online', () => {
  setTimeout(() => renderActiveFlightCard().catch(() => {}), 1500);
});

/* ==============================================================
 * BLOCK FUEL · OFP-parsinta
 * ==============================================================
 * Käyttää olemassa olevaa fetchSkyplanOFPBytes() -funktiota ja
 * pdf.js:ää tekstin poimintaan. Tulos cachetetaan per flightId
 * jotta PDF:ää ei parsita joka renderöinnillä.
 * ============================================================== */

const BLOCK_FUEL_CACHE_KEY = 'jarvis_block_fuel_cache';

function _bfCacheGet(flightId) {
  try {
    const c = JSON.parse(localStorage.getItem(BLOCK_FUEL_CACHE_KEY) || '{}');
    return c[flightId]?.kg ?? null;
  } catch (e) { return null; }
}
function _bfCacheSet(flightId, kg) {
  try {
    const c = JSON.parse(localStorage.getItem(BLOCK_FUEL_CACHE_KEY) || '{}');
    c[flightId] = { kg, at: new Date().toISOString() };
    localStorage.setItem(BLOCK_FUEL_CACHE_KEY, JSON.stringify(c));
  } catch (e) {}
}

/* ==============================================================
 * BLOCK FUEL · äärimmäisen defenssiivinen parseri
 * ============================================================== */
function _parseBlockFuelFromLines(lines) {
  if (!Array.isArray(lines)) return null;

  const clean = s => String(s || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\t/g, ' ')
    .trim();

  let result = { block: null, minBlock: null, timeHours: null, raw: null };

  for (const rawLine of lines) {
    const line = clean(rawLine);

    // 1. BLOCK FUEL 03.44 8381
    if (!result.block && /\bBLOCK\s+FUEL\b/i.test(line)) {
      const m = line.match(/BLOCK\s+FUEL\s+(\d{1,2}[.:]\d{2})\s+(\d+)/i)
             || line.match(/BLOCK\s+FUEL[^\d]*(\d+)/i);
      if (m) {
        result.timeHours = m[1] && /[.:]/.test(m[1]) ? m[1] : null;
        const kg = parseInt((m[2] || m[1] || '').replace(/[\s,]/g, ''), 10);
        if (!isNaN(kg) && kg > 100) {
          result.block = kg;
          result.raw = line;
        }
      }
    }

    // 2. MINIMUM BLOCK 8381
    if (!result.minBlock && /\bMINIMUM\s+BLOCK\b/i.test(line)) {
      const m = line.match(/MINIMUM\s+BLOCK\s+(\d+)/i)
             || line.match(/MINIMUM\s+BLOCK[^\d]*(\d+)/i);
      if (m) {
        const kg = parseInt(m[1].replace(/[\s,]/g, ''), 10);
        if (!isNaN(kg) && kg > 100) result.minBlock = kg;
      }
    }

    if (result.block && result.minBlock) break;
  }

  // Jos vain toinen löytyi → käytä samaa molempiin
  if (result.block && !result.minBlock) result.minBlock = result.block;
  if (result.minBlock && !result.block) result.block = result.minBlock;

  if (!result.block && !result.minBlock) return null;

  // Yhteensopivuus vanhan API:n kanssa: `kg` = block
  result.kg = result.block;

  return result;
}

/** Parsi PDF-teksti käyttäen pdf.js:ää */
async function _extractPDFLines(pdfBytes) {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('pdf.js ei ole ladattu');
  }
  // pdf-lib palauttaa Uint8Array, pdf.js haluaa oman formaattinsa
  const data = pdfBytes instanceof Uint8Array
    ? pdfBytes
    : new Uint8Array(pdfBytes);

  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const page = await pdf.getPage(1);

  // Käytä olemassa olevaa getLinesFromPDFPage jos saatavilla (sama formaatti)
  if (typeof window.getLinesFromPDFPage === 'function') {
    return await window.getLinesFromPDFPage(page);
  }

  // Fallback: manuaalinen rivien poiminta
  const content = await page.getTextContent();
  const lineMap = new Map();
  content.items.forEach(item => {
    const y = Math.round(item.transform[5]);
    if (!lineMap.has(y)) lineMap.set(y, []);
    lineMap.get(y).push({ x: item.transform[4], str: item.str });
  });
  return [...lineMap.entries()]
    .sort((a, b) => b[0] - a[0])   // ylhäältä alas
    .map(([_, parts]) =>
      parts.sort((a, b) => a.x - b.x).map(p => p.str).join(' ').trim()
    );
}

/**
 * Hae block fuel OFP:sta. Palauttaa { kg, display } tai null.
 * Cachetetaan flightId-kohtaisesti.
 */
/* Cache myös negatiiviselle tulokselle (422, ei vielä julkaistu) */
const BLOCK_FUEL_NEG_TTL = 30 * 60 * 1000;   // 30 min

async function getBlockFuelFromOFP(flightId) {
  const fid = String(flightId || '');
  if (!fid) return null;

  // 1. Positiivinen cache
  try {
    const cache = JSON.parse(localStorage.getItem(BLOCK_FUEL_CACHE_KEY) || '{}');
    const hit = cache[fid];
    if (hit?.block) {
      return {
        block: hit.block,
        minBlock: hit.minBlock || hit.block,
        timeHours: hit.timeHours || null,
        display: _formatFuelKg(hit.block),
        minDisplay: _formatFuelKg(hit.minBlock || hit.block)
      };
    }
    // 2. Negatiivinen cache (422 äskettäin)
    if (hit?.notAvailable) {
      const age = Date.now() - new Date(hit.notAvailable).getTime();
      if (age < BLOCK_FUEL_NEG_TTL) {
        return null;   // Hiljainen — ei uudelleenyritystä
      }
    }
  } catch (e) {}

  if (typeof fetchSkyplanOFPBytes !== 'function') return null;

  try {
    const token = (typeof getValidSkyplanToken === 'function')
      ? await getValidSkyplanToken().catch(() => null)
      : null;
    const result = await fetchSkyplanOFPBytes(fid, token);
    if (!result?.pdfBytes) {
      // Merkitse "ei saatavilla" cacheen
      try {
        const cache = JSON.parse(localStorage.getItem(BLOCK_FUEL_CACHE_KEY) || '{}');
        cache[fid] = { notAvailable: new Date().toISOString() };
        localStorage.setItem(BLOCK_FUEL_CACHE_KEY, JSON.stringify(cache));
      } catch (e) {}
      return null;
    }

    const lines = await _extractPDFLines(result.pdfBytes);
    const parsed = _parseBlockFuelFromLines(lines);
    if (!parsed) return null;

    // Positiivinen cache
    try {
      const cache = JSON.parse(localStorage.getItem(BLOCK_FUEL_CACHE_KEY) || '{}');
      cache[fid] = {
        block: parsed.block,
        minBlock: parsed.minBlock,
        timeHours: parsed.timeHours,
        at: new Date().toISOString()
      };
      localStorage.setItem(BLOCK_FUEL_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {}

    return {
      block: parsed.block,
      minBlock: parsed.minBlock,
      timeHours: parsed.timeHours,
      display: _formatFuelKg(parsed.block),
      minDisplay: _formatFuelKg(parsed.minBlock)
    };
  } catch (e) {
    // 422 → hiljainen, ei konsoliviestiä
    const is422 = /422|not generated/i.test(e.message || '');
    if (is422) {
      try {
        const cache = JSON.parse(localStorage.getItem(BLOCK_FUEL_CACHE_KEY) || '{}');
        cache[fid] = { notAvailable: new Date().toISOString() };
        localStorage.setItem(BLOCK_FUEL_CACHE_KEY, JSON.stringify(cache));
      } catch (e2) {}
    } else {
      console.warn('[BlockFuel] parse failed:', e.message);
    }
    return null;
  }
}

function _formatFuelKg(kg) {
  if (!kg || kg <= 0) return null;
  // Muotoile: "12 500 kg" tai "12.5 t"
  if (kg >= 10000) {
    const t = (kg / 1000).toFixed(1);
    return `${t} t · ${kg.toLocaleString('fi-FI')} kg`;
  }
  return `${kg.toLocaleString('fi-FI')} kg`;
}

/* -------- Debug-apuri -------- */
window.debugBlockFuel = async function(flightId) {
  const fid = String(flightId || findActiveFlight()?.flight?.ID || '');
  if (!fid) { console.warn('Anna flightId'); return null; }
  console.log('Parsitaan OFP:', fid);

  // Tyhjennä cache tämän lennon osalta
  try {
    const c = JSON.parse(localStorage.getItem(BLOCK_FUEL_CACHE_KEY) || '{}');
    delete c[fid];
    localStorage.setItem(BLOCK_FUEL_CACHE_KEY, JSON.stringify(c));
  } catch (e) {}

  const r = await getBlockFuelFromOFP(fid);
  console.log('Tulos:', r);
  return r;
};

/* ==============================================================
 * STAND-NUMERO · Etsintä ja näyttö
 * ============================================================== */
function extractStandNumber(flight, log) {
  if (!flight) return null;

  // Air Astana: DepartureGateNumber = stand
  const candidates = [
    'DepartureGateNumber',
    'DepartureStand',
    'DepStand',
    'StandDep',
    'DepartureLocationNumber',    // backup
    'GateNumber',
    'StandNumber',
    'Stand'
  ];

  for (const k of candidates) {
    const v = flight[k];
    if (v != null && String(v).trim() !== '' && String(v).trim() !== '-') {
      return { value: String(v).trim(), field: k };
    }
  }
  return null;
}
window.extractStandNumber = extractStandNumber;


/* -------- Debug: mikä kenttä sisältää stand-numeron? -------- */
window.debugStand = async function(flightId) {
  const roster = JSON.parse(localStorage.getItem('assigned_flights_cache') || '[]');
  const f = flightId
    ? roster.find(x => String(x.ID) === String(flightId))
    : roster.find(x => new Date(x.StdLt || x.Std).getTime() > Date.now());

  if (!f) { console.warn('Lentoa ei löytynyt'); return; }

  console.log('=== ROSTER-KENTÄT ===');
  console.log('Kaikki kentät:', Object.keys(f));
  console.log('Stand/Gate-viitteiset:',
    Object.keys(f).filter(k => /stand|gate|park|bay/i.test(k)));
  console.log('Flight object:', f);

  // Journey-log
  try {
    const token = await getValidSkyplanToken();
    const log = await fetchJourneyLog(f.ID, token);
    console.log('=== JOURNEY-LOG KENTÄT ===');
    console.log('Kaikki kentät:', Object.keys(log.raw || {}));
    console.log('Stand/Gate-viitteiset:',
      Object.keys(log.raw || {}).filter(k => /stand|gate|park|bay/i.test(k)));
    if (log.raw?.FlightOps) {
      console.log('FlightOps-kentät:', Object.keys(log.raw.FlightOps));
      console.log('FlightOps:', log.raw.FlightOps);
    }
    console.log('Full log:', log.raw);

    // Yritä extract
    const ext = extractStandNumber(f, log);
    console.log('=== LÖYDETTY STAND ===');
    console.log(ext);
  } catch (e) {
    console.error('Journey-log epäonnistui:', e);
  }
};

/* ==============================================================
 * TOPBAR COUNTDOWN · aika seuraavaan lentoon
 * ============================================================== */
function updateTopbarCountdown() {
  const el = document.getElementById('topbar-countdown');
  const timeEl = document.getElementById('topbar-countdown-time');
  if (!el || !timeEl) return;

  const roster = _afGetRoster();
  if (!roster.length) {
    el.style.display = 'none';
    return;
  }

  const now = Date.now();
  const next = roster
    .filter(f => {
      const std = new Date(f.StdLt || f.Std || 0).getTime();
      // Tulevat lennot + lennolla oleva (jos ATD asetettu eikä ATA)
      if (std > now - 15 * 60 * 1000) return true;
      const fid = String(f.ID || f.id || f.FlightID || '');
      const log = _getCachedJourneyLog(fid);
      return log?.atd && !log?.ata;
    })
    .sort((a, b) =>
      new Date(a.StdLt || a.Std || 0) - new Date(b.StdLt || b.Std || 0))[0];

  if (!next) {
    el.style.display = 'none';
    return;
  }

  const stdMs = new Date(next.StdLt || next.Std || 0).getTime();
  const diff = stdMs - now;

  el.style.display = '';

  if (diff <= 0) {
    // Lento on jo lähtenyt tai lähdössä
    const fid = String(next.ID || next.id || next.FlightID || '');
    const log = _getCachedJourneyLog(fid);
    if (log?.atd && !log?.ata) {
      timeEl.textContent = 'Lennolla';
      el.querySelector('.tc-icon').textContent = '✈';
    } else {
      timeEl.textContent = 'Nyt';
      el.querySelector('.tc-icon').textContent = '🛫';
    }
    return;
  }

  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);

  // Jos yli 24 h → näytä päivinä
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const hh = h % 24;
    timeEl.textContent = `${d}pv ${String(hh).padStart(2,'0')}h`;
  } else if (h > 0) {
    timeEl.textContent = `${h}h ${String(m).padStart(2,'0')}m`;
  } else {
    timeEl.textContent = `${m} min`;
  }

  el.querySelector('.tc-icon').textContent = '😴';
}
window.updateTopbarCountdown = updateTopbarCountdown;

/* Päivitä minuutin välein */
setInterval(updateTopbarCountdown, 60000);

/* Päivitä heti kun roster muuttuu */
window.addEventListener('storage', (ev) => {
  if (ev.key === 'assigned_flights_cache') updateTopbarCountdown();
});

/* Alusta kun DOM on valmis */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(updateTopbarCountdown, 1500);
  });
} else {
  setTimeout(updateTopbarCountdown, 1500);
}

/* ==============================================================
 * NÄYTÄ LENNON MIEHISTÖ · modaali
 * ============================================================== */
async function showFlightCrewModal(flightId, flightNum, dateStr, depIcao, arrIcao) {
  if (!flightId) {
    if (typeof showToast === 'function') showToast('Ei Flight ID:tä.', 'warning');
    return;
  }

  // Poista vanha
  const existing = document.getElementById('crew-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'crew-modal';
  overlay.className = 'rcp-overlay';
  overlay.innerHTML = `
    <div class="rcp-dialog" style="max-width:520px;">
      <div class="rcp-head">
        <div class="rcp-icon">👥</div>
        <div class="rcp-title">
          <div class="rcp-title-main">Miehistö · ${flightNum || 'Lento'}</div>
          <div class="rcp-title-sub">
            ${depIcao && arrIcao ? `${depIcao} → ${arrIcao} · ` : ''}${dateStr || ''}
          </div>
        </div>
        <button class="rcp-close" type="button" aria-label="Sulje">✕</button>
      </div>
      <div class="rcp-body" id="crew-modal-body">
        <div style="display:flex; align-items:center; gap:10px; padding:16px 0;">
          <div class="loader-spinner" style="transform:scale(0.7);"><span></span><span></span><span></span></div>
          <span style="font-size:12px; color:var(--dim);">Ladataan miehistöä…</span>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.style.pointerEvents = 'none';
  setTimeout(() => { overlay.style.pointerEvents = ''; }, 400);

  const close = () => {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 200);
  };
  overlay.querySelector('.rcp-close').addEventListener('click', close);

  requestAnimationFrame(() => overlay.classList.add('visible'));

  // Hae miehistö
  const body = document.getElementById('crew-modal-body');
  try {
    // 1. Yritä lokikirjasta
    const entry = (typeof getLogbookEntryByFlightId === 'function')
      ? getLogbookEntryByFlightId(flightId)
      : null;

    if (entry && entry.picName) {
      body.innerHTML = `
        <div class="bf-crew-list">
          <div class="bf-crew-item">
            <span class="bf-crew-role">PIC</span>
            <span class="bf-crew-name">${entry.picName}</span>
          </div>
        </div>
        <div style="font-size:11px; color:var(--dim); margin-top:10px;">
          Lähde: lokikirja
        </div>`;
      return;
    }

    // 2. Journey-log
    let log = (typeof getCachedJourneyLog === 'function')
      ? getCachedJourneyLog(flightId)
      : null;

    if (!log) {
      const token = (typeof getValidSkyplanToken === 'function')
        ? await getValidSkyplanToken().catch(() => null)
        : null;
      if (!token) {
        body.innerHTML = '<div class="empty">Token puuttuu.</div>';
        return;
      }
      log = await fetchJourneyLog(flightId, token);
      if (typeof _cacheJourneyLog === 'function') _cacheJourneyLog(flightId, log);
    }

    if (!log?.crewDuty?.length) {
      body.innerHTML = `
        <div style="padding:24px 12px; text-align:center; color:var(--dim); font-size:13px;">
          <div style="font-size:28px; margin-bottom:8px;">👥</div>
          Miehistöä ei ole vielä julkaistu.
          <div style="font-size:11px; color:var(--faint); margin-top:6px;">
            Dispatch julkaisee miehistön yleensä 24 h ennen lähtöä.
          </div>
        </div>`;
      return;
    }

    // 3. Järjestä ja näytä kaikki
    const ROLE_ORDER = {
      PIC: 1, CP: 1, CAPT: 1,
      FO: 2, SIC: 2,
      IS: 3, IFS: 3, PUR: 3, PURSER: 3,
      FY: 4, CABIN: 4, FA: 4
    };

    const crewList = log.crewDuty.map(c => {
      const pos = String(c.position || '').toUpperCase().trim();
      const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.employeeId || '–';

      let label = pos;
      if (['CP','CAPT','PIC','P1'].includes(pos)) label = 'PIC';
      else if (['FO','SIC','P2','SO'].includes(pos)) label = 'FO';
      else if (['IS','IFS','PUR','PURSER','SCC','SCCM','CSD'].includes(pos)) label = 'IFS';
      else if (['FY','FA','CABIN'].includes(pos)) label = 'CC';

      return { name, label, order: ROLE_ORDER[pos] || 9 };
    }).sort((a, b) => a.order - b.order);

        // Hae raw crewDuty jotta staffId säilyy
    const rawCrew = log.crewDuty;

    body.innerHTML = `
      <div class="bf-crew-list">
        ${rawCrew.map(c => {
          const pos = String(c.position || '').toUpperCase().trim();
          const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.employeeId || '–';

          let label = pos;
          if (['CP','CAPT','PIC','P1'].includes(pos)) label = 'PIC';
          else if (['FO','SIC','P2','SO'].includes(pos)) label = 'FO';
          else if (['IS','IFS','PUR','PURSER','SCC','SCCM','CSD'].includes(pos)) label = 'IFS';
          else if (['FY','FA','CABIN'].includes(pos)) label = 'CC';

          const staffId = c.staffId || '';
          const isFav = staffId && (typeof isFavoriteCrew === 'function') && isFavoriteCrew(staffId);
          const safeFirst = String(c.firstName || '').replace(/'/g, "\\'");
          const safeLast = String(c.lastName || '').replace(/'/g, "\\'");
          const safePos = pos.replace(/'/g, "\\'");

          return `
            <div class="bf-crew-item">
              <span class="bf-crew-role">${label}</span>
              <span class="bf-crew-name">${name}</span>
              ${staffId ? `
                <button class="crew-fav-btn ${isFav ? 'is-fav' : ''}"
                        data-fav-staff="${staffId}"
                        onclick="toggleFavoriteFromBtn(this, '${staffId}', '${safeFirst}', '${safeLast}', '${safePos}')"
                        title="${isFav ? 'Poista suosikeista' : 'Lisää suosikiksi'}">
                  ${isFav ? '★' : '☆'}
                </button>
              ` : ''}
            </div>`;
        }).join('')}
      </div>
      <div style="font-size:11px; color:var(--dim); margin-top:12px; text-align:right;">
        ${rawCrew.length} miehistön jäsentä
      </div>`;
  } catch (e) {
    console.warn('[Crew Modal]', e);
    body.innerHTML = `<div class="empty">Miehistön haku epäonnistui: ${e.message}</div>`;
  }
}
window.showFlightCrewModal = showFlightCrewModal;