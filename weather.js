/* ==============================================================
 * WEATHER MODULE · METAR + TAF + Home dashboard
 * ============================================================== */

const WX_CACHE_KEY = 'wx_cache_v1';
const WX_CACHE_TTL = 20 * 60 * 1000;
const WX_BASE      = 'https://aviationweather.gov/api/data';
const WX_PROXY     = 'https://wx-proxy.janri-kallas.workers.dev';

function _wxProxied(targetUrl) {
  return `${WX_PROXY}/?url=${encodeURIComponent(targetUrl)}`;
}

let _ofpLoadFailed = {};
let _homeLoadGen = 0;   // ← generaatiotunnistin reitin lataukselle

/* ---------------- Cache ---------------- */
function _wxCacheRead() {
  try { return JSON.parse(localStorage.getItem(WX_CACHE_KEY) || '{}') || {}; }
  catch (e) { return {}; }
}
function _wxCacheWrite(cache) {
  try { localStorage.setItem(WX_CACHE_KEY, JSON.stringify(cache)); } catch (e) {}
}
function _wxCacheGet(key) {
  const cache = _wxCacheRead();
  const hit = cache[key];
  if (!hit) return null;
  if (Date.now() - hit.t > WX_CACHE_TTL) return null;
  return hit.data;
}
function _wxCacheSet(key, data) {
  const cache = _wxCacheRead();
  cache[key] = { t: Date.now(), data };
  const keys = Object.keys(cache);
  if (keys.length > 200) {
    keys.sort((a, b) => cache[a].t - cache[b].t)
        .slice(0, keys.length - 200)
        .forEach(k => delete cache[k]);
  }
  _wxCacheWrite(cache);
}

async function fetchMETAR(icao) {
  return Cache.getOrFetch(
    `wx:metar:${icao}`,
    { ttlMs: 20 * 60 * 1000, staleTtlMs: 6 * 60 * 60 * 1000, mode: 'persist' },
    async () => {
      const target = `${WX_BASE}/metar?ids=${encodeURIComponent(icao)}&format=json&hours=12`;
      const resp = await fetch(_wxProxied(target));
      if (!resp.ok) throw new Error(`METAR HTTP ${resp.status}`);
      const text = await resp.text();
      if (!text || !text.trim()) return null;
      try {
        const arr = JSON.parse(text);
        return Array.isArray(arr) && arr.length ? arr[0] : null;
      } catch (e) { return null; }
    }
  );
}

async function fetchTAF(icao) {
  return Cache.getOrFetch(
    `wx:taf:${icao}`,
    { ttlMs: 20 * 60 * 1000, staleTtlMs: 6 * 60 * 60 * 1000, mode: 'persist' },
    async () => {
      const target = `${WX_BASE}/taf?ids=${encodeURIComponent(icao)}&format=json`;
      const resp = await fetch(_wxProxied(target));
      if (!resp.ok) throw new Error(`TAF HTTP ${resp.status}`);
      const text = await resp.text();
      if (!text || !text.trim()) return null;
      try {
        const arr = JSON.parse(text);
        return Array.isArray(arr) && arr.length ? arr[0] : null;
      } catch (e) { return null; }
    }
  );
}

/* ---------------- Apurit ---------------- */
function _fmtWind(wdir, wspd, wgst) {
  if (wdir == null || wspd == null) return '–';
  const dir = wdir === 0 || wdir === 'VRB' ? 'VRB' : String(wdir).padStart(3, '0');
  const spd = Math.round(wspd);
  const gst = wgst ? `G${Math.round(wgst)}` : '';
  return `${dir}° / ${spd}${gst} kt`;
}

function _fmtVis(visib, rawOb) {
  // CAVOK = Ceiling And Visibility OK → aina ≥10 km, ei matalia pilviä
  if (rawOb && /\bCAVOK\b/i.test(rawOb)) return '10+ km';
  // SKC / NSC / NCD = ei merkittäviä pilviä, mutta näkyvyys luetaan silti
  // (nämä eivät vaikuta näkyvyyteen, joten jatketaan normaalia käsittelyä)
  if (rawOb) {
    const mMetric = rawOb.match(/\s(\d{4})\s/);
    if (mMetric) {
      const m = parseInt(mMetric[1], 10);
      if (m === 9999) return '10+ km';
      if (m === 0)    return '<50 m';
      if (m < 1000)   return `${m} m`;
      return `${(m / 1000).toFixed(1)} km`;
    }
    const mUS = rawOb.match(/\s(\d+(?:\s\d\/\d)?|\d\/\d)SM\s/);
    if (mUS) {
      const s = mUS[1].replace(/\s/g, '');
      let sm = 0;
      if (s.includes('/')) {
        const [n, d] = s.split('/');
        sm = parseInt(n, 10) / parseInt(d, 10);
      } else {
        sm = parseFloat(s);
      }
      return `${(sm * 1.609).toFixed(1)} km`;
    }
  }
  if (visib == null || visib === '') return '–';
  const n = parseFloat(visib);
  if (isNaN(n)) return String(visib);
  if (n >= 10) return '10+ km';
  if (n > 30) return `${(n / 1000).toFixed(1)} km`;
  return `${(n * 1.609).toFixed(1)} km`;
}

function _fmtClouds(clouds) {
  if (!clouds) return '–';
  if (typeof clouds === 'string') return clouds;
  if (!Array.isArray(clouds)) return '–';
  if (!clouds.length) return 'SKC';
  return clouds.map(c => {
    if (!c) return '';
    if (typeof c === 'string') return c;
    const cover = String(c.cover || c.amount || '').toUpperCase();
    let base = '';
    if (c.base != null) {
      const b = Number(c.base);
      base = isFinite(b) ? String(Math.round(b / 100)).padStart(3, '0') : String(c.base);
    }
    return `${cover}${base}`;
  }).filter(Boolean).join(' ');
}

window._fmtVis = _fmtVis;
window._fmtClouds = _fmtClouds;
window._fmtTemp = _fmtTemp;
window._fmtWind = _fmtWind;

function _fmtTemp(t) {
  return t == null ? '–' : `${Math.round(t)}°C`;
}

