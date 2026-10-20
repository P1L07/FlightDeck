/* ==============================================================
 * LOGBOOK · EASA FCL.050 lokikirja
 * ==============================================================
 * Sisältää:
 *   - Lokikirjan tallennus (IndexedDB + localStorage fallback)
 *   - PDF-generointi (pdf-lib)
 *   - CSV/JSON vienti ja tuonti
 *   - Skyplan-synkka ja auto-import
 *   - Allekirjoitukset + audit hash-ketju
 *   - SPIC-lennot
 *   - Yöajan laskenta (SunCalc)
 *   - Certification-allekirjoitus PDF:ään
 *
 * Latausjärjestys (index.html):
 *   1. version.js, db.js, app.js
 *   2. LogBook.js        ← tämä tiedosto
 *   3. audit.js (sealLogbookEntry, verifyLogbookChain)
 *   4. Muut moduulit
 *
 * Riippuvuudet app.js:stä:
 *   - createModal
 *   - hhmmFromIso, yyyymmddFromIso, blockToHHMM
 *   - fetchJourneyLog
 *   - fetchSkyplanOFPBytes
 *   - getValidSkyplanToken
 *   - decodeJWT
 * ============================================================== */
'use strict';

/* ==============================================================
 * VAKIOT
 * ============================================================== */
const LOGBOOK_STORAGE_KEY = 'easa_logbook_v1';
const LOGBOOK_META_KEY    = 'easa_logbook_meta_v1';
const CERT_SIGNATURE_KEY  = '_cert_signature_v1';
const PILOT_LICENSE_KEY   = '_pilot_licenses_v1';
const LOGBOOK_BACKUP_KEY  = '_logbook_backup_meta';
const LOGBOOK_AUTOSYNC_KEY = 'logbook_autosync_state_v1';
const AUTOIMPORT_LAST_SCAN_KEY = 'easa_logbook_last_scan';

const BACKUP_INTERVAL_DAYS = 7;
const SYNC_MIN_INTERVAL    = 15 * 60 * 1000;
const SYNC_FULL_INTERVAL   = 6 * 60 * 60 * 1000;
const AUTOIMPORT_INTERVAL_MS = 15 * 60 * 1000;
const AUTOIMPORT_LOOKBACK_DAYS = 7;

/* ==============================================================
 * pdf-lib module-level reference
 * ============================================================== */
const RGB = (typeof PDFLib !== 'undefined' && typeof PDFLib.rgb === 'function')
  ? PDFLib.rgb
  : ((r = 0, g = 0, b = 0) => ({ r, g, b, type: 'RGB' }));

if (typeof PDFLib === 'undefined') {
  console.error(
    "[LogBook] pdf-lib puuttuu. Lisää <script src='https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js'></script> ENNEN LogBook.js:ää."
  );
}

/* ==============================================================
 * STORAGE LAYER · IndexedDB-ensisijainen
 * ============================================================== */
