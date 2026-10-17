/* ==============================================================
 * AIRPORT-DB · Automaattinen lentokenttätietokanta
 * ==============================================================
 * - Lataa OurAirports-data (CSV) kerran ja tallentaa IndexedDB:hen
 * - Suodattaa pois Pohjois- ja Etelä-Amerikan (NA, SA)
 * - FIR/legacy-fallback kovakoodattuna
 * - Estää tuplakutsut
 * - Aikakatkaisu CSV-lataukselle
 * ============================================================== */
'use strict';

const AIRPORT_DB_NAME    = 'flightdeck_airports';
const AIRPORT_DB_VERSION = 1;
const AIRPORT_STORE      = 'airports';
const AIRPORT_META_STORE = 'meta';
const AIRPORT_CSV_URL    = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const AIRPORT_CACHE_DAYS = 30;

let _airportDB = null;
let _airportMemCache = null;
let _airportInitPromise = null;

/* ==============================================================
 * FIR/ACC-alueet + legacy-koodit — ei OurAirportsissa
 * ============================================================== */
const _FIR_COORDS = {
  // FIR/ACC-alueet
  RKRR: { lat: 37.469, lon: 126.451, name: 'Incheon FIR',   type: 'FIR' },
  ZBPE: { lat: 40.080, lon: 116.585, name: 'Beijing FIR',   type: 'FIR' },
  ZLHW: { lat: 36.515, lon: 103.620, name: 'Lanzhou FIR',   type: 'FIR' },
  ZSHA: { lat: 31.143, lon: 121.805, name: 'Shanghai FIR',  type: 'FIR' },
  ZYSH: { lat: 41.640, lon: 123.483, name: 'Shenyang FIR',  type: 'FIR' },

  // Kiinan kentät
  RKTU: { lat: 36.716, lon: 127.499, name: 'Cheongju',      type: 'medium_airport' },
  ZBDT: { lat: 40.060, lon: 113.482, name: 'Datong',        type: 'medium_airport' },
  ZBHH: { lat: 40.851, lon: 111.824, name: 'Hohhot',        type: 'medium_airport' },
  ZBSJ: { lat: 38.281, lon: 114.696, name: 'Shijiazhuang',  type: 'medium_airport' },
  ZBYC: { lat: 35.116, lon: 111.031, name: 'Yuncheng',      type: 'medium_airport' },
  ZBYN: { lat: 37.747, lon: 112.628, name: 'Taiyuan',       type: 'medium_airport' },
  ZLDH: { lat: 40.161, lon:  94.809, name: 'Dunhuang',      type: 'medium_airport' },
  ZLIC: { lat: 38.321, lon: 106.393, name: 'Yinchuan',      type: 'medium_airport' },
  ZLLL: { lat: 36.515, lon: 103.620, name: 'Lanzhou',       type: 'medium_airport' },
  ZLXN: { lat: 36.527, lon: 102.043, name: 'Xining',        type: 'medium_airport' },
  ZSAM: { lat: 24.544, lon: 118.128, name: 'Xiamen',        type: 'medium_airport' },
  ZSCN: { lat: 28.865, lon: 115.900, name: 'Nanchang',      type: 'medium_airport' },
  ZSWX: { lat: 31.494, lon: 120.429, name: 'Wuxi Sunan',    type: 'medium_airport' },
  ZWSH: { lat: 39.543, lon:  76.020, name: 'Kashgar',       type: 'medium_airport' },
  ZWYN: { lat: 43.956, lon:  81.330, name: 'Yining',        type: 'medium_airport' },
  ZYJM: { lat: 46.843, lon: 130.465, name: 'Jiamusi',       type: 'medium_airport' },
  ZYTL: { lat: 38.966, lon: 121.539, name: 'Dalian',        type: 'medium_airport' },

  // Legacy-koodit
  UAAL: { lat: 43.352, lon:  77.040, name: 'Almaty',        type: 'legacy' },
  UACN: { lat: 51.022, lon:  71.467, name: 'Astana',        type: 'legacy' }
};

const LEGACY_ICAO_MAP = {
  UAAL: 'UAAA',
  UACN: 'UACC'
};

function normalizeIcao(icao) {
  const key = String(icao || '').toUpperCase().trim();
  if (!key) return '';
  return LEGACY_ICAO_MAP[key] || key;
}
window.normalizeIcao = normalizeIcao;
window.LEGACY_ICAO_MAP = LEGACY_ICAO_MAP;

