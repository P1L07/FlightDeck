/* ==============================================================
 * NOTAM-OFP · NOTAMit ja waypointit OFP-PDF:stä
 * ==============================================================
 * Käyttää:
 *   - getLinesFromPDFPage(page)       ← ofp-parser.js
 *   - extractNOTAMs(lines)            ← ofp-parser.js
 *   - extractCoordFromString(text)    ← ofp-parser.js
 *   - buildRows(items)                ← ofp-parser.js
 *   - parseTimeString(str)            ← ofp-parser.js
 *   - FLIGHT_THREAT_DICTIONARY        ← ofp-parser.js
 *   - fetchSkyplanOFPBytes(flightId)  ← app.js
 *   - _icaoCoords(icao)               ← logbook.js
 *   - normalizeIcao(icao)             ← airport-db.js
 * ============================================================== */
'use strict';

const NOTAM_OFP_TTL = 30 * 60 * 1000;

/* ==============================================================
 * JAETTU PDF-BYTES CACHE — yksi lataus per lento
 * ==============================================================
 * - Ei aikapohjaista TTL:ää: cache elää kunnes lento on ohi
 * - Automaattinen siivous: 24 h STA:n jälkeen
 * - Fallback: 7 vrk jos STA puuttuu
 * - forceRefresh: käyttäjä voi pakottaa tuoreen haun
 * - In-flight dedup: vain yksi verkkopyyntö samanaikaisesti
 * ============================================================== */
const _pdfBytesCache = new Map();     // fid → { bytes, isFinalized, at, sta }
const _pdfBytesInFlight = new Map();  // fid → Promise
window._isPDFCached = function(fid) {
  return _pdfBytesCache.has(String(fid));
};
window._getCachedPDFBytes = function(fid) {
  const key = String(fid);
  const cached = _pdfBytesCache.get(key);
  return cached ? cached.bytes : null;
};

const PDF_CACHE_GRACE_AFTER_STA = 24 * 60 * 60 * 1000;   // 24 h
const PDF_CACHE_STALE_FALLBACK  = 7 * 24 * 60 * 60 * 1000; // 7 vrk

/* ==============================================================
 * PDF-RIVIVÄLIMUISTI · jaettu kaikkien OFP-lukijoiden kesken
 * ==============================================================
 * - Yksi PDF-purku per lento (ei kolmea)
 * - TTL 30 min muistissa
 * - Invalidoidaan _invalidatePDFCache:n yhteydessä
 * ============================================================== */
const _pdfLinesCache = new Map();       // fid → Promise<string[]>
const _pdfLinesCacheAt = new Map();     // fid → timestamp
const PDF_LINES_TTL = 30 * 60 * 1000;

async function getPDFLinesForFlight(fid, options = {}) {
  const key = String(fid);
  const { forceRefresh = false } = options;

  if (!forceRefresh) {
    const at = _pdfLinesCacheAt.get(key);
    const promise = _pdfLinesCache.get(key);
    if (promise && at && (Date.now() - at) < PDF_LINES_TTL) {
      return await promise;
    }
  }

  const promise = (async () => {
    const entry = await _getPDFBytesForFlight(key);
    if (!entry?.bytes) throw new Error('Ei PDF-tavuja');
    return await _notamReadPDFLines(entry.bytes);
  })();

  _pdfLinesCache.set(key, promise);
  _pdfLinesCacheAt.set(key, Date.now());

  try {
    return await promise;
  } catch (e) {
    _pdfLinesCache.delete(key);
    _pdfLinesCacheAt.delete(key);
    throw e;
  }
}
window.getPDFLinesForFlight = getPDFLinesForFlight;

/* ==============================================================
 * OFP-FUEL · polttoainetiedot PDF:stä
 * ==============================================================
 * Palauttaa { blockFuel, taxi, trip, minBlock, takeoffFuel } kg.
 * takeoffFuel = blockFuel - taxi (käytetään EFOB-laskennassa).
 * ============================================================== */