function _lbReadAll() {
  if (typeof dbReadAll === 'function' && window.dbReadAll) {
    return dbReadAll();
  }
  try {
    const raw = localStorage.getItem(LOGBOOK_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function _lbWriteAll(list) {
  if (typeof dbReplaceAllSafe === 'function' && window.dbReplaceAllSafe) {
    dbReplaceAllSafe(list);
    return;
  }
  try { localStorage.setItem(LOGBOOK_STORAGE_KEY, JSON.stringify(list)); } catch (e) {}
}

function getLogbookEntries() { return _lbReadAll(); }
function getLogbookEntry(id) { return _lbReadAll().find(e => e.id === id) || null; }
function getLogbookEntryByFlightId(fid) {
  return _lbReadAll().find(e => String(e.skyplan?.flightId) === String(fid)) || null;
}

window.getLogbookEntries = getLogbookEntries;
window.getLogbookEntry = getLogbookEntry;
window.getLogbookEntryByFlightId = getLogbookEntryByFlightId;

function saveLogbookEntry(entry) {
  if (!entry || !entry.id) throw new Error("saveLogbookEntry: entry.id required");
  if (typeof dbPutOne === 'function' && window.dbPutOne) {
    dbPutOne(entry);
  } else {
    const list = _lbReadAll();
    const idx = list.findIndex(e => e.id === entry.id);
    if (idx >= 0) list[idx] = entry; else list.push(entry);
    _lbWriteAll(list);
  }
  if (typeof renderLogbookTable === 'function'
      && document.getElementById('logbook-container')) {
    renderLogbookTable();
  }
  return entry;
}
window.saveLogbookEntry = saveLogbookEntry;

function deleteLogbookEntry(id) {
  const entry = getLogbookEntry(id);
  if (!entry) return;
  const label = entry.skyplan?.flightNumber || entry.date || 'kirjaus';
  if (!confirm(`Poista ${label} pysyvästi?`)) return;
  if (typeof dbDeleteOne === 'function' && window.dbDeleteOne) {
    dbDeleteOne(id);
  } else {
    _lbWriteAll(_lbReadAll().filter(e => e.id !== id));
  }
  renderLogbookTable();
  if (typeof showToast === 'function') showToast('Kirjaus poistettu.', 'info');
}
window.deleteLogbookEntry = deleteLogbookEntry;

/* ==============================================================
 * CERTIFICATION-ALLEKIRJOITUS
 * ============================================================== */
function getCertificationSignature() {
  try {
    const raw = localStorage.getItem(CERT_SIGNATURE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

function setCertificationSignature(dataUrl, license = '') {
  try {
    localStorage.setItem(CERT_SIGNATURE_KEY, JSON.stringify({
      dataUrl,
      license,
      savedAt: new Date().toISOString()
    }));
  } catch (e) {}
}

function clearCertificationSignature() {
  try { localStorage.removeItem(CERT_SIGNATURE_KEY); } catch (e) {}
}

window.getCertificationSignature = getCertificationSignature;
window.setCertificationSignature = setCertificationSignature;
window.clearCertificationSignature = clearCertificationSignature;

/* ==============================================================
 * PILOT LICENSE · lupakirjanumerot PIC:n mukaan
 * ============================================================== */
function getLicenseForPilot(picName) {
  if (!picName) return '';
  try {
    const map = JSON.parse(localStorage.getItem(PILOT_LICENSE_KEY) || '{}');
    return map[picName.trim().toUpperCase()] || '';
  } catch (e) { return ''; }
}

function setLicenseForPilot(picName, license) {
  if (!picName || !license) return;
  try {
    const map = JSON.parse(localStorage.getItem(PILOT_LICENSE_KEY) || '{}');
    map[picName.trim().toUpperCase()] = license.trim();
    localStorage.setItem(PILOT_LICENSE_KEY, JSON.stringify(map));
  } catch (e) {}
}

window.getLicenseForPilot = getLicenseForPilot;
window.setLicenseForPilot = setLicenseForPilot;

/* ==============================================================
 * ICAO COORDINATES
 * ============================================================== */
const ICAO_COORDS = {
  /* ============================================================
   * KAZAKSTAN
   * ============================================================ */
  UAAA: { lat: 43.3521, lon: 77.0405 },  // Almaty
  UACC: { lat: 51.0222, lon: 71.4669 },  // Astana (Nursultan)
  UAII: { lat: 42.3642, lon: 69.4789 },  // Shymkent
  UADD: { lat: 42.8536, lon: 71.3036 },  // Taraz
  UATT: { lat: 50.2450, lon: 57.2031 },  // Aktobe
  UATG: { lat: 47.1219, lon: 51.8214 },  // Atyrau
  UACK: { lat: 53.3291, lon: 69.5946 },  // Kokshetau
  UAKD: { lat: 47.7083, lon: 67.7333 },  // Zhezkazgan
  UAKK: { lat: 49.6708, lon: 73.3344 },  // Karaganda
  UASK: { lat: 50.0366, lon: 82.4942 },  // Ust-Kamenogorsk
  UASP: { lat: 52.1950, lon: 77.0731 },  // Pavlodar
  UASS: { lat: 50.3500, lon: 80.2333 },  // Semey
  UATE: { lat: 43.6777, lon: 51.2167 },  // Aktau
  UAUU: { lat: 53.2069, lon: 63.5503 },  // Kostanay
  UATR: { lat: 45.8667, lon: 63.3167 },  // Baikonur (Krainiy)
  UAAH: { lat: 47.8119, lon: 67.7331 },  // Balkhash
  UACP: { lat: 54.7747, lon: 69.1858 },  // Petropavlovsk
  UAKZ: { lat: 51.6394, lon: 66.2653 },  // Atbasar
  UATL: { lat: 44.7075, lon: 65.9994 },  // Kyzylorda
  UAKT: { lat: 46.1886, lon: 80.8322 },  // Taldykorgan
  UASU: { lat: 47.0625, lon: 51.8742 },  // Atyrau (varakenttä)

  /* ============================================================
   * UZBEKISTAN
   * ============================================================ */
  UTTT: { lat: 41.2579, lon: 69.2812 },  // Tashkent (Yuzhny)
  UZTT: { lat: 41.3128, lon: 69.2838 },  // Tashkent Vostochny
  UTSS: { lat: 39.7009, lon: 66.9836 },  // Samarkand
  UTNN: { lat: 42.4883, lon: 59.6231 },  // Nukus
  UTNU: { lat: 41.5843, lon: 60.6417 },  // Urgench
  UTFN: { lat: 40.3582, lon: 71.7450 },  // Fergana
  UTFA: { lat: 40.7277, lon: 72.2940 },  // Andizhan
  UTSB: { lat: 40.0798, lon: 64.7853 },  // Bukhara
  UTST: { lat: 37.2864, lon: 67.3100 },  // Termez

  /* ============================================================
   * KYRGYZSTAN / TAJIKISTAN / TURKMENISTAN
   * ============================================================ */
  UCFM: { lat: 43.0613, lon: 74.4776 },  // Bishkek (Manas)
  UAFM: { lat: 42.8378, lon: 74.5253 },  // Bishkek (varakenttä)
  UADD_KG: { lat: 40.6089, lon: 72.7931 }, // Osh (UAFO)
  UAFO: { lat: 40.6089, lon: 72.7931 },  // Osh
  UTDD: { lat: 38.5433, lon: 68.8250 },  // Dushanbe
  UTDL: { lat: 40.2154, lon: 69.6947 },  // Khujand
  UTAA: { lat: 37.9868, lon: 58.3610 },  // Ashgabat
  UTAV: { lat: 39.0835, lon: 63.6136 },  // Turkmenabat
  UTAT: { lat: 41.7647, lon: 59.8347 },  // Dashoguz

  /* ============================================================
   * AZERBAIJAN / GEORGIA / ARMENIA
   * ============================================================ */
  UBBB: { lat: 40.4675, lon: 50.0467 },  // Baku (Heydar Aliyev)
  UBBG: { lat: 40.7377, lon: 46.3175 },  // Ganja
  UGTB: { lat: 41.6692, lon: 44.9547 },  // Tbilisi
  UGKO: { lat: 42.1767, lon: 42.4825 },  // Kutaisi
  UGSS: { lat: 42.8581, lon: 41.1281 },  // Sukhumi (varakenttä)
  UDYZ: { lat: 40.1473, lon: 44.3959 },  // Yerevan (Zvartnots)

  /* ============================================================
   * KIINA
   * ============================================================ */
  ZBAA: { lat: 40.0799, lon: 116.6031 }, // Beijing Capital
  ZBAD: { lat: 39.5098, lon: 116.4109 }, // Beijing Daxing
  ZSPD: { lat: 31.1443, lon: 121.8083 }, // Shanghai Pudong
  ZSSS: { lat: 31.1979, lon: 121.3363 }, // Shanghai Hongqiao
  ZGGG: { lat: 23.3924, lon: 113.2988 }, // Guangzhou
  ZWWW: { lat: 43.9071, lon: 87.4742 },  // Urumqi
  ZPPP: { lat: 25.1019, lon: 102.9292 }, // Kunming
  ZUUU: { lat: 30.5785, lon: 103.9471 }, // Chengdu
  ZHHH: { lat: 30.7838, lon: 114.2081 }, // Wuhan
  ZGHA: { lat: 28.1892, lon: 113.2196 }, // Changsha
  ZSHC: { lat: 30.2295, lon: 120.4344 }, // Hangzhou
  ZJSY: { lat: 18.3029, lon: 109.4123 }, // Sanya
  ZSNJ: { lat: 31.7420, lon: 118.8623 }, // Nanjing
  ZLXY: { lat: 34.4471, lon: 108.7516 }, // Xi'an
  ZBTJ: { lat: 39.1244, lon: 117.3462 }, // Tianjin
  ZSQD: { lat: 36.2661, lon: 120.3744 }, // Qingdao
  ZYTX: { lat: 41.6398, lon: 123.4834 }, // Shenyang

  /* ============================================================
   * HONG KONG / TAIWAN / MACAU
   * ============================================================ */
  VHHH: { lat: 22.3080, lon: 113.9185 }, // Hong Kong
  RCTP: { lat: 25.0777, lon: 121.2328 }, // Taipei Taoyuan
  VMMC: { lat: 22.1496, lon: 113.5915 }, // Macau

  /* ============================================================
   * KOREA
   * ============================================================ */
  RKSI: { lat: 37.4602, lon: 126.4407 }, // Seoul Incheon
  RKSS: { lat: 37.5583, lon: 126.7906 }, // Seoul Gimpo
  RKPC: { lat: 33.5113, lon: 126.4930 }, // Jeju
  RKPK: { lat: 35.1795, lon: 128.9382 }, // Busan

  /* ============================================================
   * JAPANI
   * ============================================================ */
  RJAA: { lat: 35.7720, lon: 140.3929 }, // Tokyo Narita
  RJTT: { lat: 35.5494, lon: 139.7798 }, // Tokyo Haneda
  RJBB: { lat: 34.4347, lon: 135.2440 }, // Osaka Kansai
  RJGG: { lat: 34.8584, lon: 136.8054 }, // Nagoya
  RJCC: { lat: 42.7752, lon: 141.6923 }, // Sapporo
  RJFF: { lat: 33.5859, lon: 130.4507 }, // Fukuoka

  /* ============================================================
   * INTIA / PAKISTAN / BANGLADESH / NEPAL
   * ============================================================ */
  VIDP: { lat: 28.5562, lon: 77.1000 },  // Delhi
  VABB: { lat: 19.0887, lon: 72.8679 },  // Mumbai
  VOBL: { lat: 13.1986, lon: 77.7066 },  // Bangalore
  VOMM: { lat: 12.9941, lon: 80.1709 },  // Chennai
  VECC: { lat: 22.6547, lon: 88.4467 },  // Kolkata
  VAAH: { lat: 23.0721, lon: 72.6347 },  // Ahmedabad
  VOCI: { lat: 10.1520, lon: 76.4019 },  // Kochi
  OPKC: { lat: 24.9065, lon: 67.1608 },  // Karachi
  OPLA: { lat: 31.5216, lon: 74.4036 },  // Lahore
  OPIS: { lat: 33.5607, lon: 72.8516 },  // Islamabad
  OPPS: { lat: 33.9939, lon: 71.5146 },  // Peshawar
  VGHS: { lat: 23.8433, lon: 90.3978 },  // Dhaka
  VNKT: { lat: 27.6966, lon: 85.3591 },  // Kathmandu
  VCBI: { lat: 7.1808, lon: 79.8841 },   // Colombo

  /* ============================================================
   * LÄHI-ITÄ
   * ============================================================ */
  OMDB: { lat: 25.2532, lon: 55.3657 },  // Dubai
  OMDW: { lat: 24.8964, lon: 55.1614 },  // Dubai World Central
  OMAH: { lat: 24.2572, lon: 55.6103 },  // Al Ain
  OMSJ: { lat: 25.3286, lon: 55.5172 },  // Sharjah
  OTHH: { lat: 25.2731, lon: 51.6081 },  // Doha
  OEJN: { lat: 21.6796, lon: 39.1565 },  // Jeddah
  OERK: { lat: 24.9576, lon: 46.6988 },  // Riyadh
  OEDF: { lat: 26.4712, lon: 49.7979 },  // Dammam
  OEMA: { lat: 24.5534, lon: 39.7051 },  // Medina
  OKBK: { lat: 29.2266, lon: 47.9689 },  // Kuwait
  OBBI: { lat: 26.2708, lon: 50.6336 },  // Bahrain
  OOMS: { lat: 23.5933, lon: 58.2844 },  // Muscat
  OIIE: { lat: 35.4161, lon: 51.1522 },  // Tehran IKA
  OIII: { lat: 35.6892, lon: 51.3134 },  // Tehran Mehrabad
  OJAI: { lat: 31.7226, lon: 35.9932 },  // Amman
  OLBA: { lat: 33.8209, lon: 35.4884 },  // Beirut
  LLBG: { lat: 32.0114, lon: 34.8867 },  // Tel Aviv
  HECA: { lat: 30.1219, lon: 31.4056 },  // Cairo

  /* ============================================================
   * TURKKI
   * ============================================================ */
  LTFM: { lat: 41.2753, lon: 28.7519 },  // Istanbul (new)
  LTBA: { lat: 40.9769, lon: 28.8146 },  // Istanbul Atatürk
  LTFJ: { lat: 40.8986, lon: 29.3092 },  // Istanbul Sabiha
  LTAI: { lat: 36.8987, lon: 30.8005 },  // Antalya
  LTAC: { lat: 40.1281, lon: 32.9951 },  // Ankara
  LTBJ: { lat: 38.2924, lon: 27.1568 },  // Izmir
  LTAF: { lat: 36.9822, lon: 35.2803 },  // Adana
  LTAS: { lat: 41.2544, lon: 32.6814 },  // Zonguldak
  LTCG: { lat: 40.9951, lon: 39.7897 },  // Trabzon
  LTCF: { lat: 40.5622, lon: 43.1152 },  // Kars
  LTCB: { lat: 40.3175, lon: 36.5747 },  // Tokat

  /* ============================================================
   * EUROOPPA
   * ============================================================ */
  // Iso-Britannia
  EGLL: { lat: 51.4700, lon: -0.4543 },
  EGKK: { lat: 51.1537, lon: -0.1821 },
  EGSS: { lat: 51.8850, lon: 0.2350 },
  // Ranska
  LFPG: { lat: 49.0097, lon: 2.5479 },
  LFPO: { lat: 48.7233, lon: 2.3794 },
  LFMN: { lat: 43.6584, lon: 7.2159 },
  // Saksa
  EDDF: { lat: 50.0379, lon: 8.5622 },
  EDDM: { lat: 48.3537, lon: 11.7750 },
  EDDB: { lat: 52.3622, lon: 13.5006 },
  EDDL: { lat: 51.2895, lon: 6.7668 },
  EDDH: { lat: 53.6304, lon: 9.9882 },
  // Alankomaat / Belgia
  EHAM: { lat: 52.3105, lon: 4.7683 },
  EBBR: { lat: 50.9014, lon: 4.4844 },
  // Itävalta / Sveitsi
  LOWW: { lat: 48.1103, lon: 16.5697 },
  LSZH: { lat: 47.4581, lon: 8.5555 },
  LSGG: { lat: 46.2381, lon: 6.1089 },
  // Espanja / Portugali
  LEMD: { lat: 40.4936, lon: -3.5668 },
  LEBL: { lat: 41.2971, lon: 2.0785 },
  LEMG: { lat: 36.6749, lon: -4.4991 },
  LPPT: { lat: 38.7813, lon: -9.1359 },
  // Italia
  LIRF: { lat: 41.8003, lon: 12.2389 },
  LIMC: { lat: 45.6306, lon: 8.7281 },
  LIPZ: { lat: 45.5053, lon: 12.3519 },
  LIRN: { lat: 40.8860, lon: 14.2908 },
  // Skandinavia
  EKCH: { lat: 55.6180, lon: 12.6560 },
  ESSA: { lat: 59.6519, lon: 17.9186 },
  ENGM: { lat: 60.1939, lon: 11.1004 },
  EFHK: { lat: 60.3172, lon: 24.9633 },
  // Itä-Eurooppa
  LKPR: { lat: 50.1008, lon: 14.2600 },
  EPWA: { lat: 52.1657, lon: 20.9671 },
  LHBP: { lat: 47.4369, lon: 19.2556 },
  LROP: { lat: 44.5711, lon: 26.0850 },
  LBSF: { lat: 42.6967, lon: 23.4114 },
  LGAV: { lat: 37.9364, lon: 23.9445 },
  LWSK: { lat: 41.9616, lon: 21.6214 },
  LYBE: { lat: 44.8184, lon: 20.3091 },
  LDZA: { lat: 45.7429, lon: 16.0688 },
  LJLJ: { lat: 46.2237, lon: 14.4576 },

  /* ============================================================
   * KAUKO-IDÄN / KESKI-AASIA (muut)
   * ============================================================ */
  UAAA_MN: { lat: 47.8431, lon: 106.7661 }, // Ulaanbaatar (ZMUB)
  ZMUB: { lat: 47.8431, lon: 106.7661 },    // Ulaanbaatar
  ZMCK: { lat: 47.6469, lon: 106.8200 },    // Ulaanbaatar (new)
};

function _icaoCoords(icao) {
  if (!icao) return null;
  const key = String(icao).toUpperCase().trim();
  return ICAO_COORDS[key] || null;
}
window._icaoCoords = _icaoCoords;

/* ==============================================================
 * NIGHT TIME · SunCalc
 * ==============================================================
 * EASA AMC1 FCL.050: night = aika auringonlaskun ja -nousun välillä.
 * Civil twilight -6° kynnys.
 * Interpoloi sijainti lähtö/saapuminen välillä.
 * ============================================================== */
function calculateNightTime(takeoffIso, touchdownIso, depIcao, arrIcao) {
  const fallback = { night: '', nightTakeoff: false, nightLanding: false };

  if (typeof SunCalc === 'undefined') return fallback;
  if (!takeoffIso || !touchdownIso) return fallback;

  const dep = _icaoCoords(depIcao);
  const arr = _icaoCoords(arrIcao);
  if (!dep || !arr) return fallback;

  const t0 = new Date(takeoffIso).getTime();
  const t1 = new Date(touchdownIso).getTime();
  if (!isFinite(t0) || !isFinite(t1) || t1 <= t0) return fallback;

  const STEP_MS = 60 * 1000;
  const total = t1 - t0;
  const CIVIL_TWILIGHT_RAD = -6 * Math.PI / 180;

  const isNightAt = (ms, lat, lon) => {
    const pos = SunCalc.getPosition(new Date(ms), lat, lon);
    return pos.altitude < CIVIL_TWILIGHT_RAD;
  };

  let nightMs = 0;
  for (let t = t0; t < t1; t += STEP_MS) {
    const frac = (t - t0) / total;
    const lat = dep.lat + (arr.lat - dep.lat) * frac;
    const lon = dep.lon + (arr.lon - dep.lon) * frac;
    if (isNightAt(t, lat, lon)) nightMs += STEP_MS;
  }

  const nightTakeoff = isNightAt(t0, dep.lat, dep.lon);
  const nightLanding = isNightAt(t1, arr.lat, arr.lon);

  const mins = Math.round(nightMs / 60000);
  if (mins === 0) return { night: '', nightTakeoff, nightLanding };

  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return {
    night: `${h}:${String(m).padStart(2, '0')}`,
    nightTakeoff,
    nightLanding
  };
}
window.calculateNightTime = calculateNightTime;

/* Apuri: onko annettu aika yö */
function isNight(iso, icao) {
  if (typeof SunCalc === 'undefined' || !iso || !icao) return false;
  const coords = _icaoCoords(icao);
  if (!coords) return false;
  try {
    const pos = SunCalc.getPosition(new Date(iso), coords.lat, coords.lon);
    return pos.altitude < -6 * Math.PI / 180;
  } catch (e) { return false; }
}

/* ==============================================================
 * CREATELOGBOOKENTRY · tyhjä EASA-rivi
 * ============================================================== */
function createLogbookEntry() {
  return {
    id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()),

    // Sarakkeet 1–8
    date: '',
    departure: { place: '', time: '' },
    arrival:   { place: '', time: '' },
    aircraft:  { make: '', model: '', variant: '', registration: '' },
    singlePilot: { se: '', me: '' },
    multiPilot: '',
    totalTimeOfFlight: '',
    picName: '',
    takeoffs: { day: 0, night: 0 },
    landings: { day: 0, night: 0 },

    // Sarakkeet 9–12
    operationalCondition: { night: '', ifr: '' },
    pilotFunction: { pic: '', copilot: '', dual: '', instructor: '' },
    fstd: { date: '', type: '', totalTime: '' },
    remarks: '',

    // Allekirjoitus & metadata
    signatureDataUrl: null,
    signedAt: null,
    licenseNumber: '',

    skyplan: {
      flightId: null,
      flightNumber: '',
      importedAt: null,
      atd: null, ata: null, takeoff: null, touchdown: null,
      blockTime: null, flightTime: null
    }
  };
}
window.createLogbookEntry = createLogbookEntry;

/* ==============================================================
 * SUMMAT · sumHHMM + computeTotals
 * ============================================================== */
function sumHHMM(list) {
  let mins = 0;
  for (const s of list) {
    if (!s) continue;
    const [h, m] = String(s).split(':').map(Number);
    if (!isNaN(h) && !isNaN(m)) mins += h * 60 + m;
  }
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}
window.sumHHMM = sumHHMM;

function computeTotals(entries, previousTotals = { thisPage: '0:00', previous: '0:00' }) {
  return {
    thisPage: sumHHMM(entries.map(e => e.totalTimeOfFlight)),
    previous: previousTotals.previous,
    total: sumHHMM([previousTotals.previous, sumHHMM(entries.map(e => e.totalTimeOfFlight))])
  };
}
window.computeTotals = computeTotals;

/* ==============================================================
 * MAP JOURNEY-LOG → ENTRY
 * ==============================================================
 * Sisältää:
 *   - Yöaika SunCalcilla
 *   - Takeoff/landing laskurit (pending-logiikka)
 *   - Pilot function PIC/FO
 *   - SPIC-tuki
 * ============================================================== */
function mapJourneyLogToEntry(journeyLog, flightMeta, ownStaffId) {
  const entry = createLogbookEntry();
  const L = journeyLog;
  const meta = flightMeta || {};

  entry.date = yyyymmddFromIso(L.takeoff || L.atd) || meta.date || '';

  entry.departure = { place: meta.depIcao || '', time: hhmmFromIso(L.atd) };
  entry.arrival   = { place: meta.arrIcao || '', time: hhmmFromIso(L.ata) };

  entry.aircraft = {
    make: meta.aircraftMake || '',
    model: meta.aircraftModel || '',
    variant: meta.aircraftVariant || '',
    registration: meta.aircraftReg || ''
  };

  entry.multiPilot        = blockToHHMM(L.blockTime);
  entry.totalTimeOfFlight = blockToHHMM(L.blockTime);

  /* --- Crew --- */
  const pilots = (L.crewDuty || []).filter(c =>
    ['CP','CAPT','PIC','FO','SIC','SO','P2'].includes(String(c.position || '').toUpperCase())
  );
  const me = ownStaffId
    ? L.crewDuty.find(c => String(c.staffId) === String(ownStaffId))
    : null;
  const pic = (me && ['CP','CAPT','PIC','P1'].includes(String(me.position).toUpperCase()))
    ? me
    : pilots.find(c => ['CP','CAPT','PIC','P1'].includes(String(c.position).toUpperCase()));

  entry.picName = pic
    ? `${pic.firstName} ${pic.lastName}`.trim()
    : (meta.picNameHint || '');

  const isPIC = pic && me && String(pic.staffId) === String(me.staffId);

/* --- Yöaika --- */
const night = calculateNightTime(L.takeoff, L.touchdown, meta.depIcao, meta.arrIcao);
entry.operationalCondition = {
  night: night.night || '',
  ifr: blockToHHMM(L.blockTime)
};

/* --- Kuka teki nousun / laskun --- */
const raw = L.raw || {};
const flightOps = raw.FlightOps || {};
const takeoffStaffId = flightOps.TakeOffCapStaffID ?? raw.TakeOffCapStaffID ?? 0;
const landingStaffId = flightOps.LandingCapStaffID ?? raw.LandingCapStaffID ?? 0;

const hasTakeoffData = takeoffStaffId && String(takeoffStaffId) !== '0';
const hasLandingData = landingStaffId && String(landingStaffId) !== '0';

const myId = ownStaffId ? String(ownStaffId) : null;
const iDidTakeoff = hasTakeoffData && myId && String(takeoffStaffId) === myId;
const iDidLanding = hasLandingData && myId && String(landingStaffId) === myId;

/* EI OLETUKSIA: jos Skyplan ei toimita staff-ID:tä → 0/0 + pending */
entry.takeoffs = hasTakeoffData
  ? { day: iDidTakeoff && !night.nightTakeoff ? 1 : 0,
      night: iDidTakeoff &&  night.nightTakeoff ? 1 : 0 }
  : { day: 0, night: 0 };

entry.landings = hasLandingData
  ? { day: iDidLanding && !night.nightLanding ? 1 : 0,
      night: iDidLanding &&  night.nightLanding ? 1 : 0 }
  : { day: 0, night: 0 };

const takeoffPending = !hasTakeoffData;
const landingPending = !hasLandingData;

/* --- Pilot function --- */
entry.pilotFunction = {
  pic:     isPIC ? blockToHHMM(L.blockTime) : '',
  copilot: !isPIC ? blockToHHMM(L.blockTime) : '',
  dual: '', instructor: ''
};

/* --- Metadata --- */
entry.skyplan = {
  flightId: L.flightId || meta.flightId || null,
  flightNumber: L.flightNumber || meta.flightNumber || '',
  importedAt: new Date().toISOString(),
  atd: L.atd, ata: L.ata, takeoff: L.takeoff, touchdown: L.touchdown,
  blockTime: L.blockTime, flightTime: L.flightTime,
  takeoffPending,
  landingPending,
  takeoffStaffId: hasTakeoffData ? takeoffStaffId : null,
  landingStaffId: hasLandingData ? landingStaffId : null,
  lastCheckedAt: new Date().toISOString()
};

return entry;
}
window.mapJourneyLogToEntry = mapJourneyLogToEntry;

/* ==============================================================
 * IMPORT FROM JOURNEY LOG · tuo yksi lento lokikirjaan
 * ============================================================== */
async function importLogbookFromJourneyLog(flightId, flightNum, dateStr, flightMeta = {}, options = {}) {
  const { silent = false } = options;

  if (!silent) {
    showModalLoader("Importing Logbook",
      `Fetching journey log for <strong>${flightNum || 'Flight'}</strong>…`);
  }

  try {
    const log = await fetchJourneyLog(flightId);

    let depIcao = flightMeta.depIcao || '';
    let arrIcao = flightMeta.arrIcao || '';
    let aircraftReg = flightMeta.aircraftReg || '';
    let aircraftModel = flightMeta.aircraftModel || '';

    if (!depIcao || !arrIcao) {
      try {
        const roster = JSON.parse(localStorage.getItem('assigned_flights_cache') || '[]');
        const match = roster.find(f =>
          String(f.ID || f.id || f.FlightID) === String(flightId)
        );
        if (match) {
          depIcao       = depIcao       || match.DepartureStationIcaoCode || match.DepartureStationCode || '';
          arrIcao       = arrIcao       || match.ArrivalStationIcaoCode   || match.ArrivalStationCode   || '';
          aircraftReg   = aircraftReg   || match.RegistrationNumber || '';
          aircraftModel = aircraftModel || match.AircraftDescription || '';
        }
      } catch (e) {}
    }

    let ownStaffId = null;
    try {
      const token = localStorage.getItem('skyplan_token');
      const payload = decodeJWT(token) || {};
      ownStaffId = payload.employeeid || payload.EmployeeID || payload.employeeId
                || payload.nameid || payload.sub || null;
    } catch (e) {}

    const entry = mapJourneyLogToEntry(log, {
      flightId,
      flightNumber: log.flightNumber || flightNum,
      depIcao, arrIcao,
      aircraftModel, aircraftReg,
      date: dateStr
    }, ownStaffId);

    saveLogbookEntry(entry);

    if (!silent) {
      hideModalLoader();
      if (typeof showToast === 'function') {
        showToast(`Lento ${flightNum} tuotu lokikirjaan.`, 'success');
      }
    }
    return entry;
  } catch (err) {
    if (!silent) {
      hideModalLoader();
      createModal({
        title: 'Import Failed',
        message: err.message || 'Failed to import journey log.',
        type: 'error',
        icon: '⚠️',
        confirmText: 'Close',
        compact: true
      });
    } else {
      console.warn('[AutoImport] Silent fail for', flightNum, ':', err.message);
    }
    return null;
  }
}
window.importLogbookFromJourneyLog = importLogbookFromJourneyLog;

/* ==============================================================
 * LOGBOOK TABLE RENDERER
 * ============================================================== */
function renderLogbookTable() {
  const container = document.getElementById('logbook-container');
  if (!container) return;

  const entries = _lbReadAll().sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || '')));

  window._lbEntries = entries;

  if (!entries.length) {
    container.innerHTML = `
      <div style="padding:40px; text-align:center; color:var(--dim); font-size:14px;">
        Ei kirjauksia. Tuo lentoja <strong>Lennot</strong>-välilehdeltä
        tai synkkaa rosteri.
      </div>`;
    return;
  }

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let html = `
    <table>
      <colgroup>
        <col style="width: 7%">
        <col style="width: 7%">
        <col style="width: 9%">
        <col style="width: 10%">
        <col style="width: 11%">
        <col style="width: 6%">
        <col style="width: 10%">
        <col style="width: 5%">
        <col style="width: 5%">
        <col style="width: 5%">
        <col style="width: 5%">
        <col style="width: 6%">
        <col style="width: 14%">
      </colgroup>
      <thead>
        <tr>
          <th>Pvm</th>
          <th>Lento</th>
          <th>Reitti</th>
          <th>ATD–ATA</th>
          <th>Kone</th>
          <th>Yht</th>
          <th>PIC</th>
          <th title="Takeoffs Day/Night">TO</th>
          <th title="Landings Day/Night">LDG</th>
          <th>IFR</th>
          <th>Yö</th>
          <th>Tila</th>
          <th style="text-align:right;">Toiminnot</th>
        </tr>
      </thead>
      <tbody>`;

  for (const e of entries) {
    const signed = !!e.signatureDataUrl;
    const isPending = !!(e.skyplan?.takeoffPending || e.skyplan?.landingPending);
    const isFSTD = !!e.skyplan?.isFSTD || (e.fstd?.totalTime && !e.departure?.place && !e.arrival?.place);
    const isSPIC = /SPIC/i.test(e.remarks || '');

    let status = '';
    if (signed) {
      status = isSPIC
        ? `<span style="color:var(--accent); font-size:11px; font-weight:700; white-space:nowrap;" title="Student PIC">SPIC</span>`
        : `<span style="color:var(--success); font-size:11px; font-weight:700; white-space:nowrap;" title="Allekirjoitettu">✔</span>`;
    } else if (isPending) {
      status = `<span style="color:var(--dim); font-size:11px; font-weight:700; white-space:nowrap;" title="Odottaa Skyplan-vahvistusta">⏳</span>`;
    }

    /* FSTD-rivi */
    if (isFSTD) {
      html += `
        <tr style="background:rgba(255,179,0,0.03);">
          <td style="font-family:var(--font-mono); font-size:12.5px;">${esc(e.date)}</td>
          <td colspan="2">
            <span class="badge-fstd">SIM</span>
            <span style="margin-left:8px; font-weight:600; color:var(--warning);">
              ${esc(e.fstd?.type || 'FSTD')}
            </span>
          </td>
          <td style="font-family:var(--font-mono); font-size:12px; color:var(--dim);">
            ${esc(e.fstd?.totalTime || '–')}
          </td>
          <td style="font-size:12.5px;">–</td>
          <td style="font-weight:600;">${esc(e.fstd?.totalTime || '–')}</td>
          <td style="font-size:12.5px;">${esc(e.picName || '–')}</td>
          <td colspan="4" style="text-align:center; color:var(--dim); font-size:11px;">FSTD-sessio</td>
          <td>${status}</td>
          <td style="text-align:right; white-space:nowrap;">
            <button class="btn-ghost" style="height:32px; padding:0 12px; font-size:12px;"
              onclick="promptLogbookSignature('${e.id}')">
              ${signed ? 'Muokkaa' : 'Allekirjoita'}
            </button>
            <button class="btn-ghost" style="height:32px; padding:0 12px; font-size:12px; margin-left:6px;"
              onclick="showLogbookEntryDetail('${e.id}')">Näytä</button>
            <button class="btn-ghost" style="height:32px; padding:0 10px; font-size:12px; margin-left:6px; color:var(--error);"
              onclick="deleteLogbookEntry('${e.id}')">✕</button>
          </td>
        </tr>`;
      continue;
    }

    /* Lentorivi */
    const ac = [e.aircraft?.model, e.aircraft?.registration].filter(Boolean).join(' · ') || '–';
    const to  = `${e.takeoffs?.day || 0}/${e.takeoffs?.night || 0}`;
    const ldg = `${e.landings?.day || 0}/${e.landings?.night || 0}`;

    const picDisplay = isSPIC
      ? `<span style="color:var(--accent); font-weight:700;">SPIC</span>`
      : esc(e.picName || '–');

    html += `
      <tr>
        <td style="font-family:var(--font-mono); font-size:12.5px;">${esc(e.date)}</td>
        <td style="font-weight:600;">${esc(e.skyplan?.flightNumber || '')}</td>
        <td style="letter-spacing:0.4px;">
          ${esc(e.departure?.place || '')} ➔ ${esc(e.arrival?.place || '')}
        </td>
        <td style="font-family:var(--font-mono); font-size:12.5px;">
          ${esc(e.departure?.time || '')} – ${esc(e.arrival?.time || '')}
        </td>
        <td style="font-size:12.5px;">${esc(ac)}</td>
        <td style="font-weight:600;">${esc(e.totalTimeOfFlight || '–')}</td>
        <td style="font-size:12.5px;">${picDisplay}</td>
        <td style="color:var(--success); font-family:var(--font-mono);">${to}</td>
        <td style="color:var(--accent);  font-family:var(--font-mono);">${ldg}</td>
        <td style="font-family:var(--font-mono);">${esc(e.operationalCondition?.ifr || '–')}</td>
        <td style="font-family:var(--font-mono); color:#9ec7ff;">${esc(e.operationalCondition?.night || '–')}</td>
        <td>${status}</td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="btn-ghost" style="height:32px; padding:0 12px; font-size:12px;"
            onclick="promptLogbookSignature('${e.id}')">
            ${signed ? 'Muokkaa' : 'Allekirjoita'}
          </button>
          <button class="btn-ghost" style="height:32px; padding:0 12px; font-size:12px; margin-left:6px;"
            onclick="showLogbookEntryDetail('${e.id}')">Näytä</button>
          <button class="btn-ghost" style="height:32px; padding:0 10px; font-size:12px; margin-left:6px; color:var(--error);"
            onclick="deleteLogbookEntry('${e.id}')">✕</button>
        </td>
      </tr>`;
  }

  const totals = computeTotals(entries, { thisPage: '0:00', previous: '0:00' });

  html += `</tbody></table>
    <div style="display:flex; justify-content:space-between; align-items:center;
                padding:18px 20px; border-top:1px solid var(--border);
                background:rgba(0,194,255,0.03); font-size:13px;">
      <span style="color:var(--dim); letter-spacing:1.5px; font-size:11px;
                   text-transform:uppercase; font-weight:700;">
        Yhteensä · ${entries.length} kirjausta
      </span>
      <span style="font-family:var(--font-mono); font-size:16px;
                   color:var(--accent); font-weight:700;">
        ${totals.total}
      </span>
    </div>`;

  container.innerHTML = html;
}
window.renderLogbookTable = renderLogbookTable;

/* ==============================================================
 * DETAIL MODAL
 * ============================================================== */
function showLogbookEntryDetail(id) {
  const e = getLogbookEntry(id);
  if (!e) return;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const row = (label, val) => `
    <div class="kv"><span>${esc(label)}</span><span>${esc(val) || '–'}</span></div>`;

  const sectionTitle = (t) => `
    <div style="font-size:10px; letter-spacing:1.5px; text-transform:uppercase;
                color:var(--dim); font-weight:700; margin:10px 0 6px 0;">${t}</div>`;

  const isPending = !!(e.skyplan?.takeoffPending || e.skyplan?.landingPending);
  const tkIso = e.skyplan?.takeoff;
  const ldIso = e.skyplan?.touchdown;
  const tkHint = tkIso ? hhmmFromIso(tkIso) : null;
  const ldHint = ldIso ? hhmmFromIso(ldIso) : null;
  const tkNight = tkIso ? isNight(tkIso, e.departure?.place) : false;
  const ldNight = ldIso ? isNight(ldIso, e.arrival?.place) : false;

  const wasTk = (Number(e.takeoffs?.day || 0) + Number(e.takeoffs?.night || 0)) > 0;
  const wasLd = (Number(e.landings?.day || 0) + Number(e.landings?.night || 0)) > 0;

  const numInput = (id, val) => `
    <input type="number" id="${id}" min="0" max="9"
           value="${Number(val) || 0}"
           style="width:52px; padding:5px 6px; border-radius:6px;
                  background:var(--bg); color:var(--text);
                  border:1px solid var(--border); font-family:var(--font-mono);
                  font-size:12.5px; text-align:center;">`;

  const checkboxRow = (id, checked, label, time, night, border) => `
    <label style="display:flex; align-items:center; gap:10px; cursor:pointer;
                  ${border ? 'margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid var(--border);' : ''}">
      <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}
             style="width:18px; height:18px; accent-color:var(--accent);">
      <div style="flex:1;">
        <div style="font-weight:600; font-size:12.5px;">${label}</div>
        <div style="font-size:11px; color:var(--dim); line-height:1.35;">
          ${time} · ${night ? 'yö' : 'päivä'}
          → <b style="color:var(--accent);">${night ? 'Night=1' : 'Day=1'}</b>
        </div>
      </div>
    </label>`;

  const numberRow = (dayId, nightId, dayVal, nightVal, label, border) => `
    <div style="${border ? 'margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid var(--border);' : ''}">
      <div style="font-weight:600; font-size:12.5px; margin-bottom:4px;">${label}</div>
      <div style="font-size:11px; color:var(--warning); margin-bottom:6px;">
        ⚠ Skyplan ei antanut aikaa — syötä käsin
      </div>
      <div style="display:flex; gap:10px; align-items:center;">
        <span style="font-size:12px;">Day</span>
        ${numInput(dayId, dayVal)}
        <span style="font-size:12px; margin-left:8px;">Night</span>
        ${numInput(nightId, nightVal)}
      </div>
    </div>`;

  const tkBlock = tkIso
    ? checkboxRow('dtl-did-tk', wasTk, 'Tein takeoffin', tkHint, tkNight, true)
    : numberRow('dtl-tk-day', 'dtl-tk-night',
        e.takeoffs?.day || 0, e.takeoffs?.night || 0, 'Takeoffs', true);

  const ldBlock = ldIso
    ? checkboxRow('dtl-did-ld', wasLd, 'Tein laskun', ldHint, ldNight, false)
    : numberRow('dtl-ld-day', 'dtl-ld-night',
        e.landings?.day || 0, e.landings?.night || 0, 'Landings', false);

  const body = `
    <div style="max-height:min(72vh, 600px); overflow-y:auto; padding-right:4px;">

      ${sectionTitle('Lento')}
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0 20px;">
        <div>
          ${row('1. Pvm', e.date)}
          ${row('2. Lähtö', `${e.departure?.place || ''} ${e.departure?.time || ''}`)}
          ${row('3. Saapuminen', `${e.arrival?.place || ''} ${e.arrival?.time || ''}`)}
          ${row('4. Kone',
            [e.aircraft?.make, e.aircraft?.model, e.aircraft?.variant, e.aircraft?.registration]
              .filter(Boolean).join(' '))}
        </div>
        <div>
          ${row('5. SE / ME', `${e.singlePilot?.se || '–'} / ${e.singlePilot?.me || '–'}`)}
          ${row('6. Multi-pilot', e.multiPilot)}
          ${row('7. Kokonaislentoaika', e.totalTimeOfFlight)}
          ${row('8. PIC', e.picName)}
        </div>
      </div>

      ${sectionTitle('Olosuhteet & tehtävä')}
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0 20px;">
        <div>
          ${row('9. Night / IFR',
            `${e.operationalCondition?.night || '–'} / ${e.operationalCondition?.ifr || '–'}`)}
          ${row('Takeoffs (D/N)',
            `${e.takeoffs?.day || 0} / ${e.takeoffs?.night || 0}`)}
          ${row('Landings (D/N)',
            `${e.landings?.day || 0} / ${e.landings?.night || 0}`)}
        </div>
        <div>
          ${row('10. PIC / Co-pilot',
            `${e.pilotFunction?.pic || '–'} / ${e.pilotFunction?.copilot || '–'}`)}
          ${row('11. FSTD', e.fstd?.totalTime || '–')}
          ${row('Lupakirja', e.licenseNumber || '–')}
          ${row('Allekirjoitettu',
            e.signedAt ? new Date(e.signedAt).toLocaleString() : '–')}
        </div>
      </div>

      ${sectionTitle('Takeoffs & Landings')}
      ${isPending ? `
        <div style="font-size:11.5px; color:var(--warning); padding:8px 10px;
                    background:rgba(255,179,0,0.08); border-radius:6px;
                    border:1px solid rgba(255,179,0,0.25); line-height:1.45; margin-bottom:8px;">
          ⏳ Odottaa vahvistusta — rastita mitä teit. Päivä/yö lasketaan aikaleimoista.
        </div>
      ` : ''}
      <div style="padding:10px 12px; background:var(--input); border-radius:8px;
                  border:1px solid var(--border);">
        ${tkBlock}
        ${ldBlock}
      </div>

      ${e.remarks ? `
        ${sectionTitle('Remarks (sarake 12)')}
        <div style="padding:10px 12px; background:var(--input); border-radius:8px;
                    font-size:12.5px; line-height:1.5; white-space:pre-wrap;">${esc(e.remarks)}</div>
      ` : ''}

      ${e.signatureDataUrl ? `
        ${sectionTitle("Pilot's signature")}
        <img src="${e.signatureDataUrl}"
             style="max-width:100%; height:auto; max-height:120px;
                    background:#fff; border-radius:8px; padding:6px;"/>
      ` : ''}

      ${e.skyplan?.flightId ? `
        <div style="margin-top:14px; text-align:right;">
          <button class="btn-ghost" style="height:32px; padding:0 14px; font-size:12px;"
            onclick="reimportLogbookEntry('${e.id}')">
            ⟳ Päivitä journey-logista
          </button>
        </div>
      ` : ''}
    </div>
  `;

  createModal({
    title: `${e.skyplan?.flightNumber || ''}`,
    icon: '📄',
    bodyHTML: body,
    confirmText: 'Sulje',
    maxWidth: '720px',
    compact: false,
    onConfirm: () => {
      // Lue lomake ennen sulkemista
      const ent = getLogbookEntry(id);
      if (!ent) return;

      const clampNum = (elId) => Math.max(0,
        Math.min(9, parseInt(document.getElementById(elId)?.value, 10) || 0));

      const oldTk = JSON.stringify(ent.takeoffs || {});
      const oldLd = JSON.stringify(ent.landings || {});

      if (tkIso) {
        const did = document.getElementById('dtl-did-tk')?.checked || false;
        ent.takeoffs = did
          ? (tkNight ? { day: 0, night: 1 } : { day: 1, night: 0 })
          : { day: 0, night: 0 };
      } else {
        ent.takeoffs = { day: clampNum('dtl-tk-day'), night: clampNum('dtl-tk-night') };
      }

      if (ldIso) {
        const did = document.getElementById('dtl-did-ld')?.checked || false;
        ent.landings = did
          ? (ldNight ? { day: 0, night: 1 } : { day: 1, night: 0 })
          : { day: 0, night: 0 };
      } else {
        ent.landings = { day: clampNum('dtl-ld-day'), night: clampNum('dtl-ld-night') };
      }

      const changed = JSON.stringify(ent.takeoffs) !== oldTk
                   || JSON.stringify(ent.landings) !== oldLd
                   || isPending;

      if (changed) {
        if (ent.skyplan) {
          ent.skyplan.takeoffPending = false;
          ent.skyplan.landingPending = false;
          ent.skyplan.manuallyConfirmedAt = new Date().toISOString();
        }
        saveLogbookEntry(ent);
        if (typeof showToast === 'function') showToast('TO/LDG tallennettu.', 'success');
      }
    }
  });
}
window.showLogbookEntryDetail = showLogbookEntryDetail;

/* ==============================================================
 * RE-IMPORT
 * ============================================================== */
async function reimportLogbookEntry(entryId) {
  const old = getLogbookEntry(entryId);
  if (!old || !old.skyplan?.flightId) return;
  const fid = old.skyplan.flightId;
  const fnum = old.skyplan.flightNumber;
  _lbWriteAll(_lbReadAll().filter(e => e.id !== entryId));
  await importLogbookFromJourneyLog(fid, fnum, old.date, {
    depIcao: old.departure.place,
    arrIcao: old.arrival.place,
    aircraftModel: old.aircraft.model,
    aircraftReg: old.aircraft.registration
  });
}
window.reimportLogbookEntry = reimportLogbookEntry;

/* ==============================================================
 * ALLEKIRJOITUS · yksittäinen lento (SPIC-tuki)
 * ============================================================== */
function promptLogbookSignature(entryId) {
  const entry = getLogbookEntry(entryId);
  if (!entry) return Promise.reject(new Error("Entry not found"));

  return new Promise((resolve) => {
    const savedLicense = getLicenseForPilot(entry.picName);
    const isSPIC = /SPIC/i.test(entry.remarks || '');
    const isPending = !!(entry.skyplan?.takeoffPending || entry.skyplan?.landingPending);

    const tkIso = entry.skyplan?.takeoff;
    const ldIso = entry.skyplan?.touchdown;
    const tkHint = tkIso ? hhmmFromIso(tkIso) : null;
    const ldHint = ldIso ? hhmmFromIso(ldIso) : null;
    const tkNight = tkIso ? isNight(tkIso, entry.departure?.place) : false;
    const ldNight = ldIso ? isNight(ldIso, entry.arrival?.place)   : false;

    const wasTk = (Number(entry.takeoffs?.day || 0) + Number(entry.takeoffs?.night || 0)) > 0;
    const wasLd = (Number(entry.landings?.day || 0) + Number(entry.landings?.night || 0)) > 0;

    const numInput = (id, val) => `
      <input type="number" id="${id}" min="0" max="9"
             value="${Number(val) || 0}"
             style="width:52px; padding:5px 6px; border-radius:6px;
                    background:var(--bg); color:var(--text);
                    border:1px solid var(--border); font-family:var(--font-mono);
                    font-size:12.5px; text-align:center;">`;

    /* Aikaleima → checkbox + auto-laskettu päivä/yö */
    const checkboxRow = (id, checked, label, time, night, border) => `
      <label style="display:flex; align-items:center; gap:10px; cursor:pointer;
                    ${border ? 'margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid var(--border);' : ''}">
        <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}
               style="width:18px; height:18px; accent-color:var(--accent);">
        <div style="flex:1;">
          <div style="font-weight:600; font-size:12.5px;">${label}</div>
          <div style="font-size:11px; color:var(--dim); line-height:1.35;">
            ${time} · ${night ? 'yö' : 'päivä'}
            → <b style="color:var(--accent);">${night ? 'Night=1' : 'Day=1'}</b>
          </div>
        </div>
      </label>`;

    /* Ei aikaleimaa → manuaaliset numerot (varalla) */
    const numberRow = (dayId, nightId, dayVal, nightVal, label, border) => `
      <div style="${border ? 'margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid var(--border);' : ''}">
        <div style="font-weight:600; font-size:12.5px; margin-bottom:4px;">${label}</div>
        <div style="font-size:11px; color:var(--warning); margin-bottom:6px;">
          ⚠ Skyplan ei antanut aikaa — syötä käsin
        </div>
        <div style="display:flex; gap:10px; align-items:center;">
          <span style="font-size:12px;">Day</span>
          ${numInput(dayId, dayVal)}
          <span style="font-size:12px; margin-left:8px;">Night</span>
          ${numInput(nightId, nightVal)}
        </div>
      </div>`;

    const tkBlock = tkIso
      ? checkboxRow('lb-did-tk', wasTk, 'Tein takeoffin', tkHint, tkNight, true)
      : numberRow('lb-tk-day', 'lb-tk-night',
          entry.takeoffs?.day || 0, entry.takeoffs?.night || 0, 'Takeoffs', true);

    const ldBlock = ldIso
      ? checkboxRow('lb-did-ld', wasLd, 'Tein laskun', ldHint, ldNight, false)
      : numberRow('lb-ld-day', 'lb-ld-night',
          entry.landings?.day || 0, entry.landings?.night || 0, 'Landings', false);

    const bodyHTML = `
      <div style="max-height:min(72vh, 560px); overflow-y:auto; padding-right:4px;
                  display:flex; flex-direction:column; gap:10px;">

        <div style="font-size:12.5px; color:var(--dim); line-height:1.4;">
          <strong style="color:var(--text);">${_esc(entry.skyplan?.flightNumber || '')}</strong>
          · ${_esc(entry.departure?.place || '')} → ${_esc(entry.arrival?.place || '')}
          · ${_esc(entry.date || '')} · ${_esc(entry.totalTimeOfFlight || '')}
        </div>

        ${isPending ? `
          <div style="font-size:11.5px; color:var(--warning); padding:8px 10px;
                      background:rgba(255,179,0,0.08); border-radius:6px;
                      border:1px solid rgba(255,179,0,0.25); line-height:1.45;">
            ⚠ Skyplan ei vahvistanut TO/LDG:tä. Rastita mitä teit — päivä/yö
            lasketaan automaattisesti aikaleimoista.
          </div>
        ` : ''}

        <div style="padding:10px 12px; background:var(--input); border-radius:8px;
                    border:1px solid var(--border);">
          ${tkBlock}
          ${ldBlock}
        </div>

        <div>
          <label style="display:block; font-size:11.5px; font-weight:600;
                        color:var(--dim); margin-bottom:4px;">
            Pilot's license number
          </label>
          <input type="text" id="lb-license"
                 placeholder="esim. KZ-12345"
                 value="${_esc(savedLicense || '')}"
                 style="width:100%; padding:8px 10px; border-radius:8px;
                        background:var(--input); color:var(--text);
                        border:1px solid var(--border); font-size:13px;
                        font-family:var(--font-mono); box-sizing:border-box;">
        </div>

        <div id="lb-spic-box" style="padding:10px 12px; border-radius:8px;
             background:${isSPIC ? 'rgba(0,194,255,0.08)' : 'var(--input)'};
             border:1px solid ${isSPIC ? 'var(--border-2)' : 'var(--border)'};
             transition:all 0.15s ease;">
          <label style="display:flex; align-items:center; gap:10px; cursor:pointer; user-select:none;">
            <input type="checkbox" id="lb-spic" ${isSPIC ? 'checked' : ''}
                   style="width:18px; height:18px; accent-color:var(--accent); cursor:pointer;">
            <span style="flex:1; font-size:12.5px;">
              <strong>SPIC-lento</strong>
              <span style="display:block; font-size:11px; color:var(--dim);
                           line-height:1.35; margin-top:2px;">
                Lentoaika PIC-sarakkeeseen + "SPIC" remarks-kenttään.
              </span>
            </span>
          </label>
        </div>

        <div>
          <label style="display:block; font-size:11.5px; font-weight:600;
                        color:var(--dim); margin-bottom:4px;">
            Remarks (sarake 12)
          </label>
          <textarea id="lb-remark" rows="2" placeholder="Valinnainen"
              style="width:100%; padding:8px 10px; border-radius:8px;
                     background:var(--input); color:var(--text);
                     border:1px solid var(--border); font-size:12.5px;
                     box-sizing:border-box; resize:vertical;
                     min-height:44px; max-height:100px;">${_esc(entry.remarks || '')}</textarea>
        </div>

        <div>
          <label style="display:block; font-size:11.5px; font-weight:600;
                        color:var(--dim); margin-bottom:4px;">
            Pilot's signature
          </label>
          <canvas id="lb-sig-pad" width="600" height="160"
              style="width:100%; height:120px; background:#fff;
                     border:1px solid var(--border); border-radius:8px;
                     touch-action:none;"></canvas>
          <button type="button" id="lb-sig-clear"
              style="margin-top:4px; align-self:flex-end; font-size:11px;
                     background:transparent; border:1px solid var(--border);
                     color:var(--text); padding:3px 10px; border-radius:6px; cursor:pointer;">
            Clear signature
          </button>
        </div>
      </div>
    `;

    createModal({
      title: 'Allekirjoita lento',
      icon: '✍️',
      bodyHTML,
      confirmText: 'Tallenna',
      cancelText: 'Peruuta',
      maxWidth: '560px',
      compact: true,
      onConfirm: async () => {
        const canvas = document.getElementById('lb-sig-pad');
        const remark = (document.getElementById('lb-remark')?.value || '').trim();
        const license = (document.getElementById('lb-license')?.value || '').trim();
        const spicChecked = document.getElementById('lb-spic')?.checked || false;
        const dataUrl = canvas.toDataURL('image/png');

        const blank = document.createElement('canvas');
        blank.width = canvas.width; blank.height = canvas.height;
        if (dataUrl === blank.toDataURL('image/png')) {
          if (typeof showToast === 'function') showToast('Allekirjoitus vaaditaan.', 'warning');
          return false;
        }

        const clampNum = (id) => Math.max(0,
          Math.min(9, parseInt(document.getElementById(id)?.value, 10) || 0));

        /* TO: auto-laskettu päivä/yö jos aikaleima, muuten manuaalinen */
        if (tkIso) {
          const did = document.getElementById('lb-did-tk')?.checked || false;
          entry.takeoffs = did
            ? (tkNight ? {day:0, night:1} : {day:1, night:0})
            : {day:0, night:0};
        } else {
          entry.takeoffs = { day: clampNum('lb-tk-day'), night: clampNum('lb-tk-night') };
        }

        /* LDG: sama */
        if (ldIso) {
          const did = document.getElementById('lb-did-ld')?.checked || false;
          entry.landings = did
            ? (ldNight ? {day:0, night:1} : {day:1, night:0})
            : {day:0, night:0};
        } else {
          entry.landings = { day: clampNum('lb-ld-day'), night: clampNum('lb-ld-night') };
        }

        if (entry.skyplan?.takeoffPending || entry.skyplan?.landingPending) {
          entry.skyplan.takeoffPending = false;
          entry.skyplan.landingPending = false;
          entry.skyplan.manuallyConfirmedAt = new Date().toISOString();
        }

        if (license && entry.picName) setLicenseForPilot(entry.picName, license);

        let finalRemarks = remark;
        if (spicChecked) {
          if (!/SPIC/i.test(finalRemarks)) {
            finalRemarks = finalRemarks ? `${finalRemarks}\nSPIC` : 'SPIC';
          }
        } else {
          finalRemarks = finalRemarks.replace(/\n?SPIC\b/g, '').trim();
        }

        entry.remarks = finalRemarks;
        entry.licenseNumber = license || '';
        entry.signatureDataUrl = dataUrl;
        entry.signedAt = new Date().toISOString();

        if (spicChecked) {
          const tt = entry.totalTimeOfFlight || '';
          entry.pilotFunction = entry.pilotFunction || {};
          entry.pilotFunction.pic = tt;
          entry.pilotFunction.copilot = '';
        }

        if (entry.hash && typeof _auditAppend === 'function') {
          _auditAppend({
            type: 'reseal',
            entryId: entry.id,
            oldHash: entry.hash,
            at: entry.signedAt,
            by: entry.picName || ''
          });
        }

        if (typeof sealLogbookEntry === 'function') {
          try { await sealLogbookEntry(entry); }
          catch (err) { console.error('[Seal] failed:', err); }
        }

        saveLogbookEntry(entry);

        if (typeof showToast === 'function') {
          showToast(spicChecked ? 'Kirjaus allekirjoitettu (SPIC).' : 'Kirjaus allekirjoitettu.', 'success');
        }
        if (typeof renderChainStatusBadge === 'function') renderChainStatusBadge();
        resolve(entry);
      },
      onCancel: () => resolve(null)
    });

    requestAnimationFrame(() => {
      const canvas = document.getElementById('lb-sig-pad');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#000';
      let drawing = false, last = null;

      const pos = (e) => {
        const r = canvas.getBoundingClientRect();
        const p = e.touches ? e.touches[0] : e;
        return { x: (p.clientX - r.left) * canvas.width / r.width,
                 y: (p.clientY - r.top) * canvas.height / r.height };
      };
      const down = (e) => { drawing = true; last = pos(e); e.preventDefault(); };
      const move = (e) => {
        if (!drawing) return;
        const p = pos(e);
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        last = p; e.preventDefault();
      };
      const up = () => { drawing = false; };

      canvas.addEventListener('pointerdown', down);
      canvas.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      document.getElementById('lb-sig-clear').onclick = () =>
        ctx.clearRect(0, 0, canvas.width, canvas.height);

      const spicBox = document.getElementById('lb-spic-box');
      const spicChk = document.getElementById('lb-spic');
      if (spicChk && spicBox) {
        spicChk.addEventListener('change', () => {
          spicBox.style.background = spicChk.checked ? 'rgba(0,194,255,0.08)' : 'var(--input)';
          spicBox.style.borderColor = spicChk.checked ? 'var(--border-2)' : 'var(--border)';
        });
      }
    });
  });
}
window.promptLogbookSignature = promptLogbookSignature;


/* ==============================================================
 * ALLEKIRJOITA KAIKKI · saman PIC:n lennot
 * ============================================================== */
async function signAllFlightsForPilot() {
  const entries = _lbReadAll();
  if (!entries.length) {
    if (typeof showToast === 'function') showToast('Ei kirjauksia.', 'warning');
    return;
  }

  const byPilot = new Map();
  entries.forEach(e => {
    if (e.skyplan?.isFSTD) return;
    if (!e.picName) return;
    if (e.signatureDataUrl) return;

    const key = String(e.picName).trim().toUpperCase();
    if (!byPilot.has(key)) byPilot.set(key, { name: e.picName, entries: [] });
    byPilot.get(key).entries.push(e);
  });

  if (byPilot.size === 0) {
    if (typeof showToast === 'function') {
      showToast('Ei allekirjoittamattomia lentoja.', 'info');
    }
    return;
  }

  const pilotOptions = [...byPilot.entries()].map(([key, data]) => {
    const savedLicense = getLicenseForPilot(data.name);
    return `
      <button type="button" class="sign-all-pilot" data-key="${_esc(key)}"
        style="display:flex; align-items:center; gap:14px; padding:14px 16px;
               background:var(--input); border:1px solid var(--border);
               border-radius:10px; color:var(--text); text-align:left;
               cursor:pointer; margin-bottom:8px; width:100%;
               transition:all 0.15s;">
        <span style="font-size:20px;">👤</span>
        <span style="flex:1;">
          <span style="display:block; font-weight:700; font-size:14px; margin-bottom:2px;">
            ${_esc(data.name)}
          </span>
          <span style="font-size:12px; color:var(--dim);">
            ${data.entries.length} allekirjoittamatonta lentoa
            ${savedLicense ? `· Lupakirja: <span class="mono">${_esc(savedLicense)}</span>` : '· Ei lupakirjaa'}
          </span>
        </span>
        <span style="color:var(--accent); font-size:18px;">→</span>
      </button>`;
  }).join('');

  const bodyHTML = `
    <div style="font-size:13px; color:var(--dim); margin-bottom:14px; line-height:1.5;">
      Valitse kapteeni, jonka lennot haluat allekirjoittaa kerralla.
      Jokaisen lennon alle tulee sama allekirjoitus ja lupakirja.
    </div>
    <div style="max-height:60vh; overflow-y:auto;">
      ${pilotOptions}
    </div>
  `;

  createModal({
    title: 'Allekirjoita kaikki lennot',
    icon: '✍️',
    bodyHTML,
    confirmText: 'Sulje',
    maxWidth: '560px',
    onConfirm: () => {}
  });

  setTimeout(() => {
    document.querySelectorAll('.sign-all-pilot').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.key;
        const data = byPilot.get(key);
        if (!data) return;

        const modal = btn.closest('div[style*="position: fixed"]');
        if (modal) modal.remove();

        await _promptSignAllModal(data);
      });
    });
  }, 50);
}
window.signAllFlightsForPilot = signAllFlightsForPilot;

