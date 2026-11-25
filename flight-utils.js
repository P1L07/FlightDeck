/* ==============================================================
 * FLIGHT UTILS · Jaetut apurit (ent. activeflight.js)
 * ==============================================================
 * Sisältää:
 *   - Journey-log-cache (jaettu kaikkien moduulien kesken)
 *   - Miehistön parsinta
 *   - Stand-numeron haku
 *   - Topbar-countdown
 *   - Miehistö-modaali (viikkonäkymä)
 *   - PDF/ZIP-purku
 *   - Block fuel OFP:stä
 * ============================================================== */
'use strict';

const JOURNEY_LOG_CACHE_KEY = '_journey_log_cache';
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

/* ==============================================================
 * Journey-log-cache
 * ============================================================== */
function _cacheJourneyLog(flightId, data) {
  if (!flightId) return;
  Cache.set(`journey:log:${flightId}`, data, {
    ttlMs: JOURNEY_LOG_TTL_MS,
    mode: 'persist'
  });
}

function _getCachedJourneyLog(flightId) {
  if (!flightId) return null;
  const hit = Cache.get(`journey:log:${flightId}`, {
    allowStale: true,
    mode: 'persist'
  });
  return hit?.value || null;
}

window.getCachedJourneyLog = _getCachedJourneyLog;
window._cacheJourneyLog = _cacheJourneyLog;

/* ==============================================================
 * PDF/ZIP-purku — fallback kun extractPdfFromZipOrRaw puuttuu
 * ============================================================== */
async function _extractPdfBytes(rawPayload) {
  if (rawPayload == null) throw new Error('Tyhjä payload');

  let bytes;

  // 1. Base64-string
  if (typeof rawPayload === 'string') {
    const s = rawPayload.trim();
    const b64 = s.replace(/^data:[^;]+;base64,/, '');
    try {
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
  // 3. Typed array
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

  // PDF?
  const isPDF = bytes[0] === 0x25 && bytes[1] === 0x50
             && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (isPDF) return bytes;

  // ZIP?
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

  const head = Array.from(bytes.slice(0, 8))
    .map(b => b.toString(16).padStart(2, '0')).join(' ');
  throw new Error(`Tuntematon payload-tyyppi (ensimmäiset tavut: ${head})`);
}

if (typeof window.extractPdfFromZipOrRaw !== 'function') {
  window.extractPdfFromZipOrRaw = _extractPdfBytes;
}

/* ==============================================================
 * Miehistön parsinta journey-logista
 * ============================================================== */
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
window.parseCrewFromJourneyLog = parseCrewFromJourneyLog;

/* ==============================================================
 * Stand-numeron haku
 * ============================================================== */
function extractStandNumber(flight, log) {
  if (!flight) return null;

  // KORJAUS: ennen DepartureGateNumber (portti, esim. "A1") voitti aina,
  // vaikka Skyplanissa oli erikseen oikea stand (esim. "9R").
  // Nyt stand-kentät ensin, portti vasta viimeisenä varana.
  const ok = v => v != null && String(v).trim() !== '' && String(v).trim() !== '-';
  const standFirst = [
    'DepartureStand', 'DepartureStandNumber', 'DepartureStandCode', 'DepStand', 'StandDep',
    'DepartureParkingPosition', 'DepartureParkingStand', 'DepartureParking',
    'ParkingPosition', 'ParkingStand', 'StandNumber', 'Stand',
    'DepartureLocationNumber'
  ];
  for (const k of standFirst) {
    if (ok(flight[k])) return { value: String(flight[k]).trim(), field: k };
  }
  // Tuntematon kenttänimi: mikä tahansa lähtöön liittyvä stand/parking-kenttä
  for (const k of Object.keys(flight)) {
    if (/stand|park/i.test(k) && !/arr/i.test(k) && ok(flight[k]) && typeof flight[k] !== 'object') {
      return { value: String(flight[k]).trim(), field: k };
    }
  }
  for (const k of ['DepartureGateNumber', 'GateNumber']) {
    if (ok(flight[k])) return { value: String(flight[k]).trim(), field: k, isGate: true };
  }
  return null;
}

/* UTC-aika "HH:MM" Skyplanin ISO-ajasta. Std/Sta ovat UTC:tä; jos merkkijonossa
 * on aikavyöhyke (Z tai +hh:mm), muunnetaan Date-olion kautta. */
function fmtUtcHHMM(iso) {
  if (!iso) return '--:--';
  const s = String(iso);
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d)) return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
  return s.includes('T') ? s.split('T')[1].substring(0, 5) : s;
}
window.fmtUtcHHMM = fmtUtcHHMM;
window.extractStandNumber = extractStandNumber;