async function getOFPFuelData(fid) {
  if (!fid) return null;
  try {
    const lines = await getPDFLinesForFlight(fid);
    const out = { blockFuel: 0, taxi: 0, trip: 0, minBlock: 0, takeoffFuel: 0 };

    for (const line of lines) {
      if (out.blockFuel === 0) {
        const m = line.match(/BLOCK\s+FUEL\s+(\d{1,2}[.:]\d{2})\s+(\d+)/i);
        if (m) out.blockFuel = parseInt(m[2], 10) || 0;
      }
      if (out.taxi === 0) {
        const m = line.match(/^TAXI\s+(\d+)/i);
        if (m) out.taxi = parseInt(m[1], 10) || 0;
      }
      if (out.trip === 0) {
        const m = line.match(/^TRIP\s+(\d{1,2}[.:]\d{2})\s+(\d+)/i);
        if (m) out.trip = parseInt(m[2], 10) || 0;
      }
      if (out.minBlock === 0) {
        const m = line.match(/MINIMUM\s+BLOCK\s+(\d+)/i);
        if (m) out.minBlock = parseInt(m[1], 10) || 0;
      }
    }

    out.takeoffFuel = Math.max(0, out.blockFuel - out.taxi);
    return out;
  } catch (e) {
    console.warn('[OFP-Fuel] parse failed:', e.message);
    return null;
  }
}
window.getOFPFuelData = getOFPFuelData;

window._invalidatePDFLinesCache = function(fid) {
  const key = String(fid);
  _pdfLinesCache.delete(key);
  _pdfLinesCacheAt.delete(key);
};

function _cleanupOldPDFCache() {
  const now = Date.now();
  for (const [key, entry] of _pdfBytesCache.entries()) {
    const expiry = entry.sta
      ? entry.sta + PDF_CACHE_GRACE_AFTER_STA
      : entry.at + PDF_CACHE_STALE_FALLBACK;
    if (now > expiry) {
      _pdfBytesCache.delete(key);
    }
  }
}

async function _getPDFBytesForFlight(fid, options = {}) {
  const { forceRefresh = false, flightNum = '', dateStr = '' } = options;
  const key = String(fid);

  _cleanupOldPDFCache();

  if (!forceRefresh) {
    const cached = _pdfBytesCache.get(key);
    if (cached) {
      if (cached.is422) {
        // 422-merkintä voimassa vain 15 min
        if (Date.now() - cached.at < 15 * 60 * 1000) {
          const err = new Error('OFP not generated by flight dispatch yet (HTTP 422).');
          err.code = 'OFP_NOT_AVAILABLE';
          throw err;
        }
        // Vanhentunut → poistetaan ja yritetään uudelleen
        _pdfBytesCache.delete(key);
      } else {
        return cached;
      }
    }
  }

  if (_pdfBytesInFlight.has(key)) {
    return await _pdfBytesInFlight.get(key);
  }

  const p = (async () => {
    try {
      if (typeof fetchSkyplanOFPBytes !== 'function') {
        throw new Error('fetchSkyplanOFPBytes puuttuu');
      }

      const token = (typeof getValidSkyplanToken === 'function')
        ? await getValidSkyplanToken().catch(() => null) : null;

      const r = await fetchSkyplanOFPBytes(fid, token, flightNum, dateStr);
      if (!r?.pdfBytes) throw new Error('Ei PDF-tavuja');

      let sta = 0;
      try {
        const roster = JSON.parse(localStorage.getItem('assigned_flights_cache') || '[]');
        const f = roster.find(x => String(x.ID || x.id || x.FlightID) === key);
        if (f) sta = new Date(f.StaLt || f.Sta || 0).getTime() || 0;
      } catch (e) {}

      const entry = {
        bytes: r.pdfBytes,
        isFinalized: !!r.isFinalized,
        at: Date.now(),
        sta
      };
      _pdfBytesCache.set(key, entry);
      return entry;

    } catch (err) {
      if (err.code === 'OFP_NOT_AVAILABLE' || String(err.message).includes('422')) {
        _pdfBytesCache.set(key, {
          bytes: null,
          is422: true,
          at: Date.now(),
          sta: 0
        });
      }
      throw err;
    } finally {
      _pdfBytesInFlight.delete(key);
    }
  })();

  _pdfBytesInFlight.set(key, p);
  return await p;
}