async function _promptSignAllModal(data) {
  const { name, entries } = data;
  const savedLicense = getLicenseForPilot(name);

  return new Promise((resolve) => {
    const bodyHTML = `
      <div style="display:flex; flex-direction:column; gap:14px;">
        <div style="font-size:13px; color:var(--dim); line-height:1.5;">
          Allekirjoitat <strong style="color:var(--text);">${entries.length} lentoa</strong>,
          joissa PIC on <strong style="color:var(--accent);">${_esc(name)}</strong>.
        </div>

        <div>
          <label style="display:block; font-size:12px; font-weight:600; color:var(--dim); margin-bottom:6px;">
            Pilot's license number
          </label>
          <input type="text" id="lb-license"
                 placeholder="esim. KZ-12345"
                 value="${_esc(savedLicense || '')}"
                 style="width:100%; padding:10px 12px; border-radius:8px;
                        background:var(--input); color:var(--text);
                        border:1px solid var(--border); font-size:13px;
                        font-family:var(--font-mono); box-sizing:border-box;">
        </div>

        <div id="lb-spic-box" style="padding:14px; border-radius:10px;
             background:var(--input); border:1px solid var(--border); transition:all 0.15s ease;">
          <label style="display:flex; align-items:center; gap:12px; cursor:pointer; user-select:none;">
            <input type="checkbox" id="lb-spic"
                   style="width:20px; height:20px; accent-color:var(--accent); cursor:pointer;">
            <span style="flex:1;">
              <span style="display:block; font-weight:700; font-size:14px; color:var(--text); margin-bottom:2px;">
                Merkitse kaikki SPIC-lennoiksi
              </span>
              <span style="font-size:11.5px; color:var(--dim); line-height:1.4;">
                Merkitsee nämä lennot SPIC-lennoiksi (PIC-tunnit + SPIC-merkintä remarks-kenttään).
              </span>
            </span>
          </label>
        </div>

        <div>
          <label style="display:block; font-size:12px; font-weight:600; color:var(--dim); margin-bottom:6px;">
            Remarks and endorsements (sarake 12)
          </label>
          <textarea id="lb-remark" rows="3" placeholder="Valinnainen — lisätään kaikkiin valittuihin lentoihin"
              style="width:100%; padding:10px; border-radius:8px; background:var(--input);
                     color:var(--text); border:1px solid var(--border); font-size:13px;
                     box-sizing:border-box;"></textarea>
        </div>

        <div>
          <label style="display:block; font-size:12px; font-weight:600; color:var(--dim); margin-bottom:6px;">
            Pilot's signature
          </label>
          <canvas id="lb-sig-pad" width="600" height="160"
              style="width:100%; height:160px; background:#fff; border:1px solid var(--border);
                     border-radius:8px; touch-action:none;"></canvas>
          <button type="button" id="lb-sig-clear"
              style="margin-top:6px; align-self:flex-end; font-size:11px; background:transparent;
                     border:1px solid var(--border); color:var(--text); padding:4px 10px;
                     border-radius:6px; cursor:pointer;">
            Clear signature
          </button>
        </div>
      </div>
    `;

    createModal({
      title: `Allekirjoita ${entries.length} lentoa`,
      icon: '✍️',
      bodyHTML,
      confirmText: 'Allekirjoita kaikki',
      cancelText: 'Peruuta',
      maxWidth: '640px',
      compact: true,
      onConfirm: async () => {
        const canvas = document.getElementById('lb-sig-pad');
        const license = (document.getElementById('lb-license')?.value || '').trim();
        const remark = (document.getElementById('lb-remark')?.value || '').trim();
        const spicChecked = document.getElementById('lb-spic')?.checked || false;
        const dataUrl = canvas.toDataURL('image/png');

        const blank = document.createElement('canvas');
        blank.width = canvas.width; blank.height = canvas.height;
        if (dataUrl === blank.toDataURL('image/png')) {
          if (typeof showToast === 'function') showToast('Signature required.', 'warning');
          return false;
        }

        if (license) setLicenseForPilot(name, license);

        const list = _lbReadAll();
        const byId = new Map(list.map(e => [e.id, e]));
        let updated = 0;

        for (const entry of entries) {
          const e = byId.get(entry.id);
          if (!e) continue;

          let finalRemarks = remark;
          if (spicChecked && !/SPIC/i.test(finalRemarks)) {
            finalRemarks = finalRemarks ? `${finalRemarks}\nSPIC` : 'SPIC';
          }

          e.remarks = finalRemarks;
          e.licenseNumber = license || '';
          e.signatureDataUrl = dataUrl;
          e.signedAt = new Date().toISOString();
          e.sealedAt = new Date().toISOString();

          if (spicChecked) {
            const tt = e.totalTimeOfFlight || '';
            if (!e.pilotFunction) e.pilotFunction = { pic: '', copilot: '', dual: '', instructor: '' };
            e.pilotFunction.pic = tt;
            e.pilotFunction.copilot = '';
          }

          const idx = list.findIndex(x => x.id === e.id);
          if (idx >= 0) list[idx] = e;
          _lbWriteAll(list);

          if (typeof sealLogbookEntry === 'function') {
            try {
              await sealLogbookEntry(e);
              const idx2 = list.findIndex(x => x.id === e.id);
              if (idx2 >= 0) list[idx2] = e;
              _lbWriteAll(list);
              await new Promise(r => setTimeout(r, 5));
            } catch (err) {
              console.warn('[SignAll] seal failed:', err);
            }
          }
          updated++;
        }

        if (typeof renderLogbookTable === 'function') renderLogbookTable();
        if (typeof renderChainStatusBadge === 'function') renderChainStatusBadge();

        if (typeof showToast === 'function') {
          showToast(`${updated} kirjausta allekirjoitettu${spicChecked ? ' (SPIC)' : ''}.`, 'success', 5000);
        }
        resolve(true);
      },
      onCancel: () => resolve(false)
    });

    requestAnimationFrame(() => {
      const canvas = document.getElementById('lb-sig-pad');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#000';
      let drawing = false, last = null;

      const pos = (e) => {
        const r = canvas.getBoundingClientRect();
        const p = e.touches ? e.touches[0] : e;
        return { x: (p.clientX - r.left) * canvas.width / r.width,
                 y: (p.clientY - r.top) * canvas.height / r.height };
      };
      const down = (e) => { drawing = true; last = pos(e); e.preventDefault(); };
      const move = (e) => {
        if (!drawing) return;
        const p = pos(e);
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        last = p; e.preventDefault();
      };
      const up = () => { drawing = false; };

      canvas.addEventListener('pointerdown', down);
      canvas.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      document.getElementById('lb-sig-clear').onclick = () =>
        ctx.clearRect(0, 0, canvas.width, canvas.height);

      const spicBox = document.getElementById('lb-spic-box');
      const spicChk = document.getElementById('lb-spic');
      if (spicChk && spicBox) {
        spicChk.addEventListener('change', () => {
          spicBox.style.background = spicChk.checked ? 'rgba(0,194,255,0.08)' : 'var(--input)';
          spicBox.style.borderColor = spicChk.checked ? 'var(--border-2)' : 'var(--border)';
        });
      }
    });
  });
}