/* ==============================================================
 * BLOCK FUEL · OFP-parsinta
 * ============================================================== */
const BLOCK_FUEL_CACHE_KEY = 'jarvis_block_fuel_cache';
const BLOCK_FUEL_NEG_TTL   = 30 * 60 * 1000;   // 30 min

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

  if (result.block && !result.minBlock) result.minBlock = result.block;
  if (result.minBlock && !result.block) result.block = result.minBlock;

  if (!result.block && !result.minBlock) return null;

  result.kg = result.block;
  return result;
}

async function getBlockFuelFromOFP(flightId) {
  const fid = String(flightId || '');
  if (!fid) return null;

  // 1. Positiivinen cache
  const posHit = Cache.get(`blockfuel:${fid}`, { mode: 'persist' });
  if (posHit?.value?.block) {
    const v = posHit.value;
    return {
      block: v.block,
      minBlock: v.minBlock || v.block,
      timeHours: v.timeHours || null,
      display: _formatFuelKg(v.block),
      minDisplay: _formatFuelKg(v.minBlock || v.block)
    };
  }

  // 2. Negatiivinen cache (ei yritetä uudelleen)
  const negHit = Cache.get(`blockfuel:neg:${fid}`, { mode: 'persist' });
  if (negHit) return null;

  // 3. Hae PDF-rivit (jaetusta välimuistista)
  let lines;
  try {
    if (typeof getPDFLinesForFlight !== 'function') return null;
    lines = await getPDFLinesForFlight(fid);
  } catch (e) {
    const is422 = /422|not generated/i.test(e.message || '');
    if (!is422) console.warn('[BlockFuel] lines failed:', e.message);
    Cache.set(`blockfuel:neg:${fid}`, true, { ttlMs: BLOCK_FUEL_NEG_TTL, mode: 'persist' });
    return null;
  }

  // 4. Parsi
  try {
    const parsed = _parseBlockFuelFromLines(lines);
    if (!parsed) {
      Cache.set(`blockfuel:neg:${fid}`, true, { ttlMs: BLOCK_FUEL_NEG_TTL, mode: 'persist' });
      return null;
    }

    const payload = {
      block: parsed.block,
      minBlock: parsed.minBlock,
      timeHours: parsed.timeHours
    };
    Cache.set(`blockfuel:${fid}`, payload, { ttlMs: 6 * 60 * 60 * 1000, mode: 'persist' });

    return {
      block: payload.block,
      minBlock: payload.minBlock,
      timeHours: payload.timeHours,
      display: _formatFuelKg(payload.block),
      minDisplay: _formatFuelKg(payload.minBlock)
    };
  } catch (e) {
    console.warn('[BlockFuel] parse failed:', e.message);
    return null;
  }
}
window.getBlockFuelFromOFP = getBlockFuelFromOFP;

function _formatFuelKg(kg) {
  if (!kg || kg <= 0) return null;
  if (kg >= 10000) {
    const t = (kg / 1000).toFixed(1);
    return `${t} t · ${kg.toLocaleString('fi-FI')} kg`;
  }
  return `${kg.toLocaleString('fi-FI')} kg`;
}

/* ==============================================================
 * TOPBAR COUNTDOWN
 * ============================================================== */
