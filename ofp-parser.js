/* ==============================================================
 * NOTAM-PARSER · NOTAMien poiminta OFP-tekstistä
 * ============================================================== */
'use strict';

async function getLinesFromPDFPage(page) {
  const content = await page.getTextContent();
  const items = content.items;
  if (!Array.isArray(items)) return [];

  const linesObj = {};
  items.forEach(item => {
    if (!item || !item.transform || !Array.isArray(item.transform)) return;
    const y = Math.round(item.transform[5]);
    if (!isFinite(y)) return;
    if (!linesObj[y]) linesObj[y] = [];
    linesObj[y].push(item);
  });

  // KORJATTU: miinusmerkki
  const yCoords = Object.keys(linesObj).sort((a, b) => b - a);

  return yCoords.map(y => {
    const lineItems = linesObj[y].sort((a, b) => {
      const ax = (a.transform && a.transform[4]) || 0;
      const bx = (b.transform && b.transform[4]) || 0;
      // KORJATTU: miinusmerkki
      return ax - bx;
    });
    return lineItems
      .map(item => item.str || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  });
}
window.getLinesFromPDFPage = getLinesFromPDFPage;

const FLIGHT_THREAT_DICTIONARY = {
  notams: [
    { regex: /\b(?:AD|AERODROME|APPT)\s+(?:CLSD|CLOSED)\b/i, level: 'critical', type: 'ARPT CLSD' },
    { regex: /\bRWY\s+([0-9]{2}[LRC]?)\s+(?:CLSD|CLOSED)\b/i, level: 'critical', type: 'RWY CLSD' },
    { regex: /\b(?:ILS|LOC|GP|GLIDEPATH|VOR|NDB|DME|RNP|RNAV|GPS)\s+.*?(?:U\/S|UNSERVICEABLE|NOT AVBL|OUT OF SERVICE)\b/i, level: 'warning', type: 'NAVAID' },
    { regex: /\bTWY\s+([A-Z0-9]+(?:\s+AND\s+[A-Z0-9]+)*)\s+(?:CLSD|CLOSED)\b/i, level: 'warning', type: 'TWY CLSD' },
    { regex: /\bFCT\s+(?:U\/S|NOT AVBL)\b|\b(?:FIRE AND RESCUE|RFFS)\s+DOWNGRADED\b/i, level: 'critical', type: 'RFFS' },
    { regex: /\bBA\s+(?:POOR|1|2)\b|\b(?:ICE|SNOW|SLUSH)\s+ON\s+RWY\b/i, level: 'warning', type: 'BRAKING' },
    { regex: /\bBIRD\b/i, level: 'info', type: 'BIRDS' },
    { regex: /\b(?:WIP|WORK IN PROGRESS)\b/i, level: 'info', type: 'WIP' },
    { regex: /\b\d\/\d\/\d\b.*?(?:FROST|ICE|SNOW|SLUSH|WATER|POOR|COMPACTED|DRY|WET)/i, level: 'warning', type: 'RWY CC' },
    { regex: /\bRWY\s+CC\s+([0-3])\b/i, level: 'critical', type: 'RWY CC' },
    { regex: /\bRWY\s+CC\s+\d\/\d\/\d\b/i, level: 'info', type: 'RWY CC' },
    { regex: /\bRWY\s+COND(?:ITION)?\s+.*?(?:POOR|SLIPPERY|ICE|SNOW|SLUSH|WATER|STANDING)/i, level: 'warning', type: 'RWY CC' },
    { regex: /\bBRAKING ACTION\s+(?:POOR|MEDIUM POOR|NIL)\b/i, level: 'warning', type: 'BRAKING' },
    { regex: /\b(?:FIC|AIRMET|SIGMET)\b/i, level: 'warning', type: 'INFO' },
  ],
  weather: [
    { regex: /\b(?:TS|TSRA|VCTS|\+TSRA)\b/i, level: 'critical', type: 'THUNDERSTORM' },
    { regex: /\b(?:FZRA|FZDZ|\+SN|BLSN)\b/i, level: 'critical', type: 'FREEZING' },
    { regex: /\b(?:\+SN|BLSN)\b/i, level: 'critical', type: '+SNOW' },
    { regex: /\b(?:WS\s+RWY|WINDSHEAR)\b/i, level: 'critical', type: 'WINDSHEAR' },
    { regex: /\b(?:OVC|BKN|VV)00[0-2]\b/i, level: 'critical', type: 'CEILING' },
    { regex: /\b(?:OVC|BKN|VV)00[3-6]\b/i, level: 'warning', type: 'CEILING' },
    { regex: /\bR[0-9]{2}[LRC]?\/0[0-5][0-9]{2}/i, level: 'critical', type: 'RVR' }
  ]
};
window.FLIGHT_THREAT_DICTIONARY = FLIGHT_THREAT_DICTIONARY;

function extractNOTAMs(fullText) {
  const lines = Array.isArray(fullText) ? fullText : String(fullText || '').split('\n');
  const notams = [];
  let currentNotam = null;

  const notamStartRegex = /^(?:-\s*)?([A-Z]{4})\s+([A-Z]{1,2}\d{4}\/\d{2})|^NOTAM\s*([A-Z]{4})\s+([A-Z]{1,2}\d{4}\/\d{2})/i;
  const stopMarkers = ['ARRIVAL:', 'OTHER:', 'DEPARTURE:', '---', 'PAGE', 'FLY ARYSTAN BRIEF', 'AIR ASTANA BRIEF', 'FIR:', 'REGION:', 'NOT CLASSIFIED', 'FIRE AND RESCUE', 'METAR', 'TAF', 'SPECI', 'ACC:', 'CTR:', 'TMA:', 'ENROUTE:', 'ALTERNATE:'];

  lines.forEach(line => {
    const trimmed = String(line || '').trim();
    if (!trimmed) return;
    const upper = trimmed.toUpperCase();

    if (stopMarkers.some(m => upper.startsWith(m))) {
      if (currentNotam) {
        notams.push(currentNotam.join('\n'));
        currentNotam = null;
      }
      return;
    }

    if (notamStartRegex.test(trimmed)) {
      if (currentNotam) notams.push(currentNotam.join('\n'));
      currentNotam = [trimmed];
    } else if (currentNotam) {
      currentNotam.push(trimmed);
    }
  });

  if (currentNotam) notams.push(currentNotam.join('\n'));

  const keywords = ['RWY', 'TWY', 'CLSD', 'U/S', 'NOT AVBL', 'WIP', 'FIRE', 'BIRD', 'BA', 'ICE', 'SNOW', 'SLUSH', 'ILS', 'VOR', 'NDB', 'DME', 'RNAV', 'GPS', 'RNP', 'APU', 'DE-ICING', 'STAND', 'ACFT', 'RWYCC', 'FROST', 'POOR', 'MEDIUM', 'NIL', 'WATER', 'COMPACTED', 'DRY', 'WET'];

  return notams.filter(n => {
    const up = n.toUpperCase();
    return n.length > 20 && keywords.some(kw => up.includes(kw));
  });
}
window.extractNOTAMs = extractNOTAMs;

function buildRows(items) {
  const rows = {};
  if (!Array.isArray(items)) return [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || !item.transform || !Array.isArray(item.transform)) continue;
    const y = Math.round(item.transform[5]);
    if (!isFinite(y)) continue;
    if (!rows[y]) rows[y] = [];
    rows[y].push(item);
  }

  return Object.keys(rows).map(y => ({
    y: parseFloat(y),
    items: rows[y].sort((a, b) => {
      const ax = (a.transform && a.transform[4]) || 0;
      const bx = (b.transform && b.transform[4]) || 0;
      // KORJATTU: miinusmerkki
      return ax - bx;
    })
  }));
}
window.buildRows = buildRows;