/* ==============================================================
 * MANUAL TO/LDG CONFIRMATION
 * ==============================================================
 * Skyplan ei palauta TakeOffCapStaffID / LandingCapStaffID -kenttiä
 * koskaan. Pilotti vahvistaa käsin kuka teki nousun/laskun.
 * Yöaika lasketaan SunCalcilla skyplan.takeoff / skyplan.touchdown
 * -aikaleimoista.
 * ============================================================== */
async function promptTakeoffLandingConfirmation(entryId) {
  const entry = getLogbookEntry(entryId);
  if (!entry) return;

  const tkIso = entry.skyplan?.takeoff;
  const ldIso = entry.skyplan?.touchdown;

  const tkIsNight = tkIso ? isNight(tkIso, entry.departure?.place) : false;
  const ldIsNight = ldIso ? isNight(ldIso, entry.arrival?.place)   : false;

  const tkTime = tkIso ? hhmmFromIso(tkIso) : '—';
  const ldTime = ldIso ? hhmmFromIso(ldIso) : '—';

  const bodyHTML = `
    <div style="font-size:13px; color:var(--dim); margin-bottom:14px;">
      <strong style="color:var(--text);">${_esc(entry.skyplan?.flightNumber || '')}</strong>
      · ${_esc(entry.departure?.place || '')} → ${_esc(entry.arrival?.place || '')}
      · ${_esc(entry.date || '')}
    </div>

    <div style="font-size:12px; color:var(--warning); padding:10px 12px;
                background:rgba(255,179,0,0.08); border-radius:8px; margin-bottom:14px;">
      ⚠ Skyplan ei palauttanut TO/LDG-vahvistusta. Kuittaa käsin.
    </div>

    <label style="display:flex; align-items:center; gap:12px; padding:12px;
                  background:var(--input); border-radius:8px; margin-bottom:8px; cursor:pointer;">
      <input type="checkbox" id="lb-confirm-tk"
             style="width:20px; height:20px; accent-color:var(--accent); cursor:pointer;">
      <span style="flex:1;">
        <span style="display:block; font-weight:700;">Tein takeoffin</span>
        <span style="font-size:11.5px; color:var(--dim);">
          ${tkIso ? `aika ${tkTime} (${tkIsNight ? 'yö' : 'päivä'})` : 'ei takeoff-aikaa'}
        </span>
      </span>
    </label>

    <label style="display:flex; align-items:center; gap:12px; padding:12px;
                  background:var(--input); border-radius:8px; cursor:pointer;">
      <input type="checkbox" id="lb-confirm-ld"
             style="width:20px; height:20px; accent-color:var(--accent); cursor:pointer;">
      <span style="flex:1;">
        <span style="display:block; font-weight:700;">Tein laskun</span>
        <span style="font-size:11.5px; color:var(--dim);">
          ${ldIso ? `aika ${ldTime} (${ldIsNight ? 'yö' : 'päivä'})` : 'ei touchdown-aikaa'}
        </span>
      </span>
    </label>

    <div style="font-size:11px; color:var(--faint); margin-top:12px;">
      Rastittamaton = 0/0 (ei kreditointia). Yö/päivä lasketaan
      SunCalcilla aikaleimoista, ei arvata.
    </div>
  `;

  createModal({
    title: 'Vahvista TO / LDG',
    icon: '✋',
    bodyHTML,
    confirmText: 'Tallenna',
    cancelText: 'Peruuta',
    maxWidth: '520px',
    compact: true,
    onConfirm: () => {
      const tk = document.getElementById('lb-confirm-tk')?.checked || false;
      const ld = document.getElementById('lb-confirm-ld')?.checked || false;

      entry.takeoffs = tk
        ? { day: tkIsNight ? 0 : 1, night: tkIsNight ? 1 : 0 }
        : { day: 0, night: 0 };
      entry.landings = ld
        ? { day: ldIsNight ? 0 : 1, night: ldIsNight ? 1 : 0 }
        : { day: 0, night: 0 };

      if (!entry.skyplan) entry.skyplan = {};
      entry.skyplan.takeoffPending = false;
      entry.skyplan.landingPending = false;
      entry.skyplan.manuallyConfirmedAt = new Date().toISOString();

      saveLogbookEntry(entry);
      if (typeof showToast === 'function') {
        showToast('TO/LDG vahvistettu.', 'success');
      }
    }
  });
}
window.promptTakeoffLandingConfirmation = promptTakeoffLandingConfirmation;

/* ==============================================================
 * PDF-GENEROINTI · EASA FCL.050
 * ============================================================== */
async function generateLogbookPDF(entries, certification = null) {
  const { PDFDocument, StandardFonts } = PDFLib;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const PW = 842, PH = 595;
  const margin = 24;
  const black = RGB(0, 0, 0);
  const ROW_H = 18;
  const MAX_ROWS = 22;
  const TABLE_TOP = PH - 60;
  const TABLE_BOTTOM = TABLE_TOP - 28 - MAX_ROWS * ROW_H;
  const TOTALS_TOP = TABLE_BOTTOM - 18;

  const sorted = [...entries].sort((a, b) =>
    String(a.date || '').localeCompare(String(b.date || '')));

  const cols1 = [
    { key: 'date',    label: 'Date',            w: 60 },
    { key: 'depP',    label: 'Departure Place', w: 62 },
    { key: 'depT',    label: 'Time',            w: 42 },
    { key: 'arrP',    label: 'Arrival Place',   w: 62 },
    { key: 'arrT',    label: 'Time',            w: 42 },
    { key: 'ac',      label: 'Aircraft\nMake Model Variant', w: 110 },
    { key: 'spSE',    label: 'SE',              w: 34 },
    { key: 'spME',    label: 'ME',              w: 34 },
    { key: 'multi',   label: 'Multi-pilot',     w: 56 },
    { key: 'total',   label: 'Total time\nof flight', w: 56 },
    { key: 'picName', label: 'Name(s) PIC',     w: 110 },
    { key: 'tkD',     label: 'Takeoffs\nDay',   w: 40 },
    { key: 'tkN',     label: 'Night',           w: 34 },
    { key: 'ldD',     label: 'Landings\nDay',   w: 40 },
    { key: 'ldN',     label: 'Night',           w: 34 }
  ];

  const cols2 = [
    { key: 'night', label: 'Night',       w: 50 },
    { key: 'ifr',   label: 'IFR',         w: 50 },
    { key: 'pic',   label: 'PIC',         w: 50 },
    { key: 'co',    label: 'Co-pilot',    w: 55 },
    { key: 'dual',  label: 'Dual',        w: 50 },
    { key: 'inst',  label: 'Instructor',  w: 55 },
    { key: 'fDate', label: 'FSTD Date',   w: 70 },
    { key: 'fType', label: 'Type',        w: 60 },
    { key: 'fTime', label: 'Total time',  w: 55 }
  ];

  let runningPrevious = emptyTotals();
  let pageNum = 0;

  for (let offset = 0; offset < sorted.length; offset += MAX_ROWS) {
    pageNum++;
    const chunk = sorted.slice(offset, offset + MAX_ROWS);
    const pageSum = computePageSum(chunk);
    const totalSum = addTotals(runningPrevious, pageSum);

    /* SIVU 1 */
    const p1 = pdf.addPage([PW, PH]);
    drawTableHeader(p1, font, bold, cols1, margin, TABLE_TOP, black);
    drawRows(p1, font, cols1, chunk, margin, TABLE_TOP, ROW_H, MAX_ROWS);

    drawTotalsRows(p1, font, bold, cols1, margin, TOTALS_TOP, ROW_H,
      ['spSE','spME','multi','total','tkD','tkN','ldD','ldN'],
      [
        { label: 'Total this page',      data: pageSum },
        { label: 'Total previous pages', data: runningPrevious },
        { label: 'Total time',           data: totalSum }
      ]
    );

    /* SIVU 2 */
    const p2 = pdf.addPage([PW, PH]);
    drawTableHeader(p2, font, bold, cols2, margin, TABLE_TOP, black);
    drawRows(p2, font, cols2, chunk, margin, TABLE_TOP, ROW_H, MAX_ROWS);

    drawTotalsRows(p2, font, bold, cols2, margin, TOTALS_TOP, ROW_H,
      ['night','ifr','pic','co','dual','inst','fTime'],
      [
        { label: 'Total this page',      data: pageSum },
        { label: 'Total previous pages', data: runningPrevious },
        { label: 'Total time',           data: totalSum }
      ],
      false
    );

    const remarksX = margin + cols2.reduce((a, c) => a + c.w, 0);
    const remarksW = PW - margin - remarksX;
    const headerTopY = TABLE_TOP;
    const dataTopY = headerTopY - 28;

    p2.drawRectangle({
      x: remarksX, y: dataTopY, width: remarksW, height: 28,
      borderColor: black, borderWidth: 0.7
    });
    p2.drawText('Remarks and endorsements', {
      x: remarksX + 6, y: dataTopY + 10, size: 9, font: bold, color: black
    });

    for (let i = 0; i < chunk.length; i++) {
      const e = chunk[i];
      const y = dataTopY - (i + 1) * ROW_H;

      p2.drawRectangle({
        x: remarksX, y, width: remarksW, height: ROW_H,
        borderColor: RGB(0.35, 0.35, 0.35), borderWidth: 0.4
      });

      if (e.signatureDataUrl) {
        try {
          const png = await pdf.embedPng(e.signatureDataUrl);
          const maxH = ROW_H - 3;
          const maxW = Math.min(remarksW * 0.35, 70);
          const s = Math.min(maxW / png.width, maxH / png.height);
          p2.drawImage(png, {
            x: remarksX + remarksW - (png.width * s) - 3,
            y: y + 2,
            width: png.width * s,
            height: png.height * s
          });
        } catch (err) {}
      }

      if (e.remarks) {
        const maxW = remarksW - 90;
        const raw = String(e.remarks).replace(/\s+/g, ' ').trim();
        let txt = raw;
        try {
          while (font.widthOfTextAtSize(txt, 7) > maxW && txt.length > 3) {
            txt = txt.slice(0, -2);
          }
          if (txt !== raw) txt = txt.slice(0, -1) + '…';
        } catch (e2) { txt = raw.slice(0, 60); }

        p2.drawText(txt, {
          x: remarksX + 3, y: y + 9, size: 7, font, color: black
        });
      }

      if (e.licenseNumber) {
        p2.drawText(`Lic. ${e.licenseNumber}`, {
          x: remarksX + 3, y: y + 2, size: 6.5, font: bold, color: RGB(0.3, 0.3, 0.3)
        });
      }
    }

    /* Certification-lohko */
    const certTopY = dataTopY - MAX_ROWS * ROW_H;
    const certH = 70;
    p2.drawRectangle({
      x: remarksX, y: certTopY - certH, width: remarksW, height: certH,
      borderColor: black, borderWidth: 0.7
    });

    p2.drawText('I certify that the entries in this log are true.', {
      x: remarksX + 6, y: certTopY - 14, size: 8, font, color: black
    });

    if (certification?.license) {
      p2.drawText(`Lic. ${certification.license}`, {
        x: remarksX + 6, y: certTopY - 26, size: 7, font: bold,
        color: RGB(0.3, 0.3, 0.3)
      });
    }

    p2.drawText("Pilot's signature:", {
      x: remarksX + 6, y: certTopY - 40, size: 8, font, color: black
    });

    if (certification?.dataUrl) {
      try {
        const png = await pdf.embedPng(certification.dataUrl);
        const maxW = remarksW - 20;
        const maxH = 24;
        const s = Math.min(maxW / png.width, maxH / png.height);
        p2.drawImage(png, {
          x: remarksX + 14,
          y: certTopY - certH + 4,
          width: png.width * s,
          height: png.height * s
        });
      } catch (err) {
        console.warn('[PDF] certification signature embed failed:', err);
      }
    }

    runningPrevious = totalSum;
  }

  console.log('[Logbook PDF] Sivuja yhteensä:', pageNum * 2, '(' + pageNum + ' paria)');
  return await pdf.save();
}
window.generateLogbookPDF = generateLogbookPDF;

