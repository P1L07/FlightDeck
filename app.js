const LOGBOOK_STORAGE_KEY = 'easa_logbook_v1';
const LOGBOOK_META_KEY    = 'easa_logbook_meta_v1';

/* ---------------- Storage layer ---------------- */
function _lbReadAll() {
  // Jos DB on valmis → käytä muistia
  if (typeof dbReadAll === 'function' && window.dbReadAll) {
    return dbReadAll();
  }
  // Fallback localStorageen (ennen dbInit:iä)
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

const CERT_SIGNATURE_KEY = '_cert_signature_v1';

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

function getLogbookEntries() { return _lbReadAll(); }
function getLogbookEntry(id) { return _lbReadAll().find(e => e.id === id) || null; }
function getLogbookEntryByFlightId(fid) {
  return _lbReadAll().find(e => String(e.skyplan?.flightId) === String(fid)) || null;
}

/* ==============================================================
 * pdf-lib module-level references
 * drawRows / drawTableHeader / drawTotalsFooter ovat top-level
 * funktioita, jotka tarvitsevat rgb():n. Haetaan se tähän.
 * ============================================================== */
const RGB = (typeof PDFLib !== 'undefined' && typeof PDFLib.rgb === 'function')
  ? PDFLib.rgb
  : ((r = 0, g = 0, b = 0) => ({ r, g, b, type: 'RGB' }));

if (typeof PDFLib === 'undefined') {
  console.error(
    "[LogBook] pdf-lib puuttuu. Lisää <script src='https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js'></script> ENNEN LogBook.js:ää."
  );
}

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

const PILOT_LICENSE_KEY = '_pilot_licenses_v1';

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

/* ---------------- ICAO coordinate lookup ----------------
 * Air Astana -verkon yleisimmät kentät. Laajenna tarpeen mukaan.
 */
const ICAO_COORDS = {
  // Kazakstan
  UAAA: { lat: 43.3521, lon: 77.0405 },  // Almaty
  UACC: { lat: 51.0222, lon: 71.4669 },  // Astana
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
  // IVY / Venäjä
  UUEE: { lat: 55.9726, lon: 37.4146 },  // Moscow SVO
  UUWW: { lat: 55.5915, lon: 37.2615 },  // Moscow VKO
  UUDD: { lat: 55.4088, lon: 37.9063 },  // Moscow DME
  ULLI: { lat: 59.8003, lon: 30.2625 },  // St. Petersburg
  USSS: { lat: 56.7431, lon: 60.8027 },  // Yekaterinburg
  UNNT: { lat: 55.0126, lon: 82.6507 },  // Novosibirsk
  UTTT: { lat: 41.2579, lon: 69.2812 },  // Tashkent
  UTDD: { lat: 38.5433, lon: 68.8250 },  // Dushanbe
  UCFM: { lat: 43.0613, lon: 74.4776 },  // Bishkek
  UBBB: { lat: 40.4675, lon: 50.0467 },  // Baku
  UGTB: { lat: 41.6692, lon: 44.9547 },  // Tbilisi
  // Eurooppa
  EGLL: { lat: 51.4700, lon: -0.4543 },  // London LHR
  LFPG: { lat: 49.0097, lon: 2.5479 },   // Paris CDG
  EDDF: { lat: 50.0379, lon: 8.5622 },   // Frankfurt
  EHAM: { lat: 52.3105, lon: 4.7683 },   // Amsterdam
  EDDM: { lat: 48.3537, lon: 11.7750 },  // Munich
  LTFM: { lat: 41.2753, lon: 28.7519 },  // Istanbul IST
  // Aasia / Lähi-itä
  ZBAA: { lat: 40.0799, lon: 116.6031 }, // Beijing
  ZSPD: { lat: 31.1443, lon: 121.8083 }, // Shanghai
  ZGGG: { lat: 23.3924, lon: 113.2988 }, // Guangzhou
  VHHH: { lat: 22.3080, lon: 113.9185 }, // Hong Kong
  VIDP: { lat: 28.5562, lon: 77.1000 },  // Delhi
  OMDB: { lat: 25.2532, lon: 55.3657 },  // Dubai
  OTHH: { lat: 25.2731, lon: 51.6081 },  // Doha
  OEJN: { lat: 21.6796, lon: 39.1565 },  // Jeddah
  VTBS: { lat: 13.6900, lon: 100.7501 }, // Bangkok
  WSSS: { lat: 1.3644, lon: 103.9915 },  // Singapore
  WMKK: { lat: 2.7456, lon: 101.7099 },  // Kuala Lumpur
  RPLL: { lat: 14.5086, lon: 121.0194 }, // Manila
};

function _icaoCoords(icao) {
  if (!icao) return null;
  const key = String(icao).toUpperCase().trim();
  return ICAO_COORDS[key] || null;
}

/* ---------------- EASA night time via SunCalc ----------------
 * EASA AMC1 FCL.050: night = aika auringonlaskun ja -nousun välillä.
 * Käytetään civil twilight -6° kynnystä (yleisin EASA-tulkinta).
 * Kone liikkuu → interpoloidaan sijainti lähtö/saapuminen välillä
 * lineaarisesti ja näytteistetään minuutin välein.
 *
 * Palauttaa: { night: "H:MM" | '', nightTakeoff: bool, nightLanding: bool }
 */
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

/* ---------------- Deprecated stub (overridden) ---------------- */
function estimateNightFraction() { return ''; }

/* ---------------- Enhanced mapJourneyLogToEntry ----------------
 * Sama allekirjoitus kuin alkuperäisessä, mutta:
 *   - käyttää calculateNightTime:a (SunCalc)
 *   - asettaa takeoffs/landings day/night oikein
 *   - asettaa operationalCondition.night
 */
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

  /* --- Yöaika (SunCalc) --- */
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

  /* --- Päätös + pending-tila --- */
  let creditTakeoff, creditLanding;
  let takeoffPending = false;
  let landingPending = false;

  if (hasTakeoffData) {
    creditTakeoff = iDidTakeoff;
  } else {
    // Ei tietoa vielä → oletetaan PIC teki, mutta merkitse pending
    creditTakeoff = isPIC;
    takeoffPending = true;
  }

  if (hasLandingData) {
    creditLanding = iDidLanding;
  } else {
    creditLanding = isPIC;
    landingPending = true;
  }

  /* --- Aseta laskurit --- */
  if (creditTakeoff) {
    entry.takeoffs = {
      day:   night.nightTakeoff ? 0 : 1,
      night: night.nightTakeoff ? 1 : 0
    };
  } else {
    entry.takeoffs = { day: 0, night: 0 };
  }

  if (creditLanding) {
    entry.landings = {
      day:   night.nightLanding ? 0 : 1,
      night: night.nightLanding ? 1 : 0
    };
  } else {
    entry.landings = { day: 0, night: 0 };
  }

  /* --- Pilot function time --- */
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
    // Pending-liput: mitkä tiedot puuttuvat vielä
    takeoffPending,
    landingPending,
    takeoffStaffId: takeoffStaffId || null,
    landingStaffId: landingStaffId || null,
    lastCheckedAt: new Date().toISOString()
  };

  return entry;
}

/* ---------------- Enhanced import from journey log ----------------
 * Sama allekirjoitus kuin alkuperäisellä, mutta hyväksyy
 * flightMeta:n ja hakee puuttuvat koordinaatit rosterista.
 */