/* Tyhjennä kaikki 422-merkinnät (bootissa / manuaalisesti) */
window._clear422Cache = function() {
  let cleared = 0;
  for (const [k, v] of _pdfBytesCache.entries()) {
    if (v.is422) {
      _pdfBytesCache.delete(k);
      cleared++;
    }
  }
  if (cleared) console.log(`[OFP Cache] Tyhjennetty ${cleared} kpl 422-merkintää`);
};

function _invalidatePDFCache(fid) {
  const key = String(fid);
  _pdfBytesCache.delete(key);
  _pdfBytesInFlight.delete(key);
  _pdfLinesCache.delete(key);
  _pdfLinesCacheAt.delete(key);
}
window._invalidatePDFCache = _invalidatePDFCache;

/* ==============================================================
 * Lue kaikki PDF-rivit
 * ============================================================== */
async function _notamReadPDFLines(pdfBytes) {
  if (!pdfBytes) return [];
  if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js puuttuu');
  if (typeof getLinesFromPDFPage !== 'function') throw new Error('getLinesFromPDFPage puuttuu');

  // KORJAUS: Tehdään kopio datasta (.slice(0)), jotta pdf.js ei "irrota" alkuperäistä puskuria!
  const bufferCopy = pdfBytes.slice ? pdfBytes.slice(0) : pdfBytes;
  const data = new Uint8Array(bufferCopy);
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  
  const allLines = [];

  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const lines = await getLinesFromPDFPage(page);
      allLines.push(...lines);
    }
  } finally {
    try { pdf.destroy(); } catch (e) {}
  }

  return allLines;
}

/* ==============================================================
 * NOTAM-parserit
 * ============================================================== */
function _notamParseHeader(notamText) {
  const firstLine = String(notamText || '').split('\n')[0].trim();

  const m1 = firstLine.match(/^(?:-\s*)?([A-Z]{4})\s+([A-Z]{1,2}\d{4}\/\d{2})/i);
  if (m1) return { airport: m1[1].toUpperCase(), id: m1[2].toUpperCase() };

  const m2 = firstLine.match(/^NOTAM\s*([A-Z]{4})\s+([A-Z]{1,2}\d{4}\/\d{2})/i);
  if (m2) return { airport: m2[1].toUpperCase(), id: m2[2].toUpperCase() };

  // Fallback: mikä tahansa ICAO ensimmäiseltä riviltä
  const m3 = firstLine.match(/\b([A-Z]{4})\b/);
  if (m3) return { airport: m3[1].toUpperCase(), id: '' };

  return { airport: '', id: '' };
}

function _notamCategorize(notamText) {
  const rules = (typeof FLIGHT_THREAT_DICTIONARY !== 'undefined')
    ? FLIGHT_THREAT_DICTIONARY.notams
    : [];

  let best = null;
  const rank = { critical: 0, warning: 1, info: 2 };

  rules.forEach(rule => {
    try {
      if (rule.regex.test(notamText)) {
        if (!best || rank[rule.level] < rank[best.level]) {
          best = { level: rule.level, type: rule.type };
        }
      }
    } catch (e) {}
  });

  return best || { level: 'info', type: 'INFO' };
}

function _notamEnrich(notamStrings) {
  if (!Array.isArray(notamStrings)) return [];

  return notamStrings.map(raw => {
    const header = _notamParseHeader(raw);
    const cat = _notamCategorize(raw);

    const validity = (typeof parseNotamValidity === 'function')
      ? parseNotamValidity(raw)
      : { validFrom: null, validTo: null, permanent: false };

    return {
      airport:  header.airport,
      id:       header.id,
      text:     raw,
      severity: cat.level,
      type:     cat.type,
      validFrom: validity.validFrom,
      validTo:   validity.validTo,
      permanent: validity.permanent
    };
  }).filter(n => n.airport);
}

/* ==============================================================
 * Pääfunktio: parseOFPsForNotams
 * ============================================================== */