/* --- PDF apurit --- */
function drawTotalsRows(page, font, bold, cols, x, startY, rowH, colKeys, rows, showLabels = true) {
  const totalWidth = cols.reduce((s, c) => s + c.w, 0);

  const colX = {};
  let cx = x;
  for (const c of cols) {
    colX[c.key] = cx;
    cx += c.w;
  }

  const SHORT = {
    'Total this page':      'This page',
    'Total previous pages': 'Previous',
    'Total time':           'Total'
  };

  const dataColKeys = showLabels
    ? cols.slice(2).map(c => c.key)
    : cols.map(c => c.key);

  const DATA_KEYS = {
    spSE: 'se', spME: 'me', multi: 'multi', total: 'total',
    tkD: 'tkDay', tkN: 'tkNight', ldD: 'ldDay', ldN: 'ldNight',
    night: 'night', ifr: 'ifr', pic: 'pic', co: 'co',
    dual: 'dual', inst: 'inst', fTime: 'fstd'
  };
  const NUMERIC = new Set(['tkD','tkN','ldD','ldN']);

  rows.forEach((row, i) => {
    const rowTop = startY - i * rowH;
    const rowBottom = rowTop - rowH;
    const textY = rowBottom + 6;

    page.drawLine({
      start: { x, y: rowTop },
      end:   { x: x + totalWidth, y: rowTop },
      thickness: 0.5,
      color: RGB(0.2, 0.2, 0.2)
    });

    if (showLabels) {
      page.drawText(SHORT[row.label] || row.label, {
        x: x + 3, y: textY, size: 7, font: bold, color: RGB(0, 0, 0)
      });
    }

    dataColKeys.forEach(colKey => {
      const dataKey = DATA_KEYS[colKey];
      if (!dataKey) return;

      const raw = row.data?.[dataKey];
      let val;
      if (NUMERIC.has(colKey)) {
        val = String(Number(raw) || 0);
      } else {
        val = raw || '0:00';
      }

      page.drawText(val, {
        x: colX[colKey] + 3,
        y: textY,
        size: 8,
        font,
        color: RGB(0, 0, 0)
      });
    });
  });

  const bottomY = startY - rows.length * rowH;
  page.drawLine({
    start: { x, y: bottomY },
    end:   { x: x + totalWidth, y: bottomY },
    thickness: 0.5,
    color: RGB(0.2, 0.2, 0.2)
  });
}

function emptyTotals() {
  return {
    se: '0:00', me: '0:00', multi: '0:00', total: '0:00',
    tkDay: 0, tkNight: 0, ldDay: 0, ldNight: 0,
    night: '0:00', ifr: '0:00',
    pic: '0:00', co: '0:00', dual: '0:00', inst: '0:00', fstd: '0:00'
  };
}

function _sumTimes(entries, getter) {
  let mins = 0;
  for (const e of entries) {
    const v = getter(e) || '';
    const [h, m] = String(v).split(':').map(Number);
    if (!isNaN(h) && !isNaN(m)) mins += h * 60 + m;
  }
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
}

function _addHHMM(a, b) {
  const [ah, am] = String(a || '0:00').split(':').map(Number);
  const [bh, bm] = String(b || '0:00').split(':').map(Number);
  const t = (ah * 60 + (am || 0)) + (bh * 60 + (bm || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function computePageSum(entries) {
  return {
    se:    _sumTimes(entries, e => e.singlePilot?.se),
    me:    _sumTimes(entries, e => e.singlePilot?.me),
    multi: _sumTimes(entries, e => e.multiPilot),
    total: _sumTimes(entries, e => e.totalTimeOfFlight),
    tkDay:   entries.reduce((s, e) => s + (Number(e.takeoffs?.day)   || 0), 0),
    tkNight: entries.reduce((s, e) => s + (Number(e.takeoffs?.night) || 0), 0),
    ldDay:   entries.reduce((s, e) => s + (Number(e.landings?.day)   || 0), 0),
    ldNight: entries.reduce((s, e) => s + (Number(e.landings?.night) || 0), 0),
    night: _sumTimes(entries, e => e.operationalCondition?.night),
    ifr:   _sumTimes(entries, e => e.operationalCondition?.ifr),
    pic:   _sumTimes(entries, e => e.pilotFunction?.pic),
    co:    _sumTimes(entries, e => e.pilotFunction?.copilot),
    dual:  _sumTimes(entries, e => e.pilotFunction?.dual),
    inst:  _sumTimes(entries, e => e.pilotFunction?.instructor),
    fstd:  _sumTimes(entries, e => e.fstd?.totalTime)
  };
}

function addTotals(prev, page) {
  return {
    se:    _addHHMM(prev.se,    page.se),
    me:    _addHHMM(prev.me,    page.me),
    multi: _addHHMM(prev.multi, page.multi),
    total: _addHHMM(prev.total, page.total),
    tkDay:   (prev.tkDay   || 0) + page.tkDay,
    tkNight: (prev.tkNight || 0) + page.tkNight,
    ldDay:   (prev.ldDay   || 0) + page.ldDay,
    ldNight: (prev.ldNight || 0) + page.ldNight,
    night: _addHHMM(prev.night, page.night),
    ifr:   _addHHMM(prev.ifr,   page.ifr),
    pic:   _addHHMM(prev.pic,   page.pic),
    co:    _addHHMM(prev.co,    page.co),
    dual:  _addHHMM(prev.dual,  page.dual),
    inst:  _addHHMM(prev.inst,  page.inst),
    fstd:  _addHHMM(prev.fstd,  page.fstd)
  };
}

function _truncText(text, font, size, maxWidth) {
  if (!text) return '';
  const s = String(text);
  if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;

  let t = s;
  while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + '…';
}

function drawRows(page, font, cols, entries, x, topY, rowH, maxRows) {
  const startY = topY - 28;
  let y = startY;
  const n = Math.min(entries.length, maxRows);

  for (let i = 0; i < n; i++) {
    const e = entries[i];
    y -= rowH;
    let cx = x;
    for (const c of cols) {
      page.drawRectangle({
        x: cx, y, width: c.w, height: rowH,
        borderColor: RGB(0.35, 0.35, 0.35), borderWidth: 0.4
      });
      const val = getColValue(e, c.key);
      if (val != null && val !== '') {
        const txt = _truncText(String(val), font, 8, c.w - 6);
        page.drawText(txt, {
          x: cx + 3, y: y + 5, size: 8, font, color: RGB(0, 0, 0)
        });
      }
      cx += c.w;
    }
  }

  for (let i = n; i < maxRows; i++) {
    y -= rowH;
    let cx = x;
    for (const c of cols) {
      page.drawRectangle({
        x: cx, y, width: c.w, height: rowH,
        borderColor: RGB(0.6, 0.6, 0.6), borderWidth: 0.3
      });
      cx += c.w;
    }
  }
}

function drawTableHeader(page, font, bold, cols, x, topY, color) {
  let cx = x;
  for (const c of cols) {
    page.drawRectangle({ x: cx, y: topY - 28, width: c.w, height: 28,
      borderColor: color, borderWidth: 0.7 });
    const lines = c.label.split('\n');
    lines.forEach((ln, i) => {
      page.drawText(ln, {
        x: cx + 4, y: topY - 14 - i * 11,
        size: 8, font: bold, color
      });
    });
    cx += c.w;
  }
  cx = x;
  cols.forEach((c, i) => {
    page.drawText(String(i + 1), {
      x: cx + 4, y: topY + 4, size: 9, font: bold, color
    });
    cx += c.w;
  });
}

function getColValue(e, key) {
  switch (key) {
    case 'date':    return e.date;
    case 'depP':    return e.departure?.place;
    case 'depT':    return e.departure?.time;
    case 'arrP':    return e.arrival?.place;
    case 'arrT':    return e.arrival?.time;
    case 'ac':      return [e.aircraft?.make, e.aircraft?.model, e.aircraft?.variant, e.aircraft?.registration].filter(Boolean).join(' ');
    case 'spSE':    return e.singlePilot?.se;
    case 'spME':    return e.singlePilot?.me;
    case 'multi':   return e.multiPilot;
    case 'total':   return e.totalTimeOfFlight;
    case 'picName':
      if (/SPIC/i.test(e.remarks || '')) return `SPIC · ${e.picName || ''}`;
      return e.picName;
    case 'tkD':     return e.takeoffs?.day || '';
    case 'tkN':     return e.takeoffs?.night || '';
    case 'ldD':     return e.landings?.day || '';
    case 'ldN':     return e.landings?.night || '';
    case 'night':   return e.operationalCondition?.night;
    case 'ifr':     return e.operationalCondition?.ifr;
    case 'pic':     return e.pilotFunction?.pic;
    case 'co':      return e.pilotFunction?.copilot;
    case 'dual':    return e.pilotFunction?.dual;
    case 'inst':    return e.pilotFunction?.instructor;
    case 'fDate':   return e.fstd?.date;
    case 'fType':   return e.fstd?.type;
    case 'fTime':   return e.fstd?.totalTime;
    default:        return '';
  }
}

/* ==============================================================
 * TIEDOSTON TALLENNUS · iOS Share Sheet / Download
 * ============================================================== */
function _isIOSLike() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function saveBlobToDevice(blob, filename, mimeType = 'application/octet-stream') {
  if (!blob || !blob.size) throw new Error("Empty blob.");

  const safeName = String(filename || 'document').replace(/[\\/:*?"<>|]/g, '_');
  const fullName = safeName;

  let file = null;
  try {
    file = new File([blob], fullName, { type: mimeType, lastModified: Date.now() });
  } catch (e) {
    console.warn('[Save] File() ei tuettu');
  }

  if (_isIOSLike() && file && navigator.canShare && navigator.share) {
    try {
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return 'shared';
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      console.warn('[Save] share failed:', err);
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fullName;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return 'downloaded';
  } catch (e) {
    console.warn('[Save] download failed:', e);
  }

  try {
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return 'opened';
  } catch (e) {
    URL.revokeObjectURL(url);
    throw new Error('Tiedoston tallennus ei onnistunut.');
  }
}
window.saveBlobToDevice = saveBlobToDevice;

async function savePDFToDevice(pdfBytes, filename) {
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  return saveBlobToDevice(blob, `${filename}.pdf`, 'application/pdf');
}
window.savePDFToDevice = savePDFToDevice;

/* ==============================================================
 * CERTIFICATION POPUP · kysy allekirjoitus ennen PDF:ää
 * ============================================================== */
async function promptCertificationSignature() {
  const saved = getCertificationSignature();

  return new Promise((resolve) => {
    const bodyHTML = `
      <div style="display:flex; flex-direction:column; gap:14px;">
        <div style="font-size:13px; color:var(--dim); line-height:1.5;">
          Allekirjoituksesi piirretään PDF:n alaosaan kohtaan
          <strong style="color:var(--text);">"I certify that the entries in this log are true."</strong>
        </div>

        <div>
          <label style="display:block; font-size:12px; font-weight:600; color:var(--dim); margin-bottom:6px;">
            Pilot's license number
          </label>
          <input type="text" id="cert-license"
                 placeholder="esim. FI.FCL.1111"
                 value="${saved?.license ? String(saved.license).replace(/"/g, '&quot;') : ''}"
                 style="width:100%; padding:10px 12px; border-radius:8px;
                        background:var(--input); color:var(--text);
                        border:1px solid var(--border); font-size:14px;
                        font-family:var(--font-mono); box-sizing:border-box;">
        </div>

        <div>
          <label style="display:block; font-size:12px; font-weight:600; color:var(--dim); margin-bottom:6px;">
            Pilot's signature
          </label>
          <canvas id="cert-sig-pad" width="600" height="160"
              style="width:100%; height:160px; background:#fff; border:1px solid var(--border);
                     border-radius:8px; touch-action:none;"></canvas>
          <div style="display:flex; justify-content:space-between; margin-top:6px;">
            <span style="font-size:11px; color:var(--faint);">
              Piirrä sormella tai Apple Pencilillä
            </span>
            <button type="button" id="cert-sig-clear"
                style="font-size:11px; background:transparent;
                       border:1px solid var(--border); color:var(--text);
                       padding:4px 10px; border-radius:6px; cursor:pointer;">
              Clear signature
            </button>
          </div>
        </div>

        ${saved ? `
          <div style="font-size:11px; color:var(--faint); padding:8px 12px;
                      background:rgba(0,194,255,0.04); border-radius:6px;
                      border:1px solid var(--border);">
            Aiempi allekirjoitus tallessa (${new Date(saved.savedAt).toLocaleString('fi-FI')}).
            Voit piirtää uuden tai peruuttaa ja käyttää vanhaa.
          </div>
        ` : ''}
      </div>
    `;

    createModal({
      title: 'Certification',
      icon: '✍️',
      bodyHTML,
      confirmText: 'Luo PDF',
      cancelText: 'Peruuta',
      maxWidth: '640px',
      compact: true,
      onConfirm: () => {
        const canvas = document.getElementById('cert-sig-pad');
        const license = (document.getElementById('cert-license')?.value || '').trim();
        const dataUrl = canvas.toDataURL('image/png');

        const blank = document.createElement('canvas');
        blank.width = canvas.width;
        blank.height = canvas.height;
        const isBlank = dataUrl === blank.toDataURL('image/png');

        if (isBlank) {
          if (saved?.dataUrl) {
            resolve({ dataUrl: saved.dataUrl, license: license || saved.license || '' });
            return;
          }
          if (typeof showToast === 'function') {
            showToast('Piirrä allekirjoitus ennen PDF:n luontia.', 'warning');
          }
          return false;
        }

        setCertificationSignature(dataUrl, license);
        resolve({ dataUrl, license });
      },
      onCancel: () => resolve(null)
    });

    requestAnimationFrame(() => {
      const canvas = document.getElementById('cert-sig-pad');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#000';

      if (saved?.dataUrl) {
        const img = new Image();
        img.onload = () => { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); };
        img.src = saved.dataUrl;
      }

      let drawing = false;
      let last = null;

      const pos = (e) => {
        const r = canvas.getBoundingClientRect();
        const p = e.touches ? e.touches[0] : e;
        return {
          x: (p.clientX - r.left) * canvas.width / r.width,
          y: (p.clientY - r.top) * canvas.height / r.height
        };
      };
      const down = (e) => { drawing = true; last = pos(e); e.preventDefault(); };
      const move = (e) => {
        if (!drawing) return;
        const p = pos(e);
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        last = p;
        e.preventDefault();
      };
      const up = () => { drawing = false; };

      canvas.addEventListener('pointerdown', down);
      canvas.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);

      const clearBtn = document.getElementById('cert-sig-clear');
      if (clearBtn) {
        clearBtn.onclick = () => ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    });
  });
}
window.promptCertificationSignature = promptCertificationSignature;

/* ==============================================================
 * SAVE LOGBOOK PDF
 * ============================================================== */
async function saveLogbookPDF(entries, previousTotals, options = {}) {
  const list = Array.isArray(entries) ? entries : (window._lbEntries || []);
  if (!list.length) {
    if (typeof showToast === 'function') showToast('Ei kirjauksia tallennettavaksi.', 'warning');
    return;
  }

  const cert = await promptCertificationSignature();
  if (!cert || !cert.dataUrl) {
    if (typeof showToast === 'function') showToast('Allekirjoitus peruutettu.', 'info');
    return;
  }

  if (typeof showModalLoader === 'function') {
    showModalLoader('Valmistellaan PDF…',
      `Luodaan lokikirjaa (${list.length} kirjausta)…`);
  }

  try {
    const bytes = await generateLogbookPDF(list, cert);

    const today = new Date();
    const stamp = `${today.getFullYear()}-${
      String(today.getMonth() + 1).padStart(2, '0')}-${
      String(today.getDate()).padStart(2, '0')}`;
    const filename = options.filename || `EASA_Logbook_${stamp}`;

    if (typeof hideModalLoader === 'function') hideModalLoader();

    const result = await savePDFToDevice(bytes, filename);

    if (typeof showToast === 'function') {
      const msg = {
        shared:     'PDF avattu jakovalikkoon — valitse "Tallenna tiedostoon".',
        downloaded: 'PDF ladattu laitteellesi.',
        opened:     'PDF avattu uudessa välilehdessä.',
        cancelled:  null,
        failed:     'PDF:n tallennus epäonnistui.'
      }[result];
      if (msg) {
        showToast(msg, result === 'failed' ? 'error' : 'success', 4000);
      }
    }
    return result;
  } catch (err) {
    if (typeof hideModalLoader === 'function') hideModalLoader();
    console.error('[Logbook PDF] save failed:', err);
    if (typeof createModal === 'function') {
      createModal({
        title: 'PDF-virhe',
        message: err.message || 'Lokikirjan PDF:n luonti epäonnistui.',
        type: 'error',
        icon: '⚠️',
        confirmText: 'Sulje',
        compact: true
      });
    }
  }
}
window.saveLogbookPDF = saveLogbookPDF;

async function printLogbook(entries, previousTotals) {
  return saveLogbookPDF(entries, previousTotals, { filename: 'EASA_Logbook' });
}
window.printLogbook = printLogbook;

/* ==============================================================
 * CSV-VIENTI
 * ============================================================== */
function _csvEscape(value) {
  if (value == null) return '';
  const s = String(value);
  if (/[";\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function _csvRow(cells) {
  return cells.map(_csvEscape).join(';');
}

function _entryToCsvRow(e) {
  return _csvRow([
    e.date || '',
    e.departure?.place || '', e.departure?.time || '',
    e.arrival?.place || '', e.arrival?.time || '',
    e.aircraft?.make || '', e.aircraft?.model || '',
    e.aircraft?.variant || '', e.aircraft?.registration || '',
    e.singlePilot?.se || '', e.singlePilot?.me || '',
    e.multiPilot || '',
    e.totalTimeOfFlight || '',
    e.picName || '',
    e.takeoffs?.day ?? '', e.takeoffs?.night ?? '',
    e.landings?.day ?? '', e.landings?.night ?? '',
    e.operationalCondition?.night || '',
    e.operationalCondition?.ifr   || '',
    e.pilotFunction?.pic || '', e.pilotFunction?.copilot || '',
    e.pilotFunction?.dual || '', e.pilotFunction?.instructor || '',
    e.fstd?.date || '', e.fstd?.type || '', e.fstd?.totalTime || '',
    e.remarks || '',
    e.skyplan?.flightNumber || '', e.skyplan?.flightId || '',
    e.skyplan?.atd || '', e.skyplan?.takeoff || '',
    e.skyplan?.touchdown || '', e.skyplan?.ata || '',
    e.skyplan?.blockTime || '', e.skyplan?.flightTime || '',
    e.signedAt || '', e.sealedAt || '',
    e.hash || '', e.prevHash || ''
  ]);
}

function _buildCsvHeader() {
  return _csvRow([
    '1. Date',
    '2a. Departure Place', '2b. Departure Time',
    '3a. Arrival Place',   '3b. Arrival Time',
    '4a. Aircraft Make', '4b. Model', '4c. Variant', '4d. Registration',
    '5a. Single-pilot SE', '5b. Single-pilot ME',
    '6. Multi-pilot',
    '7. Total time of flight',
    '8. Name(s) PIC',
    'Takeoffs Day', 'Takeoffs Night',
    'Landings Day', 'Landings Night',
    '9a. Night', '9b. IFR',
    '10a. PIC', '10b. Co-pilot', '10c. Dual', '10d. Instructor',
    '11a. FSTD Date', '11b. FSTD Type', '11c. FSTD Total time',
    '12. Remarks',
    'Skyplan Flight Number', 'Skyplan Flight ID',
    'ATD', 'Takeoff', 'Touchdown', 'ATA',
    'BlockTime', 'FlightTime',
    'Signed At', 'Sealed At', 'SHA-256', 'Prev Hash'
  ]);
}

async function exportLogbookCSV(options = {}) {
  const entries = (Array.isArray(options.entries) ? options.entries : getLogbookEntries())
    .slice()
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  if (!entries.length) {
    if (typeof showToast === 'function') showToast('Ei kirjauksia vietäväksi.', 'warning');
    return;
  }

  const { includeBOM = true } = options;

  const lines = [
    _buildCsvHeader(),
    ...entries.map(_entryToCsvRow)
  ];

  const totals = computeTotals(entries, { thisPage: '0:00', previous: '0:00' });
  lines.push('');
  lines.push(_csvRow(['Total this page', totals.thisPage]));
  lines.push(_csvRow(['Total previous pages', totals.previous]));
  lines.push(_csvRow(['Total time', totals.total]));
  lines.push(_csvRow(['Entries', String(entries.length)]));
  lines.push(_csvRow(['Exported', new Date().toISOString()]));

  const csv = lines.join('\r\n');
  const payload = (includeBOM ? '\uFEFF' : '') + csv;
  const blob = new Blob([payload], { type: 'text/csv;charset=utf-8' });

  const today = new Date();
  const stamp = `${today.getFullYear()}-${
    String(today.getMonth() + 1).padStart(2, '0')}-${
    String(today.getDate()).padStart(2, '0')}`;
  const filename = options.filename || `EASA_Logbook_${stamp}.csv`;

  if (typeof showModalLoader === 'function') {
    showModalLoader('Viedään CSV…', `${entries.length} kirjausta`);
  }
  try {
    const result = await saveBlobToDevice(blob, filename, 'text/csv');
    if (typeof hideModalLoader === 'function') hideModalLoader();
    if (result !== 'cancelled' && typeof showToast === 'function') {
      showToast(result === 'shared'
        ? 'CSV valmis — valitse "Tallenna tiedostoon".'
        : 'CSV ladattu.', 'success');
    }
    return result;
  } catch (err) {
    if (typeof hideModalLoader === 'function') hideModalLoader();
    console.error('[CSV Export]', err);
    if (typeof showToast === 'function') showToast('CSV-vienti epäonnistui.', 'error');
  }
}
window.exportLogbookCSV = exportLogbookCSV;

/* ==============================================================
 * JSON-VIENTI / PALAUTUS
 * ============================================================== */
async function exportLogbookJSON(options = {}) {
  const auditLog = (typeof getAuditLog === 'function') ? getAuditLog() : [];
  const payload = {
    _meta: {
      app: 'FlightDeck',
      schema: 'easa-logbook-v1',
      exported: new Date().toISOString(),
      entryCount: getLogbookEntries().length,
      auditEvents: auditLog.length,
      userAgent: navigator.userAgent
    },
    entries: getLogbookEntries(),
    auditLog
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });

  const today = new Date();
  const stamp = `${today.getFullYear()}-${
    String(today.getMonth() + 1).padStart(2, '0')}-${
    String(today.getDate()).padStart(2, '0')}`;
  const filename = options.filename || `EASA_Logbook_Backup_${stamp}.json`;

  if (typeof showModalLoader === 'function') {
    showModalLoader('Viedään varmuuskopio…', 'JSON');
  }
  try {
    const result = await saveBlobToDevice(blob, filename, 'application/json');
    if (typeof hideModalLoader === 'function') hideModalLoader();
    if (result !== 'cancelled' && typeof showToast === 'function') {
      showToast('Varmuuskopio valmis.', 'success');
    }
    return result;
  } catch (err) {
    if (typeof hideModalLoader === 'function') hideModalLoader();
    console.error('[JSON Export]', err);
    if (typeof showToast === 'function') showToast('Varmuuskopio epäonnistui.', 'error');
  }
}
window.exportLogbookJSON = exportLogbookJSON;

async function importLogbookJSON() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';

    input.addEventListener('change', async (ev) => {
      const file = ev.target.files?.[0];
      document.body.removeChild(input);
      if (!file) return resolve(false);

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data || !Array.isArray(data.entries)) {
          throw new Error('Tiedosto ei ole kelvollinen lokikirjan varmuuskopio.');
        }

        const confirmMsg = `
          <div style="font-size:14px; line-height:1.6;">
            <p>Varmuuskopiossa <b>${data.entries.length}</b> kirjausta${
              data._meta?.exported
                ? ` (viety ${new Date(data._meta.exported).toLocaleString()})`
                : ''
            }.</p>
            <p style="color:var(--warning); font-weight:600;">
              ⚠ Nykyinen lokikirja (${_lbReadAll().length} kirjausta) korvataan kokonaan.
            </p>
          </div>`;

        const proceed = await new Promise((res) => {
          let done = false;
          const finish = (v) => { if (!done) { done = true; res(v); } };
          createModal({
            title: 'Palauta varmuuskopiosta?',
            icon: '↺',
            bodyHTML: confirmMsg,
            confirmText: 'Palauta',
            cancelText: 'Peruuta',
            maxWidth: '560px',
            onConfirm: () => finish(true),
            onCancel:  () => finish(false)
          });
        });

        if (!proceed) return resolve(false);

        try {
          const backup = {
            _meta: { auto: true, at: new Date().toISOString(), reason: 'before-import' },
            entries: _lbReadAll()
          };
          localStorage.setItem('easa_logbook_autobackup_v1', JSON.stringify(backup));
        } catch (e) {}

        if (typeof dbReplaceAll === 'function' && window.dbReplaceAll) {
          console.log(`[JSON Import] Kirjoitetaan ${data.entries.length} kirjausta IndexedDB:hen`);
          dbReplaceAll(data.entries);
        } else {
          try {
            localStorage.setItem(LOGBOOK_STORAGE_KEY, JSON.stringify(data.entries));
          } catch (e) {
            console.warn('[JSON Import] localStorage täynnä:', e.message);
          }
        }

        if (Array.isArray(data.auditLog) && typeof saveAuditLog === 'function') {
          try { saveAuditLog(data.auditLog); } catch (e) {}
        }

        setTimeout(() => {
          if (typeof renderLogbookTable === 'function') renderLogbookTable();
          if (typeof renderChainStatusBadge === 'function') renderChainStatusBadge();
        }, 100);

        if (typeof showToast === 'function') {
          showToast(`Palautettu ${data.entries.length} kirjausta.`, 'success', 5000);
        }
        resolve(true);
      } catch (err) {
        console.error('[JSON Import]', err);
        if (typeof createModal === 'function') {
          createModal({
            title: 'Palautus epäonnistui',
            message: err.message || 'Tiedoston lukeminen ei onnistunut.',
            type: 'error',
            icon: '⚠️',
            confirmText: 'Sulje',
            compact: true
          });
        }
        resolve(false);
      }
    });

    document.body.appendChild(input);
    input.click();
  });
}
window.importLogbookJSON = importLogbookJSON;

/* ==============================================================
 * VIENTIMODAALI
 * ============================================================== */
function showExportDialog() {
  const entries = getLogbookEntries();
  const signed  = entries.filter(e => e.hash).length;
  const pending = entries.filter(e =>
    e.skyplan?.takeoffPending || e.skyplan?.landingPending
  ).length;
  const hasEntries = entries.length > 0;

  const item = (action, icon, title, desc, accent = null) => `
    <button type="button" data-action="${action}"
      style="display:flex; align-items:center; gap:12px; padding:11px 14px;
             background:var(--input);
             border:1px solid ${accent || 'var(--border)'};
             border-radius:10px; color:var(--text); text-align:left;
             cursor:pointer; transition:all 0.15s; width:100%;">
      <span style="font-size:20px; line-height:1;">${icon}</span>
      <span style="flex:1; min-width:0;">
        <span style="display:block; font-weight:700; font-size:13.5px; margin-bottom:2px;">${title}</span>
        <span style="font-size:11px; color:var(--dim); line-height:1.35;">${desc}</span>
      </span>
    </button>
  `;

  const sectionTitle = (t) => `
    <div style="font-size:10px; letter-spacing:1.5px; text-transform:uppercase;
                color:var(--dim); font-weight:700; margin:12px 0 6px 4px;">${t}</div>
  `;

  const scrollBody = `
    <div style="max-height:min(60vh, 480px); overflow-y:auto; padding-right:4px;
                display:flex; flex-direction:column; gap:6px;">

      ${hasEntries ? `
        <div style="font-size:12.5px; color:var(--dim); margin-bottom:2px;">
          <b style="color:var(--text);">${entries.length}</b> kirjausta
          · ${signed} sinetöity${pending
            ? ` · <b style="color:var(--warning);">${pending} odottaa</b>`
            : ''}
        </div>

        ${sectionTitle('Allekirjoitus')}
        ${item('sign-all', '✍️', 'Allekirjoita kaikki lennot',
          'Valitse kapteeni ja allekirjoita kaikki avoimet lentonsa.')}

        ${sectionTitle('Vienti')}
        ${item('csv',  '📊', 'CSV (Excel / Numbers)',
          'Kaikki 12 saraketta + audit-metadata.')}
        ${item('json', '💾', 'JSON-varmuuskopio',
          'Täysi palautus: allekirjoitukset, hash-ketju, audit-loki.')}
        ${item('pdf',  '⎙',  'PDF (EASA FCL.050)',
          'Lokikirja certification-allekirjoituksella.')}

        ${sectionTitle('Tuonti')}
      ` : `
        <div style="font-size:12.5px; color:var(--dim); padding:12px; text-align:center;
                    background:var(--input); border-radius:8px; margin-bottom:2px;">
          Lokikirja on tyhjä. Tuo lentoja tai palauta varmuuskopiosta.
        </div>
        ${sectionTitle('Tuonti')}
      `}
      ${item('csv-import', '📥', 'Tuo CSV',
        'Yhdistä tai korvaa nykyinen lokikirja CSV-tiedostosta.')}
      ${item('restore', '↺', 'Palauta varmuuskopiosta',
        'JSON-tiedostosta. Korvaa nykyisen datan.',
        'rgba(255,179,0,0.3)')}
    </div>
  `;

  createModal({
    title: 'Toiminnot',
    icon: '⚙',
    bodyHTML: scrollBody,
    confirmText: 'Sulje',
    maxWidth: '520px',
    onConfirm: () => {}
  });

  setTimeout(() => {
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        const modal = btn.closest('div[style*="position: fixed"]');
        if (modal) modal.remove();

        switch (action) {
          case 'sign-all':   await signAllFlightsForPilot();             break;
          case 'csv':        await exportLogbookCSV();                   break;
          case 'json':       await exportLogbookJSON();                  break;
          case 'pdf':        await saveLogbookPDF(window._lbEntries || []); break;
          case 'csv-import': await importLogbookFromCSV();               break;
          case 'restore':    await importLogbookJSON();                  break;
        }
      });
    });
  }, 30);
}
window.showExportDialog = showExportDialog;