async function importLogbookFromJourneyLog(flightId, flightNum, dateStr, flightMeta = {}, options = {}) {
  const { silent = false } = options;

  // Silent-moodissa ei avata modaaleja, vain toast
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
/* ---------------- Logbook table renderer ---------------- */
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
    const isFSTD = !!e.skyplan?.isFSTD || (e.fstd?.totalTime && !e.departure?.place && !e.arrival?.place);

    const isPending = e.skyplan?.takeoffPending || e.skyplan?.landingPending;

    let status;
    if (signed) {
      status = `<span style="color:var(--success); font-size:11px; font-weight:700; white-space:nowrap;">✔ Allekirjoitettu</span>`;
    } else if (isPending) {
      status = `<span style="color:var(--dim); font-size:11px; font-weight:700; white-space:nowrap;" title="Odottaa Skyplan-vahvistusta">⏳ Synkkaa…</span>`;
    } else {
      status = `<span style="color:var(--warning); font-size:11px; font-weight:700; white-space:nowrap;">● Odottaa</span>`;
    }

    if (isFSTD) {
      // FSTD-rivi — yksinkertaisempi
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
          <td colspan="5" style="text-align:center; color:var(--dim); font-size:11px;">FSTD-sessio</td>
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

    // Lentorivi (entinen logiikka)
    const ac = [e.aircraft.model, e.aircraft.registration].filter(Boolean).join(' · ') || '–';
    const to  = `${e.takeoffs.day || 0}/${e.takeoffs.night || 0}`;
    const ldg = `${e.landings.day || 0}/${e.landings.night || 0}`;

    html += `
      <tr>
        <td style="font-family:var(--font-mono); font-size:12.5px;">${esc(e.date)}</td>
        <td style="font-weight:600;">${esc(e.skyplan?.flightNumber || '')}</td>
        <td style="letter-spacing:0.4px; white-space:nowrap;">
          ${esc(e.departure.place)} ➔ ${esc(e.arrival.place)}
        </td>
        <td style="font-family:var(--font-mono); font-size:12.5px; white-space:nowrap;">
          ${esc(e.departure.time)} – ${esc(e.arrival.time)}
        </td>
        <td style="font-size:12.5px;">${esc(ac)}</td>
        <td style="font-weight:600;">${esc(e.totalTimeOfFlight || '–')}</td>
        <td style="font-size:12.5px;">${esc(e.picName || '–')}</td>
        <td style="color:var(--success); font-family:var(--font-mono);">${to}</td>
        <td style="color:var(--accent);  font-family:var(--font-mono);">${ldg}</td>
        <td style="font-family:var(--font-mono);">${esc(e.operationalCondition.ifr || '–')}</td>
        <td style="font-family:var(--font-mono); color:#9ec7ff;">${esc(e.operationalCondition.night || '–')}</td>
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

/* ---------------- Detail modal ---------------- */
function showLogbookEntryDetail(id) {
  const e = getLogbookEntry(id);
  if (!e) return;

  const row = (label, val) => `
    <div class="kv"><span>${label}</span><span>${val || '–'}</span></div>`;

  const body = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0 24px;">
      <div>
        ${row('1. Pvm', e.date)}
        ${row('2. Lähtö', `${e.departure.place} ${e.departure.time}`)}
        ${row('3. Saapuminen', `${e.arrival.place} ${e.arrival.time}`)}
        ${row('4. Kone',
          [e.aircraft.make, e.aircraft.model, e.aircraft.variant, e.aircraft.registration]
            .filter(Boolean).join(' '))}
        ${row('5. SE / ME',
          `${e.singlePilot.se || '–'} / ${e.singlePilot.me || '–'}`)}
        ${row('6. Multi-pilot', e.multiPilot)}
        ${row('7. Kokonaislentoaika', e.totalTimeOfFlight)}
      </div>
      <div>
        ${row('8. PIC', e.picName)}
        ${row('9. Night / IFR',
          `${e.operationalCondition.night || '–'} / ${e.operationalCondition.ifr || '–'}`)}
        ${row('10. PIC / Co-pilot',
          `${e.pilotFunction.pic || '–'} / ${e.pilotFunction.copilot || '–'}`)}
        ${row('Takeoffs (D/N)', `${e.takeoffs.day} / ${e.takeoffs.night}`)}
        ${row('Landings (D/N)', `${e.landings.day} / ${e.landings.night}`)}
        ${row('11. FSTD', e.fstd.totalTime || '–')}
        ${row('Allekirjoitettu', e.signedAt ? new Date(e.signedAt).toLocaleString() : '–')}
        ${row('Lupakirja', e.licenseNumber || '–')}
      </div>
    </div>
    ${e.remarks ? `
      <div style="margin-top:14px;">
        <div style="font-size:11px; letter-spacing:1.5px; color:var(--dim);
                    text-transform:uppercase; font-weight:700; margin-bottom:6px;">
          Remarks (sarake 12)
        </div>
        <div style="padding:12px; background:var(--input); border-radius:10px;
                    font-size:13px; line-height:1.5;">${e.remarks}</div>
      </div>` : ''}
    ${e.signatureDataUrl ? `
      <div style="margin-top:14px;">
        <div style="font-size:11px; letter-spacing:1.5px; color:var(--dim);
                    text-transform:uppercase; font-weight:700; margin-bottom:6px;">
          Pilot's signature
        </div>
        <img src="${e.signatureDataUrl}"
             style="max-width:100%; height:auto; background:#fff;
                    border-radius:8px; padding:6px;"/>
      </div>` : ''}
    ${e.skyplan?.flightId ? `
      <div style="margin-top:14px; text-align:right;">
        <button class="btn-ghost" style="height:34px; padding:0 14px; font-size:12px;"
          onclick="reimportLogbookEntry('${e.id}')">
          ⟳ Päivitä journey-logista
        </button>
      </div>` : ''}
  `;

  createModal({
    title: `Kirjaus · ${e.skyplan?.flightNumber || ''}`,
    icon: '📄',
    bodyHTML: body,
    confirmText: 'Sulje',
    maxWidth: '760px',
    compact: false
  });
}
window.showLogbookEntryDetail = showLogbookEntryDetail;

/* ---------------- Re-import (päivitys) ---------------- */
async function reimportLogbookEntry(entryId) {
  const old = getLogbookEntry(entryId);
  if (!old || !old.skyplan?.flightId) return;
  // Poista vanha, importtaa uudelleen
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

/* ---------------- Auto-render hooks ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('logbook-container')) renderLogbookTable();
});
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.tab-btn[data-tab="logbook"]');
  if (btn) setTimeout(renderLogbookTable, 30);
});

async function fetchFlightIdFromRoster(flightDateStr, flightNumberRaw, depIcaoRaw) {
    const token = typeof getValidSkyplanToken === 'function' ? await getValidSkyplanToken() : null;
    if (!token) {
        console.error('Valid Skyplan token unavailable.');
        return null;
    }

    let employeeId = null;
    try {
        const employee = decodeJWT(token);
        employeeId = employee.employeeid || employee.EmployeeID || employee.employeeId || 
                     employee.nameid || employee.sub || 
                     employee['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'] || null;
    } catch (e) {
        console.warn('Failed to decode JWT for EmployeeID', e);
    }

    // Clean inputs
    const flightDigits = String(flightNumberRaw || '').replace(/\D/g, '');
    const cleanFlightNum = flightDigits ? String(parseInt(flightDigits, 10)) : '';
    const depIcao = String(depIcaoRaw || '').replace(/[^A-Za-z]/g, '').toUpperCase();

    // Local Date Parsing (avoiding UTC timezone shift)
    let baseDate = new Date();
    if (flightDateStr) {
        const parts = String(flightDateStr).split(/[-/.]/);
        if (parts.length === 3) {
            if (parts[0].length === 4) {
                baseDate = new Date(parts[0], parseInt(parts[1], 10) - 1, parts[2]);
            } else if (parts[2].length === 4 || parts[2].length === 2) {
                const yr = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
                baseDate = new Date(yr, parseInt(parts[1], 10) - 1, parts[0]);
            }
        }
    }

    const formatLocalDate = (d) => {
        const yr = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const dy = String(d.getDate()).padStart(2, '0');
        return `${yr}-${mo}-${dy}`;
    };

    const fromDate = new Date(baseDate);
    fromDate.setDate(fromDate.getDate() - 1);
    const toDate = new Date(baseDate);
    toDate.setDate(toDate.getDate() + 1);

    const payload = {
        EmployeeID: String(employeeId || ''),
        From: formatLocalDate(fromDate),
        To: formatLocalDate(toDate)
    };

    try {
        const resp = await fetch('https://kcskyplanapi.airastana.com/api/v1/crew-roster-flights-details', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            console.error(`Roster Error (HTTP ${resp.status}):`, errText);
            return null;
        }

        const data = await resp.json();
        const flights = Array.isArray(data.Flights) ? data.Flights : [];

        const allowedCarriers = ['KC', 'KZR', 'AYN', 'FS'];

        const match = flights.find(f => {
            if (!f) return false;
            const carrier = String(f.CarrierCode || '').trim().toUpperCase();
            const rawApiFlt = String(f.FlightNumber || '').replace(/\D/g, '');
            const apiFltNum = rawApiFlt ? String(parseInt(rawApiFlt, 10)) : '';
            
            const apiIcao = String(f.DepartureStationIcaoCode || '').toUpperCase();
            const apiIata = String(f.DepartureStationCode || '').toUpperCase();

            return allowedCarriers.includes(carrier) &&
                   apiFltNum === cleanFlightNum &&
                   (apiIcao === depIcao || apiIata === depIcao);
        });

        return match ? (match.ID || match.id || match.FlightID || null) : null;
    } catch (e) {
        console.error("fetchFlightIdFromRoster exception:", e);
        return null;
    }
}

    function promptForTokenModal() {
        if (window._tokenModalPromise) return window._tokenModalPromise;

        window._tokenModalPromise = new Promise(async (resolve) => {
            let isResolved = false;

            const finish = (resultToken) => {
                if (isResolved) return;
                isResolved = true;
                window._tokenModalPromise = null;
                resolve(resultToken);
            };

            const cleanToken = (input) => {
                if (!input || typeof input !== 'string') return null;
                let t = input.trim().replace(/^Bearer\s+/i, '').replace(/^"+|"+$/g, '').trim();
                return (t === 'null' || t === 'undefined' || t === '') ? null : t;
            };

            const bodyHTML = `
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    <label style="font-size: 12px; font-weight: 600; color: var(--dim);">Paste New Skyplan Access Token</label>
                    <textarea id="modal-skyplan-token" placeholder='eyJhbGciOi...' 
                        style="width: 100%; height: 120px; padding: 10px; border-radius: 8px; background: var(--input); color: var(--text); border: 1px solid var(--border); font-size: 13px; font-family: monospace; resize: vertical; word-break: break-all; outline: none; box-sizing: border-box;"></textarea>
                </div>
            `;

            if (typeof createModal === 'function') {
                try {
                    const modalResult = await createModal({
                        title: 'Skyplan Token Expired',
                        icon: '🔑',
                        type: 'info',
                        confirmText: 'Save Token',
                        cancelText: 'Disregard',
                        centered: true,
                        compact: true,
                        maxWidth: '500px',
                        bodyHTML: bodyHTML,
                        onConfirm: () => {
                            const inputElem = document.getElementById('modal-skyplan-token');
                            const rawToken = cleanToken(inputElem ? inputElem.value : '');

                            if (rawToken) {
                                try {
                                    localStorage.setItem('skyplan_token', rawToken);
                                } catch (e) {
                                    console.warn("Could not persist skyplan token:", e);
                                }

                                const settingInput = document.getElementById('skyplan_token');
                                if (settingInput) settingInput.value = rawToken;

                                if (typeof showToast === 'function') showToast('Skyplan token updated!', 'success');
                                finish(rawToken);
                            } else {
                                if (typeof showToast === 'function') showToast('No valid token provided', 'warning');
                                finish(null);
                            }
                        },
                        onCancel: () => finish(null)
                    });

                    // Handle promise-resolving modal architectures
                    if (modalResult === false) {
                        finish(null);
                    }
                } catch (err) {
                    console.error("Modal execution failed:", err);
                    finish(null);
                }
            } else {
                // Native fallback prompt
                let rawToken = prompt("Skyplan Access Token expired. Please paste new token:");
                const cleaned = cleanToken(rawToken);
                if (cleaned) {
                    try {
                        localStorage.setItem('skyplan_token', cleaned);
                    } catch (e) {}
                    finish(cleaned);
                } else {
                    finish(null);
                }
            }

            // Safety fallback: auto-resolve after 5 minutes if modal is abandoned in DOM
            setTimeout(() => finish(null), 300000);
        });

        return window._tokenModalPromise;
    }

    window.getValidSkyplanToken = async function() {
        // OFFLINE: älä yritä avata token-modalia
        if (!navigator.onLine) {
            console.log('[Token] Offline — ei yritetä hakea tokenia');
            return null;
        }

        // 1. Concurrent Request De-duplication Lock
        if (window._skyplanTokenPromise) {
            return await window._skyplanTokenPromise;
        }

        const safePromptModal = async () => {
            if (typeof promptForTokenModal === 'function') {
                try {
                    window._skyplanTokenPromise = promptForTokenModal();
                    const newToken = await window._skyplanTokenPromise;
                    return newToken ? String(newToken).trim().replace(/^Bearer\s+/i, '').replace(/^"+|"+$/g, '').trim() : null;
                } finally {
                    window._skyplanTokenPromise = null;
                }
            }
            console.warn("promptForTokenModal function is missing.");
            return null;
        };

        // Helper: Safely parse JWT payload even if decodeJWT utility is missing
        const parseJwt = (t) => {
            if (typeof decodeJWT === 'function') {
                try {
                    const res = decodeJWT(t);
                    if (res) return res;
                } catch (e) { /* fallback to manual decode */ }
            }
            try {
                const parts = t.split('.');
                if (parts.length !== 3) return null;
                const base64Url = parts[1];
                const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
                const jsonPayload = decodeURIComponent(
                    atob(base64)
                        .split('')
                        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                        .join('')
                );
                return JSON.parse(jsonPayload);
            } catch (e) {
                return null;
            }
        };

        // 2. Retrieve & Clean Local Storage Token
        let token = null;
        try {
            token = localStorage.getItem('skyplan_token');
        } catch (e) {
            console.warn("localStorage access restricted:", e);
        }

        if (token) {
            token = token.trim().replace(/^Bearer\s+/i, '').replace(/^"+|"+$/g, '').trim();
            if (token === 'null' || token === 'undefined' || token === '') {
                token = null;
            } else {
                try {
                    localStorage.setItem('skyplan_token', token);
                } catch (e) {}
            }
        }

        // 3. Missing Token -> Request via modal
        if (!token) {
            return await safePromptModal();
        }

        // 4. Validate Structure
        const decoded = parseJwt(token);
        if (!decoded || typeof decoded.exp !== 'number') {
            console.warn("Malformed JWT token found in storage.");
            return await safePromptModal();
        }

        // 5. Check Expiration (with 5-minute safety buffer)
        const now = Math.floor(Date.now() / 1000);
        if (decoded.exp <= now + 300) {
            console.warn("Skyplan token expired or expiring within 5 minutes.");
            return await safePromptModal();
        }

        // 6. Token is valid
        return token;
    };

    window.loadAssignedFlights = async function(isManualSearch = false, forceOnlineSync = false) {
        const container = document.getElementById('assigned-flights-container');
        const badgeEl = document.getElementById('assigned-cache-badge');
        if (!container) return;

        const cacheKey = 'assigned_flights_cache';
        const cacheTimeKey = 'assigned_flights_cache_time';

        const formatDateLocal = (date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        };

        const escapeQuotes = (str) => String(str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');

        const getCachedFlights = () => {
            try {
                const raw = localStorage.getItem(cacheKey);
                const rawTime = localStorage.getItem(cacheTimeKey) || '';
                const flights = raw ? JSON.parse(raw) : null;
                return { flights: Array.isArray(flights) ? flights : null, lastSyncTime: rawTime };
            } catch (e) {
                return { flights: null, lastSyncTime: '' };
            }
        };

        const renderTable = async (flights, isCached = false, lastSyncTime = '') => {
            if (badgeEl) {
                if (isCached) {
                    badgeEl.style.display = 'inline-block';
                    badgeEl.textContent = `OFFLINE SINCE: ${lastSyncTime ? '(' + lastSyncTime + ')' : ''}`;
                } else {
                    badgeEl.style.display = 'none';
                }
            }

            if (!flights || flights.length === 0) {
                container.innerHTML = '<div style="color: var(--dim); text-align: center; padding: 40px; font-family: sans-serif;">No assigned flights found for the selected period.</div>';
                return;
            }

            const cachedOFPs = typeof getCachedOFPs === 'function' ? await getCachedOFPs(true) : [];
            const todayStr = formatDateLocal(new Date());

            let html = `
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 14px;">
                    <thead style="background: var(--panel); position: sticky; top: 0; z-index: 10;">
                        <tr>
                            <th style="padding: 12px 15px; border-bottom: 1px solid var(--border); color: var(--accent);">Date</th>
                            <th style="padding: 12px 15px; border-bottom: 1px solid var(--border); color: var(--accent);">Flight</th>
                            <th style="padding: 12px 15px; border-bottom: 1px solid var(--border); color: var(--accent);">Routing</th>
                            <th style="padding: 12px 15px; border-bottom: 1px solid var(--border); color: var(--accent);">STD</th>
                            <th style="padding: 12px 15px; border-bottom: 1px solid var(--border); color: var(--accent);">STA</th>
                            <th style="padding: 12px 15px; border-bottom: 1px solid var(--border); color: var(--accent);">Block</th>
                            <th style="padding: 12px 15px; border-bottom: 1px solid var(--border); color: var(--accent);">Aircraft</th>
                            <th style="padding: 12px 15px; border-bottom: 1px solid var(--border); color: var(--accent); text-align: right;">Action</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            flights.forEach(f => {
                if (!f || typeof f !== 'object') return;

                const dateStr = f.StdLt ? String(f.StdLt).split('T')[0] : (f.Date ? String(f.Date).split('T')[0] : 'Unknown');
                const carrier = String(f.CarrierCode || f.carrierCode || '').trim();
                const fltNo = String(f.FlightNumber || f.flightNumber || '').trim();
                const flightNum = (carrier && fltNo.startsWith(carrier)) ? fltNo : `${carrier}${fltNo}`;
                
                const depStn = String(f.DepartureStationIcaoCode || f.DepartureStationCode || 'XXXX').trim();
                const arrStn = String(f.ArrivalStationIcaoCode || f.ArrivalStationCode || 'XXXX').trim();
                const routing = `${depStn} ➔ ${arrStn}`;
                
                const stdStr = f.StdLt && String(f.StdLt).includes('T') ? String(f.StdLt).split('T')[1].substring(0, 5) : (String(f.Std || '--:--'));
                const staStr = f.StaLt && String(f.StaLt).includes('T') ? String(f.StaLt).split('T')[1].substring(0, 5) : (String(f.Sta || '--:--'));
                
                const aircraft = String(f.RegistrationNumber || f.AircraftDescription || 'TBA').trim();

                // Calculate Block Time
                let blockTime = '--:--';
                const durationMins = Number(f.DurationMinutes);
                if (!isNaN(durationMins) && durationMins > 0) {
                    const hrs = Math.floor(durationMins / 60);
                    const mins = durationMins % 60;
                    blockTime = `${hrs}h ${String(mins).padStart(2, '0')}m`;
                } else if (f.Std && f.Sta) {
                    const diffMs = new Date(f.Sta) - new Date(f.Std);
                    if (diffMs > 0) {
                        const hrs = Math.floor(diffMs / 3600000);
                        const mins = Math.floor((diffMs % 3600000) / 60000);
                        blockTime = `${hrs}h ${String(mins).padStart(2, '0')}m`;
                    }
                }

                // Detect finalization state
                const isFinalized = typeof isFlightFinalized === 'function' ? isFlightFinalized(f, cachedOFPs) : false;
                const isToday = (dateStr === todayStr);
                const todayRowHighlight = isToday ? 'border-left: 4px solid var(--success); background: rgba(50, 215, 75, 0.08);' : '';

                const btnBaseStyle = `height: 30px; padding: 0 12px; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 4px; border-radius: 6px; box-sizing: border-box; white-space: nowrap; transition: all 0.2s; cursor: pointer;`;

                const flightId = f.ID || f.id || f.FlightID || f.FlightId || '';
                const safeId = escapeQuotes(flightId);
                const safeFlight = escapeQuotes(flightNum);
                const safeDate = escapeQuotes(dateStr);
                const safeReg = escapeQuotes(f.RegistrationNumber || '');

                const actionHtml = isFinalized 
                    ? `
                        <div style="display: flex; gap: 6px; justify-content: flex-end; align-items: center;">
                            <span style="color: var(--success, #32d74b); font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;">
                                ✔ Finalized
                            </span>
                            <button onclick="previewOFPFromSkyplan('${safeId}', '${safeFlight}', '${safeDate}', '${safeReg}')" 
                                    style="${btnBaseStyle} background: var(--input); color: var(--text); border: 1px solid var(--border);">
                                View
                            </button>
                        </div>
                    `
                    : `
                        <div style="display: flex; gap: 6px; justify-content: flex-end; align-items: center;">
                            <button onclick="previewOFPFromSkyplan('${safeId}', '${safeFlight}', '${safeDate}', '${safeReg}')" 
                                    style="${btnBaseStyle} background: var(--input); color: var(--text); border: 1px solid var(--border);">
                                Preview / Activate
                            </button>
                        </div>
                    `;

                const aircraftClickable = (aircraft !== 'TBA' && aircraft !== '-')
                    ? `<span onclick="if(typeof navigateToADDTab === 'function') navigateToADDTab('${escapeQuotes(aircraft)}')" style="color: var(--accent); text-decoration: underline; cursor: pointer; font-weight: 600;">${aircraft}</span>`
                    : `<span style="color: var(--dim);">${aircraft}</span>`;

                html += `
                    <tr class="assigned-flight-row" style="${todayRowHighlight}">
                        <td style="padding: 14px 12px; ${isToday ? 'font-weight: bold; color: var(--success);' : 'color: var(--text);'}">${dateStr} ${isToday ? '★' : ''}</td>
                        <td class="assigned-flight" style="padding: 14px 12px; font-weight: 600;">${flightNum}</td>
                        <td style="padding: 14px 12px; color: var(--text); letter-spacing: 0.5px;">${routing}</td>
                        <td class="assigned-time" style="padding: 14px 12px; color: var(--text);">${stdStr}</td>
                        <td class="assigned-sta" style="padding: 14px 12px; color: var(--text);">${staStr}</td>
                        <td class="assigned-block" style="padding: 14px 12px;">${blockTime}</td>
                        <td class="assigned-reg" style="padding: 14px 12px;">${aircraftClickable}</td>
                        <td style="padding: 10px 12px; text-align: right;">${actionHtml}</td>
                    </tr>
                `;
            });

            html += `</tbody></table>`;
            container.innerHTML = html;

            if (typeof filterAssignedFlightsTable === 'function') filterAssignedFlightsTable();
        };

        // Offline mode early exit (unless forcing online sync)
        if (!navigator.onLine && !forceOnlineSync) {
            const { flights, lastSyncTime } = getCachedFlights();
            if (flights && flights.length > 0) {
                await renderTable(flights, true, lastSyncTime);
                return;
            } else {
                if (badgeEl) badgeEl.style.display = 'none';
                container.innerHTML = '<div style="color: var(--error); text-align: center; padding: 40px; font-family: sans-serif;">⚡ Offline: No cached flights available. Please connect online to sync roster.</div>';
                return;
            }
        }

        const token = typeof getValidSkyplanToken === 'function' ? await getValidSkyplanToken().catch(() => null) : null;
        if (!token) {
            const { flights, lastSyncTime } = getCachedFlights();
            if (flights && flights.length > 0) {
                await renderTable(flights, true, lastSyncTime);
            } else {
                if (badgeEl) badgeEl.style.display = 'none';
                container.innerHTML = '<div style="color: var(--error); text-align: center; padding: 40px; font-family: sans-serif;">⚠️ No Skyplan token found. Please add it in Settings.</div>';
            }
            return;
        }

        const fromInput = document.getElementById('assigned-date-from');
        const toInput = document.getElementById('assigned-date-to');

        let fromStr = fromInput?.value;
        let toStr = toInput?.value;

        if (!fromStr || !toStr || !isManualSearch) {
            // Oletus: koko kuluva kuukausi
            const today = new Date();
            const fromDate = new Date(today.getFullYear(), today.getMonth(), 1);
            const toDate   = new Date(today.getFullYear(), today.getMonth() + 1, 0);

            fromStr = formatDateLocal(fromDate);
            toStr   = formatDateLocal(toDate);

            if (fromInput) fromInput.value = fromStr;
            if (toInput)   toInput.value   = toStr;
        }

        container.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; gap: 12px; background: var(--panel); border: 1px solid var(--border); border-radius: 14px; margin: 10px 0;">
                <div style="width: 32px; height: 32px; border: 3px solid rgba(255,255,255,0.15); border-top-color: var(--accent, #007aff); border-radius: 50%; animation: efbSpin 0.9s linear infinite;"></div>
                <div style="font-size: 14px; font-weight: 700; color: var(--text); letter-spacing: 0.3px;">Syncing roster with Skyplan...</div>
                <div style="font-size: 12px; color: var(--dim);">Fetching latest flight schedules and status</div>
                <style>
                    @keyframes efbSpin { 100% { transform: rotate(360deg); } }
                </style>
            </div>
        `;

        try {
            let employeeId = null;
            if (typeof decodeJWT === 'function') {
                try {
                    const employee = decodeJWT(token) || {};
                    employeeId = employee.employeeid || employee.EmployeeID || employee.employeeId || 
                                employee.nameid || employee.sub || 
                                employee['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'];
                } catch (e) {
                    console.warn('Failed to decode JWT for employee ID:', e);
                }
            }

            if (!employeeId) {
                const { flights, lastSyncTime } = getCachedFlights();
                if (flights && flights.length > 0) {
                    await renderTable(flights, true, lastSyncTime);
                } else {
                    if (badgeEl) badgeEl.style.display = 'none';
                    container.innerHTML = '<div style="color: var(--error); text-align: center; padding: 40px; font-family: sans-serif;">⚠️ Could not resolve Employee ID from token.</div>';
                }
                return;
            }

            const payload = {
                EmployeeID: String(employeeId),
                From: fromStr,
                To: toStr
            };

            const resp = await fetch('https://kcskyplanapi.airastana.com/api/v1/crew-roster-flights-details', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            }).catch(() => null);

            if (!resp || !resp.ok) {
                const { flights, lastSyncTime } = getCachedFlights();
                if (flights && flights.length > 0) {
                    await renderTable(flights, true, lastSyncTime);
                    if (typeof showToast === 'function') showToast('OFFLINE: Displaying cached roster.', 'info');
                    return;
                }
                throw new Error(resp ? `API Error: ${resp.status}` : "Network connection error");
            }

            const data = await resp.json();
            let flights = Array.isArray(data.Flights) ? data.Flights : [];

            const allowedCarriers = ['KC', 'KZR', 'AYN', 'FS'];
            flights = flights.filter(f => f && allowedCarriers.includes(String(f.CarrierCode || '').trim().toUpperCase()));

            // Tallenna raaka API-vastaus vertailua varten
            // Tämä EI ole cache — se on "mitä API sanoi viimeksi"
            window._lastRosterAPIResponse = flights.slice();
            try {
              localStorage.setItem('assigned_flights_last_api', JSON.stringify({
                from: fromStr,
                to: toStr,
                at: new Date().toISOString(),
                flights: flights
              }));
            } catch (e) {
              console.warn('[Roster] API-vastauksen tallennus epäonnistui:', e);
            }
            
            flights.sort((a, b) => {
                const tA = new Date(a.StdLt || a.Std || 0).getTime();
                const tB = new Date(b.StdLt || b.Std || 0).getTime();
                return tA - tB;
            });

            const syncTimeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            try {
                // Yhdistä uudet lennot vanhoihin. Jos dispatch palauttaa vain
                // tietyn aikavälin (esim. 26.10-1.11), vanha data (1.10-25.10)
                // säilyy eikä cache tyhjene.
                const existing = JSON.parse(localStorage.getItem(cacheKey) || '[]');
                const merged = (typeof window.mergeRosterFlights === 'function')
                    ? window.mergeRosterFlights(existing, flights)
                    : flights;
                localStorage.setItem(cacheKey, JSON.stringify(merged));
                localStorage.setItem(cacheTimeKey, syncTimeString);
                localStorage.setItem('assigned_flights_cache_range', JSON.stringify({
                    from: fromStr,
                    to:   toStr,
                    at:   new Date().toISOString()
                }));
            } catch (e) {
                console.warn("Could not write roster cache:", e);
            }

            await renderTable(flights, false);

            // Background OFP caching
            if (typeof preloadAssignedOFPs === 'function') {
                setTimeout(() => {
                    try {
                        preloadAssignedOFPs(flights, token);
                    } catch (preErr) {
                        console.warn("Background preloading failed:", preErr);
                    }
                }, 500);
            }

        } catch (e) {
            console.error("Schedule fetch failed:", e);
            const { flights, lastSyncTime } = getCachedFlights();
            if (flights && flights.length > 0) {
                await renderTable(flights, true, lastSyncTime);
            } else {
                if (badgeEl) badgeEl.style.display = 'none';
                container.innerHTML = `<div style="color: var(--error); text-align: center; padding: 40px; font-family: sans-serif;">Error: ${e.message}</div>`;
            }
        }
    };

        async function fetchSkyplanOFPBytes(flightId, token, flightNum = '', dateStr = '') {
        if (!flightId) {
            throw new Error("Cannot fetch OFP: Missing flightId.");
        }

        const safeGetOffline = async () => {
            if (typeof getPdfFromOfflineCache === 'function') {
                try {
                    const cached = await getPdfFromOfflineCache(flightId, flightNum, dateStr);
                    if (cached && cached.pdfBytes && (cached.pdfBytes.byteLength || cached.pdfBytes.length) > 0) {
                        return cached;
                    }
                } catch (e) {
                    console.warn("[Offline Cache Read Error]", e);
                }
            }
            return null;
        };

        // 0. Offline Early Exit
        if (!navigator.onLine) {
            const offlineData = await safeGetOffline();
            if (offlineData) return offlineData;
            throw new Error(`Device offline. ${flightNum || 'Flight'} has not been cached for offline use yet.`);
        }

        // Auto-resolve token if omitted
        const authToken = token || (typeof getValidSkyplanToken === 'function' ? await getValidSkyplanToken().catch(() => null) : null);
        if (!authToken) {
            const offlineData = await safeGetOffline();
            if (offlineData) return offlineData;
            throw new Error("Skyplan authentication token missing or expired.");
        }

        // 1. Query v2 for finalization metadata
        let isFinalizedOnServer = false;
        let v2Status = null;

        try {
            const v2Resp = await fetch(`https://kcskyplanapi.airastana.com/api/v2/flights/${flightId}/ofp`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            
            v2Status = v2Resp.status;

            if (v2Resp.ok) {
                const v2Data = await v2Resp.json();
                const filledObj = v2Data['Filled Document'] || v2Data.FilledDocument || v2Data.filledDocument;
                const hasFilledFlag = v2Data.HasFilledDocument || v2Data.hasFilledDocument || v2Data.isFinalized || v2Data.IsFinalized;
                
                if ((filledObj && typeof filledObj === 'object') || hasFilledFlag === true || hasFilledFlag === 'true') {
                    isFinalizedOnServer = true;
                    try {
                        localStorage.setItem(`skyplan_finalized_${flightId}`, 'true');
                    } catch (e) {}
                }
            }
        } catch (e) {
            console.warn('[Skyplan v2 Metadata Warning]', e);
        }

        // Immediate bail-out if flight plan is not generated by dispatch
        if (v2Status === 422) {
            throw new Error(`OFP not generated by flight dispatch yet (HTTP 422).`);
        }

        // 2. Query v1 endpoint for PDF payload
        const v1Url = `https://kcskyplanapi.airastana.com/api/v1/flights/${flightId}/ofp`;
        let v1Resp = null;
        try {
            v1Resp = await fetch(v1Url, { headers: { 'Authorization': `Bearer ${authToken}` } });
        } catch (netErr) {
            console.warn("[Skyplan v1 Network Error]", netErr);
            const offlineData = await safeGetOffline();
            if (offlineData) return offlineData;
            throw new Error("Network request failed while downloading OFP.");
        }

        if (v1Resp.status === 401 || v1Resp.status === 403) {
            const offlineData = await safeGetOffline();
            if (offlineData) return offlineData;
            throw new Error("Skyplan authentication rejected (HTTP " + v1Resp.status + "). Please re-login.");
        }

        if (v1Resp.status === 422) {
            // 422 = OFP ei ole vielä julkaistu. Tämä on normaali tila.
            // Käytetään hiljaista virhettä (ei console.error).
            const err = new Error(`OFP not generated by flight dispatch yet (HTTP 422).`);
            err.code = 'OFP_NOT_AVAILABLE';
            err.isExpected = true;
            throw err;
        }

        if (!v1Resp.ok) {
            const offlineData = await safeGetOffline();
            if (offlineData) return offlineData;
            throw new Error(`Skyplan server error (HTTP ${v1Resp.status})`);
        }

        let rawPayload = null;
        const contentType = v1Resp.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
            const v1Data = await v1Resp.json();
            rawPayload = v1Data.FileContent || v1Data.File || v1Data.fileContent || v1Data.file;
        } else {
            // Direct binary response fallback
            rawPayload = await v1Resp.arrayBuffer();
        }

        if (!rawPayload) {
            throw new Error("No OFP document content returned by Skyplan.");
        }

        // 3. Decompress ZIP or parse raw PDF
        if (typeof extractPdfFromZipOrRaw !== 'function') {
            throw new Error("PDF decompression utility (extractPdfFromZipOrRaw) is missing.");
        }

        const pdfBytes = await extractPdfFromZipOrRaw(rawPayload);
        const byteLength = pdfBytes ? (pdfBytes.byteLength || pdfBytes.length || 0) : 0;

        if (!pdfBytes || byteLength < 500) {
            throw new Error("Failed to extract valid PDF from Skyplan response (document corrupted or empty).");
        }

        // 4. Save to offline cache (non-blocking, non-fatal)
        if (typeof savePdfToOfflineCache === 'function') {
            try {
                await savePdfToOfflineCache(flightId, flightNum, dateStr, pdfBytes, isFinalizedOnServer);
            } catch (cacheErr) {
                console.warn("[Offline Cache Write Warning]", cacheErr);
            }
        }

        return { 
            pdfBytes, 
            isFinalized: isFinalizedOnServer, 
            isServerFilled: isFinalizedOnServer,
            isCached: false 
        };
    }

/* ---------------- Robust Journey-Log fetcher ----------------
 * Etsii kentät rekursiivisesti ja tukee useita kirjoitusasuja.
 * ----------------------------------------------------------- */
function _deepPick(obj, keys, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return null;
  for (const k of keys) {
    const v = obj[k];
    if (v != null && v !== '') return v;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const found = _deepPick(v, keys, depth + 1);
      if (found != null && found !== '') return found;
    }
  }
  return null;
}

