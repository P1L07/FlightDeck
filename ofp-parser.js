/* ==============================================================
 * NOTAM-PARSER · NOTAMien poiminta OFP-tekstistä
 * ==============================================================
 * Sisältää:
 *   - getLinesFromPDFPage(page)      — pdf.js-rivien poiminta
 *   - extractNOTAMs(lines)            — NOTAM-blokkien erottelu
 *   - FLIGHT_THREAT_DICTIONARY        — kriittiset regex-säännöt
 *
 * Riippuvuudet:
 *   - pdfjsLib (index.html)
 * ============================================================== */
'use strict';

/* ==============================================================
 * PDF-RIVIT
 * ============================================================== */
async function getLinesFromPDFPage(page) {
  const content = await page.getTextContent();
  const items = content.items;

  // Ryhmittele Y-koordinaatin mukaan
  const linesObj = {};
  items.forEach(item => {
    const y = Math.round(item.transform[5]);
    if (!linesObj[y]) linesObj[y] = [];
    linesObj[y].push(item);
  });

  // Järjestä Y:t ylhäältä alas
  const yCoords = Object.keys(linesObj).sort((a, b) => b - a);

  // Järjestä X:t vasemmalta oikealle ja yhdistä
  return yCoords.map(y => {
    const lineItems = linesObj[y].sort((a, b) => a.transform[4] - b.transform[4]);
    return lineItems.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim();
  });
}
window.getLinesFromPDFPage = getLinesFromPDFPage;

/* ==============================================================
 * FLIGHT THREAT DICTIONARY
 * ============================================================== */
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

/* ==============================================================
 * EXTRACT NOTAMS
 * ==============================================================
 * Erottaa NOTAM-blokit OFP-tekstistä:
 *   "UAAA A1234/26 ..."
 *   "NOTAM UAAA A1234/26 ..."
 * Käyttää stop-markereita uusien osioiden tunnistukseen.
 * Suodattaa kriittisten avainsanojen perusteella.
 * ============================================================== */
function extractNOTAMs(fullText) {
  const lines = Array.isArray(fullText) ? fullText : String(fullText || '').split('\n');
  const notams = [];
  let currentNotam = null;

  // Aloitus-regex
  const notamStartRegex = /^(?:-\s*)?([A-Z]{4})\s+([A-Z]{1,2}\d{4}\/\d{2})|^NOTAM\s*([A-Z]{4})\s+([A-Z]{1,2}\d{4}\/\d{2})/i;

  // Stop-markerit — kun nämä tulevat, lopetetaan NOTAM-blokki
  const stopMarkers = [
    'ARRIVAL:', 'OTHER:', 'DEPARTURE:', '---', 'PAGE',
    'FLY ARYSTAN BRIEF', 'AIR ASTANA BRIEF', 'FIR:', 'REGION:',
    'NOT CLASSIFIED', 'FIRE AND RESCUE', 'METAR', 'TAF', 'SPECI'
  ];

  lines.forEach(line => {
    const trimmed = String(line || '').trim();
    if (!trimmed) return;
    const upper = trimmed.toUpperCase();

    // 1. Stop-marker → tallenna edellinen ja lopeta
    if (stopMarkers.some(m => upper.startsWith(m))) {
      if (currentNotam) {
        notams.push(currentNotam.join('\n'));
        currentNotam = null;
      }
      return;
    }

    // 2. Uusi NOTAM → tallenna edellinen, aloita uusi
    if (notamStartRegex.test(trimmed)) {
      if (currentNotam) notams.push(currentNotam.join('\n'));
      currentNotam = [trimmed];
    }
    // 3. Jatkorivi
    else if (currentNotam) {
      currentNotam.push(trimmed);
    }
  });

  if (currentNotam) notams.push(currentNotam.join('\n'));

  // Suodata: vain NOTAMit joilla on kriittisiä avainsanoja
  const keywords = [
    'RWY', 'TWY', 'CLSD', 'U/S', 'NOT AVBL', 'WIP', 'FIRE', 'BIRD', 'BA',
    'ICE', 'SNOW', 'SLUSH', 'ILS', 'VOR', 'NDB', 'DME', 'RNAV', 'GPS',
    'RNP', 'APU', 'DE-ICING', 'STAND', 'ACFT', 'RWYCC', 'FROST', 'POOR',
    'MEDIUM', 'NIL', 'WATER', 'COMPACTED', 'DRY', 'WET'
  ];

  return notams.filter(n => {
    const up = n.toUpperCase();
    return n.length > 20 && keywords.some(kw => up.includes(kw));
  });
}
window.extractNOTAMs = extractNOTAMs;