/* ==============================================================
 * CSV-TUONTI
 * ============================================================== */
function _parseCSV(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }

    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === delimiter) { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') {
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = []; i++; continue;
    }
    field += c; i++;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function _detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const semis = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return semis >= commas ? ';' : ',';
}

function _normalizeDateCSV(raw) {
  if (!raw) return '';
  const s = String(raw).trim();

  if (/^\d{4,5}$/.test(s)) {
    const days = parseInt(s, 10);
    const ms = (days - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (!isNaN(d)) {
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    }
  }

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;

  m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;

  m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2})$/);
  if (m) return `20${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;

  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;

  return s;
}

function _normalizeTimeCSV(raw) {
  if (!raw) return '';
  const s = String(raw).trim();

  let m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return `${m[1].padStart(2,'0')}:${m[2]}`;

  if (/^0\.\d+$/.test(s)) {
    const frac = parseFloat(s);
    const totalMins = Math.round(frac * 24 * 60);
    const h = Math.floor(totalMins / 60);
    const mi = totalMins % 60;
    return `${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}`;
  }

  if (/^\d{3,4}$/.test(s)) {
    const n = parseInt(s, 10);
    const h = Math.floor(n / 100);
    const mi = n % 100;
    if (h < 24 && mi < 60) return `${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}`;
  }

  return s;
}

function _buildHeaderMap(headers) {
  const H = headers.map(h => String(h || '').trim().toUpperCase().replace(/[.\s,()]+/g, ' ').trim());

  const exact = (name) => H.findIndex(h => h === name.toUpperCase());
  const find = (patterns) => {
    for (let i = 0; i < H.length; i++) {
      for (const p of patterns) {
        if (H[i].includes(p)) return i;
      }
    }
    return -1;
  };
  const findAll = (pattern) => {
    const out = [];
    for (let i = 0; i < H.length; i++) {
      if (H[i].includes(pattern)) out.push(i);
    }
    return out;
  };

  const airports = findAll('AIRPORT');
  const times = findAll('TIME');
  const days = findAll('DAY');
  const nights = findAll('NIGHT');
  const pics = findAll('PIC');

  let spSE = exact('SE');
  if (spSE < 0) spSE = find(['SINGLE PILOT SE', 'SINGLE-PILOT SE']);
  let spME = exact('ME');
  if (spME < 0) spME = find(['SINGLE PILOT ME', 'SINGLE-PILOT ME']);

  return {
    date:        find(['DATE', 'PVM', 'PÄIVÄ']),
    depPlace:    airports[0] ?? find(['DEPARTURE AIRPORT', 'DEP PLACE', 'LÄHTÖPAIKKA']),
    depTime:     times[0]    ?? find(['DEPARTURE TIME', 'DEP TIME', 'LÄHTÖAIKA']),
    arrPlace:    airports[1] ?? find(['ARRIVAL AIRPORT', 'ARR PLACE', 'SAAPUMISPAIKKA']),
    arrTime:     times[1]    ?? find(['ARRIVAL TIME', 'ARR TIME', 'SAAPUMISAIKA']),
    acMake:      find(['MAKE', 'AIRCRAFT MAKE']),
    acModel:     find(['MODEL']),
    acVariant:   find(['VARIANT']),
    acReg:       find(['REGISTRATION', 'AIRCRAFT REG', ' REG']),
    spSE, spME,
    multi:       find(['MULTI PILOT', 'MULTI-PILOT']),
    total:       find(['TOTAL TIME', 'KOKONAISLENTOAIKA']),
    pic:         pics[0] ?? -1,
    pfPIC:       pics[1] ?? -1,
    tkDay:       days[0] ?? find(['TAKEOFF DAY']),
    tkNight:     nights[0] ?? find(['TAKEOFF NIGHT']),
    ldDay:       days[1] ?? find(['LANDING DAY']),
    ldNight:     nights[1] ?? find(['LANDING NIGHT']),
    pfCO:        find(['CO PILOT', 'CO-PILOT', 'COPILOT']),
    pfDual:      find(['DUAL']),
    pfInst:      find(['INSTRUCTOR']),
    night:       nights[2] ?? find(['NIGHT FLYING', 'NIGHT TIME']),
    ifr:         find(['IFR']),
    fstdDate:    find(['SIMULATOR DATE', 'FSTD DATE']),
    fstdType:    find(['SIMULATOR TYPE', 'FSTD TYPE']),
    fstdTime:    find(['SIMULATOR TIME', 'FSTD TOTAL', 'FSTD TIME']),
    remarks:     find(['REMARKS', 'HUOMAUTUKSET', 'ENDORS'])
  };
}

function _rowToEntry(row, map, lineNum, prevDate = '') {
  const get = (idx) => idx >= 0 ? String(row[idx] || '').trim() : '';

  let date = _normalizeDateCSV(get(map.date));
  if (!date) date = prevDate;
  if (!date) return null;

  const depPlace = get(map.depPlace).toUpperCase();
  const arrPlace = get(map.arrPlace).toUpperCase();
  const hasFlight = depPlace || arrPlace;

  const acField = get(map.acMake);
  const acReg   = get(map.acReg);
  const simType = get(map.fstdType);
  const simTime = get(map.fstdTime);

  const FSTD_KEYWORDS = /FNPT|FTD|FSTD|SIMULATOR|\bSIM\b|DA42\s+FNPT|SYNTHETIC|DEVICE|FFS|BITD|IPT/i;
  const looksLikeFSTD = FSTD_KEYWORDS.test(acField)
                     || FSTD_KEYWORDS.test(acReg)
                     || FSTD_KEYWORDS.test(simType)
                     || FSTD_KEYWORDS.test(simTime);

  const isFSTD = !hasFlight && (
    looksLikeFSTD ||
    (simType && simTime) ||
    (get(map.depTime) && get(map.arrTime) && acField)
  );

  const entry = createLogbookEntry();
  entry.date = date;

  if (isFSTD) {
    const startTime = _normalizeTimeCSV(get(map.depTime));
    const endTime   = _normalizeTimeCSV(get(map.arrTime));

    let durationHHMM = '';
    if (startTime && endTime) {
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      let diff = (eh * 60 + em) - (sh * 60 + sm);
      if (diff < 0) diff += 24 * 60;
      if (diff > 0) durationHHMM = `${Math.floor(diff / 60)}:${String(diff % 60).padStart(2, '0')}`;
    }

    let fstdType = simType || acField || '';
    if (acReg && !fstdType.includes(acReg)) {
      fstdType = fstdType ? `${fstdType} / ${acReg}` : acReg;
    }
    if (!fstdType && acField) fstdType = acField;

    entry.fstd = {
      date: date,
      type: fstdType || 'FSTD',
      totalTime: simTime || durationHHMM || ''
    };

    entry.picName = get(map.pic);
    entry.remarks = get(map.remarks);

    entry.skyplan = {
      flightId: null,
      flightNumber: '',
      importedAt: new Date().toISOString(),
      atd: null, ata: null, takeoff: null, touchdown: null,
      blockTime: null, flightTime: null,
      source: 'csv-import',
      csvLine: lineNum,
      isFSTD: true
    };

    return entry;
  }

  if (!hasFlight) return null;

  entry.departure = {
    place: depPlace,
    time: _normalizeTimeCSV(get(map.depTime))
  };
  entry.arrival = {
    place: arrPlace,
    time: _normalizeTimeCSV(get(map.arrTime))
  };

  entry.aircraft = {
    make: acField,
    model: '',
    variant: '',
    registration: acReg.toUpperCase()
  };

  entry.singlePilot = { se: get(map.spSE), me: get(map.spME) };
  entry.multiPilot = get(map.multi);
  entry.totalTimeOfFlight = get(map.total);
  entry.picName = get(map.pic);

  entry.takeoffs = {
    day:   parseInt(get(map.tkDay), 10) || 0,
    night: parseInt(get(map.tkNight), 10) || 0
  };
  entry.landings = {
    day:   parseInt(get(map.ldDay), 10) || 0,
    night: parseInt(get(map.ldNight), 10) || 0
  };

  entry.operationalCondition = {
    night: get(map.night),
    ifr: get(map.ifr)
  };
  entry.pilotFunction = {
    pic: get(map.pfPIC),
    copilot: get(map.pfCO),
    dual: get(map.pfDual),
    instructor: get(map.pfInst)
  };

  entry.fstd = {
    date: get(map.fstdDate),
    type: get(map.fstdType),
    totalTime: get(map.fstdTime)
  };

  entry.remarks = get(map.remarks);

  entry.skyplan = {
    flightId: null,
    flightNumber: '',
    importedAt: new Date().toISOString(),
    atd: null, ata: null, takeoff: null, touchdown: null,
    blockTime: null, flightTime: null,
    source: 'csv-import',
    csvLine: lineNum
  };

  return entry;
}

async function importLogbookFromCSV() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.style.display = 'none';

    input.addEventListener('change', async (ev) => {
      const file = ev.target.files?.[0];
      document.body.removeChild(input);
      if (!file) return resolve(false);

      try {
        let text = await file.text();
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

        const delimiter = _detectDelimiter(text);
        console.log('[CSV Import] Tiedosto:', file.name, '| erotin:', delimiter);

        const rows = _parseCSV(text, delimiter);
        if (!rows.length) throw new Error('Tiedosto on tyhjä');

        let headerIdx = 0;
        for (let i = 0; i < Math.min(5, rows.length); i++) {
          if (rows[i].length > 3) { headerIdx = i; break; }
        }
        const headers = rows[headerIdx];
        console.log('[CSV Import] Headerit:', headers);

        const map = _buildHeaderMap(headers);
        console.log('[CSV Import] Header-map:', map);

        if (map.date === -1) {
          throw new Error('Päivämääräsaraketta ei löytynyt.');
        }

        const entries = [];
        const skipped = [];
        let lastDate = '';

        for (let i = headerIdx + 1; i < rows.length; i++) {
          const entry = _rowToEntry(rows[i], map, i + 1, lastDate);
          if (entry) {
            entries.push(entry);
            lastDate = entry.date;
          } else {
            const nonEmpty = rows[i].filter(c => c && c.trim());
            if (nonEmpty.length > 0) {
              skipped.push({ line: i + 1, preview: nonEmpty.slice(0, 4).join(' | ') });
            }
          }
        }

        console.log('[CSV Import] Löytyi', entries.length, 'kirjausta');
        console.log('[CSV Import] Hylätty', skipped.length, 'riviä');

        if (skipped.length) {
          console.log('[CSV Import] --- Hylätyt rivit ---');
          skipped.slice(0, 30).forEach(s =>
            console.log(`  rivi ${s.line}: "${s.preview}"`)
          );
          if (skipped.length > 30) {
            console.log(`  … ja ${skipped.length - 30} muuta`);
          }
        }

        if (!entries.length) {
          throw new Error('Ei kelvollisia rivejä. Katso konsolin "Hylätyt rivit" -lista.');
        }

        const existing = getLogbookEntries().length;
        const bodyHTML = `
          <div style="font-size:13px; color:var(--dim); line-height:1.6;">
            <p style="color:var(--text); font-size:15px; font-weight:700; margin-bottom:12px;">
              ${entries.length} kirjausta löytyi
            </p>
            ${skipped.length ? `
              <p style="color:var(--warning); font-size:12px; margin-bottom:12px;">
                ⚠ ${skipped.length} riviä hylättiin. Katso konsolista syyt.
              </p>
            ` : ''}
            <div class="kv"><span>Nykyinen lokikirja</span><span>${existing} kirjausta</span></div>
            <div class="kv"><span>Tuotavat rivit</span><span>${entries.length} kirjausta</span></div>
          </div>
        `;

        const proceed = await new Promise((res) => {
          let done = false;
          const finish = (v) => { if (!done) { done = true; res(v); } };
          createModal({
            title: 'Tuo lokikirja CSV:stä',
            icon: '📥',
            bodyHTML,
            confirmText: 'Yhdistä',
            cancelText: 'Korvaa kaikki',
            maxWidth: '520px',
            onConfirm: () => finish('merge'),
            onCancel: () => finish('replace')
          });
          setTimeout(() => {
            const d = document.querySelector('div[style*="position: fixed"]');
            if (!d) return;
            const cancelBtn = d.querySelector('#modal-cancel');
            if (cancelBtn) {
              cancelBtn.style.background = 'rgba(255,69,58,0.15)';
              cancelBtn.style.color = 'var(--error)';
              cancelBtn.style.borderColor = 'var(--error)';
            }
          }, 30);
        });

        try {
          localStorage.setItem('easa_logbook_backup_before_csv',
            localStorage.getItem(LOGBOOK_STORAGE_KEY) || '[]');
        } catch (e) {}

        if (proceed === 'replace') {
          _lbWriteAll(entries);
          if (typeof showToast === 'function') {
            showToast(`Korvattu ${entries.length} kirjauksella.`, 'success', 5000);
          }
        } else {
          const list = _lbReadAll();
          const existingKeys = new Set(list.map(e =>
            `${e.date}|${e.departure?.place}|${e.departure?.time}|${e.arrival?.place}|${e.arrival?.time}`
          ));
          let added = 0, dupes = 0;
          entries.forEach(e => {
            const key = `${e.date}|${e.departure?.place}|${e.departure?.time}|${e.arrival?.place}|${e.arrival?.time}`;
            if (existingKeys.has(key)) { dupes++; return; }
            list.push(e);
            added++;
          });
          _lbWriteAll(list);
          if (typeof showToast === 'function') {
            showToast(`Lisätty ${added} uutta (${dupes} duplikaattia ohitettu).`, 'success', 5000);
          }
        }

        if (typeof renderLogbookTable === 'function') renderLogbookTable();
        if (typeof renderChainStatusBadge === 'function') renderChainStatusBadge();
        resolve(true);

      } catch (err) {
        console.error('[CSV Import]', err);
        if (typeof createModal === 'function') {
          createModal({
            title: 'Tuonti epäonnistui',
            message: err.message || 'Tiedoston lukeminen ei onnistunut.',
            type: 'error',
            icon: '⚠️',
            confirmText: 'Sulje',
            compact: true
          });
        }
        resolve(false);
      }
    });

    document.body.appendChild(input);
    input.click();
  });
}
window.importLogbookFromCSV = importLogbookFromCSV;

/* ==============================================================
 * HTML-ESC · apuri
 * ============================================================== */
function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
window._esc = _esc;

/* ==============================================================
 * SKYPLAN SYNC · journey-log -päivitys kuukausittain
 * ============================================================== */
async function syncLogbookWithSkyplan(options = {}) {
  const {
    apply = false,
    verbose = true,
    fromMonth = null,
    toMonth = null,
    delayMs = 120,
    monthDelayMs = 3000,
    matchRoster = true,
    onlyPending = false,
    showLoader = true,
    forceFullScan = false,
    skipFreshHours = 24,
    maxLookbackMonths = 3        // ← UUSI: älä skannaa yli 12 kk taakse
  } = options;

  const allEntries = _lbReadAll();
  if (!allEntries.length) {
    if (typeof showToast === 'function') showToast('Ei kirjauksia.', 'info');
    return { total: 0, processed: 0, changed: 0, skipped: 0, errors: 0 };
  }

  const now = new Date();
  const defaultTo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const to = toMonth || defaultTo;

  /* ============================================================
   * 1. Laske aikaisin sallittu kuukausi
   * ============================================================ */
  let effectiveFrom = fromMonth;
  if (!effectiveFrom) {
    const entryMonths = allEntries
      .map(e => (e.date || '').slice(0, 7))
      .filter(d => /^\d{4}-\d{2}$/.test(d))
      .sort();
    effectiveFrom = entryMonths[0] || '2024-01';
  }

  // Rajoita maxLookbackMonths-taakse
  if (maxLookbackMonths != null && maxLookbackMonths > 0) {
    const limit = new Date(now.getFullYear(), now.getMonth() - maxLookbackMonths, 1);
    const limitStr = `${limit.getFullYear()}-${String(limit.getMonth() + 1).padStart(2, '0')}`;
    if (effectiveFrom < limitStr) {
      effectiveFrom = limitStr;
    }
  }

  /* ============================================================
   * 2. Ryhmittele entries kuukausittain (kerran, O(n))
   * ============================================================ */
  const entriesByMonth = new Map();
  for (const e of allEntries) {
    const m = (e.date || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(m)) continue;
    if (!entriesByMonth.has(m)) entriesByMonth.set(m, []);
    entriesByMonth.get(m).push(e);
  }

  /* ============================================================
   * 3. Generoi kuukausilista
   * ============================================================ */
  const allMonths = [];
  let [fy, fm] = effectiveFrom.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (fy < ty || (fy === ty && fm <= tm)) {
    allMonths.push(`${fy}-${String(fm).padStart(2, '0')}`);
    fm++;
    if (fm > 12) { fm = 1; fy++; }
  }

  /* ============================================================
   * 4. Suodata kuukaudet jotka oikeasti tarvitsevat synkkausta
   * ============================================================ */
  const FRESH_MS = skipFreshHours * 60 * 60 * 1000;
  const now_ms = Date.now();
  const monthsToProcess = [];

  for (const month of allMonths) {
    const monthEntries = entriesByMonth.get(month) || [];
    if (!monthEntries.length) continue;

    const hasPending = monthEntries.some(e =>
      e.skyplan?.takeoffPending || e.skyplan?.landingPending
    );
    const hasUnmatched = monthEntries.some(e => !e.skyplan?.flightId);

    if (onlyPending && !hasPending) continue;

    // forceFullScan ohittaa 24h-tarkistuksen, mutta EI API-lookbackia
    // (API ei palauta dataa yli 12 kk taakse, joten sen vanhempien
    //  kuukausien skannaaminen on turhaa)
    if (!forceFullScan && !hasPending && !hasUnmatched) {
      const timestamps = monthEntries
        .map(e => e.skyplan?.lastCheckedAt || e.skyplan?.lastSyncedAt)
        .filter(Boolean)
        .map(t => new Date(t).getTime())
        .filter(t => isFinite(t));

      if (timestamps.length === monthEntries.length) {
        const newestCheck = Math.max(...timestamps);
        if (now_ms - newestCheck < FRESH_MS) continue;
      }
    }

    monthsToProcess.push({
      month,
      entries: monthEntries,
      needsRoster: hasUnmatched && matchRoster
    });
  }


  if (!monthsToProcess.length) {
    if (typeof showToast === 'function') {
      showToast('Lokikirja ajan tasalla', 'success', 4000);
    }
    return { total: allEntries.length, processed: 0, changed: 0, skipped: 0, errors: 0 };
  }

  /* ============================================================
   * 5. Token
   * ============================================================ */
  const token = (typeof getValidSkyplanToken === 'function')
    ? await getValidSkyplanToken().catch(() => null) : null;
  if (!token) {
    console.error('[Logbook Sync] Token puuttuu.');
    return { total: allEntries.length, processed: 0, changed: 0, skipped: 0, errors: 0 };
  }

  let empId = null;
  try {
    const p = decodeJWT(token) || {};
    empId = p.employeeid || p.EmployeeID || p.employeeId || p.nameid || p.sub;
  } catch (e) {}

  /* ============================================================
   * 6. Käy läpi kuukaudet
   * ============================================================ */
  const stats = {
    total: allEntries.length,
    matched: 0, processed: 0, changed: 0, skipped: 0, errors: 0
  };
  const changes = [];

  for (let mi = 0; mi < monthsToProcess.length; mi++) {
    const { month, entries: monthEntries, needsRoster } = monthsToProcess[mi];

    if (showLoader && typeof showModalLoader === 'function') {
      showModalLoader('Synkronoidaan Skyplanista…',
        `Kuukausi ${month} (${mi + 1} / ${monthsToProcess.length})`);
    }

    let roster = [];
    if (needsRoster && empId) {
      try {
        roster = await _fetchRosterForMonth(token, empId, month);
        
        // Jos API palautti 0 → älä yritä uudelleen samalle kuukaudelle
        if (roster.length === 0 && verbose) {
          console.log(`[Logbook Sync] ${month}: API ei palauttanut dataa (yli 12 kk vanha?)`);
        }
      } catch (e) {
        console.warn(`[Logbook Sync] ${month}: roster-haku epäonnistui:`, e.message);
        stats.errors++;
      }
    }

    for (const entry of monthEntries) {
      if (!entry.skyplan?.flightId && roster.length) {
        const match = _matchEntryToRosterFlight(entry, roster);
        if (match) {
          if (!entry.skyplan) entry.skyplan = {};
          entry.skyplan.flightId = String(match.ID || match.id || match.FlightID || '');
          entry.skyplan.flightNumber = String(match.FlightNumber || '');
          entry.skyplan.matchedFromRoster = true;
          stats.matched++;
        }
      }

      if (entry.skyplan?.flightId) {
        try {
          const log = await fetchJourneyLog(entry.skyplan.flightId, token);
          stats.processed++;
          const diffs = _compareLogbookEntryWithLog(entry, log);
          if (diffs.length > 0) changes.push({ entry, log, diffs });

          if (!entry.skyplan) entry.skyplan = {};
          entry.skyplan.lastCheckedAt = new Date().toISOString();
        } catch (e) {
          stats.errors++;
          if (verbose) {
            const msg = String(e?.message || '');
            const isAuthIssue = msg.includes('token missing') || msg.includes('token expired')
                             || msg.includes('authentication rejected');
            const isNotAvailable = msg.includes('422') || msg.includes('not available')
                                || msg.includes('not been completed');
            if (!isAuthIssue && !isNotAvailable) {
              console.warn(`[Logbook Sync] ${entry.skyplan.flightId}:`, e.message);
            }
          }
        }
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    if (mi < monthsToProcess.length - 1) {
      await new Promise(r => setTimeout(r, monthDelayMs));
    }
  }

  /* ============================================================
   * 7. Tallenna kaikki kerralla
   * ============================================================ */
  _lbWriteAll(allEntries);

  if (showLoader && typeof hideModalLoader === 'function') hideModalLoader();

  stats.changed = changes.length;
  stats.skipped = stats.processed - stats.changed;

  if (changes.length === 0) {
    if (typeof showToast === 'function') {
      showToast(`Lisätty ${stats.matched} uutta lentoa lokikirjaan`,
        'success', 5000);
    }
    return stats;
  }

  if (verbose) {
    changes.forEach((c, i) => {
      const flt = c.entry.skyplan?.flightNumber || c.entry.date || '?';
      console.log(`  #${i + 1} ${flt} (${c.entry.date})`);
      c.diffs.forEach(d => console.log(`     ${d.label}: "${d.old}" → "${d.new}"`));
    });
  }

  if (!apply) {
    return await _promptLogbookSyncConfirmation(changes, stats);
  }

  _applyLogbookChanges(changes);
  if (typeof showToast === 'function') {
    showToast(`Päivitetty ${changes.length} kirjausta.`, 'success', 5000);
  }
  return stats;
}
window.syncLogbookWithSkyplan = syncLogbookWithSkyplan;