/* ==============================================================
 * Nimen fallback
 * ============================================================== */
const _ICAO_NAME_FALLBACK = {
  UAAA: 'Almaty', UACC: 'Astana', UAII: 'Shymkent',
  UATT: 'Aktobe', UATG: 'Atyrau', UAKK: 'Karaganda',
  UASK: 'Ust-Kamenogorsk', UAUU: 'Kostanay', UADD: 'Taraz',
  UTTT: 'Tashkent', UTSS: 'Samarkand', UCFM: 'Bishkek',
  UTDD: 'Dushanbe', UTAA: 'Ashgabat',
  RKSI: 'Seoul Incheon', RKSS: 'Seoul Gimpo',
  RKPC: 'Jeju', RKPK: 'Busan Gimhae', RKTU: 'Cheongju',
  ZBAA: 'Beijing Capital', ZBAD: 'Beijing Daxing',
  ZSPD: 'Shanghai Pudong', ZSSS: 'Shanghai Hongqiao',
  ZGGG: 'Guangzhou', ZWWW: 'Urumqi', ZYTX: 'Shenyang',
  ZSHC: 'Hangzhou', ZSNJ: 'Nanjing', ZPPP: 'Kunming',
  VHHH: 'Hong Kong', RCTP: 'Taipei Taoyuan',
  RJAA: 'Tokyo Narita', RJTT: 'Tokyo Haneda',
  OMDB: 'Dubai', OTHH: 'Doha', LTFM: 'Istanbul',
  LTAI: 'Antalya', LTBA: 'Istanbul Atatürk',
  EGLL: 'London Heathrow', LFPG: 'Paris CDG', EDDF: 'Frankfurt',
  EHAM: 'Amsterdam', LEMD: 'Madrid', LIRF: 'Rome Fiumicino',
  LOWW: 'Vienna', LSZH: 'Zurich', EKCH: 'Copenhagen',
  ESSA: 'Stockholm', EFHK: 'Helsinki', LKPR: 'Prague',
  EPWA: 'Warsaw', LHBP: 'Budapest'
};

/* ==============================================================
 * IndexedDB
 * ============================================================== */
function _openAirportDB() {
  return new Promise((resolve, reject) => {
    if (_airportDB) return resolve(_airportDB);
    const req = indexedDB.open(AIRPORT_DB_NAME, AIRPORT_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(AIRPORT_STORE)) {
        db.createObjectStore(AIRPORT_STORE, { keyPath: 'icao' });
      }
      if (!db.objectStoreNames.contains(AIRPORT_META_STORE)) {
        db.createObjectStore(AIRPORT_META_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => { _airportDB = req.result; resolve(_airportDB); };
    req.onerror   = () => reject(req.error);
  });
}

/* ==============================================================
 * CSV-parseri
 * ============================================================== */
function _parseCSVLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

/* ==============================================================
 * Lataa ja parsii CSV
 * ============================================================== */
async function _downloadAirportsCSV() {
  console.log('[AirportDB] Ladataan OurAirports-dataa…');

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30000);

  let resp;
  try {
    resp = await fetch(AIRPORT_CSV_URL, { signal: ctrl.signal });
  } finally {
    clearTimeout(timeout);
  }
   if (!resp.ok) throw new Error(`CSV HTTP ${resp.status}`);
  let text = await resp.text();

  // Poista BOM-merkki (OurAirports CSV alkaa sillä)
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const lines = text.split('\n');
  const header = lines[0].split(',');
  const idx = {
    ident:     header.indexOf('ident'),
    type:      header.indexOf('type'),
    name:      header.indexOf('name'),
    lat:       header.indexOf('latitude_deg'),
    lon:       header.indexOf('longitude_deg'),
    continent: header.indexOf('continent'),
    iata:      header.indexOf('iata_code')
  };

  const out = {};
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = _parseCSVLine(lines[i]);
    if (cols.length < header.length) continue;

    const continent = (cols[idx.continent] || '').toUpperCase();
    if (continent === 'NA' || continent === 'SA') { skipped++; continue; }

    const icao = (cols[idx.ident] || '').toUpperCase().trim();
    if (!icao || icao.length !== 4) continue;

    const lat = parseFloat(cols[idx.lat]);
    const lon = parseFloat(cols[idx.lon]);
    if (!isFinite(lat) || !isFinite(lon)) continue;

    out[icao] = {
      icao,
      name: (cols[idx.name] || '').trim(),
      lat,
      lon,
      type: (cols[idx.type] || '').toLowerCase(),
      iata: (cols[idx.iata] || '').trim()
    };
  }

  console.log(`[AirportDB] ${Object.keys(out).length} kenttää (ohitettiin ${skipped} Amerikan kenttää)`);
  return out;
}