async function fetchJourneyLog(flightId, token) {
  if (!flightId) throw new Error("Cannot fetch journey log: Missing flightId.");

  const authToken = token || (typeof getValidSkyplanToken === 'function'
    ? await getValidSkyplanToken().catch(() => null) : null);
  if (!authToken) throw new Error("Skyplan authentication token missing or expired.");

  const url = `https://kcskyplanapi.airastana.com/api/v1/flights/${flightId}/journey-log`;
  const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${authToken}` } });

  if (resp.status === 401 || resp.status === 403)
    throw new Error("Skyplan authentication rejected. Please re-login.");
  if (resp.status === 422)
    throw new Error("Journey log not available yet (flight may not be completed).");
  if (!resp.ok)
    throw new Error(`Skyplan server error (HTTP ${resp.status})`);

  const data = await resp.json();

  const crewRaw = _deepPick(data, ['CrewDuty', 'crewDuty', 'crew']);
  const crewDuty = Array.isArray(crewRaw) ? crewRaw.map(c => ({
    staffId:   _deepPick(c, ['StaffID', 'StaffId', 'staffId', 'Id', 'id']),
    firstName: _deepPick(c, ['FirstName', 'firstName', 'firstname']) || '',
    lastName:  _deepPick(c, ['LastName',  'lastName',  'lastname'])  || '',
    position:  _deepPick(c, ['PositionCode', 'Position', 'position']) || '',
    fdp:       _deepPick(c, ['FDP', 'fdp']),
    maxFdp:    _deepPick(c, ['MaxFPD', 'MaxFdp', 'maxFdp'])
  })) : [];

  const result = {
    flightId:     _deepPick(data, ['FlightID', 'FlightId', 'flightId']) || flightId,
    flightNumber: _deepPick(data, ['FlightNumber', 'flightNumber']) || '',
    atd:          _deepPick(data, ['ATD', 'Atd', 'atd']),
    ata:          _deepPick(data, ['ATA', 'Ata', 'ata']),
    takeoff:      _deepPick(data, ['TakeOff', 'Takeoff', 'takeoff', 'Take_Off']),
    touchdown:    _deepPick(data, ['TouchDown', 'Touchdown', 'touchdown', 'Touch_Down']),
    blockTime:    _deepPick(data, ['BlockTime', 'blockTime', 'Block_Time']),
    flightTime:   _deepPick(data, ['FlightTime', 'flightTime', 'Flight_Time']),
    crewDuty,
    raw: data
  };


  return result;
}

window.fetchJourneyLog = fetchJourneyLog;
async function autoImportCompletedFlights(assignedFlights, token, ownStaffId) {
    const imported = [];

    for (const f of assignedFlights) {
        const flightId = f.ID || f.id || f.FlightID;
        if (!flightId) continue;

        // Ohita jos jo importattu
        if (getLogbookEntryByFlightId(flightId)) continue;

        // Onko lento päättynyt?
        const sta = new Date(f.StaLt || f.Sta || 0).getTime();
        if (!sta || Date.now() < sta + 10 * 60 * 1000) continue;

        try {
            const log = await fetchJourneyLog(flightId, token);
            if (!log.ata) continue; // ei vielä ACARS-dataa

            const entry = mapJourneyLogToEntry(log, {
                depIcao: f.DepartureStationIcaoCode,
                arrIcao: f.ArrivalStationIcaoCode,
                aircraftModel: f.AircraftDescription,
                aircraftReg: f.RegistrationNumber
            }, ownStaffId);

            saveLogbookEntry(entry);
            imported.push(entry);
        } catch (e) {
            console.warn(`[Logbook AutoImport] Skip ${flightId}:`, e.message);
        }
    }

    if (imported.length && typeof showToast === 'function') {
        showToast(`${imported.length} lento(a) tuotu lokikirjaan — allekirjoita lopuksi.`, 'success');
    }
    return imported;
}

// Yksi EASA-lokikirjarivi (vastaa sarakkeita 1–12)
function createLogbookEntry() {
    return {
        id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()),
        
        // Sarakkeet 1–8 (sivu 1)
        date: '',                                    // 1
        departure: { place: '', time: '' },          // 2
        arrival:   { place: '', time: '' },          // 3
        aircraft:  { make: '', model: '', variant: '', registration: '' }, // 4
        singlePilot: { se: '', me: '' },             // 5
        multiPilot: '',                              // 6
        totalTimeOfFlight: '',                       // 7  (HH:MM)
        picName: '',                                 // 8
        takeoffs: { day: 0, night: 0 },
        landings: { day: 0, night: 0 },

        // Sarakkeet 9–12 (sivu 2)
        operationalCondition: { night: '', ifr: '' }, // 9
        pilotFunction: { pic: '', copilot: '', dual: '', instructor: '' }, // 10
        fstd: { date: '', type: '', totalTime: '' },   // 11
        remarks: '',                                   // 12
        
        // Allekirjoitus & metadata
        signatureDataUrl: null,
        signedAt: null,
        
        skyplan: {
            flightId: null,
            flightNumber: '',
            importedAt: null,
            atd: null, ata: null, takeoff: null, touchdown: null,
            blockTime: null, flightTime: null
        }
    };
}

// Apurit
function createModal(options, legacyMessage = '', legacyConfirm = 'OK', legacyCancel = null) {
    let opts = {};
    if (typeof options === 'string') {
        // Handled legacy positional calls: createModal("Title", "Message", "ConfirmText", "CancelText")
        opts = {
            title: options,
            message: legacyMessage,
            confirmText: legacyConfirm,
            cancelText: legacyCancel
        };
    } else if (options && typeof options === 'object') {
        opts = options;
    }

    const {
        title = 'Notice',
        message = '',
        confirmText = 'OK',
        cancelText = null,
        onConfirm,
        onCancel,
        type = 'info',
        icon = '📋',
        showVersion = null,
        listItems = null,
        bodyHTML = '',
        centered = true,
        compact = false,
        maxWidth = null
    } = opts;

    return new Promise((resolve) => {
        const dialog = document.createElement('div');
        dialog.style.cssText = `position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: flex; justify-content: center; align-items: center; z-index: 10001; backdrop-filter: blur(5px); animation: fadeIn 0.2s ease;`;

        const color = type === 'error' ? 'var(--error, #ff3b30)' : 'var(--accent, #007aff)';
        const align = centered ? 'text-align: center;' : 'text-align: left;';
        const width = maxWidth || (compact ? '400px' : '500px');

        const listHTML = (listItems && listItems.length) 
            ? `<div style="margin-bottom: 25px; max-height: 400px; overflow-y: auto; ${align}">
                <ul style="list-style: none; padding: 0; margin: 0;">
                   ${listItems.map(item => `<li style="margin-bottom: 8px; color: var(--text);">${item}</li>`).join('')}
                </ul>
               </div>` 
            : '';

        dialog.innerHTML = `
            <div style="background: var(--panel, #1c1c1e); border-radius: 20px; padding: ${compact ? '15px' : '30px'}; max-width: ${width}; width: 90%; border: 2px solid ${color}; box-shadow: 0 20px 40px rgba(0,0,0,0.5); text-align: left;">
                <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 20px;">
                    <span style="font-size: 40px;">${icon}</span>
                    <div>
                        <h2 style="color: ${color}; margin: 0; font-size: 24px;">${title || 'Notice'}</h2>
                        ${showVersion ? `<p style="color: var(--dim, #8e8e93); margin: 5px 0 0 0;">Version ${showVersion}</p>` : ''}
                    </div>
                </div>
                ${message ? `<div style="color: var(--text, #ffffff); margin-bottom: 25px; line-height: 1.5; ${align}">${message}</div>` : ''}
                ${listHTML}
                ${bodyHTML ? `<div style="margin-bottom: 25px;">${bodyHTML}</div>` : ''}
                <div style="display: flex; gap: 15px; margin-top: 25px;">
                    ${cancelText ? `<button id="modal-cancel" style="flex:1; padding:14px; background:var(--input, #2c2c2e); border:1px solid var(--border, #38383a); color:var(--text, #ffffff); border-radius:12px; font-weight:600; cursor:pointer;">${cancelText}</button>` : ''}
                    <button id="modal-confirm" style="flex:1; padding:14px; background:${color}; border:none; color:white; border-radius:12px; font-weight:800; cursor:pointer;">${confirmText}</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        const confirmBtn = dialog.querySelector('#modal-confirm');
        if (confirmBtn) {
            confirmBtn.onclick = () => { 
                if (onConfirm) onConfirm(); 
                dialog.remove(); 
                resolve(true); 
            };
        }    
        if (cancelText) {
            const cancelBtn = dialog.querySelector('#modal-cancel');
            if (cancelBtn) {
                cancelBtn.onclick = () => { 
                    if (onCancel) onCancel(); 
                    dialog.remove(); 
                    resolve(false); 
                };
            }
        }
    });
}