async function parseOFPsForNotams(flightId) {
  const fid = String(flightId || '');
  if (!fid) throw new Error('Ei Flight ID:tä');

  // localStorage-cache
  const cached = Cache.get(`notam:ofp:${fid}`, { mode: 'persist' });
  if (cached?.value) return cached.value;

  if (typeof extractNOTAMs !== 'function') {
    throw new Error('extractNOTAMs puuttuu');
  }

  let lines;
  try {
    lines = await getPDFLinesForFlight(fid);
  } catch (err) {
    if (err.code === 'OFP_NOT_AVAILABLE' || String(err.message).includes('422')) {
      const data = { flightId: fid, notams: [], at: new Date().toISOString(), is422: true };
      Cache.set(`notam:ofp:${fid}`, data, { ttlMs: NOTAM_OFP_TTL, mode: 'persist' });
      return data;
    }
    throw err;
  }

  const rawNotams = extractNOTAMs(lines);
  const notams = _notamEnrich(rawNotams);

  const data = {
    flightId: fid,
    notams,
    at: new Date().toISOString()
  };

  // Tallenna localStorageen
  Cache.set(`notam:ofp:${fid}`, data, { ttlMs: NOTAM_OFP_TTL, mode: 'persist' });
  return data;
}
window.parseOFPsForNotams = parseOFPsForNotams;

/* ==============================================================
 * Rakenna kenttälista (DEP/DEST/ALTN/NOTAM)
 * ============================================================== */
function buildAirportData(notams, flight, options = {}) {
  const notamMap = new Map();
  (notams || []).forEach(n => {
    if (!n.airport) return;
    if (!notamMap.has(n.airport)) notamMap.set(n.airport, []);
    notamMap.get(n.airport).push(n);
  });

  const pickIcao = (...vals) => {
    for (const v of vals) {
      const s = String(v || '').toUpperCase().trim();
      if (s && s.length === 4) return s;
    }
    return '';
  };

  // 1. Flight-objektista
  let dep = pickIcao(
    flight?.DepartureStationIcaoCode,
    flight?.DepartureStationCode,
    flight?.DepIcao,
    flight?.DepartureIcao
  );
  let arr = pickIcao(
    flight?.ArrivalStationIcaoCode,
    flight?.ArrivalStationCode,
    flight?.ArrIcao,
    flight?.ArrivalIcao
  );

  // 2. DOM:sta
  if (!dep) {
    dep = pickIcao(
      document.getElementById('view-dep')?.innerText,
      document.querySelector('[data-field="dep-icao"]')?.textContent
    );
  }
  if (!arr) {
    arr = pickIcao(
      document.getElementById('view-dest')?.innerText,
      document.getElementById('view-arr')?.innerText,
      document.querySelector('[data-field="arr-icao"]')?.textContent
    );
  }

  // 3. OFP-notameista (DEP/DEST-prefix)
  if (!dep || !arr) {
    (notams || []).forEach(n => {
      if (!dep && /^DEP/i.test(n.type || '')) dep = n.airport;
      if (!arr && /^DEST/i.test(n.type || '')) arr = n.airport;
    });
  }

  // 4. Rosterista
  if ((!dep || !arr) && flight?.ID) {
    try {
      const roster = JSON.parse(localStorage.getItem('assigned_flights_cache') || '[]');
      const m = roster.find(x => String(x.ID || x.id || x.FlightID) === String(flight.ID));
      if (m) {
        dep = dep || pickIcao(m.DepartureStationIcaoCode, m.DepartureStationCode);
        arr = arr || pickIcao(m.ArrivalStationIcaoCode, m.ArrivalStationCode);
      }
    } catch (e) {}
  }

  // Alternates
  const altn1 = pickIcao(flight?.Alternate1IcaoCode, flight?.Alternate1);
  const altn2 = pickIcao(flight?.Alternate2IcaoCode, flight?.Alternate2);
  const alternates = [altn1, altn2].filter(Boolean);

  // Normalisoi legacy-ICAOt (UACN → UACC)
  const norm = (typeof normalizeIcao === 'function')
    ? normalizeIcao
    : (x) => String(x || '').toUpperCase().trim();

  dep = norm(dep);
  arr = norm(arr);
  const normalizedAlternates = alternates.map(norm);

  // Yhdistä notamMap normalisoituna
  const normNotamMap = new Map();
  for (const [icao, list] of notamMap.entries()) {
    const k = norm(icao);
    if (!normNotamMap.has(k)) normNotamMap.set(k, []);
    normNotamMap.get(k).push(...list);
  }

  const all = new Set();
  if (dep) all.add(dep);
  if (arr) all.add(arr);
  normalizedAlternates.forEach(a => all.add(a));
  for (const k of normNotamMap.keys()) all.add(k);

  const airports = [];
  all.forEach(icao => {
    let role = 'NOTAM';
    if (icao === dep) role = 'DEP';
    else if (icao === arr) role = 'DEST';
    else if (normalizedAlternates.includes(icao)) role = 'ALTN';

    airports.push({
      icao,
      role,
      notams: normNotamMap.get(icao) || [],
      coords: (typeof _icaoCoords === 'function') ? _icaoCoords(icao) : null
    });
  });

  // Järjestä
  const order = { DEP: 0, DEST: 1, ALTN: 2, NOTAM: 3 };
  airports.sort((a, b) => {
    const o = order[a.role] - order[b.role];
    return o !== 0 ? o : a.icao.localeCompare(b.icao);
  });

  // Yhteenveto vain jos merkittävä määrä puuttuu
  const missing = airports.filter(a => !a.coords);
  if (missing.length > 3) {
    console.log(`[NotamMap] ${missing.length} kenttää ilman koordinaatteja:`,
                missing.map(a => a.icao).join(', '));
  }

  return airports;
}
window.buildAirportData = buildAirportData;