/* ==============================================================
 * Rivi- ja aika-apurit (OFP NAV LOG)
 * ============================================================== */
function buildRows(items) {
  const rows = {};
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const y = Math.round(item.transform[5]);
    if (!rows[y]) rows[y] = [];
    rows[y].push(item);
  }
  return Object.keys(rows).map(y => ({
    y: parseFloat(y),
    items: rows[y].sort((a, b) => a.transform[4] - b.transform[4])
  }));
}
window.buildRows = buildRows;

function parseTimeString(timeStr) {
  if (!timeStr) return 0;
  if (timeStr.length === 4 && /^\d{4}$/.test(timeStr)) {
    return (parseInt(timeStr.substring(0, 2)) || 0) * 60
         + (parseInt(timeStr.substring(2, 4)) || 0);
  }
  if (timeStr.includes(':')) {
    const [h, m] = timeStr.split(':');
    return (parseInt(h) || 0) * 60 + (parseInt(m) || 0);
  }
  const sep = timeStr.includes(':') ? ':' : '.';
  const [hStr, mStr] = timeStr.split(sep);
  let h = parseInt(hStr) || 0;
  let m = parseInt(mStr) || 0;
  if (mStr && mStr.length === 1 && sep === '.') m *= 10;
  return h * 60 + m;
}
window.parseTimeString = parseTimeString;

/* ==============================================================
 * Koordinaattien poiminta PDF-riviltä
 * ==============================================================
 * Tukee:
 *   N5512.3 E03745.2      (ddmm.m)
 *   N5512.3E03745.2
 *   5512N 03745E          (ddmm)
 *   551205N 0374530E      (ddmmss)
 *   55.205 37.753         (desimaali)
 * ============================================================== */

function _coordParseDdmm(sign, deg, min) {
  const d = parseInt(deg, 10);
  const m = parseFloat(min);
  if (isNaN(d) || isNaN(m)) return null;
  return (d + m / 60) * (sign === 'S' || sign === 'W' ? -1 : 1);
}

function extractCoordFromString(str) {
  if (!str) return null;
  const s = String(str);

  // 1) ddmm.m / dddmm.m  (N4544.3 E06835.5)
  //    Lat: 2 digit deg + 2 digit min;  Lon: 3 digit deg + 2 digit min
  let m = s.match(
    /([NS])\s*(\d{2})\s*(\d{2}(?:\.\d+)?)\s*['′]?\s*([EW])\s*(\d{3})\s*(\d{2}(?:\.\d+)?)/i
  );
  if (m) {
    const lat = _coordParseDdmm(m[1].toUpperCase(), m[2], m[3]);
    const lon = _coordParseDdmm(m[4].toUpperCase(), m[5], m[6]);
    if (lat != null && lon != null) return { lat, lon };
  }

  // 2) ddmmss (N454430 E0683518)
  m = s.match(
    /([NS])\s*(\d{2})\s*(\d{2})\s*(\d{2})['″]?\s*([EW])\s*(\d{3})\s*(\d{2})\s*(\d{2})/i
  );
  if (m) {
    const lat = (parseInt(m[2], 10) + parseInt(m[3], 10)/60 + parseInt(m[4], 10)/3600)
              * (m[1].toUpperCase() === 'S' ? -1 : 1);
    const lon = (parseInt(m[5], 10) + parseInt(m[6], 10)/60 + parseInt(m[7], 10)/3600)
              * (m[5].toUpperCase() === 'W' ? -1 : 1);
    return { lat, lon };
  }

  // 3) Desimaalipari (45.7383 68.5917) — varmista ettei sekoita muuhun dataan
  m = s.match(/\b(-?\d{1,3}\.\d{3,})\s+(-?\d{1,3}\.\d{3,})\b/);
  if (m) {
    const lat = parseFloat(m[1]);
    const lon = parseFloat(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
  }

  return null;
}
window.extractCoordFromString = extractCoordFromString;