const hhmmFromIso = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
};

const yyyymmddFromIso = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
};

// "01:35:00" → "1:35"
const blockToHHMM = (hhmmss) => {
    if (!hhmmss) return '';
    const [h, m] = String(hhmmss).split(':');
    return `${parseInt(h, 10)}:${String(m).padStart(2,'0')}`;
};

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

function computeTotals(entries, previousTotals = { thisPage: '0:00', previous: '0:00' }) {
    return {
        thisPage: sumHHMM(entries.map(e => e.totalTimeOfFlight)),
        previous: previousTotals.previous,
        total: sumHHMM([previousTotals.previous, sumHHMM(entries.map(e => e.totalTimeOfFlight))])
    };
}



function promptLogbookSignature(entryId) {
  const entry = getLogbookEntry(entryId);
  if (!entry) return Promise.reject(new Error("Entry not found"));

  return new Promise((resolve) => {
    const savedLicense = getLicenseForPilot(entry.picName);

    const bodyHTML = `
      <div style="display:flex; flex-direction:column; gap:14px;">
        <div style="font-size:13px; color:var(--dim);">
          <strong>${entry.skyplan?.flightNumber || ''}</strong> · 
          ${entry.departure?.place || ''} → ${entry.arrival?.place || ''} · 
          ${entry.date || ''} · ${entry.totalTimeOfFlight || ''}
        </div>

        <div>
          <label style="display:block; font-size:12px; font-weight:600; color:var(--dim); margin-bottom:6px;">
            Pilot's license number
          </label>
          <input type="text" id="lb-license" 
                 placeholder="esim. FI.FCL.111"
                 value="${savedLicense || ''}"
                 style="width:100%; padding:10px 12px; border-radius:8px;
                        background:var(--input); color:var(--text);
                        border:1px solid var(--border); font-size:13px;
                        font-family:var(--font-mono); box-sizing:border-box;">
        </div>

        <div>
          <label style="display:block; font-size:12px; font-weight:600; color:var(--dim); margin-bottom:6px;">
            Remarks and endorsements (sarake 12)
          </label>
          <textarea id="lb-remark" rows="3" placeholder="Valinnainen"
              style="width:100%; padding:10px; border-radius:8px; background:var(--input);
                     color:var(--text); border:1px solid var(--border); font-size:13px;
                     box-sizing:border-box;">${entry.remarks || ''}</textarea>
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
      title: 'Sign Logbook Entry',
      icon: '✍️',
      bodyHTML,
      confirmText: 'Sign & Save',
      cancelText: 'Cancel',
      maxWidth: '640px',
      compact: true,
      onConfirm: async () => {
        const canvas = document.getElementById('lb-sig-pad');
        const remark = (document.getElementById('lb-remark')?.value || '').trim();
        const license = (document.getElementById('lb-license')?.value || '').trim();
        const dataUrl = canvas.toDataURL('image/png');

        const blank = document.createElement('canvas');
        blank.width = canvas.width; blank.height = canvas.height;
        if (dataUrl === blank.toDataURL('image/png')) {
          if (typeof showToast === 'function') {
            showToast('Signature required before signing.', 'warning');
          }
          return false;
        }

        if (license && entry.picName) {
          setLicenseForPilot(entry.picName, license);
        }

                entry.remarks = remark;
        entry.licenseNumber = license || '';
        entry.signatureDataUrl = dataUrl;
        entry.signedAt = new Date().toISOString();
        entry.sealedAt = new Date().toISOString();

        // Tallenna ennen sinetöintiä → hash-ketju näkee tämän entryn
        saveLogbookEntry(entry);

        if (entry.hash) {
          _auditAppend({
            type: 'reseal',
            entryId: entry.id,
            oldHash: entry.hash,
            at: entry.signedAt,
            by: entry.picName || ''
          });
        }

        try {
          await sealLogbookEntry(entry);
        } catch (err) {
          console.error('[Seal] failed:', err);
          if (typeof showToast === 'function') {
            showToast('Sinetöinti epäonnistui — hash ei päivittynyt.', 'error');
          }
        }

        // Tallenna uudelleen sinetöinnin jälkeen (hash + prevHash päivittyivät)
        saveLogbookEntry(entry);

        if (typeof showToast === 'function') {
          showToast('Kirjaus allekirjoitettu ja sinetöity.', 'success');
        }
        if (typeof renderChainStatusBadge === 'function') {
          renderChainStatusBadge();
        }
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
    });
  });
}

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
  const TABLE_TOP = PH - 60;                 // Header ylhäällä
  const TABLE_BOTTOM = TABLE_TOP - 28 - MAX_ROWS * ROW_H;   // Taulukon ala
  const TOTALS_TOP = TABLE_BOTTOM - 18;       // 6 px rako taulukkoon

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

    /* ============ SIVU 1: sarakkeet 1–8 ============ */
    const p1 = pdf.addPage([PW, PH]);
    drawTableHeader(p1, font, bold, cols1, margin, TABLE_TOP, black);
    drawRows(p1, font, cols1, chunk, margin, TABLE_TOP, ROW_H, MAX_ROWS);

    // Total-rivit sivu 1: SE, ME, Multi, Total, TK-D, TK-N, LD-D, LD-N
    drawTotalsRows(p1, font, bold, cols1, margin, TOTALS_TOP, ROW_H,
      ['spSE','spME','multi','total','tkD','tkN','ldD','ldN'],
      [
        { label: 'Total this page',      data: pageSum },
        { label: 'Total previous pages', data: runningPrevious },
        { label: 'Total time',           data: totalSum }
      ]
    );

    /* ============ SIVU 2: sarakkeet 9–12 ============ */
    const p2 = pdf.addPage([PW, PH]);
    drawTableHeader(p2, font, bold, cols2, margin, TABLE_TOP, black);
    drawRows(p2, font, cols2, chunk, margin, TABLE_TOP, ROW_H, MAX_ROWS);

    // Total-rivit sivu 2: Night, IFR, PIC, Co-pilot, Dual, Instructor, FSTD Total
        // Total-rivit sivu 2
    drawTotalsRows(p2, font, bold, cols2, margin, TOTALS_TOP, ROW_H,
      ['night','ifr','pic','co','dual','inst','fTime'],
      [
        { label: 'Total this page',      data: pageSum },
        { label: 'Total previous pages', data: runningPrevious },
        { label: 'Total time',           data: totalSum }
      ],
      false   // ← TÄMÄ PUUTTUU SINULTA
    );

    // Sarake 12: Remarks (koko korkeus)
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

        // Rivi 1: remarks-teksti (jos olemassa)
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

      // Rivi 2: lupakirjanumero (jos olemassa)
      if (e.licenseNumber) {
        p2.drawText(`Lic. ${e.licenseNumber}`, {
          x: remarksX + 3, y: y + 2, size: 6.5, font: bold, color: RGB(0.3, 0.3, 0.3)
        });
      }
    }

       // Certification-lohko
    const certTopY = dataTopY - MAX_ROWS * ROW_H;
    const certH = 70;
    p2.drawRectangle({
      x: remarksX, y: certTopY - certH, width: remarksW, height: certH,
      borderColor: black, borderWidth: 0.7
    });

    p2.drawText('I certify that the entries in this log are true.', {
      x: remarksX + 6, y: certTopY - 14, size: 8, font, color: black
    });

    // Lupakirjanumero (jos annettu)
    if (certification?.license) {
      p2.drawText(`Lic. ${certification.license}`, {
        x: remarksX + 6, y: certTopY - 26, size: 7, font: bold,
        color: RGB(0.3, 0.3, 0.3)
      });
    }

    p2.drawText("Pilot's signature:", {
      x: remarksX + 6, y: certTopY - 40, size: 8, font, color: black
    });

    // Certification-allekirjoituskuva
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

/* ==============================================================
 * Total-rivit taulukon alaosassa
 * ==============================================================
 * @param showLabels — jos true, piirretään "This page / Previous / Total"
 *                     vasempaan reunaan (sivu 1)
 *                     jos false, piirretään pelkät numerot (sivu 2)
 * ============================================================== */
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

  // Jos näytetään labelit → hypätään 2 ensimmäistä saraketta
  // Jos ei → käytetään kaikkia sarakkeita
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

    // Yläviiva
    page.drawLine({
      start: { x, y: rowTop },
      end:   { x: x + totalWidth, y: rowTop },
      thickness: 0.5,
      color: RGB(0.2, 0.2, 0.2)
    });

    // Label vasemmalle — vain sivulla 1
    if (showLabels) {
      page.drawText(SHORT[row.label] || row.label, {
        x: x + 3, y: textY, size: 7, font: bold, color: RGB(0, 0, 0)
      });
    }

    // Arvot sarakkeiden alle
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

  // Alaviiva
  const bottomY = startY - rows.length * rowH;
  page.drawLine({
    start: { x, y: bottomY },
    end:   { x: x + totalWidth, y: bottomY },
    thickness: 0.5,
    color: RGB(0.2, 0.2, 0.2)
  });
}
/* ==============================================================
 * Summa-apurit
 * ============================================================== */
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

/* ==============================================================
 * Tekstin leikkaus — sovittaa tekstin sarakkeen leveyteen
 * ==============================================================
 * @param text     — leikattava teksti
 * @param font     — pdf-lib-fontti
 * @param size     — fonttikoko
 * @param maxWidth — sarakkeen sisäleveys (pt) miinus padding
 * @returns        — teksti joko sellaisenaan tai "…"-lyhennettynä
 * ============================================================== */
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

/* --- Rivit: rajoita MAX_ROWS --- */
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
        // Leikkaa sarakkeen leveyteen (padding 3+3 = 6 pt)
        const txt = _truncText(String(val), font, 8, c.w - 6);
        page.drawText(txt, {
          x: cx + 3, y: y + 5, size: 8, font, color: RGB(0, 0, 0)
        });
      }
      cx += c.w;
    }
  }

  // Täytä tyhjät rivit
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



// --- Apufunktiot ---

function drawTableHeader(page, font, bold, cols, x, topY, color) {
    let cx = x;
    // Otsikkorivi
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
    // Numerot 1..N
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
        case 'depP':    return e.departure.place;
        case 'depT':    return e.departure.time;
        case 'arrP':    return e.arrival.place;
        case 'arrT':    return e.arrival.time;
        case 'ac':      return [e.aircraft.make, e.aircraft.model, e.aircraft.variant, e.aircraft.registration].filter(Boolean).join(' ');
        case 'spSE':    return e.singlePilot.se;
        case 'spME':    return e.singlePilot.me;
        case 'multi':   return e.multiPilot;
        case 'total':   return e.totalTimeOfFlight;
        case 'picName': return e.picName;
        case 'tkD':     return e.takeoffs.day || '';
        case 'tkN':     return e.takeoffs.night || '';
        case 'ldD':     return e.landings.day || '';
        case 'ldN':     return e.landings.night || '';
        case 'night':   return e.operationalCondition.night;
        case 'ifr':     return e.operationalCondition.ifr;
        case 'pic':     return e.pilotFunction.pic;
        case 'co':      return e.pilotFunction.copilot;
        case 'dual':    return e.pilotFunction.dual;
        case 'inst':    return e.pilotFunction.instructor;
        case 'fDate':   return e.fstd.date;
        case 'fType':   return e.fstd.type;
        case 'fTime':   return e.fstd.totalTime;
        default:        return '';
    }
}


async function printLogbook(entries, previousTotals) {
    const totals = computeTotals(entries, previousTotals);
    const bytes = await generateLogbookPDF(entries, totals);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);

    // Avaa uudessa välilehdessä → käyttäjä voi tulostaa / tallentaa
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);

    // TAI suora lataus:
    // if (typeof downloadBlob === 'function') downloadBlob(blob, `Logbook_${Date.now()}.pdf`);
}

/* ==============================================================
 * AUTO-IMPORT · Päättyneet lennot lokikirjaan
 * ============================================================== */

const AUTOIMPORT_LAST_SCAN_KEY = 'easa_logbook_last_scan';
const AUTOIMPORT_INTERVAL_MS   = 15 * 60 * 1000;  // 15 min
const AUTOIMPORT_LOOKBACK_DAYS = 7;

// Estä rinnakkaiset skannaukset
let _autoScanInFlight = false;

async function scanForCompletedFlights() {
  if (_autoScanInFlight) return [];
  if (!navigator.onLine) return [];

  _autoScanInFlight = true;
  const imported = [];

  try {
    const roster = JSON.parse(localStorage.getItem('assigned_flights_cache') || '[]');
    if (!Array.isArray(roster) || !roster.length) return [];

    const token = (typeof getValidSkyplanToken === 'function')
      ? await getValidSkyplanToken().catch(() => null)
      : null;
    if (!token) return [];

    const now = Date.now();
    const lookbackMs = AUTOIMPORT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

    const candidates = roster.filter(f => {
      if (!f || typeof f !== 'object') return false;

      const flightId = f.ID || f.id || f.FlightID;
      if (!flightId) return false;

      // Onko jo lokikirjassa?
      if (getLogbookEntryByFlightId(flightId)) return false;

      // Laskeutunut?
      const sta = new Date(f.StaLt || f.Sta || 0).getTime();
      if (!sta || now < sta + 10 * 60 * 1000) return false;

      // Ei liian vanha (vältä historian massiivista backfilliä)
      if (now - sta > lookbackMs) return false;

      return true;
    });

    // Rajoita erä (rate-limit)
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

    // Tallenna viimeisin skannaus
    try {
      localStorage.setItem(AUTOIMPORT_LAST_SCAN_KEY, String(now));
    } catch (e) {}

    if (imported.length && typeof showToast === 'function') {
      showToast(
        `${imported.length} lento(a) tuotu automaattisesti lokikirjaan.`,
        'success', 4500
      );
      // Päivitä näkymä jos ollaan lokikirja-tabilla
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

/* --- Wrap loadAssignedFlights → skannaa heti roisterin jälkeen --- */
(function wrapLoadAssignedFlights() {
  if (typeof window.loadAssignedFlights !== 'function') return;
  const orig = window.loadAssignedFlights;
  window.loadAssignedFlights = async function (...args) {
    const result = await orig.apply(this, args);

    // Skannaa vain jos viikkonäkymä EI ole aktiivinen
    const weekActive = document.querySelector(
      '#flights-view-toggle .vt-btn[data-view="week"].active'
    );
    if (!weekActive) {
      setTimeout(() => scanForCompletedFlights().catch(() => {}), 1500);
    }
    return result;
  };
})();

/* --- Audit badge: päivitä aina kun lokikirja renderöidään --- */
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

/* --- Periodinen skannaus --- */
setInterval(() => {
  if (navigator.onLine) scanForCompletedFlights().catch(() => {});
}, AUTOIMPORT_INTERVAL_MS);

/* --- Kun tullaan takaisin online-tilaan --- */
window.addEventListener('online', () => {
  setTimeout(() => scanForCompletedFlights().catch(() => {}), 2000);
});

/* --- Ensimmäinen skannaus 5 s käynnistyksestä --- */
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => scanForCompletedFlights().catch(() => {}), 5000);
});

/* ==============================================================
 * PDF TALLENNUS · iPad Files / Share Sheet
 * ==============================================================
 * Strategia:
 *   1. iOS / iPadOS + Web Share API Level 2 → natiivijakovalikko
 *      → "Tallenna tiedostoon" → Files-sovellus
 *   2. Muut selaimet → perinteinen download-linkki (blob URL)
 *   3. Viimeinen fallback → avaa uudessa välilehdessä
 *
 * HUOM: iOS:lla älä koskaan lähetä title/text/url-kenttiä files-
 * jaon yhteydessä — muuten iOS luulee että jaat tekstiä, ei
 * tiedostoa. Tämä on WebKit-bugin tunnettu käyttäytyminen.
 * ============================================================== */

function _isIOSLike() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/* ==============================================================
 * Geneerinen tiedostontallennus (PDF, CSV, JSON, …)
 * ============================================================== */
async function saveBlobToDevice(blob, filename, mimeType = 'application/octet-stream') {
  if (!blob || !blob.size) throw new Error("Empty blob.");

  const safeName = String(filename || 'document')
    .replace(/[\\/:*?"<>|]/g, '_');
  const fullName = safeName.toLowerCase().endsWith(`.${mimeType.split('/')[1]}`)
    ? safeName
    : safeName;

  let file = null;
  try {
    file = new File([blob], fullName, { type: mimeType, lastModified: Date.now() });
  } catch (e) {
    console.warn('[Save] File() ei tuettu');
  }

  // 1) iOS: natiivi share sheet
  if (_isIOSLike() && file && navigator.canShare && navigator.share) {
    try {
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });   // vain files!
        return 'shared';
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      console.warn('[Save] share failed:', err);
    }
  }

  // 2) Download-attribuutti
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

  // 3) Fallback: uusi välilehti
  try {
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return 'opened';
  } catch (e) {
    URL.revokeObjectURL(url);
    throw new Error('Tiedoston tallennus ei onnistunut.');
  }
}

/* PDF-spesifinen wrapper (yhteensopivuus) */
async function savePDFToDevice(pdfBytes, filename) {
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  return saveBlobToDevice(blob, `${filename}.pdf`, 'application/pdf');
}

/* ==============================================================
 * CSV-VIENTI · EASA FCL.050 lokikirja
 * ==============================================================
 * - Sarake-erotin: puolipiste ( ; ) → toimii suoraan
 *   eurooppalaisessa Excelissä ja Numbersissa.
 * - UTF-8 BOM → ä/ö näkyvät oikein Excelissä.
 * - Kaikki 12 EASA-saraketta + audit-metadata.
 * ============================================================== */

/* --- CSV-kentän escapetus: RFC 4180 + puolipiste-erotin --- */
function _csvEscape(value) {
  if (value == null) return '';
  const s = String(value);
  // Jos sisältää erottimen, lainausmerkin, rivinvaihdon → lainataan
  if (/[";\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function _csvRow(cells) {
  return cells.map(_csvEscape).join(';');
}

/* --- Kokoa yksi entry CSV-riviksi --- */
function _entryToCsvRow(e) {
  return _csvRow([
    // 1. Päivämäärä
    e.date || '',

    // 2–3. Lähtö / saapuminen
    e.departure?.place || '',
    e.departure?.time  || '',
    e.arrival?.place   || '',
    e.arrival?.time    || '',

    // 4. Kone
    e.aircraft?.make || '',
    e.aircraft?.model || '',
    e.aircraft?.variant || '',
    e.aircraft?.registration || '',

    // 5–6. Single / multi-pilot
    e.singlePilot?.se || '',
    e.singlePilot?.me || '',
    e.multiPilot || '',

    // 7. Kokonaislentoaika
    e.totalTimeOfFlight || '',

    // 8. PIC
    e.picName || '',

    // Takeoffs
    e.takeoffs?.day   ?? '',
    e.takeoffs?.night ?? '',

    // Landings
    e.landings?.day   ?? '',
    e.landings?.night ?? '',

    // 9. Operational condition
    e.operationalCondition?.night || '',
    e.operationalCondition?.ifr   || '',

    // 10. Pilot function
    e.pilotFunction?.pic        || '',
    e.pilotFunction?.copilot    || '',
    e.pilotFunction?.dual       || '',
    e.pilotFunction?.instructor || '',

    // 11. FSTD
    e.fstd?.date || '',
    e.fstd?.type || '',
    e.fstd?.totalTime || '',

    // 12. Remarks
    e.remarks || '',

    // --- Metadata (Skyplan + Audit) ---
    e.skyplan?.flightNumber || '',
    e.skyplan?.flightId     || '',
    e.skyplan?.atd          || '',
    e.skyplan?.takeoff      || '',
    e.skyplan?.touchdown    || '',
    e.skyplan?.ata          || '',
    e.skyplan?.blockTime    || '',
    e.skyplan?.flightTime   || '',

    e.signedAt  || '',
    e.sealedAt  || '',
    e.hash      || '',
    e.prevHash  || ''
  ]);
}

/* --- Otsikkorivi --- */
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

/* --- Varsinainen vienti --- */
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

  // Yhteenvetorivit loppuun (valinnainen)
  const totals = computeTotals(entries, { thisPage: '0:00', previous: '0:00' });
  lines.push('');
  lines.push(_csvRow(['Total this page', totals.thisPage]));
  lines.push(_csvRow(['Total previous pages', totals.previous]));
  lines.push(_csvRow(['Total time', totals.total]));
  lines.push(_csvRow(['Entries', String(entries.length)]));
  lines.push(_csvRow(['Exported', new Date().toISOString()]));

  const csv = lines.join('\r\n');             // CRLF = Excel-yhteensopiva
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
      showToast(
        result === 'shared'
          ? 'CSV valmis — valitse "Tallenna tiedostoon".'
          : 'CSV ladattu.',
        'success'
      );
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
 * JSON-VARUUSKOPIO · täysi palautus
 * ==============================================================
 * Sisältää kaiken: entryt, allekirjoitukset (base64 PNG),
 * hash-ketjun ja audit-lokin. Ainoa tapa palauttaa kirja
 * täysin identtisenä.
 * ============================================================== */
async function exportLogbookJSON(options = {}) {
  const payload = {
    _meta: {
      app: 'Jarvis Flight Deck',
      schema: 'easa-logbook-v1',
      exported: new Date().toISOString(),
      entryCount: getLogbookEntries().length,
      auditEvents: getAuditLog().length,
      userAgent: navigator.userAgent
    },
    entries: getLogbookEntries(),
    auditLog: getAuditLog()
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

/* ==============================================================
 * JSON-PALAUTUS (import)
 * ==============================================================
 * Palauttaa koko lokikirjan JSON-varmuuskopiosta.
 * Kysyy vahvistuksen ja ylikirjoittaa nykyisen datan.
 * ============================================================== */
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
              ⚠ Nykyinen lokikirja (${getLogbookEntries().length} kirjausta) korvataan kokonaan.
            </p>
            <p style="color:var(--dim); font-size:12px;">
              Suositus: vie ensin nykyinen tila CSV:nä talteen.
            </p>
          </div>`;

        // Käytä olemassa olevaa createModal:ia
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

        // Varmuuskopioi nykyinen tila automaattisesti ennen ylikirjoitusta
        try {
          const backup = {
            _meta: { auto: true, at: new Date().toISOString(), reason: 'before-import' },
            entries: getLogbookEntries(),
            auditLog: getAuditLog()
          };
          localStorage.setItem('easa_logbook_autobackup_v1', JSON.stringify(backup));
        } catch (e) {}

        // Kirjoita uusi data
        localStorage.setItem('easa_logbook_v1', JSON.stringify(data.entries));
        if (Array.isArray(data.auditLog)) {
          localStorage.setItem('easa_logbook_audit_v1', JSON.stringify(data.auditLog));
        }

        // Päivitä UI
        if (typeof renderLogbookTable === 'function') renderLogbookTable();
        if (typeof renderChainStatusBadge === 'function') renderChainStatusBadge();

        if (typeof showToast === 'function') {
          showToast(`Palautettu ${data.entries.length} kirjausta.`, 'success');
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
 * UI: vientimodaali
 * ============================================================== */
function showExportDialog() {
  const entries = getLogbookEntries();
  if (!entries.length) {
    if (typeof showToast === 'function') showToast('Ei kirjauksia vietäväksi.', 'warning');
    return;
  }

  const signed = entries.filter(e => e.hash).length;

  const body = `
    <div style="font-size:13px; color:var(--dim); margin-bottom:16px;">
      Lokikirjassa <b style="color:var(--text);">${entries.length}</b> kirjausta
      (${signed} sinetöity).
    </div>

    <div style="display:flex; flex-direction:column; gap:10px;">
      <button type="button" data-action="csv"
        style="display:flex; align-items:center; gap:14px; padding:16px 18px;
               background:var(--input); border:1px solid var(--border);
               border-radius:12px; color:var(--text); text-align:left; cursor:pointer;
               transition:all 0.15s;">
        <span style="font-size:26px;">📊</span>
        <span style="flex:1;">
          <span style="display:block; font-weight:700; margin-bottom:2px;">CSV (Excel / Numbers)</span>
          <span style="font-size:11.5px; color:var(--dim);">
            Kaikki 12 saraketta + audit-metadata. Puolipiste-erotin, UTF-8 BOM.
          </span>
        </span>
      </button>

      <button type="button" data-action="json"
        style="display:flex; align-items:center; gap:14px; padding:16px 18px;
               background:var(--input); border:1px solid var(--border);
               border-radius:12px; color:var(--text); text-align:left; cursor:pointer;
               transition:all 0.15s;">
        <span style="font-size:26px;">💾</span>
        <span style="flex:1;">
          <span style="display:block; font-weight:700; margin-bottom:2px;">JSON-varmuuskopio</span>
          <span style="font-size:11.5px; color:var(--dim);">
            Täysi palautus: allekirjoitukset, hash-ketju, audit-loki.
          </span>
        </span>
      </button>

      <button type="button" data-action="restore"
        style="display:flex; align-items:center; gap:14px; padding:16px 18px;
               background:var(--input); border:1px solid var(--border);
               border-radius:12px; color:var(--text); text-align:left; cursor:pointer;
               transition:all 0.15s;">
        <span style="font-size:26px;">↺</span>
        <span style="flex:1;">
          <span style="display:block; font-weight:700; margin-bottom:2px;">Palauta varmuuskopiosta</span>
          <span style="font-size:11.5px; color:var(--dim);">
            JSON-tiedostosta. Korvaa nykyisen datan (autobackup otetaan).
          </span>
        </span>
      </button>
    </div>
  `;

  createModal({
    title: 'Vie lokikirja',
    icon: '⬇',
    bodyHTML: body,
    confirmText: 'Sulje',
    maxWidth: '540px',
    onConfirm: () => {}
  });

  // Kiinnitä nappien toiminnallisuus modaalin renderöitymisen jälkeen
  setTimeout(() => {
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        // Sulje modaali
        const modal = btn.closest('div[style*="position: fixed"]');
        if (modal) modal.remove();

        if (action === 'csv')     await exportLogbookCSV();
        if (action === 'json')    await exportLogbookJSON();
        if (action === 'restore') await importLogbookJSON();
      });
    });
  }, 30);
}
window.showExportDialog = showExportDialog;

