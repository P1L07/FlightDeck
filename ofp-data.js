/* ==============================================================
 * NOTAM-OFP · NOTAMit OFP-PDF:stä
 * ==============================================================
 * Käyttää:
 *   - getLinesFromPDFPage(page)      ← app.js / sinun
 *   - extractNOTAMs(lines)            ← sinun
 *   - FLIGHT_THREAT_DICTIONARY        ← sinun
 *   - fetchSkyplanOFPBytes(flightId)  ← app.js
 *   - _icaoCoords(icao)               ← LogBook.js
 * ============================================================== */
'use strict';

const NOTAM_OFP_CACHE_KEY = 'notam_ofp_cache_v3';
const NOTAM_OFP_CACHE_TTL = 30 * 60 * 1000; // 30 min

/* ==============================================================
 * Lue kaikki PDF-rivit
 * ============================================================== */
async function _notamReadPDFLines(pdfBytes) {
  if (!pdfBytes) return [];
  if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js puuttuu');

  const data = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const allLines = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const lines = await getLinesFromPDFPage(page);
    allLines.push(...lines);
  }

  return allLines;
}

/* ==============================================================
 * Parsii jokaisen NOTAM-tekstin: airport, id, severity, type
 * ============================================================== */
function _notamParseHeader(notamText) {
  // Esim. "UAAA A1234/26\nBLA BLA..." tai "NOTAM UAAA A1234/26\n..."
  const firstLine = String(notamText || '').split('\n')[0].trim();

  const m1 = firstLine.match(/^(?:-\s*)?([A-Z]{4})\s+([A-Z]{1,2}\d{4}\/\d{2})/i);
  if (m1) return { airport: m1[1].toUpperCase(), id: m1[2].toUpperCase() };

  const m2 = firstLine.match(/^NOTAM\s*([A-Z]{4})\s+([A-Z]{1,2}\d{4}\/\d{2})/i);
  if (m2) return { airport: m2[1].toUpperCase(), id: m2[2].toUpperCase() };

  // Fallback: etsi mikä tahansa ICAO ensimmäiseltä riviltä
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

/* ==============================================================
 * Muunna raa'at NOTAM-tekstit rikkaiksi objekteiksi
 * ============================================================== */
function _notamEnrich(notamStrings) {
  if (!Array.isArray(notamStrings)) return [];

  return notamStrings.map(raw => {
    const header = _notamParseHeader(raw);
    const cat = _notamCategorize(raw);
    return {
      airport: header.airport,
      id: header.id,
      text: raw,
      severity: cat.level,   // 'critical' | 'warning' | 'info'
      type: cat.type
    };
  }).filter(n => n.airport);
}

/* ==============================================================
 * Pääfunktio
 * ============================================================== */
async function parseOFPsForNotams(flightId) {
  const fid = String(flightId || '');
  if (!fid) throw new Error('Ei Flight ID:tä');

  // Cache
  try {
    const cache = JSON.parse(localStorage.getItem(NOTAM_OFP_CACHE_KEY) || '{}');
    const hit = cache[fid];
    if (hit && (Date.now() - new Date(hit.at).getTime()) < NOTAM_OFP_CACHE_TTL) {
      return hit.data;
    }
  } catch (e) {}

  if (typeof fetchSkyplanOFPBytes !== 'function') {
    throw new Error('fetchSkyplanOFPBytes puuttuu');
  }
  if (typeof extractNOTAMs !== 'function') {
    throw new Error('extractNOTAMs puuttuu');
  }

  const token = (typeof getValidSkyplanToken === 'function')
    ? await getValidSkyplanToken().catch(() => null)
    : null;

  const r = await fetchSkyplanOFPBytes(fid, token);
  if (!r?.pdfBytes) throw new Error('Ei PDF-tavuja');

  const lines = await _notamReadPDFLines(r.pdfBytes);

  // Käytä sinun parseria
  const rawNotams = extractNOTAMs(lines);

  // Rikastetaan
  const notams = _notamEnrich(rawNotams);
  
  const data = {
    flightId: fid,
    notams,
    at: new Date().toISOString()
  };

  // Cache
  try {
    const cache = JSON.parse(localStorage.getItem(NOTAM_OFP_CACHE_KEY) || '{}');
    cache[fid] = { at: new Date().toISOString(), data };
    const keys = Object.keys(cache);
    if (keys.length > 50) {
      keys.sort((a, b) => new Date(cache[a].at) - new Date(cache[b].at))
        .slice(0, keys.length - 50)
        .forEach(k => delete cache[k]);
    }
    localStorage.setItem(NOTAM_OFP_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {}

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

  /* ============ DEP / DEST — yritä montaa lähdettä ============ */
  const pickIcao = (...vals) => {
    for (const v of vals) {
      const s = String(v || '').toUpperCase().trim();
      if (s && s.length === 4) return s;
    }
    return '';
  };

  // 1. Flight-objektista (useita kenttänimiä)
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

  // 2. DOM:sta (jos flight-objekti ei täytä)
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

  // 3. OFP-notameista (jos löytyy DEP/DEST-prefix)
  if (!dep || !arr) {
    (notams || []).forEach(n => {
      if (!dep && /^DEP/i.test(n.type || '')) dep = n.airport;
      if (!arr && /^DEST/i.test(n.type || '')) arr = n.airport;
    });
  }

  // 4. Rosterista (haku flight ID:llä)
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

  /* ============ Alternates ============ */
  const altn1 = pickIcao(flight?.Alternate1IcaoCode, flight?.Alternate1);
  const altn2 = pickIcao(flight?.Alternate2IcaoCode, flight?.Alternate2);
  const alternates = [altn1, altn2].filter(Boolean);

    /* ============ Kokoa kaikki kentät ============ */
  // Normalisoi legacy-ICAOt moderneiksi (UACN → UACC)
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

   // Logita yhteenveto vain jos koordinaatteja puuttuu
  const missing = airports.filter(a => !a.coords);
  if (missing.length) {
    console.log(`[NotamMap] ${missing.length} kenttää ilman koordinaatteja (ohitetaan kartalta):`,
                missing.map(a => a.icao).join(', '));
  }
  return airports;
}
window.buildAirportData = buildAirportData;

/* ==============================================================
 * WAYPOINT-PARSERI · NAV LOG -sivut OFP:stä
 * ==============================================================
 * Palauttaa: [{ name, lat, lon, level, track, wind, tas, gs, sr,
 *               totalMins, fob, rawTime, page, y_anchor }]
 * ============================================================== */

const NOTAM_WP_CACHE_KEY = 'notam_wp_cache_v1';
const NOTAM_WP_CACHE_TTL = 60 * 60 * 1000; // 60 min

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

    // ============ 1) Etsi waypointin nimi + koordinaatit ============
    // Yritä ensin prev-rivi (yleensä sama rivi jossa name)
    // Sitten sama rivi, sitten seuraava (joskus teksti on alla)
    const candidates = [];
    if (r > 0) candidates.push(rows[r - 1]);
    candidates.push(row);
    if (r + 1 < rows.length) candidates.push(rows[r + 1]);

    let coordFound = false;
    for (const cand of candidates) {
      const fullString = cand.items.map(x => x.str).join(' ').trim();
      const parts = fullString.split(/\s+/);

      // Koordinaatti etsitään ensin koko rivin tekstistä
      if (!coordFound) {
        const c = extractCoordFromString(fullString);
        if (c) {
          data.lat = c.lat;
          data.lon = c.lon;
          coordFound = true;
        }
      }

      // Nimi ja muut sarakkeet — vain prev-riviltä (ei sekoita)
      if (cand === rows[r - 1] && parts.length > 0 && parts[0]) {
        const maybeName = parts[0].replace(/[^a-zA-Z0-9*-]/g, '') || parts[0];
        // Hyväksy vain jos näyttää waypoint-nimeltä (2-6 merkkiä, sisältää kirjaimen)
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

    // ============ 2) SR ============
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

    // ============ 3) Hyväksy vain jos name JA coords löytyi ============
    if (data.name === '?') continue;
    if (!coordFound) continue;   // ilman koordinaattia ei voi piirtää

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
async function parseOFPsForWaypoints(flightId) {
  const fid = String(flightId || '');
  if (!fid) throw new Error('Ei Flight ID:tä');

  // Cache
  try {
    const cache = JSON.parse(localStorage.getItem(NOTAM_WP_CACHE_KEY) || '{}');
    const hit = cache[fid];
    if (hit && (Date.now() - new Date(hit.at).getTime()) < NOTAM_WP_CACHE_TTL) {
      return hit.data;
    }
  } catch (e) {}

  if (typeof fetchSkyplanOFPBytes !== 'function') throw new Error('fetchSkyplanOFPBytes puuttuu');

  const token = (typeof getValidSkyplanToken === 'function')
    ? await getValidSkyplanToken().catch(() => null) : null;

  const r = await fetchSkyplanOFPBytes(fid, token);
  if (!r?.pdfBytes) throw new Error('Ei PDF-tavuja');

  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(r.pdfBytes) }).promise;
  const waypoints = await parseAllWaypoints(pdf);

  const data = { flightId: fid, waypoints, at: new Date().toISOString() };

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