/* ==============================================================
 * WAYPOINT-PARSERI · NAV LOG -sivut OFP:stä
 * ==============================================================
 * Palauttaa: [{ name, lat, lon, level, track, wind, tas, gs, sr,
 *              totalMins, fob, rawTime, page, y_anchor }]
 * ============================================================== */

const NOTAM_WP_TTL = 60 * 60 * 1000;

async function parseWaypoints(page, pageNum) {
  const textContent = await page.getTextContent();
  const rows = typeof buildRows === 'function' ? buildRows(textContent.items) : [];
  if (!rows || rows.length === 0) return [];
  rows.sort((a, b) => b.y - a.y);

  let headerY = null;
  for (const row of rows) {
    const rowText = row.items.map(i => i.str).join(' ');
    if ((rowText.includes("TO") && rowText.includes("FUEL")) ||
        (rowText.includes("AWY") && rowText.includes("ETE")) ||
        (rowText.includes("FREQ") && rowText.includes("FL"))) {
      headerY = row.y;
      break;
    }
  }
  if (!headerY) return [];

  const waypoints = [];

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (row.y >= headerY) continue;
    if (!row.items || row.items.length < 2) continue;

    let timeValue = null, fuelValue = null;
    for (const item of row.items) {
      const str = (item.str || '').trim();
      if (/^\d{1,3}[\.:]\d{2}$/.test(str)) timeValue = str;
      if (/^\d{3,5}$/.test(str) && !str.includes('.') && !str.includes(':')) {
        const num = parseInt(str, 10);
        const fullRow = row.items.map(x => x.str).join(' ');
        if (num >= 100 && num <= 99999 && !fullRow.includes('FL ')) fuelValue = str;
      }
    }
    if (!timeValue || !fuelValue) continue;

    const data = {
      name: "?", awy: "-", level: "-", track: "-",
      wind: "-", tas: "-", gs: "-", sr: "-",
      lat: null, lon: null
    };

    // Etsi nimi + koordinaatit (prev, sama, next)
    const candidates = [];
    if (r > 0) candidates.push(rows[r - 1]);
    candidates.push(row);
    if (r + 1 < rows.length) candidates.push(rows[r + 1]);

    let coordFound = false;
    for (const cand of candidates) {
      const fullString = cand.items.map(x => x.str).join(' ').trim();
      const parts = fullString.split(/\s+/);

      if (!coordFound && typeof extractCoordFromString === 'function') {
        try {
          const c = extractCoordFromString(fullString);
          if (c && isFinite(c.lat) && isFinite(c.lon)) {
            data.lat = c.lat;
            data.lon = c.lon;
            coordFound = true;
          }
        } catch (e) {
          // Yksittäinen rivi ei parsittavissa — ohita
        }
      }

      if (cand === rows[r - 1] && parts.length > 0 && parts[0]) {
        const maybeName = parts[0].replace(/[^a-zA-Z0-9*-]/g, '') || parts[0];
        if (maybeName.length >= 2 && maybeName.length <= 8 && /[A-Z]/i.test(maybeName)) {
          data.name = maybeName;
          if (parts[1]) data.awy = parts[1];
          if (parts[2]) data.level = parts[2];
          if (parts[3]) data.track = parts[3];
          if (parts[4]) data.wind = parts[4];
          if (parts[5]) data.tas = parts[5];
          if (parts[6]) data.gs = parts[6];
        }
      }
    }

    // SR
    for (let i = 0; i < row.items.length - 1; i++) {
      const t = (row.items[i].str || '').trim();
      const n = (row.items[i + 1].str || '').trim();
      if (/^\d{3}$/.test(t) && /^\d{2}$/.test(n)) { data.sr = n; break; }
    }
    if (data.sr === '-') {
      for (const it of row.items) {
        const t = (it.str || '').trim();
        if (/^\d{5}$/.test(t)) { data.sr = t.substring(3, 5); break; }
      }
    }

    // Hyväksy vain jos name JA coords
    if (data.name === '?') continue;
    if (!coordFound) continue;

    waypoints.push({
      ...data,
      totalMins: typeof parseTimeString === 'function' ? parseTimeString(timeValue) : 0,
      eto: "",
      fob: parseInt(fuelValue, 10) || 0,
      page: pageNum - 1,
      y_anchor: row.y,
      rawTime: timeValue
    });
  }

  return waypoints;
}
window.parseWaypoints = parseWaypoints;