async function saveLogbookPDF(entries, previousTotals, options = {}) {
  const list = Array.isArray(entries) ? entries : (window._lbEntries || []);
  if (!list.length) {
    if (typeof showToast === 'function') {
      showToast('Ei kirjauksia tallennettavaksi.', 'warning');
    }
    return;
  }

  // 1. Kysy allekirjoitus (tai käytä tallennettua)
  const cert = await promptCertificationSignature();

  if (!cert || !cert.dataUrl) {
    if (typeof showToast === 'function') {
      showToast('Allekirjoitus peruutettu.', 'info');
    }
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
 * CERTIFICATION-ALLEKIRJOITUS · popup ennen PDF:ää
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

        // Onko tyhjä?
        const blank = document.createElement('canvas');
        blank.width = canvas.width;
        blank.height = canvas.height;
        const isBlank = dataUrl === blank.toDataURL('image/png');

        if (isBlank) {
          // Jos aiempi on olemassa, käytä sitä
          if (saved?.dataUrl) {
            resolve({ dataUrl: saved.dataUrl, license: license || saved.license || '' });
            return;
          }
          if (typeof showToast === 'function') {
            showToast('Piirrä allekirjoitus ennen PDF:n luontia.', 'warning');
          }
          return false;   // estä modaalin sulkeutuminen
        }

        // Tallenna uusi
        setCertificationSignature(dataUrl, license);
        resolve({ dataUrl, license });
      },
      onCancel: () => resolve(null)
    });

    // Piirto canvas
    requestAnimationFrame(() => {
      const canvas = document.getElementById('cert-sig-pad');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#000';

      // Lataa aiempi allekirjoitus jos on
      if (saved?.dataUrl) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
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

window.previewOFPFromSkyplan = async function(flightId, flightNum, dateStr, tailNumber = '') {
        let pdfUrl = null;
        let downloadedBytes = null;

        const cleanupUrl = () => {
            if (pdfUrl) {
                URL.revokeObjectURL(pdfUrl);
                pdfUrl = null;
            }
        };

        showModalLoader("Loading OFP", `Fetching flight plan for <strong>${flightNum || 'Flight'}</strong> (${dateStr || ''})...`);

        try {
            let pdfBlob = null;
            let isFinalized = false;
            let isCached = false;

            // 1. Offline Cache Check
            const tryReadOffline = async () => {
                if (typeof getPdfFromOfflineCache !== 'function') return null;
                try {
                    const cached = await getPdfFromOfflineCache(flightId, flightNum, dateStr);
                    if (cached && cached.pdfBytes && (cached.pdfBytes.byteLength || cached.pdfBytes.length || 0) > 500) {
                        return cached;
                    }
                } catch (e) {
                    console.warn("[Offline Cache Read Warning]", e);
                }
                return null;
            };

            if (!navigator.onLine) {
                const cached = await tryReadOffline();
                if (cached) {
                    downloadedBytes = cached.pdfBytes;
                    pdfBlob = new Blob([cached.pdfBytes], { type: 'application/pdf' });
                    isFinalized = Boolean(cached.isFinalized);
                    isCached = true;
                }
            }

            // 2. Fetch from Skyplan API
            if (!pdfBlob) {
                const token = typeof getValidSkyplanToken === 'function' ? await getValidSkyplanToken().catch(() => null) : null;
                if (typeof fetchSkyplanOFPBytes !== 'function') {
                    throw new Error("Skyplan download service is unavailable.");
                }

                const result = await fetchSkyplanOFPBytes(flightId, token, flightNum, dateStr);
                if (result && result.pdfBytes && (result.pdfBytes.byteLength || result.pdfBytes.length || 0) > 500) {
                    downloadedBytes = result.pdfBytes;
                    isFinalized = Boolean(result.isFinalized);
                    isCached = Boolean(result.isCached);
                    pdfBlob = new Blob([result.pdfBytes], { type: 'application/pdf' });
                } else {
                    throw new Error("Unable to retrieve valid OFP PDF data.");
                }
            }

            if (!pdfBlob || pdfBlob.size < 500) {
                throw new Error("Document data is empty or corrupt.");
            }

            pdfUrl = URL.createObjectURL(pdfBlob);

            let statusTag = '';
            if (isCached) {
                statusTag = ' <span style="color: #ffb300; font-size: 11px; font-weight: bold; margin-left: 8px;">⚡Offline Cache</span>';
            } else if (isFinalized) {
                statusTag = ' <span style="color: var(--success, #32d74b); font-size: 11px; font-weight: bold; margin-left: 8px;">✔ (Finalized)</span>';
            }

            const bodyHTML = `
                <div style="width: 100%; height: 75vh; position: relative; background: var(--bg, #000); border-radius: 8px; overflow: hidden;">
                    <object data="${pdfUrl}" type="application/pdf" style="width: 100%; height: 100%; border: none;">
                        <iframe src="${pdfUrl}" style="width: 100%; height: 100%; border: none;"></iframe>
                    </object>
                </div>
            `;

            // Dismiss loader before opening the preview viewer
            hideModalLoader();

            const modalConfig = {
                title: `${flightNum || 'FLT'} (${dateStr || ''})${statusTag}`,
                bodyHTML: bodyHTML,
                maxWidth: '92%',
                compact: true
            };

            if (isFinalized) {
                modalConfig.confirmText = 'Close';
                modalConfig.cancelText = 'Open Fullscreen';
                modalConfig.onCancel = () => window.open(pdfUrl, '_blank');
                modalConfig.onConfirm = () => cleanupUrl();
            } else {
                modalConfig.confirmText = 'Activate OFP';
                modalConfig.cancelText = 'Close';
                modalConfig.onConfirm = () => {
                    cleanupUrl();
                    // Pass downloaded bytes directly to avoid a duplicate network request
                    if (typeof importOFPFromSkyplan === 'function') {
                        importOFPFromSkyplan(flightId, flightNum, dateStr, tailNumber, downloadedBytes);
                    }
                };
                modalConfig.onCancel = () => cleanupUrl();
            }

            if (typeof createModal === 'function') {
                createModal(modalConfig);
            }

        } catch (error) {
            cleanupUrl();
            hideModalLoader();
            console.error("Preview failed:", error);
            
            if (typeof createModal === 'function') {
                createModal({
                    title: 'Preview Failed',
                    message: error.message || "Failed to load OFP preview.",
                    type: 'error',
                    icon: '⚠️',
                    confirmText: 'OK',
                    compact: true
                });
            } else {
                alert(error.message || "Failed to load OFP preview.");
            }
        }
    };



/* ==============================================================
 * CSV-TUONTI · tuo lokikirja CSV-tiedostosta
 * ==============================================================
 * Tukee:
 *  - Sovelluksen omaa vientiformaattia (40 saraketta)
 *  - Yksinkertaista EASA-formaattia (12 saraketta)
 *  - Auto-detektoi erotin (; tai ,)
 *  - Excel-päivämäärät muunnetaan automaattisesti
 * ============================================================== */

/* --- CSV-parseri (käsittelee lainatut kentät oikein) --- */
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

/* --- Auto-detektoi erotin --- */
function _detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const semis = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return semis >= commas ? ';' : ',';
}

/* --- Normalisoi päivämäärä YYYY-MM-DD --- */
function _normalizeDateCSV(raw) {
  if (!raw) return '';
  const s = String(raw).trim();

  // Excel-sarjanumero (esim. 45678)
  if (/^\d{4,5}$/.test(s)) {
    const days = parseInt(s, 10);
    // Excel epoch 1900-01-01 = 1, mutta Excelissä on 1900-karkausvuosibugi
    // Käytetään standardikaavaa: (days - 25569) * 86400 * 1000 → JS Date
    const ms = (days - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (!isNaN(d)) {
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    }
  }

  // ISO: 2026-10-13
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;

  // DD.MM.YYYY tai DD/MM/YYYY tai DD-MM-YYYY
  m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;

  // DD.MM.YY
  m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2})$/);
  if (m) return `20${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;

  // YYYY/MM/DD
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;

  return s;   // palautetaan sellaisenaan
}

/* --- Normalisoi kellonaika HH:MM --- */
function _normalizeTimeCSV(raw) {
  if (!raw) return '';
  const s = String(raw).trim();

  // HH:MM tai H:MM
  let m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return `${m[1].padStart(2,'0')}:${m[2]}`;

  // Excel time-sarjanumero (0.xxx = vuorokauden osa)
  if (/^0\.\d+$/.test(s)) {
    const frac = parseFloat(s);
    const totalMins = Math.round(frac * 24 * 60);
    const h = Math.floor(totalMins / 60);
    const mi = totalMins % 60;
    return `${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}`;
  }

  // Pelkkä numero (esim. 445 = 04:45)
  if (/^\d{3,4}$/.test(s)) {
    const n = parseInt(s, 10);
    const h = Math.floor(n / 100);
    const mi = n % 100;
    if (h < 24 && mi < 60) return `${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}`;
  }

  return s;
}

/* --- Header-mapaus: tunnista kenttä nimestä --- */
function _buildHeaderMap(headers) {
  const H = headers.map(h => String(h || '').trim().toUpperCase().replace(/[.\s,()]+/g, ' ').trim());

  // Etsii täsmällisen osuman (koko kenttä == pattern)
  const exact = (name) => H.findIndex(h => h === name.toUpperCase());
  // Etsii sisältävän osuman
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

  // SE/ME: yritä ensin tarkkaa osumaa, sitten laajennettua
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
    spSE,
    spME,
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

/* --- Muunna CSV-rivi entryksi --- */
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

  // FSTD-tunnistus: ei lentokenttiä mutta viittaa simulaattoriin
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

  /* ============ FSTD-sessio ============ */
  if (isFSTD) {
    const startTime = _normalizeTimeCSV(get(map.depTime));
    const endTime   = _normalizeTimeCSV(get(map.arrTime));

    // Laske kesto (HH:MM) jos molemmat ajat saatavilla
    let durationHHMM = '';
    if (startTime && endTime) {
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      let diff = (eh * 60 + em) - (sh * 60 + sm);
      if (diff < 0) diff += 24 * 60;
      if (diff > 0) durationHHMM = `${Math.floor(diff / 60)}:${String(diff % 60).padStart(2, '0')}`;
    }

    // Yhdistä tyyppi: SIMULATOR TYPE + AIRCRAFT MAKE / REG
    let fstdType = simType || acField || '';
    if (acReg && !fstdType.includes(acReg)) {
      fstdType = fstdType ? `${fstdType} / ${acReg}` : acReg;
    }
    // Jos AIRCRAFT-sarakkeessa on simulaattorin nimi, käytä sitä
    if (!fstdType && acField) fstdType = acField;

    entry.fstd = {
      date: date,
      type: fstdType || 'FSTD',
      totalTime: simTime || durationHHMM || ''
    };

    // PIC-nimi (jos sarakkeessa on)
    entry.picName = get(map.pic);

    // Säilytä alkuperäiset ajat muistiinpanoissa (tulevaisuutta varten)
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

  /* ============ Lentorivi ============ */
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

/* --- Pääfunktio: avaa tiedostovalitsin --- */
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
        // 1. Lue tiedosto
        let text = await file.text();

        // Poista UTF-8 BOM
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

        // 2. Tunnista erotin
        const delimiter = _detectDelimiter(text);
        console.log('[CSV Import] Tiedosto:', file.name, '| erotin:', delimiter);

        // 3. Parsitaan
        const rows = _parseCSV(text, delimiter);
        if (!rows.length) throw new Error('Tiedosto on tyhjä');

        // 4. Etsi header-rivi (ensimmäinen rivi jossa on enemmän kuin 1 kenttä)
        let headerIdx = 0;
        for (let i = 0; i < Math.min(5, rows.length); i++) {
          if (rows[i].length > 3) { headerIdx = i; break; }
        }
        const headers = rows[headerIdx];
        console.log('[CSV Import] Headerit:', headers);

        // 5. Rakenna header-map
        const map = _buildHeaderMap(headers);
        console.log('[CSV Import] Header-map:', map);

        if (map.date === -1) {
          throw new Error(
            'Päivämääräsaraketta ei löytynyt. Tarkista että CSV:ssä on "Date" tai "Pvm" -sarake.'
          );
        }

        // 6. Parsitaan rivit → entryt
        const entries = [];
        for (let i = headerIdx + 1; i < rows.length; i++) {
          const entry = _rowToEntry(rows[i], map, i + 1);
          if (entry) entries.push(entry);
        }

        if (!entries.length) {
          throw new Error('Ei kelvollisia rivejä. Tarkista että rivit sisältävät päivämäärän ja paikat.');
        }

        console.log('[CSV Import] Löytyi', entries.length, 'kirjausta');

        // 7. Näytä vahvistusmodaali
        const existing = getLogbookEntries().length;
        const bodyHTML = `
          <div style="font-size:13px; color:var(--dim); line-height:1.6;">
            <p style="color:var(--text); font-size:15px; font-weight:700; margin-bottom:12px;">
              ${entries.length} kirjausta löytyi
            </p>
            <div class="kv" style="border-color:var(--border);">
              <span>Nykyinen lokikirja</span>
              <span>${existing} kirjausta</span>
            </div>
            <div class="kv" style="border-color:var(--border);">
              <span>Tuotavat rivit</span>
              <span>${entries.length} kirjausta</span>
            </div>
            <p style="margin-top:16px; color:var(--warning); font-weight:600;">
              ⚠ Valitse toiminto:
            </p>
          </div>
        `;

        const proceed = await new Promise((res) => {
          let done = false;
          const finish = (v) => { if (!done) { done = true; res(v); } };

          createModal({
            title: 'Tuo lokikirja CSV:stä',
            icon: '📥',
            bodyHTML,
            confirmText: 'Korvaa kaikki',
            cancelText: 'Peruuta',
            maxWidth: '520px',
            onConfirm: () => finish('replace'),
            onCancel: () => finish('cancel')
          });

          // Hoida "Yhdistä"-vaihtoehto — lisätään nappi dialogiin manuaalisesti
          setTimeout(() => {
            const dialog = document.querySelector('div[style*="position: fixed"]');
            if (!dialog) return;
            const confirmBtn = dialog.querySelector('#modal-confirm');
            if (confirmBtn) {
              // Muuta confirm → yhdistä
              confirmBtn.textContent = 'Yhdistä';
              confirmBtn.onclick = () => {
                dialog.remove();
                finish('merge');
              };
            }
            const cancelBtn = dialog.querySelector('#modal-cancel');
            if (cancelBtn) {
              cancelBtn.textContent = 'Peruuta';
              cancelBtn.onclick = () => {
                dialog.remove();
                finish('cancel');
              };
            }
          }, 30);
        });

        if (proceed === 'cancel') {
          resolve(false);
          return;
        }

        // 8. Tallenna
        if (proceed === 'replace') {
          // Varmuuskopio
          try {
            localStorage.setItem('easa_logbook_backup_before_csv',
              localStorage.getItem('easa_logbook_v1') || '[]');
          } catch (e) {}

          _lbWriteAll(entries);
        } else if (proceed === 'merge') {
          const list = _lbReadAll();
          const flightIds = new Set(list.map(e =>
            e.skyplan?.flightId ? String(e.skyplan.flightId) : null).filter(Boolean));

          // Dedupe: sama pvm + sama reitti + sama aika → ohita
          const existingKeys = new Set(list.map(e =>
            `${e.date}|${e.departure?.place}|${e.departure?.time}|${e.arrival?.place}|${e.arrival?.time}`
          ));

          let added = 0;
          entries.forEach(e => {
            const key = `${e.date}|${e.departure?.place}|${e.departure?.time}|${e.arrival?.place}|${e.arrival?.time}`;
            if (existingKeys.has(key)) return;
            list.push(e);
            added++;
          });
          _lbWriteAll(list);
          if (typeof showToast === 'function') {
            showToast(`Lisätty ${added} uutta kirjausta (${entries.length - added} ohitettiin)`, 'success');
          }
        }

        // 9. Päivitä UI
        if (typeof renderLogbookTable === 'function') renderLogbookTable();
        if (typeof renderChainStatusBadge === 'function') renderChainStatusBadge();

        if (typeof showToast === 'function') {
          showToast(`Lokikirja tuotu: ${entries.length} kirjausta.`, 'success', 5000);
        }
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
 * LOGBOOK SYNC · Skyplan journey-log -päivitys
 * ==============================================================
 * Käy läpi kaikki kirjaukset joilla on skyplan.flightId,
 * hakee tuoreen journey-login ja päivittää muuttuneet kentät.
 *
 * Käyttö konsolista:
 *   await syncLogbookWithSkyplan()             → näyttää yhteenvedon
 *   await syncLogbookWithSkyplan({ apply: true })  → soveltaa muutokset
 * ============================================================== */

async function syncLogbookWithSkyplan(options = {}) {
  const {
    apply = false,
    verbose = true,
    fromMonth = '2024-01',
    toMonth = null,
    delayMs = 120,
    monthDelayMs = 3000,
    matchRoster = true,   // ← hakee rosterin ja yhdistää flightId:n
    onlyPending = false,
  } = options;


// Hae pending-entryt
  const allEntries = _lbReadAll();
  const pendingEntries = allEntries.filter(e =>
    e.skyplan?.takeoffPending || e.skyplan?.landingPending
  );

  if (pendingEntries.length > 0) {
    console.log(`[Logbook Sync] ${pendingEntries.length} kirjausta odottaa kapteenin vahvistusta`);
  }

  const now = new Date();
  const defaultTo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const to = toMonth || defaultTo;

  // Kuukaudet välillä [fromMonth, to]
  const months = [];
  let [fy, fm] = fromMonth.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (fy < ty || (fy === ty && fm <= tm)) {
    months.push(`${fy}-${String(fm).padStart(2, '0')}`);
    fm++;
    if (fm > 12) { fm = 1; fy++; }
  }

  console.log(`[Logbook Sync] Skannataan ${months.length} kuukautta: ${fromMonth} → ${to}`);

  // Hae token
  const token = (typeof getValidSkyplanToken === 'function')
    ? await getValidSkyplanToken().catch(() => null)
    : null;
  if (!token) {
    console.error('[Logbook Sync] Token puuttuu.');
    return { total: allEntries.length, processed: 0, changed: 0, skipped: 0, errors: 0 };
  }

  // Hae EmployeeID
  let empId = null;
  try {
    const p = decodeJWT(token) || {};
    empId = p.employeeid || p.EmployeeID || p.employeeId || p.nameid || p.sub;
  } catch (e) {}

  const stats = {
    total: allEntries.length,
    matched: 0,         // montako kirjausta sai flightId:n rosterista
    processed: 0,       // montako journey-logia haettiin
    changed: 0,
    skipped: 0,
    errors: 0
  };
  const changes = [];

  // Käy kuukausi kerrallaan
    const showLoader = options.showLoader !== false;   // oletus: näytä, mutta autosync voi kytkeä pois

  for (let mi = 0; mi < months.length; mi++) {
    const month = months[mi];

    if (showLoader && typeof showModalLoader === 'function') {
      showModalLoader(
        'Synkronoidaan Skyplanista…',
        `Kuukausi ${month} (${mi + 1} / ${months.length})`
      );
    }

    // 1. Hae roster tälle kuukaudelle
    let roster = [];
    if (matchRoster && empId) {
      try {
        roster = await _fetchRosterForMonth(token, empId, month);
        console.log(`[Logbook Sync] ${month}: roster ${roster.length} lentoa`);
      } catch (e) {
        console.warn(`[Logbook Sync] ${month}: roster-haku epäonnistui:`, e.message);
        stats.errors++;
      }
    }

    // 2. Yhdistä logbook-kirjaukset roster-lentoihin
    let monthEntries = allEntries.filter(e => (e.date || '').slice(0, 7) === month);

    // Jos onlyPending → käsittele VAIN ne joilla on flightId + pending-lippu
    if (onlyPending) {
      monthEntries = monthEntries.filter(e =>
        e.skyplan?.flightId &&
        (e.skyplan?.takeoffPending || e.skyplan?.landingPending)
      );
    }

    for (const entry of monthEntries) {
      // Jos entryllä ei ole flightId → yritä löytää rosterista
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

      // 3. Jos on flightId → hae journey-log ja vertaa
      if (entry.skyplan?.flightId) {
        try {
          const log = await fetchJourneyLog(entry.skyplan.flightId, token);
          stats.processed++;
          const diffs = _compareLogbookEntryWithLog(entry, log);
          if (diffs.length > 0) changes.push({ entry, log, diffs });
        } catch (e) {
          stats.errors++;
          if (verbose) console.warn(`[Logbook Sync] ${entry.skyplan.flightId}:`, e.message);
        }
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    // 4. Tallenna välittömästi — jotta matched flightIdt eivät katoa jos keskeytyy
    _lbWriteAll(allEntries);

    // Delay kuukausien välissä
    if (mi < months.length - 1) {
      await new Promise(r => setTimeout(r, monthDelayMs));
    }
  }

  if (showLoader && typeof hideModalLoader === 'function') hideModalLoader();

  stats.changed = changes.length;
  stats.skipped = stats.processed - stats.changed;

  console.log('[Logbook Sync] Valmis:', stats);
  console.log(`[Logbook Sync] Yhdistetty rosterista: ${stats.matched} kirjausta`);
  console.log(`[Logbook Sync] Journey-log haettu: ${stats.processed} kirjaukselle`);
  console.log(`[Logbook Sync] Tarvitsee päivityksen: ${changes.length}`);

  if (changes.length === 0) {
    if (typeof showToast === 'function') {
      showToast(
        `Kaikki ajan tasalla. Yhdistetty ${stats.matched} uuteen lentoon rosterista.`,
        'success', 5000
      );
    }
    return stats;
  }

  // Debug
  if (verbose) {
    console.log('[Logbook Sync] --- Muutokset ---');
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

/* ==============================================================
 * Vertaa entryä journey-logiin
 * ============================================================== */
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

  // ATD / ATA
  if (log.atd) check('ATD', entry.departure?.time, hhmmFromIso(log.atd), 'departure.time');
  if (log.ata) check('ATA', entry.arrival?.time, hhmmFromIso(log.ata), 'arrival.time');

  // Block time
  if (log.blockTime) {
    const newBlock = blockToHHMM(log.blockTime);
    check('Total time', entry.totalTimeOfFlight, newBlock, 'totalTimeOfFlight');
  }

  // Päivämäärä
  if (log.takeoff || log.atd) {
    const newDate = yyyymmddFromIso(log.takeoff || log.atd);
    check('Päivämäärä', entry.date, newDate, 'date');
  }

  // PIC
  const crew = (typeof parseCrewFromJourneyLog === 'function')
    ? parseCrewFromJourneyLog(log)
    : null;
  if (crew?.pic?.name) {
    check('PIC', entry.picName, crew.pic.name, 'picName');
  }

  /* --- Nousu/lasku-tarkistus --- */
  const raw = log.raw || {};
  const flightOps = raw.FlightOps || {};
  const tkId = flightOps.TakeOffCapStaffID ?? raw.TakeOffCapStaffID ?? 0;
  const ldId = flightOps.LandingCapStaffID ?? raw.LandingCapStaffID ?? 0;

  const hasTk = tkId && String(tkId) !== '0';
  const hasLd = ldId && String(ldId) !== '0';

  // Hae oma StaffID
  let myId = null;
  try {
    const token = localStorage.getItem('skyplan_token');
    const p = decodeJWT(token) || {};
    myId = String(p.employeeid || p.EmployeeID || p.employeeId || p.nameid || p.sub || '');
  } catch (e) {}

  if (hasTk && myId) {
    const myTk = String(tkId) === myId;
    const curTkTotal = (Number(entry.takeoffs?.day) || 0) + (Number(entry.takeoffs?.night) || 0);
    const newTkDay = myTk ? (log.takeoff && isNight(log.takeoff, entry.departure?.place) ? 0 : 1) : 0;
    const newTkNight = myTk ? (log.takeoff && isNight(log.takeoff, entry.departure?.place) ? 1 : 0) : 0;

    if (curTkTotal !== (myTk ? 1 : 0)) {
      diffs.push({
        label: 'Takeoff (vahvistus)',
        field: 'takeoffCredit',
        old: String(curTkTotal),
        new: myTk ? '1' : '0',
        newValues: { day: newTkDay, night: newTkNight }
      });
    }
  }

  if (hasLd && myId) {
    const myLd = String(ldId) === myId;
    const curLdTotal = (Number(entry.landings?.day) || 0) + (Number(entry.landings?.night) || 0);
    const newLdDay = myLd ? (log.touchdown && isNight(log.touchdown, entry.arrival?.place) ? 0 : 1) : 0;
    const newLdNight = myLd ? (log.touchdown && isNight(log.touchdown, entry.arrival?.place) ? 1 : 0) : 0;

    if (curLdTotal !== (myLd ? 1 : 0)) {
      diffs.push({
        label: 'Landing (vahvistus)',
        field: 'landingCredit',
        old: String(curLdTotal),
        new: myLd ? '1' : '0',
        newValues: { day: newLdDay, night: newLdNight }
      });
    }
  }

  return diffs;
}

/* Apuri: onko päivä vai yö */
function isNight(iso, icao) {
  if (typeof SunCalc === 'undefined' || !iso || !icao) return false;
  const coords = (typeof _icaoCoords === 'function') ? _icaoCoords(icao) : null;
  if (!coords) return false;
  try {
    const pos = SunCalc.getPosition(new Date(iso), coords.lat, coords.lon);
    return pos.altitude < -6 * Math.PI / 180;
  } catch (e) { return false; }
}

/* ==============================================================
 * Näytä vahvistusmodaali
 * ============================================================== */
async function _promptLogbookSyncConfirmation(changes, stats) {
  return new Promise((resolve) => {
    // Rakenna lista
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

/* ==============================================================
 * Sovella muutokset
 * ============================================================== */
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

/* ==============================================================
 * Roster-haku tietylle kuukaudelle
 * ============================================================== */
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
    // 403/404 vanhoille kuukausille → tyhjä lista, ei virhe
    if (resp.status === 403 || resp.status === 404) return [];
    throw new Error(`HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return Array.isArray(data.Flights) ? data.Flights : [];
}