/* ---------------- Widget: yhden kentän sää ---------------- */
function renderWeatherWidget(el, metar, taf) {
  if (!el) return;
  if (!metar) {
    el.innerHTML = `<div class="empty">Ei METAR-dataa</div>`;
    return;
  }

  const icao = metar.icaoId || '';
  const name = metar.name || '';
  const fltCat = metar.fltCat || '';
  const fltColor = {
    'VFR':  'var(--success)',
    'MVFR': 'var(--accent)',
    'IFR':  'var(--warning)',
    'LIFR': 'var(--error)'
  }[fltCat] || 'var(--dim)';

  const obsTime = metar.reportTime
    ? new Date(metar.reportTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  el.innerHTML = `
    <div class="wx-head">
      <div>
        <div class="wx-icao">${icao}</div>
        <div class="wx-name">${name}</div>
      </div>
      <div class="wx-cat" style="color:${fltColor}; border-color:${fltColor};">${fltCat || '—'}</div>
    </div>
    <div class="wx-grid">
      <div class="wx-cell"><span>Tuuli</span><b>${_fmtWind(metar.wdir, metar.wspd, metar.wgst)}</b></div>
      <div class="wx-cell"><span>Näkyvyys</span><b>${_fmtVis(metar.visib, metar.rawOb)}</b></div>
      <div class="wx-cell"><span>Lämpötila</span><b>${_fmtTemp(metar.temp)}</b></div>
      <div class="wx-cell"><span>Kastepiste</span><b>${_fmtTemp(metar.dewp)}</b></div>
      <div class="wx-cell"><span>QNH</span><b>${metar.altim != null ? Math.round(metar.altim) + ' hPa' : '–'}</b></div>
      <div class="wx-cell"><span>Pilvet</span><b>${_fmtClouds(metar.clouds)}</b></div>
    </div>
    ${metar.rawOb ? `<pre class="wx-raw">${metar.rawOb}</pre>` : ''}
    ${taf && taf.rawTAF ? `
      <details class="wx-taf">
        <summary>TAF · ${icao}</summary>
        <pre class="wx-raw">${taf.rawTAF}</pre>
      </details>` : ''}
    ${obsTime ? `<div class="wx-time">Havainto ${obsTime}</div>` : ''}
  `;
}

function renderCompactWeatherWidget(el, metar) {
  if (!el) return;
  if (!metar) { el.innerHTML = `<div class="empty">Ei dataa</div>`; return; }

  const fltCat = metar.fltCat || '';
  const fltColor = {
    'VFR':  'var(--success)',
    'MVFR': 'var(--accent)',
    'IFR':  'var(--warning)',
    'LIFR': 'var(--error)'
  }[fltCat] || 'var(--dim)';

  el.innerHTML = `
    <div class="wx-compact">
      <div class="wx-compact-head">
        <span class="wx-compact-icao">${metar.icaoId || ''}</span>
        <span class="wx-compact-cat" style="color:${fltColor}; border-color:${fltColor};">
          ${fltCat || '—'}
        </span>
      </div>
      <div class="wx-compact-grid">
        <div><span>Tuuli</span><b>${_fmtWind(metar.wdir, metar.wspd, metar.wgst)}</b></div>
        <div><span>Näkyvyys</span><b>${_fmtVis(metar.visib, metar.rawOb)}</b></div>
        <div><span>Lämpötila</span><b>${_fmtTemp(metar.temp)}</b></div>
        <div><span>QNH</span><b>${metar.altim != null ? Math.round(metar.altim) + ' hPa' : '–'}</b></div>
      </div>
    </div>
  `;
}
window.renderCompactWeatherWidget = renderCompactWeatherWidget;

/* ---------------- Sää-välilehden haku ---------------- */
async function loadWeatherForStation() {
  const input = document.getElementById('wx-icao');
  const out = document.getElementById('wx-output');
  const notamOut = document.getElementById('notam-output');
  if (!input || !out) return;

  const icao = (input.value || '').toUpperCase().trim();
  if (icao.length !== 4) {
    if (typeof showToast === 'function') showToast('Anna 4-kirjaiminen ICAO-koodi.', 'warning');
    return;
  }

  out.textContent = `Haetaan ${icao}…`;
  if (notamOut) notamOut.textContent = '–';

  try {
    const [metar, taf] = await Promise.all([
      fetchMETAR(icao).catch(() => null),
      fetchTAF(icao).catch(() => null)
    ]);

    if (!metar) {
      out.textContent = `Ei METAR-dataa kentälle ${icao}.`;
      return;
    }

    out.textContent =
      (metar.rawOb ? `METAR ${icao}\n${metar.rawOb}\n\n` : '') +
      (taf && taf.rawTAF ? `TAF ${icao}\n${taf.rawTAF}\n\n` : '') +
      `Tuuli:     ${_fmtWind(metar.wdir, metar.wspd, metar.wgst)}\n` +
      `Näkyvyys:  ${_fmtVis(metar.visib, metar.rawOb)}\n` +
      `Lämpötila: ${_fmtTemp(metar.temp)}  (kastepiste ${_fmtTemp(metar.dewp)})\n` +
      `QNH:       ${metar.altim != null ? Math.round(metar.altim) + ' hPa' : '–'}\n` +
      `Pilvet:    ${_fmtClouds(metar.clouds)}\n` +
      `Luokka:    ${metar.fltCat || '–'}\n` +
      `Havainto:  ${metar.reportTime ? new Date(metar.reportTime).toLocaleString() : '–'}`;

    if (typeof showToast === 'function') showToast(`Sää haettu: ${icao}`, 'success');
  } catch (err) {
    out.textContent = `Virhe: ${err.message}`;
    if (typeof showToast === 'function') showToast('Sään haku epäonnistui.', 'error');
  }
}
window.loadWeatherForStation = loadWeatherForStation;

function _haversineNM(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth radius in NM
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ==============================================================
 * ETUSIVUN DASHBOARD
 * ============================================================== */

function _homeFmtTime(iso) {
  if (!iso) return '--:--';
  const s = String(iso);
  if (s.includes('T')) return s.split('T')[1].substring(0, 5);
  return s;
}

function _findCurrentAndNextFlights() {
  let roster = [];
  try {
    roster = JSON.parse(localStorage.getItem('assigned_flights_cache') || '[]');
  } catch (e) {}
  if (!Array.isArray(roster)) roster = [];

  // ============ PINNED FLIGHT CHECK ============
  // Jos briefingissä valittiin lento, käytä sitä
  try {
    const pinnedId = localStorage.getItem('home_pinned_flight_id');
    const pinnedAt = localStorage.getItem('home_pinned_flight_at');
    if (pinnedId && pinnedAt) {
      const ageH = (Date.now() - new Date(pinnedAt).getTime()) / 3600000;
      // Pinned vanhenee 24h kuluttua
      if (ageH < 24) {
        const pinnedFlight = roster.find(f =>
          String(f.ID || f.id || f.FlightID) === String(pinnedId)
        );
        if (pinnedFlight) {
          console.log('[Home] Käytetään pinned-lentoa:', pinnedFlight.FlightNumber);
          return { current: null, next: pinnedFlight, pinned: true };
        }
      } else {
        // Vanhentunut — poista
        localStorage.removeItem('home_pinned_flight_id');
        localStorage.removeItem('home_pinned_flight_at');
      }
    }
  } catch (e) {}

  const now = Date.now();
  const WITH_GRACE_BEFORE = 30 * 60 * 1000;
  const WITH_GRACE_AFTER  = 45 * 60 * 1000;

  const withTimes = roster.map(f => {
    const std = new Date(f.StdLt || f.Std || 0).getTime();
    const sta = new Date(f.StaLt || f.Sta || 0).getTime();
    return { f, std, sta };
  }).filter(x => x.std && x.sta);

  const current = withTimes.find(x =>
    now >= x.std - WITH_GRACE_BEFORE && now <= x.sta + WITH_GRACE_AFTER
  );

  const upcoming = withTimes
    .filter(x => x.std > now)
    .sort((a, b) => a.std - b.std)[0];

  if (!current && !upcoming && withTimes.length) {
    const latestPast = withTimes.sort((a, b) => b.std - a.std)[0];
    return { current: latestPast.f, next: null };
  }

  return { current: current?.f || null, next: upcoming?.f || null };
}

function _findNearestAirport(flight, airports, depIcao, arrIcao) {
  if (!flight || !Array.isArray(airports) || !airports.length) return null;

  const stdMs = new Date(flight.StdLt || flight.Std || 0).getTime();
  const staMs = new Date(flight.StaLt || flight.Sta || 0).getTime();
  if (!stdMs || !staMs || Date.now() < stdMs || Date.now() > staMs + 30 * 60 * 1000) {
    return null; // Ei käynnissä
  }

  // 1. GPS-sijainti jos saatavilla
  let currentPos = null;
  if (typeof LocationService !== 'undefined' && LocationService.getLast) {
    const gps = LocationService.getLast();
    if (gps && isFinite(gps.lat) && isFinite(gps.lon)) {
      currentPos = { lat: gps.lat, lon: gps.lon, source: 'gps' };
    }
  }

  // 2. Fallback: aikapohjainen estimaatti
  if (!currentPos) {
    const depCoords = (typeof _icaoCoords === 'function') ? _icaoCoords(depIcao) : null;
    const arrCoords = (typeof _icaoCoords === 'function') ? _icaoCoords(arrIcao) : null;
    if (!depCoords || !arrCoords) return null;

    const progress = Math.max(0, Math.min(1, (Date.now() - stdMs) / (staMs - stdMs)));
    currentPos = {
      lat: depCoords.lat + (arrCoords.lat - depCoords.lat) * progress,
      lon: depCoords.lon + (arrCoords.lon - depCoords.lon) * progress,
      source: 'estimate'
    };
  }

  // 3. Lähin — DEP ja DEST mukaan lukien
  let nearest = null;
  let minDist = Infinity;

  for (const apt of airports) {
    if (!apt.coords || !isFinite(apt.coords.lat) || !isFinite(apt.coords.lon)) continue;

    const dist = _haversineNM(currentPos.lat, currentPos.lon, apt.coords.lat, apt.coords.lon);
    if (dist < minDist) {
      minDist = dist;
      nearest = { airport: apt, distance: dist };
    }
  }

  if (!nearest) return null;
  return { ...nearest, source: currentPos.source };
}

async function renderHomeDashboard() {
  if (window._standRefreshTimer) {
    clearInterval(window._standRefreshTimer);
    window._standRefreshTimer = null;
  }

  const { current, next } = _findCurrentAndNextFlights();
  const flight = current || next;

  const cardEl = document.getElementById('home-map-card');
  const mapEl = document.getElementById('fc-map');
  const overlayEl = document.getElementById('home-map-overlay');
  const emptyEl = document.getElementById('home-map-empty');
  if (!cardEl || !mapEl || !overlayEl) return;

  if (!flight) {
    overlayEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'flex';
    mapEl.innerHTML = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  const fid = String(flight.ID || flight.id || flight.FlightID || '');
  const carrier = String(flight.CarrierCode || '').trim();
  const fltNo = String(flight.FlightNumber || '').trim();
  const flightNum = (carrier && fltNo.startsWith(carrier)) ? fltNo : `${carrier}${fltNo}`;
  const dep = String(flight.DepartureStationIcaoCode || flight.DepartureStationCode || '').toUpperCase();
  const arr = String(flight.ArrivalStationIcaoCode || flight.ArrivalStationCode || '').toUpperCase();
  const std = _homeFmtTime(flight.StdLt || flight.Std);
  const sta = _homeFmtTime(flight.StaLt || flight.Sta);
  const tailNumber = String(flight.RegistrationNumber || '').trim();
  const reg = String(tailNumber || flight.AircraftDescription || 'TBA').trim();
  const canOpenDefects = tailNumber && tailNumber !== '-' && tailNumber !== 'TBA';

  /* FIX #3: aseta globaalit finalizeOFP:ää varten */
  window._lastFlightNumber = flightNum;
  window._lastFlightId = fid;

  const regSafe = String(reg)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const stand = (typeof extractStandNumber === 'function') ? extractStandNumber(flight, null) : null;
  const stdMs = new Date(flight.StdLt || flight.Std || 0).getTime();
  const now = Date.now();

  overlayEl.innerHTML = `
    <div class="hm-route">
      <button class="hm-icao hm-icao-dep" data-icao="${dep}" type="button">${dep}</button>
      <span class="hm-arrow">→</span>
      <button class="hm-icao hm-icao-arr" data-icao="${arr}" type="button">${arr}</button>
      <span class="hm-flight">${flightNum}</span>
    </div>
    <div class="hm-info" id="hm-info-primary">
            <button type="button" class="hm-takeoff-btn"
          style="background:rgba(0,194,255,0.08); border:1px solid var(--border-2);
                color:var(--accent); padding:6px 12px; border-radius:6px;
                font-size:11.5px; font-weight:600; cursor:pointer;"
          onclick="if (typeof showTakeoffModal === 'function') showTakeoffModal()">
          ✈️
        </button>
      <div class="hm-info-item">
        <span class="hm-info-label">Aika</span>
        <span class="hm-info-value">${std} → ${sta}</span>
      </div>
      <div class="hm-info-item">
        <span class="hm-info-label">Kone</span>
        <span class="hm-info-value">
          ${canOpenDefects
            ? `<button type="button" data-reg="${regSafe}"
                 style="background:none; border:none; padding:0; margin:0;
                        color:var(--accent); font-family:inherit; font-size:inherit;
                        font-weight:inherit; line-height:inherit; cursor:pointer;
                        text-decoration:underline; text-underline-offset:2px;">${regSafe}</button>`
            : regSafe}
        </span>
      </div>
      <div class="hm-info-item" id="hm-stand-item" ${stand ? '' : 'style="display:none;"'}>
        <span class="hm-info-label">Stand</span>
        <span class="hm-info-value" id="hm-stand-value">${stand ? stand.value : '–'}</span>
      </div>
    </div>
        <div style="margin-top:8px; text-align:right;">

    </div>
  `;

  // Auringonnousu/lasku (ennallaan)
  if (typeof SunCalc !== 'undefined') {
    const depCoords = (typeof _icaoCoords === 'function') ? _icaoCoords(dep) : null;
    const arrCoords = (typeof _icaoCoords === 'function') ? _icaoCoords(arr) : null;
    const approxTzOffset = (lon) => Math.round(lon / 15);
    const fmtInTz = (d, lon) => {
      if (!d) return { time: '–', offset: 0 };
      const offset = approxTzOffset(lon);
      const shifted = new Date(d.getTime() + offset * 3600 * 1000);
      return {
        time: `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`,
        offset
      };
    };
    const sunRows = [];
    if (depCoords) {
      const t = SunCalc.getTimes(new Date(), depCoords.lat, depCoords.lon);
      const sr = fmtInTz(t.sunrise, depCoords.lon);
      const ss = fmtInTz(t.sunset,  depCoords.lon);
      const tzLabel = `UTC${sr.offset >= 0 ? '+' : ''}${sr.offset}`;
      sunRows.push(`<span class="hm-info-item">
        <span class="hm-info-label">${dep} ↑↓</span>
        <span class="hm-info-value">${sr.time} ↑ · ${ss.time} ↓ <span style="opacity:0.5; font-size:10px; margin-left:2px;">${tzLabel}</span></span>
      </span>`);
    }
    if (arrCoords) {
      const t = SunCalc.getTimes(new Date(), arrCoords.lat, arrCoords.lon);
      const sr = fmtInTz(t.sunrise, arrCoords.lon);
      const ss = fmtInTz(t.sunset,  arrCoords.lon);
      const tzLabel = `UTC${sr.offset >= 0 ? '+' : ''}${sr.offset}`;
      sunRows.push(`<span class="hm-info-item">
        <span class="hm-info-label">${arr} ↑↓</span>
        <span class="hm-info-value">${sr.time} ↑ · ${ss.time} ↓ <span style="opacity:0.5; font-size:10px; margin-left:2px;">${tzLabel}</span></span>
      </span>`);
    }
    if (sunRows.length) {
      overlayEl.insertAdjacentHTML('beforeend',
        `<div class="hm-info">${sunRows.join('')}</div>`);
    }
  }

  overlayEl.style.display = 'flex';

  // Stand-päivitys (ennallaan)
  if (navigator.onLine && typeof refreshSingleFlightFromRoster === 'function') {
    (async () => {
      try {
        const fresh = await refreshSingleFlightFromRoster(fid, flight.StdLt || flight.Std);
        if (!fresh) return;
        const newStand = (typeof extractStandNumber === 'function') ? extractStandNumber(fresh, null) : null;
        const oldVal = stand ? stand.value : '';
        if (newStand && newStand.value && newStand.value !== oldVal) {
          const valEl = document.getElementById('hm-stand-value');
          const itemEl = document.getElementById('hm-stand-item');
          if (valEl) valEl.textContent = newStand.value;
          if (itemEl) itemEl.style.display = '';
          try {
            const roster = JSON.parse(localStorage.getItem('assigned_flights_cache') || '[]');
            const idx = roster.findIndex(x => String(x.ID || x.id || x.FlightID) === String(fid));
            if (idx >= 0) {
              roster[idx] = { ...roster[idx], ...fresh };
              localStorage.setItem('assigned_flights_cache', JSON.stringify(roster));
            }
          } catch (e) {}
        }
      } catch (e) {
        console.warn('[Stand] refresh failed:', e);
      }
    })();

    const staMs = new Date(flight.StaLt || flight.Sta || 0).getTime();
    const isActive = now >= stdMs - 30 * 60 * 1000 && now <= staMs + 30 * 60 * 1000;
    if (isActive) {
      window._standRefreshTimer = setInterval(async () => {
        if (!navigator.onLine) return;
        if (!document.querySelector('#tab-home.active')) return;
        try {
          const fresh = await refreshSingleFlightFromRoster(fid, flight.StdLt || flight.Std);
          if (!fresh) return;
          const newStand = (typeof extractStandNumber === 'function') ? extractStandNumber(fresh, null) : null;
          if (!newStand || !newStand.value) return;
          const valEl = document.getElementById('hm-stand-value');
          const itemEl = document.getElementById('hm-stand-item');
          if (valEl && valEl.textContent !== newStand.value) {
            valEl.textContent = newStand.value;
            if (itemEl) itemEl.style.display = '';
          }
        } catch (e) {}
      }, 15 * 60 * 1000);
    }
  }

  const _isMobile = /iPad|iPhone|iPod|Android/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  let notamAirports = [];
  let extraAirports = [];
  let waypointList = [];

  const mapOpts = {
    realistic: !_isMobile,
    showTimezones: !_isMobile,
    showWeather: true,
    lightMode: _isMobile,
    date: new Date(),
    margin: 20,
    flight,
    flightId: fid,
    onMarkerClick: (airport, evt) => {
      const rect = cardEl.getBoundingClientRect();
      const px = evt ? (evt.clientX - rect.left) : cardEl.clientWidth / 2;
      const py = evt ? (evt.clientY - rect.top)  : cardEl.clientHeight / 2;
      showAirportPopupInline(airport, { x: px, y: py }, cardEl, notamAirports);
    }
  };

  if (typeof renderFlightMap === 'function') {
    await renderFlightMap(mapEl, dep, arr, mapOpts);
  }

  /* FIX #2: altista "Lähin"-päivitys globaalisti — mock-GPS voi kutsua tätä */
  window._updateNearestAirport = function () {
    if (typeof _findNearestAirport !== 'function') return;
    overlayEl.querySelector('#hm-nearest-item')?.remove();

    const nearestInfo = _findNearestAirport(flight, notamAirports, dep, arr);
    if (!nearestInfo) return;

    const target = overlayEl.querySelector('#hm-info-primary');
    if (!target) return;

    const distStr = Math.round(nearestInfo.distance) + ' NM';
    const icaoSafe = String(nearestInfo.airport.icao || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    target.insertAdjacentHTML('beforeend', `
      <div class="hm-info-item" id="hm-nearest-item">
        <span class="hm-info-label">📍 Lähin</span>
        <span class="hm-info-value">
          <button type="button" class="hm-nearest-btn" data-icao="${icaoSafe}"
            style="background:none; border:none; padding:0; margin:0;
                   color:var(--accent); font-family:inherit; font-size:inherit;
                   font-weight:inherit; line-height:inherit; cursor:pointer;
                   text-decoration:underline; text-underline-offset:2px;">
            ${icaoSafe} · ${distStr}
          </button>
        </span>
      </div>
    `);

    const btn = target.querySelector('.hm-nearest-btn');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const icao = btn.dataset.icao;
        const apt = notamAirports.find(a => a.icao === icao)
                 || _findAirportForIcao(icao, flight, notamAirports);
        const pos = mapEl._getMarkerPosition ? mapEl._getMarkerPosition(icao) : null;
        const px = pos ? pos.x : cardEl.clientWidth - 200;
        const py = pos ? pos.y : cardEl.clientHeight / 2;
        showAirportPopupInline(apt, { x: px, y: py }, cardEl, notamAirports);
      });
    }
  };

  // Asynkroninen OFP/NOTAM/WX-lataus
  (async () => {
    const loadGen = ++_homeLoadGen;

    let skipLoader = false;
    try {
      const wpCache = JSON.parse(localStorage.getItem('notam_wp_cache_v3') || '{}');
      const wpHit = wpCache[fid];
      const wpFresh = wpHit && (Date.now() - new Date(wpHit.at).getTime()) < 60 * 60 * 1000;

      const notamCache = JSON.parse(localStorage.getItem('notam_ofp_cache_v3') || '{}');
      const notamHit = notamCache[fid];
      const notamFresh = notamHit && (Date.now() - new Date(notamHit.at).getTime()) < 30 * 60 * 1000;

      if (wpFresh && notamFresh) skipLoader = true;
    } catch (e) {}

    let loaderShown = false;
    let loaderTimer = null;
    let loaderSafetyTimer = null;

    if (!skipLoader && typeof showModalLoader === 'function') {
      loaderTimer = setTimeout(() => {
        if (loadGen !== _homeLoadGen) return;
        showModalLoader('Ladataan reittiä…', `${flightNum} · ${dep} → ${arr}`);
        loaderShown = true;
        loaderSafetyTimer = setTimeout(() => {
          if (typeof hideModalLoader === 'function') hideModalLoader();
          loaderShown = false;
        }, 15000);
      }, 300);
    }

    try {
      // 1. NOTAMit
      let notams = [];
      try {
        if (typeof parseOFPsForNotams === 'function' && fid && !_ofpLoadFailed[fid]) {
          const data = await parseOFPsForNotams(fid);
          if (loadGen !== _homeLoadGen) return;
          notams = data.notams || [];
        }
      } catch (e) {
        const msg = String(e?.message || '');
        const isAuthIssue = msg.includes('token missing')
                         || msg.includes('token expired')
                         || msg.includes('authentication rejected');
        if (msg.includes('HTTP 422') || msg.includes('not generated')) {
          _ofpLoadFailed[fid] = true;
        } else if (!isAuthIssue) {
          console.warn('[HomeMap] NOTAM parse failed:', e);
        }
      }

      // 2. Rakenna kenttälista
      if (typeof buildAirportData === 'function') {
        notamAirports = buildAirportData(notams, flight);
        extraAirports = notamAirports.filter(a => a.role === 'ALTN' || a.role === 'NOTAM');
      }

      // 2b. Lähin lentokenttä
      if (typeof window._updateNearestAirport === 'function') {
        try { window._updateNearestAirport(); } catch (e) { console.warn('[Nearest]', e); }
      }

      // 3. Waypointit
      try {
        if (typeof parseOFPsForWaypoints === 'function' && fid && !_ofpLoadFailed[fid]) {
          const wpData = await parseOFPsForWaypoints(fid);
          if (loadGen !== _homeLoadGen) return;
          waypointList = wpData.waypoints || [];
          window._allOFPWaypoints = wpData.allWaypoints || wpData.waypoints || [];
        }
      } catch (e) {
        const msg = String(e?.message || '');
        const isAuthIssue = msg.includes('token missing')
                         || msg.includes('token expired')
                         || msg.includes('authentication rejected');
        if (msg.includes('HTTP 422') || msg.includes('not generated')) {
          _ofpLoadFailed[fid] = true;
        } else if (!isAuthIssue) {
          console.warn('[HomeMap] Waypoint parse failed:', e);
        }
      }

      // 4. Re-render waypointeilla
      if (loadGen !== _homeLoadGen) return;
      if (waypointList.length > 0 || extraAirports.length > 0) {
        if (typeof renderFlightMap === 'function') {
          await renderFlightMap(mapEl, dep, arr, {
            ...mapOpts,
            extraAirports,
            waypoints: waypointList
          });

          if (waypointList.length > 0 && typeof startWaypointGPSWatch === 'function') {
            startWaypointGPSWatch(fid, waypointList);
          }
        }
      }

      /* FIX #1: oikea fuel-parsinta OFP:stä */
            /* FIX #1: Älä ylikirjoita manuaalisesti syötettyjä tietoja */
      try {
        const journeyLog = (typeof getCachedJourneyLog === 'function') ? getCachedJourneyLog(fid) : null;
        const takeoffIso = journeyLog?.takeoff || journeyLog?.atd || null;

        let takeoffFuelKg = null;
        if (typeof getOFPFuelData === 'function') {
          const fuel = await getOFPFuelData(fid).catch(() => null);
          if (fuel?.takeoffFuel) takeoffFuelKg = fuel.takeoffFuel;
        }

        const existingCtx = (typeof Cache !== 'undefined')
          ? (Cache.get(`flight:context:${fid}`, { mode: 'persist' })?.value || {})
          : {};

        // Säilytetään vanha, jos uusi on null
        const mergedCtx = {
          takeoffIso: takeoffIso || existingCtx.takeoffIso || null,
          takeoffFuelKg: takeoffFuelKg || existingCtx.takeoffFuelKg || null
        };

        if (mergedCtx.takeoffIso || mergedCtx.takeoffFuelKg != null) {
          Cache.set(`flight:context:${fid}`, mergedCtx, {
            ttlMs: 24 * 60 * 60 * 1000, mode: 'persist'
          });
        }
      } catch (e) {}

      // 5. WX-lataus + re-render
      if (notamAirports.length && typeof _preloadWxForAirports === 'function') {
        try {
          await _preloadWxForAirports(notamAirports);
          if (loadGen !== _homeLoadGen) return;
          if (typeof renderFlightMap === 'function') {
            /* FIX #4: await — varmistaa että kaikki on tehty ennen paluuta */
            await renderFlightMap(mapEl, dep, arr, {
              ...mapOpts,
              extraAirports,
              waypoints: waypointList
            });
          }
        } catch (e) {}
      }
    } finally {
      if (loaderTimer) clearTimeout(loaderTimer);
      if (loaderSafetyTimer) clearTimeout(loaderSafetyTimer);
      if (loaderShown && typeof hideModalLoader === 'function') {
        hideModalLoader();
      }
    }
  })();

  // FIX #5: Pakotetaan lähimmän kentän päivitys
  if (window._nearestTimer) clearInterval(window._nearestTimer);
  window._nearestTimer = setInterval(() => {
    if (document.querySelector('#tab-home.active') && typeof window._updateNearestAirport === 'function') {
      try { window._updateNearestAirport(); } catch (e) {}
    }
  }, 10000);

  // Klikkauskäsittelijät
  overlayEl.querySelectorAll('.hm-icao, [data-reg]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();

      if (btn.dataset.reg) {
        const tail = btn.dataset.reg;
        if (typeof showDefectsPopup === 'function' && tail) {
          showDefectsPopup(tail);
        } else if (typeof showToast === 'function') {
          showToast('Vikatietopalvelu ei ole ladattu.', 'warning');
        }
        return;
      }

      const icao = btn.dataset.icao;
      if (!icao) return;
      const apt = _findAirportForIcao(icao, flight, notamAirports);
      const pos = mapEl._getMarkerPosition ? mapEl._getMarkerPosition(icao) : null;
      const px = pos ? pos.x : cardEl.clientWidth - 200;
      const py = pos ? pos.y : cardEl.clientHeight / 2;
      showAirportPopupInline(apt, { x: px, y: py }, cardEl, notamAirports);
    });
  });
}
window.renderHomeDashboard = renderHomeDashboard;

/* ==============================================================
 * Kartan sisäinen popup
 * ============================================================== */
async function showAirportPopupInline(airport, position, container, allAirports) {
  if (!airport || !container) return;

  /* --- Täydennä DEP/DEST puuttuvat NOTAMit --- */
  if (allAirports && allAirports.length) {
    const full = allAirports.find(a => a.icao === airport.icao);
    if (full) {
      airport = { ...airport, ...full, role: airport.role };
    }
  }

  const existing = container.querySelector('.map-inline-popup');
  if (existing) existing.remove();

  const roleLabels = { DEP: 'LÄHTÖ', DEST: 'SAAPUMINEN', ALTN: 'VARAKENTTÄ', NOTAM: 'NOTAM-KENTTÄ' };

  const popup = document.createElement('div');
  popup.className = 'map-inline-popup';
  popup.innerHTML = `
    <div class="mip-head">
      <div>
        <div class="mip-icao">${airport.icao}</div>
        <div class="mip-role">${roleLabels[airport.role] || 'KENTTÄ'}</div>
      </div>
      <button class="mip-close" type="button" aria-label="Sulje">✕</button>
    </div>
    <div class="mip-body" id="mip-body-${Date.now()}">
      <div style="display:flex; align-items:center; gap:10px; padding:20px 0;">
        <div class="loader-spinner" style="transform:scale(0.7);"><span></span><span></span><span></span></div>
        <span style="font-size:12px; color:var(--dim);">Haetaan säätä…</span>
      </div>
    </div>
  `;

  const cw = container.clientWidth;
  const ch = container.clientHeight;
  const TOP_INSET    = 96;
  const BOTTOM_INSET = 110;
  const PAD          = 12;
  const minY = TOP_INSET;
  const maxY = ch - BOTTOM_INSET;

  let px = position?.x ?? cw / 2;
  let py = position?.y ?? ch / 2;

  popup.style.visibility = 'hidden';
  popup.style.left = `${px}px`;
  popup.style.top  = `${py}px`;
  container.appendChild(popup);

  requestAnimationFrame(() => {
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;
    let lx = px + 20;
    let ly = py - 20;
    if (lx + pw > cw - PAD) lx = px - pw - 20;
    if (lx < PAD)           lx = PAD;
    if (lx + pw > cw - PAD) lx = Math.max(PAD, cw - pw - PAD);
    const popupH = Math.min(ph, maxY - minY);
    if (ly + popupH > maxY) ly = maxY - popupH;
    if (ly < minY)          ly = minY;
    popup.style.left = `${lx}px`;
    popup.style.top  = `${ly}px`;
    popup.style.visibility = '';
    if (ph > maxY - minY) popup.style.maxHeight = `${maxY - minY}px`;
  });

  const close = () => {
    popup.style.opacity = '0';
    setTimeout(() => popup.remove(), 180);
  };
  popup.querySelector('.mip-close').addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });
  popup.addEventListener('pointerdown', (e) => e.stopPropagation());

  const outsideHandler = (e) => {
    if (!popup.contains(e.target) && !container.contains(e.target.closest('.hm-icao'))) {
      close();
      document.removeEventListener('pointerdown', outsideHandler, true);
    }
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', outsideHandler, true);
  }, 200);

  let liveMetar = null;
  let liveTaf   = null;
  let isStale   = false;

  try {
    if (typeof fetchWXForAirport === 'function') {
      const r = await fetchWXForAirport(airport.icao);
      liveMetar = r.metar;
      liveTaf   = r.taf;
      isStale   = !!r.isStale;
    }
  } catch (e) {
    console.warn('[InlinePopup] WX fetch failed:', e);
  }

  const body = popup.querySelector('.mip-body');
  if (!body) return;

  const esc = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let html = '';

  if (liveMetar) {
    const fltCat = liveMetar.fltCat || '';
    const catColor = { VFR: 'var(--success)', MVFR: 'var(--accent)', IFR: 'var(--warning)', LIFR: 'var(--error)' }[fltCat] || 'var(--dim)';
    const fmtWind = (d, s, g) => d == null ? '–'
      : `${String(d).padStart(3, '0')}° / ${Math.round(s)}kt${g ? ' G' + Math.round(g) : ''}`;

    html += `
      <div class="notam-popup-section">
        <div class="notam-popup-head">
          <span>METAR${isStale ? ' · CACHE' : ''}</span>
          ${fltCat ? `<span class="notam-popup-badge" style="color:${catColor}; border-color:${catColor};">${fltCat}</span>` : ''}
        </div>
        <div class="notam-popup-grid">
          <div><span>Tuuli</span><b>${fmtWind(liveMetar.wdir, liveMetar.wspd, liveMetar.wgst)}</b></div>
          <div><span>Näkyvyys</span><b>${_fmtVis(liveMetar.visib, liveMetar.rawOb)}</b></div>
          <div><span>Lämpötila</span><b>${liveMetar.temp != null ? Math.round(liveMetar.temp) + '°C' : '–'}</b></div>
          <div><span>Kastepiste</span><b>${liveMetar.dewp != null ? Math.round(liveMetar.dewp) + '°C' : '–'}</b></div>
          <div><span>QNH</span><b>${liveMetar.altim != null ? Math.round(liveMetar.altim) + ' hPa' : '–'}</b></div>
          <div><span>Pilvet</span><b>${_fmtClouds(liveMetar.clouds)}</b></div>
        </div>
        ${liveMetar.rawOb ? `<pre class="notam-popup-raw">${esc(liveMetar.rawOb)}</pre>` : ''}
      </div>`;
  } else {
    html += `<div class="notam-popup-section">
      <div class="notam-popup-head"><span>METAR</span></div>
      <div style="font-size:11px; color:var(--dim); padding:4px 0;">Ei saatavilla.</div>
    </div>`;
  }

  if (liveTaf?.rawTAF) {
    html += `<div class="notam-popup-section">
      <div class="notam-popup-head"><span>TAF</span></div>
      <pre class="notam-popup-raw">${esc(liveTaf.rawTAF)}</pre>
    </div>`;
  }

  if (airport.notams && airport.notams.length) {
    const order = { critical: 0, warning: 1, info: 2 };
    const sorted = [...airport.notams].sort((a, b) => order[a.severity] - order[b.severity]);
    html += `<div class="notam-popup-section">
      <div class="notam-popup-head">
        <span>NOTAMit</span>
        <span class="notam-popup-badge" style="color:var(--error); border-color:var(--error);">${airport.notams.length}</span>
      </div>`;
    sorted.forEach(n => {
      const sevColor = n.severity === 'critical' ? 'var(--error)'
                     : n.severity === 'warning' ? 'var(--warning)' : 'var(--accent)';
      html += `
        <div class="notam-popup-item" style="border-left-color:${sevColor};">
          <div class="notam-popup-item-head">
            ${n.id ? `<span class="notam-popup-id">${esc(n.id)}</span>` : ''}
            <span class="notam-popup-type">${esc(n.type || '')}</span>
          </div>
          <div class="notam-popup-text">${esc(n.text)}</div>
        </div>`;
    });
    html += `</div>`;
  }

  body.innerHTML = html;

  requestAnimationFrame(() => {
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;
    let lx = parseFloat(popup.style.left);
    let ly = parseFloat(popup.style.top);
    if (lx + pw > cw - PAD) lx = Math.max(PAD, px - pw - 20);
    if (lx < PAD)           lx = PAD;
    const popupH = Math.min(ph, maxY - minY);
    if (ly + popupH > maxY) ly = maxY - popupH;
    if (ly < minY)          ly = minY;
    popup.style.left = `${lx}px`;
    popup.style.top  = `${ly}px`;
    if (ph > maxY - minY) popup.style.maxHeight = `${maxY - minY}px`;
  });
}
window.showAirportPopupInline = showAirportPopupInline;

function _findAirportForIcao(icao, flight, extraAirports) {
  // Etsi täydellinen kenttä ensin (DEP/DEST/ALTN/NOTAM)
  const list = extraAirports || [];
  const found = list.find(a => a.icao === icao);
  if (found) return found;

  // Fallback
  const dep = String(flight?.DepartureStationIcaoCode || '').toUpperCase();
  const arr = String(flight?.ArrivalStationIcaoCode || '').toUpperCase();

  let role = 'NOTAM';
  if (icao === dep) role = 'DEP';
  else if (icao === arr) role = 'DEST';

  return {
    icao,
    role,
    notams: [],
    coords: (typeof _icaoCoords === 'function') ? _icaoCoords(icao) : null
  };
}
window._findAirportForIcao = _findAirportForIcao;

/* ==============================================================
 * KOTISIVUN INIT
 * ============================================================== */
let _homeDashRunning = false;
let _homeDashPending = false;
let _boot422Cleared = false;

async function _initHomeDashboard(reason = 'boot') {
  if (_homeDashRunning) {
    _homeDashPending = true;
    return;
  }

  // Bootissa: tyhjennetään 422-merkinnät jotta OFP yritetään hakea uudelleen
  if (!_boot422Cleared) {
    _boot422Cleared = true;
    try {
      if (typeof window._clear422Cache === 'function') {
        window._clear422Cache();
      }
      // Tyhjennä myös localStorage 422-merkinnät
      for (const key of ['notam_ofp_cache_v3', 'notam_wp_cache_v3']) {
        try {
          const cache = JSON.parse(localStorage.getItem(key) || '{}');
          let changed = false;
          for (const fid of Object.keys(cache)) {
            if (cache[fid]?.data?.is422) {
              delete cache[fid];
              changed = true;
            }
          }
          if (changed) localStorage.setItem(key, JSON.stringify(cache));
        } catch (e) {}
      }
    } catch (e) {
      console.warn('[Boot] 422-cache clear failed:', e);
    }
  }

  _homeDashRunning = true;
  try {
    await renderHomeDashboard();
  } catch (err) {
    console.error('[Weather] virhe:', err);
  } finally {
    _homeDashRunning = false;
    if (_homeDashPending) {
      _homeDashPending = false;
      setTimeout(() => _initHomeDashboard(reason + '-queued'), 100);
    }
  }
}

document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.tab-btn[data-tab="home"]');
  if (!btn) return;
  setTimeout(() => {
    // Tyhjennä pinned jos käyttäjä palaa kotiin
    try {
      const pinnedAt = localStorage.getItem('home_pinned_flight_at');
      if (pinnedAt) {
        const ageMin = (Date.now() - new Date(pinnedAt).getTime()) / 60000;
        // Pidetään voimassa 2 min (esim. jos kävi vahingossa toisella tabilla)
        // Sen jälkeen palataan normaaliin valintaan
        if (ageMin > 2) {
          localStorage.removeItem('home_pinned_flight_id');
          localStorage.removeItem('home_pinned_flight_at');
        }
      }
    } catch (e) {}

    const mapEl = document.getElementById('fc-map');
    if (mapEl && !mapEl.querySelector('svg')) {
      _initHomeDashboard('tab-click').catch(() => {});
    }
  }, 50);
});

setTimeout(() => {
  const mapEl = document.getElementById('fc-map');
  if (mapEl && !mapEl.querySelector('svg')) {
    _initHomeDashboard('retry-fallback').catch(() => {});
  }
}, 8000);

/* Fuel-kenttä */
async function _fillFuelForVisibleCards() {
  if (typeof getBlockFuelFromOFP !== 'function') return;
  const els = document.querySelectorAll('.fc-fuel[data-flight-id]');
  for (const el of els) {
    if (el.dataset.loaded === '1') continue;
    const fid = el.dataset.flightId;
    if (!fid) continue;
    try {
      const fuel = await getBlockFuelFromOFP(fid);
      if (fuel && fuel.minDisplay) {
        el.querySelector('.fc-fuel-value').textContent = fuel.minDisplay;
        el.style.display = '';
        el.dataset.loaded = '1';
      }
    } catch (e) {}
  }
}
window._fillFuelForVisibleCards = _fillFuelForVisibleCards;

/* Päivän lennot */
function renderHomeDayFlights() {
  const container = document.getElementById('home-day-flights');
  if (!container) return;

  const roster = (() => {
    try { return JSON.parse(localStorage.getItem('assigned_flights_cache') || '[]'); }
    catch (e) { return []; }
  })();

  const todayYMD = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  })();

  const today = roster
    .filter(f => String(f.StdLt || f.Std || '').split('T')[0] === todayYMD)
    .sort((a, b) => new Date(a.StdLt || a.Std) - new Date(b.StdLt || b.Std));

  if (!today.length) {
    container.innerHTML = `
      <div class="home-day-empty">
        <span class="hde-icon">🏖</span>
        <span class="hde-text">Ei lentoja tänään</span>
      </div>`;
    if (typeof updateHomeStats === 'function') updateHomeStats([], roster);
    return;
  }

  const now = Date.now();
  container.innerHTML = today.map(f => {
    const carrier = String(f.CarrierCode || '').trim();
    const fltNo = String(f.FlightNumber || '').trim();
    const flightNum = (carrier && fltNo.startsWith(carrier)) ? fltNo : `${carrier}${fltNo}`;
    const dep = String(f.DepartureStationIcaoCode || f.DepartureStationCode || '?');
    const arr = String(f.ArrivalStationIcaoCode   || f.ArrivalStationCode   || '?');
    const std = String(f.StdLt || f.Std || '').split('T')[1]?.substring(0,5) || '--:--';
    const sta = String(f.StaLt || f.Sta || '').split('T')[1]?.substring(0,5) || '--:--';
    const reg = String(f.RegistrationNumber || '').trim();
    const stand = f.DepartureGateNumber ? String(f.DepartureGateNumber).trim() : '';
    const mins = Number(f.DurationMinutes) || 0;

    const stdT = new Date(f.StdLt || f.Std || 0).getTime();
    const staT = new Date(f.StaLt || f.Sta || 0).getTime();
    const isDone = staT && staT < now - 15 * 60 * 1000;
    const isActive = stdT && staT && now >= stdT - 30 * 60 * 1000 && now <= staT + 15 * 60 * 1000;

    let stateClass = '';
    let stateLabel = '';
    if (isDone) { stateClass = 'done'; stateLabel = '✔ LENNETTY'; }
    else if (isActive) { stateClass = 'active'; stateLabel = '● AKTIIVINEN'; }

    return `
      <div class="home-day-flight ${stateClass}">
        <div class="hdf-time">${std} → ${sta}</div>
        <div class="hdf-route">
          <span class="hdf-flt">${flightNum}</span>
          <span class="hdf-icao">${dep} → ${arr}</span>
        </div>
        <div class="hdf-meta">
          ${reg ? `<span class="hdf-reg">${reg}</span>` : ''}
          ${stand ? `<span class="hdf-stand">STAND ${stand}</span>` : ''}
          ${mins ? `<span class="hdf-block">${Math.floor(mins/60)}h ${String(mins%60).padStart(2,'0')}m</span>` : ''}
        </div>
        ${stateLabel ? `<div class="hdf-state">${stateLabel}</div>` : ''}
      </div>
    `;
  }).join('');

  if (typeof updateHomeStats === 'function') updateHomeStats(today, roster);
}
window.renderHomeDayFlights = renderHomeDayFlights;