/* ==============================================================
 * Tallennus ja luku
 * ============================================================== */
async function _storeAirports(data) {
  const db = await _openAirportDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([AIRPORT_STORE, AIRPORT_META_STORE], 'readwrite');
    const store = tx.objectStore(AIRPORT_STORE);
    const meta  = tx.objectStore(AIRPORT_META_STORE);
    store.clear();
    for (const icao in data) store.put(data[icao]);
    meta.put({ key: 'lastUpdate', value: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function _loadAirportsFromDB() {
  const db = await _openAirportDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([AIRPORT_STORE, AIRPORT_META_STORE], 'readonly');
    const store = tx.objectStore(AIRPORT_STORE);
    const meta  = tx.objectStore(AIRPORT_META_STORE);
    const all = {};
    store.openCursor().onsuccess = (e) => {
      const cur = e.target.result;
      if (cur) { all[cur.key] = cur.value; cur.continue(); }
    };
    meta.get('lastUpdate').onsuccess = (e) => {
      const last = e.target.result?.value || 0;
      resolve({ all, lastUpdate: last });
    };
    tx.onerror = () => reject(tx.error);
  });
}

/* ==============================================================
 * Alustus — estää tuplakutsut
 * ============================================================== */
function initAirportDB() {
  if (_airportInitPromise) return _airportInitPromise;

  _airportInitPromise = (async () => {
    try {
      const { all, lastUpdate } = await _loadAirportsFromDB();
      const ageDays = (Date.now() - lastUpdate) / 86400000;

      if (Object.keys(all).length > 100 && ageDays < AIRPORT_CACHE_DAYS) {
        _airportMemCache = all;
        console.log(`[AirportDB] ${Object.keys(all).length} kenttää muistissa (päivitetty ${Math.round(ageDays)} vrk sitten)`);
        return;
      }

      const fresh = await _downloadAirportsCSV();
      await _storeAirports(fresh);
      _airportMemCache = fresh;
      console.log('[AirportDB] Päivitetty');
    } catch (e) {
      console.warn('[AirportDB] Lataus epäonnistui:', e.message || e);
      if (!_airportMemCache) {
        try {
          const { all } = await _loadAirportsFromDB();
          if (Object.keys(all).length) {
            _airportMemCache = all;
            console.log(`[AirportDB] Käytetään vanhaa dataa (${Object.keys(all).length} kenttää)`);
          }
        } catch (_) {}
      }
    }
  })();

  return _airportInitPromise;
}
window.initAirportDB = initAirportDB;

/* ==============================================================
 * Haku
 * ============================================================== */
function lookupAirport(icao) {
  const key = String(icao || '').toUpperCase().trim();
  if (!key) return null;
  if (_airportMemCache && _airportMemCache[key]) return _airportMemCache[key];
  if (_FIR_COORDS[key]) return { icao: key, ..._FIR_COORDS[key] };
  return null;
}
window.lookupAirport = lookupAirport;

function getAirportName(icao) {
  const key = String(icao || '').toUpperCase().trim();
  if (!key) return '';
  const hit = lookupAirport(key);
  if (hit && hit.name) return hit.name;
  return _ICAO_NAME_FALLBACK[key] || '';
}
window.getAirportName = getAirportName;

/* ==============================================================
 * Kytke _icaoCoords (turvallinen wrapper)
 * ============================================================== */
(function () {
  if (typeof window._icaoCoords !== 'function') {
    console.warn('[AirportDB] _icaoCoords ei ole vielä määritelty');
    return;
  }
  const _orig = window._icaoCoords;
  window._icaoCoords = function (icao) {
    try {
      const r = _orig.call(this, icao);
      if (r && isFinite(r.lat) && isFinite(r.lon)) return r;
    } catch (e) {}

    try {
      const hit = lookupAirport(icao);
      if (hit && isFinite(hit.lat) && isFinite(hit.lon)) {
        return { lat: hit.lat, lon: hit.lon };
      }
    } catch (e) {}

    return null;
  };
  console.log('[AirportDB] _icaoCoords-wrapper asennettu');
})();