/* ==============================================================
 * Matchaa logbook-entry roster-lentoon
 * ==============================================================
 * Yhdistää: päivämäärä + lentonumero + lähtö + saapuminen
 * ============================================================== */
function _matchEntryToRosterFlight(entry, roster) {
  if (!entry || !roster?.length) return null;

  const entryDate = String(entry.date || '').trim();
  if (!entryDate) return null;

  const entryFlightNum = String(entry.skyplan?.flightNumber || '')
    .replace(/\D/g, '');          // poista kirjaimet, jätä numerot
  const entryDep = String(entry.departure?.place || '').toUpperCase();
  const entryArr = String(entry.arrival?.place   || '').toUpperCase();

  // Yritä ensin tiukka match: sama päivä + sama lentonumero + sama reitti
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

  // Löysennetty: sama päivä + sama reitti (jos lentonumeroa ei ole)
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

/* --- Apuri HTML-esc --- */
function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ==============================================================
 * NIGHT TIME RECALC · yöaika + nousut/laskut uudelleen
 * ==============================================================
 * Käy läpi kaikki kirjaukset ja laskee SunCalcilla:
 *   - operationalCondition.night  (yöaika H:MM)
 *   - takeoffs.day / .night       (1/0)
 *   - landings.day / .night       (1/0)
 *
 * Käyttö konsolista:
 *   await recalculateNightTimes()                 → esikatselu
 *   await recalculateNightTimes({ apply: true })  → sovella suoraan
 *   await recalculateNightTimes({ onlyMissing: true }) → vain ne joilla night on tyhjä
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
    /* --- Suodattimet --- */
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

    // Multi-leg: jos nykyinen summa > 1 → ohita laskurien osalta
    // (yöaika lasketaan silti)
    const isMultiLeg = curTkTotal > 1 || curLdTotal > 1;
    if (skipMultiLeg && isMultiLeg) {
      // ei kokonaan ohiteta — lasketaan vain yöaika
    }

    if (!dep || !arr || dep.length !== 4 || arr.length !== 4) {
      stats.skipped++; stats.reason.noIcao++; continue;
    }
    if (typeof _icaoCoords === 'function') {
      if (!_icaoCoords(dep) || !_icaoCoords(arr)) {
        stats.skipped++; stats.reason.noCoords++; continue;
      }
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

    /* --- Laskurit: päivitä VAIN jos nykyinen arvo on 1 --- */
    // SunCalc-ehdotus
    const sunTkD = result.nightTakeoff ? 0 : 1;
    const sunTkN = result.nightTakeoff ? 1 : 0;
    const sunLdD = result.nightLanding ? 0 : 1;
    const sunLdN = result.nightLanding ? 1 : 0;

    // Sääntö: laskurit saa päivittää VAIN jos nykyinen summa on tasan 1.
    // 0/0 → jätetään rauhaan (ei lisätä uutta nousua/laskua).
    // >1 → multi-leg, jätetään rauhaan.
    const canUpdateTakeoffs = updateCounters && curTkTotal === 1;
    const canUpdateLandings = updateCounters && curLdTotal === 1;

    let countersChanged = false;
    const counterDiffs = [];

    if (canUpdateTakeoffs) {
      if (curTkD !== sunTkD) {
        countersChanged = true;
        counterDiffs.push({ label: 'Takeoff day',   old: curTkD, new: sunTkD, field: 'tkD' });
      }
      if (curTkN !== sunTkN) {
        countersChanged = true;
        counterDiffs.push({ label: 'Takeoff night', old: curTkN, new: sunTkN, field: 'tkN' });
      }
    }
    if (canUpdateLandings) {
      if (curLdD !== sunLdD) {
        countersChanged = true;
        counterDiffs.push({ label: 'Landing day',   old: curLdD, new: sunLdD, field: 'ldD' });
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
      entry,
      diffs,
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
  console.log(`[Night Recalc] ${changes.length} kirjausta päivittyy, ${stats.skipped} ohitettu.`);
  console.log('[Night Recalc] Ohitusten syyt:', stats.reason);

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

/* ==============================================================
 * Yhdistä päivämäärä + kellonaika ISO:ksi (UTC)
 * ============================================================== */
function _recalcCombineDateTime(entry, which) {
  // 1) Ensisijaisesti skyplan.takeoff / .touchdown (tarkat ACARS-ajat)
  if (which === 'departure' && entry.skyplan?.takeoff) {
    return entry.skyplan.takeoff;
  }
  if (which === 'arrival' && entry.skyplan?.touchdown) {
    return entry.skyplan.touchdown;
  }

  // 2) Yhdistä date + HH:MM
  const date = String(entry.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const time = which === 'departure'
    ? String(entry.departure?.time || '').trim()
    : String(entry.arrival?.time   || '').trim();

  if (!/^\d{2}:\d{2}$/.test(time)) return null;

  let iso = `${date}T${time}:00.000Z`;

  // Jos saapuminen on ennen lähtöä → lisää päivä
  if (which === 'arrival' && entry.departure?.time) {
    const depTime = String(entry.departure.time).trim();
    if (/^\d{2}:\d{2}$/.test(depTime)) {
      const [dh, dm] = depTime.split(':').map(Number);
      const [ah, am] = time.split(':').map(Number);
      const depMins = dh * 60 + dm;
      const arrMins = ah * 60 + am;
      if (arrMins < depMins) {
        // Yölento — saapuminen seuraavana päivänä
        const d = new Date(iso);
        d.setUTCDate(d.getUTCDate() + 1);
        iso = d.toISOString();
      }
    }
  }

  return iso;
}

/* ==============================================================
 * Vahvistusmodaali
 * ============================================================== */
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
        Varmuuskopio otetaan automaattisesti.
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

/* ==============================================================
 * Sovella muutokset
 * ============================================================== */
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

    // Yöaika päivitetään aina
    if (!entry.operationalCondition) entry.operationalCondition = { night: '', ifr: '' };
    entry.operationalCondition.night = c.newValues.night;

    // Laskurit VAIN jos lupa (nykyinen oli 1)
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

const LOGBOOK_AUTOSYNC_KEY = 'logbook_autosync_state_v1';
const SYNC_MIN_INTERVAL   = 15 * 60 * 1000;      // 15 min
const SYNC_FULL_INTERVAL  = 6 * 60 * 60 * 1000;  // 6 h

async function autoSyncLogbook(reason = 'auto') {
  // Estä rinnakkaiset synkat
  if (window._logbookSyncRunning) {
    return;
  }

  if (!navigator.onLine) {
    return;
  }

  const token = (typeof getValidSkyplanToken === 'function')
    ? await getValidSkyplanToken().catch(() => null)
    : null;
  if (!token) {
    console.log(`[Logbook AutoSync] Skip (${reason}): ei tokenia`);
    return;
  }

  // Laske pending-entryt (VAIN ne joilla on flightId)
  const entries = _lbReadAll();
  const pendingCount = entries.filter(e =>
    e.skyplan?.flightId &&
    !e.skyplan?.isFSTD &&
    (e.skyplan?.takeoffPending || e.skyplan?.landingPending)
  ).length;

  // Lue tila
  let state = {};
  try { state = JSON.parse(localStorage.getItem(LOGBOOK_AUTOSYNC_KEY) || '{}'); }
  catch (e) {}
  const lastRun = state.lastRun ? new Date(state.lastRun).getTime() : 0;
  const sinceLast = Date.now() - lastRun;

  // Jos ei pendingiä → tarkista 6 h välein
  if (pendingCount === 0 && sinceLast < SYNC_FULL_INTERVAL) {
    return;
  }

  // Jos pendingiä → tarkista 15 min välein
  if (pendingCount > 0 && sinceLast < SYNC_MIN_INTERVAL) {
    return;
  }

  // Jos ei ole mitään pendingiä → ei tarvitse ajaa lainkaan
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
      matchRoster: false,       // ← EI roster-hakua automaatissa
      onlyPending: true,
      verbose: false,
      showLoader: false         // ← ei modaalia
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

/* ==============================================================
 * Laukaisimet
 * ============================================================== */

// 1. App launch
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => autoSyncLogbook('app-launch').catch(() => {}), 5000);
  });
} else {
  setTimeout(() => autoSyncLogbook('app-launch').catch(() => {}), 5000);
}

// 2. Online-paluu
window.addEventListener('online', () => {
  setTimeout(() => autoSyncLogbook('online').catch(() => {}), 3000);
});

// 5. Rosterin synkan jälkeen
(function _wrapForceRosterSync() {
  if (typeof window.forceRosterSync !== 'function') return;
  const orig = window.forceRosterSync;
  window.forceRosterSync = async function (...args) {
    const result = await orig.apply(this, args);
    // Roster päivittyi → lento todennäköisesti päättynyt → sync logbook
    setTimeout(() => {
      autoSyncLogbook('after-roster-sync').catch(() => {});
    }, 3000);
    return result;
  };
})();

/* ==============================================================
 * ALLEKIRJOITA KAIKKI LENNOT · saman PIC:n lennot
 * ==============================================================
 * Käy läpi kaikki kirjaukset, joilla on sama PIC-merkintä ja
 * lisää niihin saman allekirjoituksen + lupakirjan.
 * ============================================================== */
async function signAllFlightsForPilot() {
  const entries = _lbReadAll();
  if (!entries.length) {
    if (typeof showToast === 'function') showToast('Ei kirjauksia.', 'warning');
    return;
  }

  // Ryhmittele PIC-nimen mukaan
  const byPilot = new Map();
  entries.forEach(e => {
    // Ohita FSTD-sessiot ja jo allekirjoitetut
    if (e.skyplan?.isFSTD) return;
    if (!e.picName) return;
    if (e.signatureDataUrl) return;   // jo allekirjoitettu

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

  // Näytä valinta-modaali
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

  // Kiinnitä klikkaukset
  setTimeout(() => {
    document.querySelectorAll('.sign-all-pilot').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.key;
        const data = byPilot.get(key);
        if (!data) return;

        // Sulje valinta-modaali
        const modal = btn.closest('div[style*="position: fixed"]');
        if (modal) modal.remove();

        await _promptSignAllModal(data);
      });
    });
  }, 50);
}
window.signAllFlightsForPilot = signAllFlightsForPilot;