function _compareLogbookEntryWithLog(entry, log) {
  const diffs = [];

  const check = (label, oldVal, newVal, field) => {
    const o = String(oldVal ?? '').trim();
    const n = String(newVal ?? '').trim();
    if (!n) return;
    if (o === n) return;
    if (field === 'picName' && o && o.length > 0 && n.length < 3) return;
    diffs.push({ label, field, old: o || '–', new: n });
  };

  if (log.atd) check('ATD', entry.departure?.time, hhmmFromIso(log.atd), 'departure.time');
  if (log.ata) check('ATA', entry.arrival?.time, hhmmFromIso(log.ata), 'arrival.time');
  if (log.blockTime) {
    check('Total time', entry.totalTimeOfFlight, blockToHHMM(log.blockTime), 'totalTimeOfFlight');
  }
  if (log.takeoff || log.atd) {
    check('Päivämäärä', entry.date, yyyymmddFromIso(log.takeoff || log.atd), 'date');
  }

  const crew = (typeof parseCrewFromJourneyLog === 'function')
    ? parseCrewFromJourneyLog(log) : null;
  if (crew?.pic?.name) check('PIC', entry.picName, crew.pic.name, 'picName');

  const raw = log.raw || {};
  const fo = raw.FlightOps || {};
  const tkId = fo.TakeOffCapStaffID ?? raw.TakeOffCapStaffID ?? 0;
  const ldId = fo.LandingCapStaffID ?? raw.LandingCapStaffID ?? 0;

  const hasTk = tkId && String(tkId) !== '0';
  const hasLd = ldId && String(ldId) !== '0';

  let myId = null;
  try {
    const token = localStorage.getItem('skyplan_token');
    const p = decodeJWT(token) || {};
    myId = String(p.employeeid || p.EmployeeID || p.employeeId || p.nameid || p.sub || '');
  } catch (e) {}

  /* Vahvista VAIN jos Skyplan toimitti oikean staff-ID:n. Muuten pysyy pending. */
  if (entry.skyplan?.takeoffPending && hasTk && myId) {
    const myTk = String(tkId) === myId;
    const curD = Number(entry.takeoffs?.day)   || 0;
    const curN = Number(entry.takeoffs?.night) || 0;
    const tkIsNight = !!(log.takeoff && isNight(log.takeoff, entry.departure?.place));
    const newD = myTk ? (tkIsNight ? 0 : 1) : 0;
    const newN = myTk ? (tkIsNight ? 1 : 0) : 0;
    diffs.push({
      label: (curD === newD && curN === newN) ? 'Takeoff vahvistettu' : 'Takeoff',
      field: 'takeoffCredit',
      old: `${curD}/${curN}`, new: `${newD}/${newN}`,
      newValues: { day: newD, night: newN }
    });
  }

  if (entry.skyplan?.landingPending && hasLd && myId) {
    const myLd = String(ldId) === myId;
    const curD = Number(entry.landings?.day)   || 0;
    const curN = Number(entry.landings?.night) || 0;
    const ldIsNight = !!(log.touchdown && isNight(log.touchdown, entry.arrival?.place));
    const newD = myLd ? (ldIsNight ? 0 : 1) : 0;
    const newN = myLd ? (ldIsNight ? 1 : 0) : 0;
    diffs.push({
      label: (curD === newD && curN === newN) ? 'Landing vahvistettu' : 'Landing',
      field: 'landingCredit',
      old: `${curD}/${curN}`, new: `${newD}/${newN}`,
      newValues: { day: newD, night: newN }
    });
  }

  return diffs;
}

async function _promptLogbookSyncConfirmation(changes, stats) {
  return new Promise((resolve) => {
    const items = changes.slice(0, 20).map((c, i) => {
      const flt = c.entry.skyplan?.flightNumber || '?';
      const diffs = c.diffs.map(d =>
        `<div style="font-size:12px; color:var(--dim); margin-left:16px; font-family:var(--font-mono);">
          ${_esc(d.label)}: <span style="color:var(--error); text-decoration:line-through;">${_esc(d.old)}</span>
          → <span style="color:var(--success); font-weight:600;">${_esc(d.new)}</span>
        </div>`
      ).join('');
      return `
        <div style="padding:10px 12px; background:var(--input); border-radius:8px; margin-bottom:8px;">
          <div style="font-size:13px; font-weight:700; color:var(--accent);">
            ${_esc(flt)} · ${_esc(c.entry.date || '')}
          </div>
          ${diffs}
        </div>`;
    }).join('');

    const more = changes.length > 20
      ? `<div style="text-align:center; color:var(--dim); font-size:12px; margin-top:8px;">
           … ja ${changes.length - 20} muuta
         </div>`
      : '';

    const bodyHTML = `
      <div style="font-size:13px; line-height:1.5; margin-bottom:12px;">
        <p style="color:var(--text); font-weight:600; margin-bottom:8px;">
          ${changes.length} kirjausta tarvitsee päivityksen
        </p>
        <div style="font-size:11.5px; color:var(--dim); margin-bottom:12px;">
          Käsitelty: ${stats.processed} · Muuttunut: ${changes.length} · Virheet: ${stats.errors}
        </div>
      </div>
      <div style="max-height:340px; overflow-y:auto; margin-bottom:12px;">
        ${items}
        ${more}
      </div>
      <p style="font-size:11.5px; color:var(--warning); margin-bottom:0;">
        ⚠ Muutokset ylikirjoittavat nykyiset arvot. Varmuuskopio otetaan automaattisesti.
      </p>
    `;

    createModal({
      title: 'Päivitä lokikirja Skyplanista?',
      icon: '⟳',
      bodyHTML,
      confirmText: 'Päivitä',
      cancelText: 'Peruuta',
      maxWidth: '640px',
      onConfirm: () => {
        _applyLogbookChanges(changes);
        if (typeof showToast === 'function') {
          showToast(`Päivitetty ${changes.length} kirjausta.`, 'success', 5000);
        }
        resolve(stats);
      },
      onCancel: () => resolve(stats)
    });
  });
}

function _applyLogbookChanges(changes) {
  try {
    localStorage.setItem('easa_logbook_backup_before_sync',
      JSON.stringify({ at: new Date().toISOString(), entries: _lbReadAll() }));
  } catch (e) {}

  const list = _lbReadAll();
  const byId = new Map(list.map(e => [e.id, e]));

  changes.forEach(c => {
    const entry = byId.get(c.entry.id);
    if (!entry) return;

    c.diffs.forEach(d => {
      switch (d.field) {
        case 'departure.time':
          if (!entry.departure) entry.departure = { place: '', time: '' };
          entry.departure.time = d.new;
          break;
        case 'arrival.time':
          if (!entry.arrival) entry.arrival = { place: '', time: '' };
          entry.arrival.time = d.new;
          break;
        case 'totalTimeOfFlight':
          entry.totalTimeOfFlight = d.new;
          break;
        case 'date':
          entry.date = d.new;
          break;
        case 'picName':
          entry.picName = d.new;
          break;
        case 'takeoffCredit':
          if (!entry.takeoffs) entry.takeoffs = { day: 0, night: 0 };
          entry.takeoffs.day   = d.newValues?.day   ?? 0;
          entry.takeoffs.night = d.newValues?.night ?? 0;
          if (entry.skyplan) entry.skyplan.takeoffPending = false;
          break;
        case 'landingCredit':
          if (!entry.landings) entry.landings = { day: 0, night: 0 };
          entry.landings.day   = d.newValues?.day   ?? 0;
          entry.landings.night = d.newValues?.night ?? 0;
          if (entry.skyplan) entry.skyplan.landingPending = false;
          break;
      }
    });

    if (!entry.skyplan) entry.skyplan = {};
    entry.skyplan.lastSyncedAt = new Date().toISOString();
  });

  _lbWriteAll(list);
  if (typeof renderLogbookTable === 'function') renderLogbookTable();
  if (typeof renderChainStatusBadge === 'function') renderChainStatusBadge();
}