function updateTopbarCountdown() {
  const el = document.getElementById('topbar-countdown');
  const timeEl = document.getElementById('topbar-countdown-time');
  if (!el || !timeEl) return;
  const iconEl = el.querySelector('.tc-icon');
  // Lentonumero + rekisteri omana ryhmänään pillerin vasemmalla puolella (kellon tyyliin)
  let grp = document.getElementById('topbar-flight');
  if (!grp) {
    grp = document.createElement('div');
    grp.id = 'topbar-flight';
    grp.className = 'topbar-flight';
    el.parentElement.insertBefore(grp, el);
  }
  let fltEl = grp.querySelector('.tc-flt');
  if (!fltEl) {
    fltEl = document.createElement('span');
    fltEl.className = 'tc-flt';
    grp.appendChild(fltEl);
  }
  let regEl = grp.querySelector('.tc-reg');
  if (!regEl) {
    regEl = document.createElement('button');
    regEl.type = 'button';
    regEl.className = 'tc-reg';
    regEl.title = 'ADD / CDD';
    regEl.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const tail = regEl.dataset.reg;
      if (tail && typeof showDefectsPopup === 'function') showDefectsPopup(tail);
    });
    fltEl.after(regEl);
  }

  const roster = _afGetRoster();
  let etaEl = document.getElementById('topbar-eta');
  if (!etaEl) {
    etaEl = document.createElement('div');
    etaEl.id = 'topbar-eta';
    etaEl.className = 'topbar-eta';
    const clock = document.getElementById('live-clock');
    (clock || el).after(etaEl);
  }
  etaEl.style.display = 'none';
  if (!roster.length) { el.style.display = 'none'; grp.style.display = 'none'; return; }

  // KORJAUS: kaikki vertailut UTC:nä (Std/Sta + toteutuneet ajat), ei StdLt/StaLt-paikallisaikoja
  const now = Date.now();
  const cands = roster
    .map(f => ({ f, a: (typeof getFlightActuals === 'function') ? getFlightActuals(f) : null }))
    .filter(x => x.a && x.a.stdMs && !x.a.done && (x.a.active || x.a.arrMs + 30 * 60e3 > now))
    .sort((x, y) => x.a.depMs - y.a.depMs);
  const next = cands.find(x => x.a.active) || cands[0];
  if (!next) { el.style.display = 'none'; grp.style.display = 'none'; return; }
  grp.style.display = '';

  const { f, a } = next;
  const c = String(f.CarrierCode || '').trim(), n = String(f.FlightNumber || '').trim();
  fltEl.textContent = (c && n.startsWith(c)) ? n : `${c}${n}`;
  const tail = String(f.RegistrationNumber || '').trim();
  const okTail = tail && tail !== '-' && tail !== 'TBA';
  regEl.textContent = okTail ? tail : '';
  regEl.dataset.reg = okTail ? tail : '';
  regEl.style.display = okTail ? '' : 'none';
  if (okTail) _tbUpdateMelColor(regEl, tail);

  // 🛬 ETA: aktiivinen lento tai tuleva lento, jolle OFP on saatavilla
  const eta = (typeof computeFlightEta === 'function') ? computeFlightEta(f, a) : null;
  if (eta && (a.active || eta.hasOfp)) {
    const d = new Date(eta.ms);
    const hhmm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    etaEl.innerHTML = `<span class="te-icon">🛬</span><span class="te-time">${hhmm}</span>`;
    etaEl.title = ({ TD: 'Touchdown', WP: 'ETA (viimeisin ATO + OFP)', TO: 'ETA (takeoff + OFP trip)', PLAN: 'ETA (STD/ETD + taxi + OFP trip)', STA: 'STA' })[eta.src] || 'ETA';
    etaEl.dataset.src = eta.src;
    etaEl.style.display = '';
  }
  el.style.display = '';

  const fmt = (ms) => {
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    if (h >= 24) return `${Math.floor(h / 24)}pv ${String(h % 24).padStart(2, '0')}h`;
    return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`;
  };

  if (a.active) {
    // Lennolla: aika saapumiseen (ATA/ETA/STA)
    iconEl.textContent = '✈';
    const left = a.arrMs - now;
    timeEl.textContent = left > 0 ? fmt(left) : '';
    el.title = 'In flight';
    return;
  }
  const diff = a.depMs - now;
  if (diff <= 0) {
    iconEl.textContent = '🛫';
    timeEl.textContent = 'Nyt';
    return;
  }
  iconEl.textContent = '😴';
  timeEl.textContent = fmt(diff);
}
window.updateTopbarCountdown = updateTopbarCountdown;

/* ==============================================================
 * ETA (laskeutuminen) · takeoff-aika + OFP:n reittipisteiden ajat
 * ==============================================================
 * Prioriteetti:
 *   1. Touchdown (journey log)                         → src 'TD'
 *   2. Viimeisin waypointille kirjattu ATO + jäljellä oleva OFP-aika → 'WP'
 *   3. Takeoff-aika (käsin / journey log) + OFP trip   → 'TO'
 *   4. ATD/ETD/STD + 10 min rullaus + OFP trip         → 'PLAN'
 *   5. Ei OFP:tä → ETA/STA rosterista                  → 'STA'
 * ============================================================== */
function computeFlightEta(f, a) {
  if (!f) return null;
  a = a || getFlightActuals(f);
  if (!a) return null;
  const fid = String(f.ID || f.id || f.FlightID || '');
  if (a.onMs) return { ms: a.onMs, src: 'TD', hasOfp: true };

  // OFP-reittipisteet (välimuisti)
  let wps = [];
  try {
    const c = JSON.parse(localStorage.getItem('notam_wp_cache_v3') || '{}')[fid];
    wps = (c?.data?.allWaypoints || c?.data?.waypoints || []).filter(w => w && w.totalMins != null && isFinite(w.totalMins));
  } catch (e) {}
  if (!wps.length && Array.isArray(window._allOFPWaypoints) && String(window._homeOfpFid || '') === fid) {
    wps = window._allOFPWaypoints.filter(w => w && w.totalMins != null && isFinite(w.totalMins));
  }
  const hasOfp = wps.length > 0;
  if (!hasOfp) {
    const ms = a.etaMs ?? a.staMs;
    return ms ? { ms, src: 'STA', hasOfp: false } : null;
  }
  const trip = Math.max(...wps.map(w => +w.totalMins));

  // Takeoff-aika
  let toMs = null;
  try {
    const ctx = (typeof Cache !== 'undefined') ? Cache.get(`flight:context:${fid}`, { mode: 'persist' })?.value : null;
    toMs = utcMs(ctx?.takeoffIso);
  } catch (e) {}
  if (!toMs) toMs = a.offMs;

  // Viimeisin kirjattu ATO
  if (toMs && typeof getAllWaypointLogs === 'function') {
    const logs = getAllWaypointLogs(fid) || {};
    let best = null;
    for (const w of wps) {
      const lg = logs[String(w.name || '').toUpperCase()];
      const m = String(lg?.ato || '').match(/^(\d{1,2}):?(\d{2})$/);
      if (!m) continue;
      const base = new Date(toMs);
      let ms = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), +m[1], +m[2]);
      if (ms < toMs - 12 * 3600e3) ms += 24 * 3600e3;
      if (ms < toMs - 30 * 60e3) ms += 24 * 3600e3;        // yli puolenyön
      if (!best || +w.totalMins > best.tm) best = { tm: +w.totalMins, ms };
    }
    if (best) return { ms: best.ms + (trip - best.tm) * 60e3, src: 'WP', hasOfp };
  }
  if (toMs) return { ms: toMs + trip * 60e3, src: 'TO', hasOfp };
  const dep = a.atdMs ?? a.etdMs ?? a.stdMs;
  return dep ? { ms: dep + (10 + trip) * 60e3, src: 'PLAN', hasOfp } : null;
}
window.computeFlightEta = computeFlightEta;

/* Rekisterin väri: keltainen, jos avoimissa ADD/CDD-vioissa on MEL-kohde */
const _tbMelCheckedAt = {};
// Vain oikea MEL-viitenumero (esim. 34-01-22B) muuttaa värin keltaiseksi
const _TB_MEL_RE = /\b\d{2}-\d{2}-\d{2}(?:-\d{1,2})?[A-Z]?\b/i;
function _tbHasMel(defects) {
  return (defects || []).some(d => d && ['MelNumber', 'MELNumber', 'melNumber', 'Mel', 'MEL', 'mel']
    .some(k => d[k] != null && _TB_MEL_RE.test(String(d[k]))));
}
function _tbUpdateMelColor(regEl, tail) {
  const key = String(tail).trim().toUpperCase();
  // 1. Välimuisti heti
  try {
    const raw = localStorage.getItem((typeof ADD_CACHE_PREFIX !== 'undefined' ? ADD_CACHE_PREFIX : 'add_cache_') + key);
    if (raw) regEl.classList.toggle('has-mel', _tbHasMel(JSON.parse(raw)));
  } catch (e) {}
  // 2. Tuore haku enintään 20 min välein
  if (typeof fetchAircraftDefects !== 'function') return;
  if (Date.now() - (_tbMelCheckedAt[key] || 0) < 20 * 60e3) return;
  _tbMelCheckedAt[key] = Date.now();
  fetchAircraftDefects(key).then(list => {
    if (regEl.dataset.reg === tail) regEl.classList.toggle('has-mel', _tbHasMel(list));
  }).catch(() => {});
}

setInterval(updateTopbarCountdown, 60000);
// Päivitä yläpalkki heti käynnistyksessä ja kun kotisivun reitti/OFP on ladattu
(function () {
  const kick = () => { try { updateTopbarCountdown(); } catch (e) {} };
  const afterRoute = () => {
    const p = window._homeRouteLoadPromise;
    if (p && typeof p.then === 'function') p.then(kick, kick);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { kick(); afterRoute(); });
  else { kick(); afterRoute(); }
  setTimeout(kick, 3000);
})();

window.addEventListener('storage', (ev) => {
  if (ev.key === 'assigned_flights_cache') updateTopbarCountdown();
});

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

  const body = document.getElementById('crew-modal-body');

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  try {
    // 1. Lokikirjasta
    const entry = (typeof getLogbookEntryByFlightId === 'function')
      ? getLogbookEntryByFlightId(flightId)
      : null;

    if (entry && entry.picName) {
      body.innerHTML = `
        <div class="bf-crew-list">
          <div class="bf-crew-item">
            <span class="bf-crew-role">PIC</span>
            <span class="bf-crew-name">${esc(entry.picName)}</span>
          </div>
        </div>
        <div style="font-size:11px; color:var(--dim); margin-top:10px;">
          Lähde: lokikirja
        </div>`;
      return;
    }

    // 2. Journey-log
    let log = _getCachedJourneyLog(flightId);

    if (!log) {
      const token = (typeof getValidSkyplanToken === 'function')
        ? await getValidSkyplanToken().catch(() => null)
        : null;
      if (!token) {
        body.innerHTML = '<div class="empty">Token puuttuu.</div>';
        return;
      }
      log = await fetchJourneyLog(flightId, token);
      if (log) _cacheJourneyLog(flightId, log);
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

    const ROLE_ORDER = {
      PIC: 1, CP: 1, CAPT: 1, P1: 1,
      FO: 2, SIC: 2, P2: 2, SO: 2,
      IS: 3, IFS: 3, PUR: 3, PURSER: 3, SCC: 3, SCCM: 3, CSD: 3,
      FY: 4, FA: 4, CABIN: 4, CC: 4
    };

    const rows = log.crewDuty
      .map((c, i) => {
        const pos = String(c.position || '').toUpperCase().trim();
        const name = [c.firstName, c.lastName].filter(Boolean).join(' ')
                  || c.employeeId || '–';

        let label = pos || '?';
        if (['CP','CAPT','PIC','P1'].includes(pos)) label = 'PIC';
        else if (['FO','SIC','P2','SO'].includes(pos)) label = 'FO';
        else if (['IS','IFS','PUR','PURSER','SCC','SCCM','CSD'].includes(pos)) label = 'IFS';
        else if (['FY','FA','CABIN','CC'].includes(pos)) label = 'CC';

        const staffId = String(c.staffId || '');
        const isFav = staffId
          && (typeof isFavoriteCrew === 'function')
          && isFavoriteCrew(staffId);
        const safeFirst = String(c.firstName || '').replace(/'/g, "\\'");
        const safeLast  = String(c.lastName  || '').replace(/'/g, "\\'");
        const safePos   = pos.replace(/'/g, "\\'");

        return {
          name, label, staffId, isFav, safeFirst, safeLast, safePos,
          order: ROLE_ORDER[pos] || 9,
          origIndex: i
        };
      })
      .sort((a, b) => (a.order - b.order) || (a.origIndex - b.origIndex))
      .map(c => `
        <div class="bf-crew-item">
          <span class="bf-crew-role">${esc(c.label)}</span>
          <span class="bf-crew-name">${esc(c.name)}</span>
          ${c.staffId ? `
            <button class="crew-fav-btn ${c.isFav ? 'is-fav' : ''}"
                    data-fav-staff="${c.staffId}"
                    onclick="toggleFavoriteFromBtn(this, '${c.staffId}', '${c.safeFirst}', '${c.safeLast}', '${c.safePos}')"
                    title="${c.isFav ? 'Poista suosikeista' : 'Lisää suosikiksi'}">
              ${c.isFav ? '★' : '☆'}
            </button>
          ` : ''}
        </div>
      `).join('');

    body.innerHTML = `
      <div class="bf-crew-list">${rows}</div>
      <div style="font-size:11px; color:var(--dim); margin-top:12px; text-align:right;">
        ${log.crewDuty.length} miehistön jäsentä
      </div>`;
  } catch (e) {
    console.warn('[Crew Modal]', e);
    const msg = String(e?.message || '');
    const isNotPublished = msg.includes('422') || msg.includes('not available')
                        || msg.includes('not been completed');
    if (isNotPublished) {
      body.innerHTML = `
        <div style="padding:24px 12px; text-align:center; color:var(--dim); font-size:13px;">
          <div style="font-size:28px; margin-bottom:8px;">👥</div>
          Miehistöä ei ole vielä julkaistu.
        </div>`;
    } else {
      body.innerHTML = `<div class="empty">Miehistön haku epäonnistui: ${esc(e.message)}</div>`;
    }
  }
}
window.showFlightCrewModal = showFlightCrewModal;

/* ==============================================================
 * Debug-apurit (säilytetty — eivät häiritse)
 * ============================================================== */
window.debugStand = async function(flightId) {
  const roster = _afGetRoster();
  const f = flightId
    ? roster.find(x => String(x.ID || x.id) === String(flightId))
    : roster.find(x => new Date(x.StdLt || x.Std).getTime() > Date.now());

  if (!f) { console.warn('Lentoa ei löytynyt'); return; }
  console.log('Stand/Gate-kentät:',
    Object.keys(f).filter(k => /stand|gate|park|bay/i.test(k)));
  console.log(extractStandNumber(f, null));
};

window.debugBlockFuel = async function(flightId) {
  const fid = String(flightId || '');
  if (!fid) { console.warn('Anna flightId'); return null; }
  try {
    const c = JSON.parse(localStorage.getItem(BLOCK_FUEL_CACHE_KEY) || '{}');
    delete c[fid];
    localStorage.setItem(BLOCK_FUEL_CACHE_KEY, JSON.stringify(c));
  } catch (e) {}
  const r = await getBlockFuelFromOFP(fid);
  return r;
};
/* ==============================================================
 * LENNON TILA · toteutuneet ajat (ATD / takeoff / touchdown / ATA)
 * ==============================================================
 * Skyplanin Std/Sta ovat UTC:tä ilman aikavyöhykettä → parsitaan
 * UTC:nä. Toteutuneet ajat tulevat journey-logista (välimuisti) tai
 * lokikirjan kirjauksesta. Näin lento tunnistetaan lennetyksi myös,
 * jos se laskeutui (tai lähti) suunniteltua aiemmin.
 * ============================================================== */
function utcMs(iso) {
  if (!iso) return null;
  const s = String(iso).trim();
  if (!s) return null;
  const ms = /(Z|[+-]\d{2}:?\d{2})$/.test(s) ? Date.parse(s) : Date.parse(s + 'Z');
  return isFinite(ms) ? ms : null;
}

function _fsPick(o, keys) {
  if (!o) return null;
  for (const k of keys) if (o[k] != null && String(o[k]).trim() !== '' && String(o[k]).trim() !== '-') return o[k];
  return null;
}

function getFlightActuals(f) {
  if (!f) return null;
  const fid = String(f.ID || f.id || f.FlightID || '');
  const log = (typeof _getCachedJourneyLog === 'function' ? _getCachedJourneyLog(fid) : null) || null;
  const lb = (typeof getLogbookEntryByFlightId === 'function' ? getLogbookEntryByFlightId(fid) : null)?.skyplan || null;

  const stdMs = utcMs(f.Std) ?? utcMs(f.StdLt);
  const staMs = utcMs(f.Sta) ?? utcMs(f.StaLt);
  const etdMs = utcMs(_fsPick(f, ['Etd', 'ETD', 'EstimatedDeparture']));
  const etaMs = utcMs(_fsPick(f, ['Eta', 'ETA', 'EstimatedArrival']));
  const atdMs = utcMs(log?.atd) ?? utcMs(lb?.atd) ?? utcMs(_fsPick(f, ['Atd', 'ATD', 'ActualDeparture']));
  const ataMs = utcMs(log?.ata) ?? utcMs(lb?.ata) ?? utcMs(_fsPick(f, ['Ata', 'ATA', 'ActualArrival']));
  const offMs = utcMs(log?.takeoff) ?? utcMs(lb?.takeoff);
  const onMs  = utcMs(log?.touchdown) ?? utcMs(lb?.touchdown);

  const depMs = atdMs ?? etdMs ?? stdMs;            // paras arvio lähdöstä (off-block)
  const arrMs = ataMs ?? etaMs ?? staMs;            // paras arvio saapumisesta (on-block)
  const now = Date.now();

  let state;
  if (ataMs || (onMs && now > onMs + 10 * 60e3) || lb) state = 'done';
  else if (onMs) state = 'landed';                  // laskeutunut, rullaa
  else if (offMs) state = 'air';
  else if (atdMs) state = 'out';                    // off-block, ei vielä ilmassa
  else if (arrMs && now > arrMs + 30 * 60e3) state = 'done';   // ei dataa, mutta aika ohi
  else state = 'planned';

  return { fid, stdMs, staMs, etdMs, etaMs, atdMs, ataMs, offMs, onMs, depMs, arrMs, state,
           done: state === 'done', active: state === 'out' || state === 'air' || state === 'landed' };
}

/* Päivän (duty) sektorit: ketjutetaan lennot, joiden väli < 10 h */
function getDutySectors(f, roster) {
  if (!f) return [];
  const list = (roster || []).filter(x => (utcMs(x.Std) ?? utcMs(x.StdLt)) && (utcMs(x.Sta) ?? utcMs(x.StaLt)))
    .slice().sort((a, b) => (utcMs(a.Std) ?? utcMs(a.StdLt)) - (utcMs(b.Std) ?? utcMs(b.StdLt)));
  const id = x => String(x.ID || x.id || x.FlightID || '');
  let i = list.findIndex(x => id(x) === id(f));
  if (i < 0) return [f];
  const GAP = 10 * 3600e3;
  let a = i, b = i;
  while (a > 0 && (utcMs(list[a].Std) ?? utcMs(list[a].StdLt)) - (utcMs(list[a - 1].Sta) ?? utcMs(list[a - 1].StaLt)) < GAP) a--;
  while (b < list.length - 1 && (utcMs(list[b + 1].Std) ?? utcMs(list[b + 1].StdLt)) - (utcMs(list[b].Sta) ?? utcMs(list[b].StaLt)) < GAP) b++;
  return list.slice(a, b + 1);
}

/* Päivitä journey-logit päivän sektoreille, jotka ovat alkaneet (toteutuneet ajat) */
const _fsJlFetchedAt = {};
async function refreshDutyActuals(sectors, force) {
  if (typeof fetchJourneyLog !== 'function' || !navigator.onLine) return false;
  const now = Date.now();
  const todo = (sectors || []).filter(f => {
    const a = getFlightActuals(f);
    if (!a || a.ataMs) return false;
    if (now < (a.depMs ?? 0) - 45 * 60e3) return false;           // ei vielä alkanut
    if (now > (a.arrMs ?? 0) + 12 * 3600e3) return false;         // liian vanha
    return force || !(now - (_fsJlFetchedAt[a.fid] || 0) < 3 * 60e3);
  });
  if (!todo.length) return false;
  const token = (typeof getValidSkyplanToken === 'function') ? await getValidSkyplanToken().catch(() => null) : null;
  if (!token) return false;
  let changed = false;
  for (const f of todo) {
    const fid = String(f.ID || f.id || f.FlightID || '');
    _fsJlFetchedAt[fid] = Date.now();
    try {
      const before = _getCachedJourneyLog(fid);
      const log = await fetchJourneyLog(fid, token);
      if (log) {
        _cacheJourneyLog(fid, log);
        if (!before || before.atd !== log.atd || before.ata !== log.ata ||
            before.takeoff !== log.takeoff || before.touchdown !== log.touchdown) changed = true;
      }
    } catch (e) { /* 422 = ei vielä saatavilla */ }
  }
  return changed;
}

window.utcMs = utcMs;
window.getFlightActuals = getFlightActuals;
window.getDutySectors = getDutySectors;
window.refreshDutyActuals = refreshDutyActuals;

/* Toteutuneiden aikojen automaattinen päivitys:
 *  - heti kun nettiyhteys palaa (online-tapahtuma)
 *  - kun sovellus tulee taas näkyviin (visibilitychange)
 *  - 3 min välein, kun sovellus on auki ja verkossa
 * Haetaan vain alkaneille lennoille (viim. 14 h), joilta ATA puuttuu. */
let _fsAutoBusy = false;
async function refreshRecentActuals(force) {
  if (_fsAutoBusy || !navigator.onLine) return;
  _fsAutoBusy = true;
  try {
    let roster = [];
    try { roster = JSON.parse(localStorage.getItem('assigned_flights_cache') || '[]'); } catch (e) {}
    const now = Date.now();
    const recent = (Array.isArray(roster) ? roster : []).filter(f => {
      const s = utcMs(f.Std) ?? utcMs(f.StdLt);
      return s && s < now + 60 * 60e3 && s > now - 14 * 3600e3;
    });
    if (!recent.length) return;
    const changed = await refreshDutyActuals(recent, force);
    if (changed) {
      if (typeof _bfRefreshDayCard === 'function') _bfRefreshDayCard();
      if (typeof renderHomeDashboard === 'function' && document.querySelector('#tab-home.active')) {
        renderHomeDashboard().catch?.(() => {});
      }
      if (typeof updateTopbarCountdown === 'function') updateTopbarCountdown();
    }
  } catch (e) {
  } finally { _fsAutoBusy = false; }
}
window.refreshRecentActuals = refreshRecentActuals;
window.addEventListener('online', () => setTimeout(() => refreshRecentActuals(true), 1500));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') setTimeout(() => refreshRecentActuals(true), 800);
});
setInterval(() => { if (document.visibilityState === 'visible') refreshRecentActuals(false); }, 3 * 60e3);
setTimeout(() => refreshRecentActuals(false), 8000);