async function parseAllWaypoints(pdf) {
  const all = [];
  for (let i = 2; i <= pdf.numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const wps = await parseWaypoints(page, i);
      if (wps && wps.length) all.push(...wps);
    } catch (e) {
      console.warn(`[Waypoints] Sivu ${i} epäonnistui:`, e);
    }
  }
  return all;
}
window.parseAllWaypoints = parseAllWaypoints;

/* ==============================================================
 * Pääfunktio: parseOFPsForWaypoints
 * ============================================================== */
async function parseOFPsForWaypoints(flightId, forceRefresh = false) {
  const fid = String(flightId || '');
  if (!fid) throw new Error('Ei Flight ID:tä');

  // Cache (ohitetaan, jos forceRefresh on true)
  if (!forceRefresh) {
    try {
      const cache = JSON.parse(localStorage.getItem(NOTAM_WP_CACHE_KEY) || '{}');
      const hit = cache[fid];
      if (hit && (Date.now() - new Date(hit.at).getTime()) < NOTAM_WP_TTL) {
        if (hit.data && hit.data.allWaypoints) {
          return hit.data;
        }
      }
    } catch (e) {}
  }

  let entry;
  try {
    entry = await _getPDFBytesForFlight(fid);
  } catch (err) {
    // ... (säilytä vanha 422-käsittely tässä) ...
    if (err.code === 'OFP_NOT_AVAILABLE' || String(err.message).includes('422')) {
      const data = { flightId: fid, waypoints: [], allWaypoints: [], destRoute: '', at: new Date().toISOString(), is422: true };
      try {
        const cache = JSON.parse(localStorage.getItem(NOTAM_WP_CACHE_KEY) || '{}');
        cache[fid] = { at: new Date().toISOString(), data };
        localStorage.setItem(NOTAM_WP_CACHE_KEY, JSON.stringify(cache));
      } catch (e) {}
      return data;
    }
    throw err;
  }

  const bufferCopy = entry.bytes.slice ? entry.bytes.slice(0) : entry.bytes;
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bufferCopy) }).promise;

  // KORJATTU: Määritellään allWaypoints oikein
  let waypoints = [];
  let allWaypoints = []; // <-- Ei enää const!
  let destRoute = '';

  try {
    waypoints = await parseAllWaypoints(pdf);
    allWaypoints = [...waypoints]; // <-- Kopioidaan vasta parsinnan JÄLKEEN


    /* --- Hae DEST ROUTE tekstistä (sivut 1–3) --- */
    if (typeof extractRoutes === 'function' && typeof getLinesFromPDFPage === 'function') {
      const routeLines = [];
      const pagesToCheck = Math.min(3, pdf.numPages);
      for (let p = 1; p <= pagesToCheck; p++) {
        try {
          const page = await pdf.getPage(p);
          const lines = await getLinesFromPDFPage(page);
          routeLines.push(...lines);
          if (lines.join(' ').match(/DEST\s+ROUTE/i)) break;
        } catch (e) {}
      }
      if (routeLines.length) {
        const routes = extractRoutes(routeLines);
        destRoute = routes?.destRoute || '';
      }
    }

    /* --- Suodata waypointit: poista FIR-pisteet, koordinaattipisteet ja leikkaa SID/STAR pois --- */
    if (!window.SHOW_ALL_WAYPOINTS && destRoute && waypoints.length) {
      const before = waypoints.length;

      // 1. Poistetaan FIR-pisteet (nimet jotka alkavat viivalla, esim. -UAII, -UACN)
      waypoints = waypoints.filter(w => !String(w.name || '').trim().startsWith('-'));

      // 2. Poistetaan generoidut koordinaattipisteet (esim. 42222N, 5102N0, D042R)
      const isCoordPoint = (name) => {
        return /^\d{4,5}[NS]$/.test(name) || /^\d{4}[NS]\d$/.test(name) || /^[A-Z]\d{3}[A-Z]$/.test(name);
      };
      waypoints = waypoints.filter(w => !isCoordPoint(String(w.name || '').toUpperCase()));

      // 3. Etsitään DEST ROUTE -merkkijonosta reitin ensimmäinen ja viimeinen piste
      const routeNames = (typeof parseRouteWaypointNames === 'function')
        ? parseRouteWaypointNames(destRoute)
        : new Set();

      let depIcao = '', arrIcao = '';
      try {
        const roster = JSON.parse(localStorage.getItem('assigned_flights_cache') || '[]');
        const f = roster.find(x => String(x.ID || x.id || x.FlightID) === fid);
        if (f) {
          depIcao = String(f.DepartureStationIcaoCode || f.DepartureStationCode || '').toUpperCase();
          arrIcao = String(f.ArrivalStationIcaoCode || f.ArrivalStationCode || '').toUpperCase();
        }
      } catch (e) {}

      routeNames.delete(depIcao);
      routeNames.delete(arrIcao);

      if (routeNames.size > 0) {
        let firstIdx = -1;
        let lastIdx = -1;

        // Etsitään mistä kohtaa SID loppuu ja STAR alkaa
        for (let i = 0; i < waypoints.length; i++) {
          const name = String(waypoints[i].name || '').toUpperCase();
          if (routeNames.has(name)) {
            if (firstIdx === -1) firstIdx = i;
            lastIdx = i;
          }
        }

        // Leikataan: pidetään kaikki pisteet ensimmäisen ja viimeisen reittipisteen väliltä
        if (firstIdx !== -1 && lastIdx !== -1) {
          waypoints = waypoints.slice(firstIdx, lastIdx + 1);
          console.log(
            `[Waypoints] Puhdistettu: ${before} → ${waypoints.length} ` +
            `(ensimmäinen: ${waypoints[0]?.name}, viimeinen: ${waypoints[waypoints.length-1]?.name})`
          );
        }
      }
    }
  } finally {
    try { pdf.destroy(); } catch (e) {}
  }

  const data = {
    flightId: fid,
    waypoints,
    allWaypoints, 
    destRoute,
    at: new Date().toISOString()
  };

  try {
    const cache = JSON.parse(localStorage.getItem(NOTAM_WP_CACHE_KEY) || '{}');
    cache[fid] = { at: new Date().toISOString(), data };
    const keys = Object.keys(cache);
    if (keys.length > 30) {
      keys.sort((a, b) => new Date(cache[a].at) - new Date(cache[b].at))
        .slice(0, keys.length - 30)
        .forEach(k => delete cache[k]);
    }
    localStorage.setItem(NOTAM_WP_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {}

  return data;
}
window.parseOFPsForWaypoints = parseOFPsForWaypoints;