async function _fetchRosterForMonth(token, employeeId, month) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const last  = new Date(y, m, 0);
  const fmt = (d) => `${d.getFullYear()}-${
    String(d.getMonth() + 1).padStart(2, '0')}-${
    String(d.getDate()).padStart(2, '0')}`;

  const resp = await fetch(
    'https://kcskyplanapi.airastana.com/api/v1/crew-roster-flights-details',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        EmployeeID: String(employeeId),
        From: fmt(first),
        To: fmt(last)
      })
    }
  );

  if (!resp.ok) {
    if (resp.status === 403 || resp.status === 404) return [];
    throw new Error(`HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return Array.isArray(data.Flights) ? data.Flights : [];
}

function _matchEntryToRosterFlight(entry, roster) {
  if (!entry || !roster?.length) return null;

  const entryDate = String(entry.date || '').trim();
  if (!entryDate) return null;

  const entryFlightNum = String(entry.skyplan?.flightNumber || '').replace(/\D/g, '');
  const entryDep = String(entry.departure?.place || '').toUpperCase();
  const entryArr = String(entry.arrival?.place   || '').toUpperCase();

  const strict = roster.find(f => {
    const fDate = String(f.StdLt || f.Std || '').split('T')[0];
    if (fDate !== entryDate) return false;

    const fNum = String(f.FlightNumber || '').replace(/\D/g, '');
    if (entryFlightNum && fNum && entryFlightNum !== fNum) return false;

    const fDep = String(f.DepartureStationIcaoCode || f.DepartureStationCode || '').toUpperCase();
    const fArr = String(f.ArrivalStationIcaoCode   || f.ArrivalStationCode   || '').toUpperCase();

    return fDep === entryDep && fArr === entryArr;
  });
  if (strict) return strict;

  if (!entryFlightNum) {
    return roster.find(f => {
      const fDate = String(f.StdLt || f.Std || '').split('T')[0];
      if (fDate !== entryDate) return false;
      const fDep = String(f.DepartureStationIcaoCode || f.DepartureStationCode || '').toUpperCase();
      const fArr = String(f.ArrivalStationIcaoCode   || f.ArrivalStationCode   || '').toUpperCase();
      return fDep === entryDep && fArr === entryArr;
    }) || null;
  }

  return null;
}

/* ==============================================================
 * NIGHT TIME RECALC
 * ============================================================== */
async function recalculateNightTimes(options = {}) {
  const {
    apply = false,
    verbose = true,
    onlyMissing = false,
    updateCounters = true,
    skipSameIcao = true,
    skipMultiLeg = true
  } = options;

  if (typeof SunCalc === 'undefined') {
    console.error('[Night Recalc] SunCalc ei ole ladattu.');
    if (typeof showToast === 'function') showToast('SunCalc puuttuu.', 'error');
    return;
  }

  const entries = _lbReadAll();
  if (!entries.length) {
    console.log('[Night Recalc] Ei kirjauksia.');
    return { total: 0, changed: 0, skipped: 0 };
  }

  const stats = {
    total: entries.length,
    changed: 0,
    skipped: 0,
    reason: {
      fstd: 0, sameIcao: 0, multiLeg: 0,
      noIcao: 0, noTime: 0, noCoords: 0,
      noChange: 0, missingOnly: 0
    }
  };
  const changes = [];

  console.log(`[Night Recalc] Käydään läpi ${entries.length} kirjausta...`);

  for (const entry of entries) {
    if (entry.skyplan?.isFSTD || (entry.fstd?.totalTime && !entry.departure?.place)) {
      stats.skipped++; stats.reason.fstd++; continue;
    }
    if (onlyMissing && entry.operationalCondition?.night) {
      stats.skipped++; stats.reason.missingOnly++; continue;
    }

    const dep = String(entry.departure?.place || '').toUpperCase();
    const arr = String(entry.arrival?.place   || '').toUpperCase();

    if (skipSameIcao && dep && arr && dep === arr) {
      stats.skipped++; stats.reason.sameIcao++; continue;
    }

    const curTkD = Number(entry.takeoffs?.day)   || 0;
    const curTkN = Number(entry.takeoffs?.night) || 0;
    const curLdD = Number(entry.landings?.day)   || 0;
    const curLdN = Number(entry.landings?.night) || 0;
    const curTkTotal = curTkD + curTkN;
    const curLdTotal = curLdD + curLdN;

    if (!dep || !arr || dep.length !== 4 || arr.length !== 4) {
      stats.skipped++; stats.reason.noIcao++; continue;
    }
    if (!_icaoCoords(dep) || !_icaoCoords(arr)) {
      stats.skipped++; stats.reason.noCoords++; continue;
    }

    const takeoffIso  = _recalcCombineDateTime(entry, 'departure');
    const touchdownIso = _recalcCombineDateTime(entry, 'arrival');
    if (!takeoffIso || !touchdownIso) {
      stats.skipped++; stats.reason.noTime++; continue;
    }

    let result;
    try {
      result = calculateNightTime(takeoffIso, touchdownIso, dep, arr);
    } catch (e) {
      stats.skipped++; stats.reason.noTime++; continue;
    }
    if (!result) { stats.skipped++; stats.reason.noTime++; continue; }

    const newNight = result.night || '';
    const curNight = entry.operationalCondition?.night || '';
    const nightChanged = curNight !== newNight;

    const sunTkD = result.nightTakeoff ? 0 : 1;
    const sunTkN = result.nightTakeoff ? 1 : 0;
    const sunLdD = result.nightLanding ? 0 : 1;
    const sunLdN = result.nightLanding ? 1 : 0;

    const canUpdateTakeoffs = updateCounters && curTkTotal === 1;
    const canUpdateLandings = updateCounters && curLdTotal === 1;

    let countersChanged = false;
    const counterDiffs = [];

    if (canUpdateTakeoffs) {
      if (curTkD !== sunTkD) {
        countersChanged = true;
        counterDiffs.push({ label: 'Takeoff day', old: curTkD, new: sunTkD, field: 'tkD' });
      }
      if (curTkN !== sunTkN) {
        countersChanged = true;
        counterDiffs.push({ label: 'Takeoff night', old: curTkN, new: sunTkN, field: 'tkN' });
      }
    }
    if (canUpdateLandings) {
      if (curLdD !== sunLdD) {
        countersChanged = true;
        counterDiffs.push({ label: 'Landing day', old: curLdD, new: sunLdD, field: 'ldD' });
      }
      if (curLdN !== sunLdN) {
        countersChanged = true;
        counterDiffs.push({ label: 'Landing night', old: curLdN, new: sunLdN, field: 'ldN' });
      }
    }

    if (!nightChanged && !countersChanged) {
      stats.skipped++; stats.reason.noChange++; continue;
    }

    const diffs = [];
    if (nightChanged) {
      diffs.push({ label: 'Yöaika', old: curNight || '–', new: newNight || '–', field: 'night' });
    }
    diffs.push(...counterDiffs);

    changes.push({
      entry, diffs,
      newValues: {
        night: newNight,
        updateTakeoffs: canUpdateTakeoffs,
        updateLandings: canUpdateLandings,
        tkD: sunTkD, tkN: sunTkN,
        ldD: sunLdD, ldN: sunLdN
      }
    });
  }

  stats.changed = changes.length;
  console.log('[Night Recalc] Valmis:', stats);

  if (!changes.length) {
    if (typeof showToast === 'function') showToast('Kaikki yöajat ovat jo oikein.', 'success', 4000);
    return stats;
  }

  if (verbose) {
    console.log('[Night Recalc] --- Muutokset (ensimmäiset 30) ---');
    changes.slice(0, 30).forEach((c, i) => {
      const flt = c.entry.skyplan?.flightNumber
        || `${c.entry.departure?.place}→${c.entry.arrival?.place}`;
      console.log(`  #${i + 1} ${c.entry.date} ${flt}`);
      c.diffs.forEach(d => console.log(`     ${d.label}: ${d.old} → ${d.new}`));
    });
  }

  if (!apply) {
    return await _promptNightRecalcConfirmation(changes, stats);
  }
  _applyNightRecalcChanges(changes);
  if (typeof showToast === 'function') showToast(`Päivitetty ${changes.length} kirjausta.`, 'success', 5000);
  return stats;
}
window.recalculateNightTimes = recalculateNightTimes;

function _recalcCombineDateTime(entry, which) {
  if (which === 'departure' && entry.skyplan?.takeoff) {
    return entry.skyplan.takeoff;
  }
  if (which === 'arrival' && entry.skyplan?.touchdown) {
    return entry.skyplan.touchdown;
  }

  const date = String(entry.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const time = which === 'departure'
    ? String(entry.departure?.time || '').trim()
    : String(entry.arrival?.time   || '').trim();

  if (!/^\d{2}:\d{2}$/.test(time)) return null;

  let iso = `${date}T${time}:00.000Z`;

  if (which === 'arrival' && entry.departure?.time) {
    const depTime = String(entry.departure.time).trim();
    if (/^\d{2}:\d{2}$/.test(depTime)) {
      const [dh, dm] = depTime.split(':').map(Number);
      const [ah, am] = time.split(':').map(Number);
      const depMins = dh * 60 + dm;
      const arrMins = ah * 60 + am;
      if (arrMins < depMins) {
        const d = new Date(iso);
        d.setUTCDate(d.getUTCDate() + 1);
        iso = d.toISOString();
      }
    }
  }

  return iso;
}

async function _promptNightRecalcConfirmation(changes, stats) {
  return new Promise((resolve) => {
    const items = changes.slice(0, 25).map((c, i) => {
      const flt = c.entry.skyplan?.flightNumber
        || `${c.entry.departure?.place}→${c.entry.arrival?.place}`;
      const diffs = c.diffs.map(d => {
        const oldStr = typeof d.old === 'number' ? String(d.old) : d.old;
        const newStr = typeof d.new === 'number' ? String(d.new) : d.new;
        return `<div style="font-size:11.5px; color:var(--dim); margin-left:14px;
                            font-family:var(--font-mono); line-height:1.5;">
          ${_esc(d.label)}:
          <span style="color:var(--error);">${_esc(oldStr)}</span>
          →
          <span style="color:var(--success); font-weight:600;">${_esc(newStr)}</span>
        </div>`;
      }).join('');
      return `
        <div style="padding:8px 12px; background:var(--input); border-radius:8px; margin-bottom:6px;">
          <div style="font-size:12.5px; font-weight:700; color:var(--accent);">
            ${_esc(c.entry.date)} · ${_esc(flt)}
          </div>
          ${diffs}
        </div>`;
    }).join('');

    const more = changes.length > 25
      ? `<div style="text-align:center; color:var(--dim); font-size:11.5px; margin-top:6px;">
           … ja ${changes.length - 25} muuta
         </div>`
      : '';

    const bodyHTML = `
      <div style="font-size:13px; line-height:1.5; margin-bottom:12px;">
        <p style="color:var(--text); font-weight:600; margin-bottom:6px;">
          ${changes.length} kirjausta päivittyy
        </p>
        <div style="font-size:11.5px; color:var(--dim);">
          Käyty läpi: ${stats.total} · Muutos: ${changes.length} · Ohitettu: ${stats.skipped}
        </div>
      </div>
      <div style="max-height:360px; overflow-y:auto; margin-bottom:12px;">
        ${items}
        ${more}
      </div>
      <p style="font-size:11.5px; color:var(--warning); margin-bottom:0;">
        ⚠ Yöaika ja nousut/laskut lasketaan uudelleen SunCalcin avulla.
      </p>
    `;

    createModal({
      title: 'Laske yöajat uudelleen?',
      icon: '🌙',
      bodyHTML,
      confirmText: 'Päivitä',
      cancelText: 'Peruuta',
      maxWidth: '680px',
      onConfirm: () => {
        _applyNightRecalcChanges(changes);
        if (typeof showToast === 'function') {
          showToast(`Päivitetty ${changes.length} kirjausta.`, 'success', 5000);
        }
        resolve(stats);
      },
      onCancel: () => resolve(stats)
    });
  });
}

function _applyNightRecalcChanges(changes) {
  try {
    localStorage.setItem('easa_logbook_backup_before_nightrecalc',
      JSON.stringify({ at: new Date().toISOString(), entries: _lbReadAll() }));
  } catch (e) {}

  const list = _lbReadAll();
  const byId = new Map(list.map(e => [e.id, e]));

  changes.forEach(c => {
    const entry = byId.get(c.entry.id);
    if (!entry) return;

    if (!entry.operationalCondition) entry.operationalCondition = { night: '', ifr: '' };
    entry.operationalCondition.night = c.newValues.night;

    if (c.newValues.updateTakeoffs) {
      if (!entry.takeoffs) entry.takeoffs = { day: 0, night: 0 };
      entry.takeoffs.day   = c.newValues.tkD;
      entry.takeoffs.night = c.newValues.tkN;
    }
    if (c.newValues.updateLandings) {
      if (!entry.landings) entry.landings = { day: 0, night: 0 };
      entry.landings.day   = c.newValues.ldD;
      entry.landings.night = c.newValues.ldN;
    }
  });

  _lbWriteAll(list);
  if (typeof renderLogbookTable === 'function') renderLogbookTable();
  if (typeof renderChainStatusBadge === 'function') renderChainStatusBadge();
}

/* ==============================================================
 * AUTO-SYNC · lokikirjan automaattinen päivitys
 * ============================================================== */
async function autoSyncLogbook(reason = 'auto') {
  if (window._logbookSyncRunning) return;
  if (!navigator.onLine) return;

  const token = (typeof getValidSkyplanToken === 'function')
    ? await getValidSkyplanToken().catch(() => null) : null;
  if (!token) return;

  const entries = _lbReadAll();
  const pendingCount = entries.filter(e =>
    e.skyplan?.flightId &&
    !e.skyplan?.isFSTD &&
    (e.skyplan?.takeoffPending || e.skyplan?.landingPending)
  ).length;

  let state = {};
  try { state = JSON.parse(localStorage.getItem(LOGBOOK_AUTOSYNC_KEY) || '{}'); }
  catch (e) {}
  const lastRun = state.lastRun ? new Date(state.lastRun).getTime() : 0;
  const sinceLast = Date.now() - lastRun;

  if (pendingCount === 0 && sinceLast < SYNC_FULL_INTERVAL) return;
  if (pendingCount > 0 && sinceLast < SYNC_MIN_INTERVAL) return;

  if (pendingCount === 0) {
    state.lastRun = new Date().toISOString();
    state.lastReason = reason;
    localStorage.setItem(LOGBOOK_AUTOSYNC_KEY, JSON.stringify(state));
    return;
  }

  window._logbookSyncRunning = true;

  try {
    const stats = await syncLogbookWithSkyplan({
      apply: true,
      matchRoster: false,
      onlyPending: true,
      verbose: false,
      showLoader: false
    });

    state.lastRun = new Date().toISOString();
    state.lastReason = reason;
    state.lastStats = stats || null;
    localStorage.setItem(LOGBOOK_AUTOSYNC_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn(`[Logbook AutoSync] Virhe (${reason}):`, e);
  } finally {
    window._logbookSyncRunning = false;
  }
}
window.autoSyncLogbook = autoSyncLogbook;

/* Laukaisimet */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => autoSyncLogbook('app-launch').catch(() => {}), 5000);
  });
} else {
  setTimeout(() => autoSyncLogbook('app-launch').catch(() => {}), 5000);
}

/* ==============================================================
 * AUTO-IMPORT · päättyneet lennot
 * ============================================================== */
let _autoScanInFlight = false;
let _lastScanAt = 0;
const SCAN_MIN_INTERVAL_MS = 60 * 1000; // Älä skannaa useammin kuin kerran minuutissa

async function scanForCompletedFlights() {
  if (_autoScanInFlight) return [];
  if (!navigator.onLine) return [];

  // Cooldown: skip jos skannattu äskettäin
  if (Date.now() - _lastScanAt < SCAN_MIN_INTERVAL_MS) {
    return [];
  }

  _autoScanInFlight = true;
  _lastScanAt = Date.now();
  const imported = [];
  // ... loput säilyvät ennallaan

  try {
    const roster = JSON.parse(localStorage.getItem('assigned_flights_cache') || '[]');
    if (!Array.isArray(roster) || !roster.length) return [];

    const token = (typeof getValidSkyplanToken === 'function')
      ? await getValidSkyplanToken().catch(() => null) : null;
    if (!token) return [];

    const now = Date.now();
    const lookbackMs = AUTOIMPORT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

    const candidates = roster.filter(f => {
      if (!f || typeof f !== 'object') return false;

      const flightId = f.ID || f.id || f.FlightID;
      if (!flightId) return false;

      if (getLogbookEntryByFlightId(flightId)) return false;

      const sta = new Date(f.StaLt || f.Sta || 0).getTime();
      if (!sta || now < sta + 10 * 60 * 1000) return false;

      if (now - sta > lookbackMs) return false;

      return true;
    });

    const batch = candidates.slice(0, 5);

    for (const f of batch) {
      const flightId = f.ID || f.id || f.FlightID;
      const carrier = String(f.CarrierCode || '').trim();
      const fltNo = String(f.FlightNumber || '').trim();
      const flightNum = (carrier && fltNo.startsWith(carrier)) ? fltNo : `${carrier}${fltNo}`;
      const dateStr = String(f.StdLt || f.Std || '').split('T')[0];

      const entry = await importLogbookFromJourneyLog(
        flightId, flightNum, dateStr,
        {
          depIcao:       f.DepartureStationIcaoCode || f.DepartureStationCode,
          arrIcao:       f.ArrivalStationIcaoCode   || f.ArrivalStationCode,
          aircraftReg:   f.RegistrationNumber,
          aircraftModel: f.AircraftDescription
        },
        { silent: true }
      );

      if (entry) imported.push(entry);
    }

    try {
      localStorage.setItem(AUTOIMPORT_LAST_SCAN_KEY, String(now));
    } catch (e) {}

    if (imported.length && typeof showToast === 'function') {
      showToast(`${imported.length} lento(a) tuotu automaattisesti lokikirjaan.`,
        'success', 4500);
      if (document.querySelector('.tab-btn[data-tab="logbook"].active')) {
        renderLogbookTable();
      }
    }

    return imported;
  } catch (e) {
    console.warn('[AutoImport] scan failed:', e);
    return imported;
  } finally {
    _autoScanInFlight = false;
  }
}
window.scanForCompletedFlights = scanForCompletedFlights;

(function wrapLoadAssignedFlights() {
  if (typeof window.loadAssignedFlights !== 'function') return;
  const orig = window.loadAssignedFlights;
  window.loadAssignedFlights = async function (...args) {
    const result = await orig.apply(this, args);

    const weekActive = document.querySelector(
      '#flights-view-toggle .vt-btn[data-view="week"].active'
    );
    if (!weekActive) {
      setTimeout(() => scanForCompletedFlights().catch(() => {}), 1500);
    }
    return result;
  };
})();

/* Audit-badge wrapper */
(function wrapRenderLogbookTable() {
  if (typeof window.renderLogbookTable !== 'function') return;
  const orig = window.renderLogbookTable;
  window.renderLogbookTable = function (...args) {
    const r = orig.apply(this, args);
    setTimeout(() => {
      if (typeof renderChainStatusBadge === 'function') {
        renderChainStatusBadge().catch(() => {});
      }
    }, 60);
    return r;
  };
})();

setInterval(() => {
  if (navigator.onLine) scanForCompletedFlights().catch(() => {});
}, AUTOIMPORT_INTERVAL_MS);

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => scanForCompletedFlights().catch(() => {}), 5000);
});

/* ==============================================================
 * AUTO-BACKUP MUISTUTUS
 * ============================================================== */
async function autoBackupLogbook() {
  if (!navigator.onLine) return;

  let meta = {};
  try { meta = JSON.parse(localStorage.getItem(LOGBOOK_BACKUP_KEY) || '{}'); }
  catch (e) {}

  const last = meta.lastBackup ? new Date(meta.lastBackup).getTime() : 0;
  const days = (Date.now() - last) / (24 * 60 * 60 * 1000);

  if (days < BACKUP_INTERVAL_DAYS) return;

  try {
    if (typeof showToast === 'function') {
      showToast('Varmuuskopioimaton data — muista viedä JSON.', 'info', 8000);
    }
    // Merkitse muistutus näytetyksi — seuraava vasta 7 vrk kuluttua
    meta.lastBackup = new Date().toISOString();
    localStorage.setItem(LOGBOOK_BACKUP_KEY, JSON.stringify(meta));
  } catch (e) {}
}
window.autoBackupLogbook = autoBackupLogbook;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(autoBackupLogbook, 15000);
  });
} else {
  setTimeout(autoBackupLogbook, 15000);
}

(function _wrapForceRosterSync() {
  // Jos jo olemassa — wrap nyt
  if (typeof window.forceRosterSync === 'function') {
    const orig = window.forceRosterSync;
    window.forceRosterSync = async function (...args) {
      const result = await orig.apply(this, args);
      setTimeout(() => {
        autoSyncLogbook('after-roster-sync').catch(() => {});
      }, 3000);
      return result;
    };
    return;
  }

  // Muuten intercept property assignment
  let _forceRosterSync = undefined;
  Object.defineProperty(window, 'forceRosterSync', {
    configurable: true,
    get() { return _forceRosterSync; },
    set(fn) {
      if (typeof fn !== 'function') {
        _forceRosterSync = fn;
        return;
      }
      _forceRosterSync = async function (...args) {
        const result = await fn.apply(this, args);
        setTimeout(() => {
          autoSyncLogbook('after-roster-sync').catch(() => {});
        }, 3000);
        return result;
      };
    }
  });
})();