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

  const candidates = [
    'DepartureGateNumber',
    'DepartureStand',
    'DepStand',
    'StandDep',
    'DepartureLocationNumber',
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

async function _extractPDFLines(pdfBytes) {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('pdf.js ei ole ladattu');
  }
  const data = pdfBytes instanceof Uint8Array
    ? pdfBytes
    : new Uint8Array(pdfBytes);

  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const page = await pdf.getPage(1);

  if (typeof window.getLinesFromPDFPage === 'function') {
    return await window.getLinesFromPDFPage(page);
  }

  const content = await page.getTextContent();
  const lineMap = new Map();
  content.items.forEach(item => {
    const y = Math.round(item.transform[5]);
    if (!lineMap.has(y)) lineMap.set(y, []);
    lineMap.get(y).push({ x: item.transform[4], str: item.str });
  });
  return [...lineMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([_, parts]) =>
      parts.sort((a, b) => a.x - b.x).map(p => p.str).join(' ').trim()
    );
}

async function getBlockFuelFromOFP(flightId) {
  const fid = String(flightId || '');
  if (!fid) return null;

  // Positiivinen / negatiivinen cache
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
    if (hit?.notAvailable) {
      const age = Date.now() - new Date(hit.notAvailable).getTime();
      if (age < BLOCK_FUEL_NEG_TTL) return null;
    }
  } catch (e) {}

  // Käytä jaettua PDF-cachea jos saatavilla
  let pdfBytes = null;
  try {
    if (typeof _getPDFBytesForFlight === 'function') {
      const entry = await _getPDFBytesForFlight(fid);
      pdfBytes = entry?.bytes || null;
    } else if (typeof fetchSkyplanOFPBytes === 'function') {
      const token = (typeof getValidSkyplanToken === 'function')
        ? await getValidSkyplanToken().catch(() => null)
        : null;
      const r = await fetchSkyplanOFPBytes(fid, token);
      pdfBytes = r?.pdfBytes || null;
    }
  } catch (e) {
    const is422 = /422|not generated/i.test(e.message || '');
    if (!is422) console.warn('[BlockFuel] fetch failed:', e.message);
    try {
      const cache = JSON.parse(localStorage.getItem(BLOCK_FUEL_CACHE_KEY) || '{}');
      cache[fid] = { notAvailable: new Date().toISOString() };
      localStorage.setItem(BLOCK_FUEL_CACHE_KEY, JSON.stringify(cache));
    } catch (e2) {}
    return null;
  }

  if (!pdfBytes) {
    try {
      const cache = JSON.parse(localStorage.getItem(BLOCK_FUEL_CACHE_KEY) || '{}');
      cache[fid] = { notAvailable: new Date().toISOString() };
      localStorage.setItem(BLOCK_FUEL_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {}
    return null;
  }

  try {
    const lines = await _extractPDFLines(pdfBytes);
    const parsed = _parseBlockFuelFromLines(lines);
    if (!parsed) return null;

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

  const roster = _afGetRoster();
  if (!roster.length) {
    el.style.display = 'none';
    return;
  }

  const now = Date.now();
  const next = roster
    .filter(f => {
      const std = new Date(f.StdLt || f.Std || 0).getTime();
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

setInterval(updateTopbarCountdown, 60000);

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