/* ==============================================================
 * Sisäinen: allekirjoitusmodaali yhdelle kapteenille
 * ============================================================== */
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
                 placeholder="esim. FI.FCL.1111"
                 value="${_esc(savedLicense || '')}"
                 style="width:100%; padding:10px 12px; border-radius:8px;
                        background:var(--input); color:var(--text);
                        border:1px solid var(--border); font-size:13px;
                        font-family:var(--font-mono); box-sizing:border-box;">
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
        const dataUrl = canvas.toDataURL('image/png');

        const blank = document.createElement('canvas');
        blank.width = canvas.width; blank.height = canvas.height;
        if (dataUrl === blank.toDataURL('image/png')) {
          if (typeof showToast === 'function') {
            showToast('Signature required before signing.', 'warning');
          }
          return false;
        }

        if (license) setLicenseForPilot(name, license);

                const list = _lbReadAll();
        const byId = new Map(list.map(e => [e.id, e]));
        let updated = 0;

        // Sinetöi jokainen peräkkäin — tallenna välissä, jotta
        // _getPrevSealedEntry näkee edellisen hashin
        for (const entry of entries) {
          const e = byId.get(entry.id);
          if (!e) continue;

          e.remarks = remark;
          e.licenseNumber = license || '';
          e.signatureDataUrl = dataUrl;
          e.signedAt = new Date().toISOString();
          e.sealedAt = new Date().toISOString();

          // Tallenna tämä entry listaan ENNEN sinetöintiä → hash-ketju näkee sen
          const idx = list.findIndex(x => x.id === e.id);
          if (idx >= 0) list[idx] = e;
          _lbWriteAll(list);   // ← välitallennus

          try {
            await sealLogbookEntry(e);
            // Tallenna uudelleen sinetöinnin jälkeen (hash + prevHash päivittyivät)
            const idx2 = list.findIndex(x => x.id === e.id);
            if (idx2 >= 0) list[idx2] = e;
            _lbWriteAll(list);   // ← välitallennus

            // Pieni viive jotta sealedAt eroaa mikrosekunnin
            await new Promise(r => setTimeout(r, 5));
          } catch (err) {
            console.warn('[SignAll] seal failed:', err);
          }
          updated++;
        }

        if (typeof renderLogbookTable === 'function') renderLogbookTable();
        if (typeof renderChainStatusBadge === 'function') renderChainStatusBadge();

        if (typeof showToast === 'function') {
          showToast(`${updated} kirjausta allekirjoitettu.`, 'success', 5000);
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
    });
  });
}

const LOGBOOK_BACKUP_KEY = '_logbook_backup_meta';
const BACKUP_INTERVAL_DAYS = 7;

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
  } catch (e) {}
}
window.autoBackupLogbook = autoBackupLogbook;

// Aja kerran käynnistyksessä
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(autoBackupLogbook, 15000);
  });
} else {
  setTimeout(autoBackupLogbook, 15000);
}