function parseTimeString(timeStr) {
  if (!timeStr) return 0;
  const s = String(timeStr).trim();

  if (/^\d{4}$/.test(s)) {
    return (parseInt(s.substring(0, 2)) || 0) * 60 + (parseInt(s.substring(2, 4)) || 0);
  }

  if (s.includes(':')) {
    const [h, m] = s.split(':');
    return (parseInt(h) || 0) * 60 + (parseInt(m) || 0);
  }

  if (s.includes('.')) {
    const [hStr, mStr] = s.split('.');
    const h = parseInt(hStr) || 0;
    let m = parseInt(mStr) || 0;
    if (mStr && mStr.length === 1) m *= 10;
    // KORJATTU: kertomerkki
    return h * 60 + m;
  }

  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : n;
}

function _coordParseDdmm(sign, deg, min) {
  const d = parseInt(deg, 10);
  const m = parseFloat(min);
  if (isNaN(d) || isNaN(m)) return null;
  return (d + m / 60) * (sign === 'S' || sign === 'W' ? -1 : 1);
}

function extractCoordFromString(str) {
  if (!str) return null;
  const s = String(str);

  let m = s.match(/([NS])\s*(\d{2})\s*(\d{2}(?:\.\d+)?)\s*['′]?\s*([EW])\s*(\d{3})\s*(\d{2}(?:\.\d+)?)/i);
  if (m) {
    const lat = _coordParseDdmm(m[1].toUpperCase(), m[2], m[3]);
    const lon = _coordParseDdmm(m[4].toUpperCase(), m[5], m[6]);
    if (lat != null && lon != null) return { lat, lon };
  }

  m = s.match(/(\d{2})\s*(\d{2}(?:\.\d+)?)\s*['′]?\s*([NS])\s*(\d{3})\s*(\d{2}(?:\.\d+)?)\s*['′]?\s*([EW])/i);
  if (m) {
    const lat = _coordParseDdmm(m[3].toUpperCase(), m[1], m[2]);
    const lon = _coordParseDdmm(m[6].toUpperCase(), m[4], m[5]);
    if (lat != null && lon != null) return { lat, lon };
  }

  m = s.match(/([NS])\s*(\d{2})\s*(\d{2})\s*(\d{2})['″]?\s*([EW])\s*(\d{3})\s*(\d{2})\s*(\d{2})/i);
  if (m) {
    const lat = (parseInt(m[2], 10) + parseInt(m[3], 10)/60 + parseInt(m[4], 10)/3600) * (m[1].toUpperCase() === 'S' ? -1 : 1);
    const lon = (parseInt(m[5], 10) + parseInt(m[6], 10)/60 + parseInt(m[7], 10)/3600) * (m[5].toUpperCase() === 'W' ? -1 : 1);
    return { lat, lon };
  }

  m = s.match(/(\d{2})\s*(\d{2})\s*(\d{2})['″]?\s*([NS])\s*(\d{3})\s*(\d{2})\s*(\d{2})['″]?\s*([EW])/i);
  if (m) {
    const lat = (parseInt(m[1], 10) + parseInt(m[2], 10)/60 + parseInt(m[3], 10)/3600) * (m[4].toUpperCase() === 'S' ? -1 : 1);
    const lon = (parseInt(m[5], 10) + parseInt(m[6], 10)/60 + parseInt(m[7], 10)/3600) * (m[8].toUpperCase() === 'W' ? -1 : 1);
    return { lat, lon };
  }

  m = s.match(/\b(-?\d{1,3}\.\d{3,})\s+(-?\d{1,3}\.\d{3,})\b/);
  if (m) {
    const lat = parseFloat(m[1]);
    const lon = parseFloat(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
  }

  return null;
}
window.extractCoordFromString = extractCoordFromString;

/* ==============================================================
 * ROUTE EXTRACTION · DEST / ALTN ROUTE -merkkijonot
 * ============================================================== */

function extractRoutes(lines) {
  if (!lines || !Array.isArray(lines)) return null;

  const fullText = lines
    .map(l => l.replace(/[\u200B-\u200D\uFEFF]/g, '').trim())
    .join(' ');

  const pick = (re) => {
    const m = fullText.match(re);
    return m && m[1] ? m[1].replace(/\s+/g, ' ').trim() : '';
  };

  return {
    destRoute: pick(/\bDEST\s+ROUTE[:\s]+([\s\S]*?)(?=\bALTN\s*1?\s+ROUTE\b|\bALTN\s*2\s+ROUTE\b|\bFUEL\b|\bRMK\b|\bREMARKS?\b|$)/i),
    altnRoute: pick(/\bALTN\s*1?\s+ROUTE[:\s]+([\s\S]*?)(?=\bALTN\s*2\s+ROUTE\b|\bFUEL\b|\bRMK\b|\bREMARKS?\b|$)/i),
    altn2Route: pick(/\bALTN\s*2\s+ROUTE[:\s]+([\s\S]*?)(?=\bFUEL\b|\bRMK\b|\bREMARKS?\b|$)/i)
  };
}
window.extractRoutes = extractRoutes;

/* ==============================================================
 * ROUTE TOKENIZER · DEST ROUTE → waypoint-nimien joukko
 * ==============================================================
 * Suodattaa pois:
 *   - korkeudet (N0450F350, FL350)
 *   - airways (A466, G3, UN123, L4)
 *   - DCT, IF, VFR, IFR ja muut reittimodifioijat
 * Jäljelle jäävät oikeat waypoint-nimet (WPT1, KODAP, UATE, …).
 * ============================================================== */

function parseRouteWaypointNames(routeString) {
  const names = new Set();
  if (!routeString) return names;

  const tokens = String(routeString)
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const ALTITUDE = /^[NMF]?\d{3,5}(F\d{3})?$/;
  const AIRWAY   = /^[A-Z]{1,2}\d{1,4}[A-Z]?$/;
  const SKIP     = /^(DCT|IF|VFR|IFR|FL|SID|STAR|TO|VIA|DIR|NAT|PAC|OTS|XING|LEVEL|RNAV|RNP|NDB|VOR|ILS|DME)$/;

  for (const tok of tokens) {
    if (tok.length < 2) continue;
    if (SKIP.test(tok)) continue;
    if (ALTITUDE.test(tok)) continue;
    if (AIRWAY.test(tok)) continue;
    names.add(tok);
  }

  return names;
}
window.parseRouteWaypointNames = parseRouteWaypointNames;