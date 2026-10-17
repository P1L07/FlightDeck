/* ==============================================================
 * WEATHER MODULE · METAR + TAF
 * Käyttää aviationweather.gov -rajapintaa (ilmainen, CORS sallittu)
 * ============================================================== */

const WX_CACHE_KEY = 'wx_cache_v1';
const WX_CACHE_TTL = 20 * 60 * 1000;   // 20 min
const WX_BASE      = 'https://aviationweather.gov/api/data';

/* Cloudflare Worker -välityspalvelin
 * Vaihda tähän oma Worker-osoitteesi! */
const WX_PROXY = 'https://wx-proxy.janri-kallas.workers.dev';

/* Rakentaa välityspalvelimen kautta kulkevan URL:n */
function _wxProxied(targetUrl) {
  return `${WX_PROXY}/?url=${encodeURIComponent(targetUrl)}`;
}

let _ofpLoadFailed = {};

/* ---------------- Cache ---------------- */
function _wxCacheRead() {
  try {
    return JSON.parse(localStorage.getItem(WX_CACHE_KEY) || '{}') || {};
  } catch (e) { return {}; }
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
  // Rajaa cache 200 entryyn
  const keys = Object.keys(cache);
  if (keys.length > 200) {
    keys.sort((a, b) => cache[a].t - cache[b].t)
        .slice(0, keys.length - 200)
        .forEach(k => delete cache[k]);
  }
  _wxCacheWrite(cache);
}


async function fetchMETAR(icao) {
  const key = `metar:${icao}`;
  const cached = _wxCacheGet(key);
  if (cached) return cached;

  // 12 h ikkuna — kattaa harvemmin raportoivat kentät (mm. UAAA, Keski-Aasia)
  const target = `${WX_BASE}/metar?ids=${encodeURIComponent(icao)}&format=json&hours=12`;
  const resp = await fetch(_wxProxied(target));
  if (!resp.ok) throw new Error(`METAR HTTP ${resp.status}`);
  const arr = await resp.json();
  const data = Array.isArray(arr) && arr.length ? arr[0] : null;
  if (data) _wxCacheSet(key, data);
  return data;
}

async function fetchTAF(icao) {
  const key = `taf:${icao}`;
  const cached = _wxCacheGet(key);
  if (cached) return cached;

  const target = `${WX_BASE}/taf?ids=${encodeURIComponent(icao)}&format=json`;
  const resp = await fetch(_wxProxied(target));
  if (!resp.ok) throw new Error(`TAF HTTP ${resp.status}`);
  const arr = await resp.json();
  const data = Array.isArray(arr) && arr.length ? arr[0] : null;
  if (data) _wxCacheSet(key, data);
  return data;
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
  // 1. Yritä parsia raw METARista (tarkin)
  if (rawOb) {
    // ICAO-metriformaatti: 4-numeroinen metreinä
    const mMetric = rawOb.match(/\s(\d{4})\s/);
    if (mMetric) {
      const m = parseInt(mMetric[1], 10);
      if (m === 9999) return '10+ km';
      if (m === 0)    return '<50 m';
      if (m < 1000)   return `${m} m`;
      return `${(m / 1000).toFixed(1)} km`;
    }
    // US-formaatti: "10SM", "1 1/2SM", "1/2SM"
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

  // 2. Fallback: tulkitse visib-kenttä
  if (visib == null || visib === '') return '–';
  const n = parseFloat(visib);
  if (isNaN(n)) return String(visib);
  if (n >= 10) return '10+ km';
  // Yli 30 → todennäköisesti metrejä
  if (n > 30) return `${(n / 1000).toFixed(1)} km`;
  // 0–30 → statute milejä
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
    // base on joko jalkoina (numeerinen) tai merkkijonona
    let base = '';
    if (c.base != null) {
      const b = Number(c.base);
      base = isFinite(b)
        ? String(Math.round(b / 100)).padStart(3, '0')   // 5000 ft → "050"
        : String(c.base);
    }
    return `${cover}${base}`;
  }).filter(Boolean).join(' ');
}

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
  if (!metar) {
    el.innerHTML = `<div class="empty">Ei dataa</div>`;
    return;
  }

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
        <span class="wx-compact-cat"
              style="color:${fltColor}; border-color:${fltColor};">
          ${fltCat || '—'}
        </span>
      </div>
      <div class="wx-compact-grid">
        <div><span>Tuuli</span><b>${_fmtWind(metar.wdir, metar.wspd, metar.wgst)}</b></div>
        <div><span>Näkyvyys</span><b>${_fmtVis(metar.visib)}</b></div>
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
      `Näkyvyys:  ${_fmtVis(metar.visib)}\n` +
      `Lämpötila: ${_fmtTemp(metar.temp)}  (kastepiste ${_fmtTemp(metar.dewp)})\n` +
      `QNH:       ${metar.altim != null ? Math.round(metar.altim) + ' hPa' : '–'}\n` +
      `Pilvet:    ${_fmtClouds(metar.clouds)}\n` +
      `Luokka:    ${metar.fltCat || '–'}\n` +
      `Havainto:  ${metar.reportTime ? new Date(metar.reportTime).toLocaleString() : '–'}`;

    if (notamOut) {
      notamOut.innerHTML = `
        <div style="padding:20px; text-align:center; color:var(--dim); font-size:13px;">
          <div style="font-size:20px; margin-bottom:8px;">🛠</div>
          NOTAM-integraatio tulossa myöhemmin.
          <div style="font-size:11px; margin-top:6px; color:var(--faint);">
            Syy: ilmaisten API-lähteiden kattavuus ei riitä Kazakstaniin.
          </div>
        </div>`;
    }

    if (typeof showToast === 'function') showToast(`Sää haettu: ${icao}`, 'success');
  } catch (err) {
    out.textContent = `Virhe: ${err.message}`;
    if (typeof showToast === 'function') showToast('Sään haku epäonnistui.', 'error');
  }
}
window.loadWeatherForStation = loadWeatherForStation;

/* ==============================================================
 * ETUSIVUN DASHBOARD · Nykyinen + seuraava lento + sää
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

  const now = Date.now();
  const WITH_GRACE_BEFORE = 30 * 60 * 1000;   // 30 min ennen STD:tä
  const WITH_GRACE_AFTER  = 45 * 60 * 1000;   // 45 min STA:n jälkeen

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

  // Fallback: jos ei tulevaa/nykyistä, näytä viimeisin mennyt (offline-recovery)
  if (!current && !upcoming && withTimes.length) {
    const latestPast = withTimes.sort((a, b) => b.std - a.std)[0];
    console.log('[Home] Fallback: käytetään viimeisintä lennoa', latestPast.f.FlightNumber);
    return { current: latestPast.f, next: null };
  }

  return { current: current?.f || null, next: upcoming?.f || null };
}

function _flightCardHTML(f, opts = {}) {
  if (!f) return `<div class="empty">${opts.emptyText || 'Ei lentoa'}</div>`;

  const carrier = String(f.CarrierCode || '').trim();
  const fltNo = String(f.FlightNumber || '').trim();
  const flightNum = (carrier && fltNo.startsWith(carrier)) ? fltNo : `${carrier}${fltNo}`;
  const dep = String(f.DepartureStationIcaoCode || f.DepartureStationCode || 'XXXX').trim();
  const arr = String(f.ArrivalStationIcaoCode   || f.ArrivalStationCode   || 'XXXX').trim();
  const std = _homeFmtTime(f.StdLt || f.Std);
  const sta = _homeFmtTime(f.StaLt || f.Sta);
  const reg = String(f.RegistrationNumber || f.AircraftDescription || 'TBA').trim();
  const fid = String(f.ID || f.id || f.FlightID || '');

  const stand = (typeof extractStandNumber === 'function')
    ? extractStandNumber(f, null)
    : null;

  // Countdown
  const stdMs = new Date(f.StdLt || f.Std || 0).getTime();
  const now = Date.now();
  let countdownHtml = '';
  if (stdMs > now) {
    const diff = stdMs - now;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const timeStr = h > 0
      ? `${h}h ${String(m).padStart(2,'0')}m`
      : `${m} min`;
    countdownHtml = `
      <div class="fc-countdown">
        <span class="fc-countdown-label">Lähtöön</span>
        <span class="fc-countdown-value">${timeStr}</span>
      </div>`;
  }

  return `
    <div class="flight-card-inner">
      <!-- Kartta / maapallo -->
      <div id="fc-map" class="fc-map"
           data-dep="${dep}" data-arr="${arr}"
           style="width:100%; height:220px;
                  border-radius:12px;
                  background:radial-gradient(ellipse at center,
                             rgba(0,30,60,0.35) 0%, transparent 70%);
                  overflow:hidden; margin-bottom:6px;
                  position:relative;"></div>

      <div class="fc-route-row">
        <div class="fc-route">
          <span class="fc-icao">${dep}</span>
          <span class="fc-arrow">→</span>
          <span class="fc-icao">${arr}</span>
        </div>
        <span class="fc-flt">${flightNum}</span>
      </div>

      <div class="fc-time-row">
        <span class="fc-time">${std} → ${sta}</span>
      </div>

      <div class="fc-reg-row">
        <span class="fc-reg fc-reg-clickable"
              onclick="showDefectsPopup('${reg}')"
              title="Näytä koneen viat">${reg}</span>
        ${stand ? `<span class="fc-stand">STAND <b>${stand.value}</b></span>` : ''}
      </div>

      <div class="fc-fuel" id="fc-fuel-${fid}" data-flight-id="${fid}" style="display:none;">
        <span class="fc-fuel-label">MIN BLOCK FUEL</span>
        <span class="fc-fuel-value">–</span>
      </div>

      ${countdownHtml}
    </div>`;
}

async function renderHomeDashboard() {
  // Tyhjennä edellinen stand-päivitys-intervalli
  if (window._standRefreshTimer) {
    clearInterval(window._standRefreshTimer);
    window._standRefreshTimer = null;
  }

  const { current, next } = _findCurrentAndNextFlights();
  const flight = current || next;

  // Aktiivisen lennon kortti (säilyy)
  if (typeof renderActiveFlightCard === 'function') {
    renderActiveFlightCard().catch(() => {});
  }

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
  const reg = String(flight.RegistrationNumber || flight.AircraftDescription || 'TBA').trim();
  const stand = (typeof extractStandNumber === 'function') ? extractStandNumber(flight, null) : null;

  const stdMs = new Date(flight.StdLt || flight.Std || 0).getTime();
  const now = Date.now();
  let countdownStr = '';
  if (stdMs > now) {
    const diff = stdMs - now;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    countdownStr = h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`;
  }

  overlayEl.innerHTML = `
    <div class="hm-route">
      <button class="hm-icao hm-icao-dep" data-icao="${dep}" type="button">${dep}</button>
      <span class="hm-arrow">→</span>
      <button class="hm-icao hm-icao-arr" data-icao="${arr}" type="button">${arr}</button>
      <span class="hm-flight">${flightNum}</span>
    </div>
    <div class="hm-info">
      <div class="hm-info-item">
        <span class="hm-info-label">Aika</span>
        <span class="hm-info-value">${std} → ${sta}</span>
      </div>
      <div class="hm-info-item">
        <span class="hm-info-label">Kone</span>
        <span class="hm-info-value">${reg}</span>
      </div>
      <div class="hm-info-item" id="hm-stand-item" ${stand ? '' : 'style="display:none;"'}>
        <span class="hm-info-label">Stand</span>
        <span class="hm-info-value" id="hm-stand-value">${stand ? stand.value : '–'}</span>
      </div>
    </div>
    ${countdownStr ? `<div class="hm-countdown">
      <span class="hm-countdown-label">Lähtöön</span>
      <span class="hm-countdown-value">${countdownStr}</span>
    </div>` : ''}
  `;
     // Auringonnousu/lasku DEP + DEST (#4) — kohdekentän paikallisessa ajassa
  if (typeof SunCalc !== 'undefined') {
    const depCoords = (typeof _icaoCoords === 'function') ? _icaoCoords(dep) : null;
    const arrCoords = (typeof _icaoCoords === 'function') ? _icaoCoords(arr) : null;

    // Karkea aikavyöhykearvio pituusasteesta (UTC ± tunnit)
    const approxTzOffset = (lon) => Math.round(lon / 15);

    const fmtInTz = (d, lon) => {
      if (!d) return '–';
      const offset = approxTzOffset(lon);
      // Muunna UTC-ms → kohdekentän paikallinen aika
      const shifted = new Date(d.getTime() + offset * 3600 * 1000);
      const hh = String(shifted.getUTCHours()).padStart(2, '0');
      const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
      return { time: `${hh}:${mm}`, offset };
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

  // ============ Stand-päivitys automaattisesti jos online ============
  if (navigator.onLine && typeof refreshSingleFlightFromRoster === 'function') {
    // Välitön päivitys
    (async () => {
      try {
        const fresh = await refreshSingleFlightFromRoster(fid, flight.StdLt || flight.Std);
        if (!fresh) return;
        const newStand = (typeof extractStandNumber === 'function')
          ? extractStandNumber(fresh, null) : null;
        const oldVal = stand ? stand.value : '';
        if (newStand && newStand.value && newStand.value !== oldVal) {
          console.log('[Stand] Päivitetty:', oldVal || '(tyhjä)', '→', newStand.value);
          const valEl = document.getElementById('hm-stand-value');
          const itemEl = document.getElementById('hm-stand-item');
          if (valEl) valEl.textContent = newStand.value;
          if (itemEl) itemEl.style.display = '';
          // Päivitä cached roster
          try {
            const roster = JSON.parse(localStorage.getItem('assigned_flights_cache') || '[]');
            const idx = roster.findIndex(x =>
              String(x.ID || x.id || x.FlightID) === String(fid));
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

    // Ajoitettu päivitys — vain jos lento on aktiivinen
    const stdMs = new Date(flight.StdLt || flight.Std || 0).getTime();
    const staMs = new Date(flight.StaLt || flight.Sta || 0).getTime();
    const now = Date.now();
    const isActive = now >= stdMs - 30 * 60 * 1000 && now <= staMs + 30 * 60 * 1000;

    if (isActive) {
      window._standRefreshTimer = setInterval(async () => {
        if (!navigator.onLine) return;
        if (!document.querySelector('#tab-home.active')) return;

        try {
          const fresh = await refreshSingleFlightFromRoster(fid, flight.StdLt || flight.Std);
          if (!fresh) return;
          const newStand = (typeof extractStandNumber === 'function')
            ? extractStandNumber(fresh, null) : null;
          if (!newStand || !newStand.value) return;

          const valEl = document.getElementById('hm-stand-value');
          const itemEl = document.getElementById('hm-stand-item');
          if (valEl && valEl.textContent !== newStand.value) {
            console.log('[Stand] Aikapäivitys:', valEl.textContent, '→', newStand.value);
            valEl.textContent = newStand.value;
            if (itemEl) itemEl.style.display = '';
          }
        } catch (e) {
          console.warn('[Stand] interval failed:', e);
        }
      }, 15 * 60 * 1000);
    }
  }

  // Hae NOTAMit taustalla
  let extraAirports = [];
  let notamAirports = [];
  try {
    if (typeof parseOFPsForNotams === 'function' && fid) {
      const data = await parseOFPsForNotams(fid);
      if (typeof buildAirportData === 'function') {
        notamAirports = buildAirportData(data.notams, flight);
        extraAirports = notamAirports.filter(a => a.role === 'ALTN' || a.role === 'NOTAM');
      }
    }
  } catch (e) {
    const msg = String(e?.message || '');
    if (!msg.includes('HTTP 422') && !msg.includes('not generated')) {
      console.warn('[HomeMap] NOTAM parse failed:', e);
    }
  }

    // Waypointit (#12)
  let waypointList = [];
  try {
    if (typeof parseOFPsForWaypoints === 'function' && fid) {
      const wpData = await parseOFPsForWaypoints(fid);
      waypointList = wpData.waypoints || [];
    }
  } catch (e) {
    const msg = String(e?.message || '');
    if (!msg.includes('HTTP 422') && !msg.includes('not generated')) {
      console.warn('[HomeMap] Waypoint parse failed:', e);
    }
  }

    // Esilataa WX taustalla (ei blokkaa renderöintiä)
  if (notamAirports.length && typeof _preloadWxForAirports === 'function') {
    _preloadWxForAirports(notamAirports).catch(() => {});
  }

  // Renderöi kartta — KAIKKI optiot mukaan lukien waypointit
  if (typeof renderFlightMap === 'function') {
    renderFlightMap(mapEl, dep, arr, {
      extraAirports,
      waypoints: waypointList,       // ← tämä puuttui aiemmin
      realistic: true,
      showTimezones: true,
      showWeather: true,
      date: new Date(),
      onMarkerClick: (airport, evt) => {
        const rect = cardEl.getBoundingClientRect();
        const px = evt ? (evt.clientX - rect.left) : cardEl.clientWidth / 2;
        const py = evt ? (evt.clientY - rect.top)  : cardEl.clientHeight / 2;
        showAirportPopupInline(airport, { x: px, y: py }, cardEl, notamAirports);
      },
      margin: 20
    });
  }

  // DEP/DEST-nappien klikkaus → popup markerin kohdalle
  overlayEl.querySelectorAll('.hm-icao').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const icao = btn.dataset.icao;
      const apt = _findAirportForIcao(icao, flight, notamAirports);

      // Hae markerin sijainti kartalta
      const pos = mapEl._getMarkerPosition ? mapEl._getMarkerPosition(icao) : null;
      const px = pos ? pos.x : cardEl.clientWidth - 200;
      const py = pos ? pos.y : cardEl.clientHeight / 2;

      showAirportPopupInline(apt, { x: px, y: py }, cardEl, notamAirports);
    });
  });
}
window.renderHomeDashboard = renderHomeDashboard;

  // ============ Countdown-päivitys ============
  if (window._homeCountdownTimer) clearInterval(window._homeCountdownTimer);
  const stdMsFinal = new Date(flight.StdLt || flight.Std || 0).getTime();
  window._homeCountdownTimer = setInterval(() => {
    const el = document.querySelector('.hm-countdown-value');
    if (!el) return;
    const diff = stdMsFinal - Date.now();
    if (diff <= 0) {
      el.textContent = 'LÄHTÖ';
      return;
    }
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    el.textContent = h > 0
      ? `${h}h ${String(m).padStart(2, '0')}m`
      : `${m} min`;
  }, 30000);   // päivitä 30 s välein

/* ==============================================================
 * Kartan sisäinen popup (DEP/DEST/ALTN/NOTAM)
 * ============================================================== */
async function showAirportPopupInline(airport, position, container, allAirports) {
  if (!airport || !container) return;

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

  // ============ Sijoittelu ============
  const cw = container.clientWidth;
  const ch = container.clientHeight;

  // ⬅ MUUTOS: turvamarginaalit topbarin ja tabbarin takia
  const TOP_INSET    = 96;   // topbar + hieman ilmaa
  const BOTTOM_INSET = 110;  // tabbar + hieman ilmaa
  const PAD          = 12;

  // Sallittu pystyikkuna
  const minY = TOP_INSET;
  const maxY = ch - BOTTOM_INSET;

  let px = position?.x ?? cw / 2;
  let py = position?.y ?? ch / 2;

  popup.style.visibility = 'hidden';
  popup.style.left = `${px}px`;
  popup.style.top  = `${py}px`;
  container.appendChild(popup);

  // ============ Sijoittelun hienosäätö ============
  requestAnimationFrame(() => {
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;

    // Oletus: 20px oikealle ja 20px ylös markerista
    let lx = px + 20;
    let ly = py - 20;

    // Vaakasuuntainen rajaus
    if (lx + pw > cw - PAD) lx = px - pw - 20;
    if (lx < PAD)           lx = PAD;
    if (lx + pw > cw - PAD) lx = Math.max(PAD, cw - pw - PAD);

    // ⬅ MUUTOS: pystysuuntainen rajaus huomioi topbarin ja tabbarin
    const popupH = Math.min(ph, maxY - minY);   // jos popup on korkeampi kuin sallittu tila
    if (ly + popupH > maxY) ly = maxY - popupH;
    if (ly < minY)          ly = minY;

    popup.style.left = `${lx}px`;
    popup.style.top  = `${ly}px`;
    popup.style.visibility = '';

    // Jos popup ei mahdu kokonaan, rajaa korkeus ja salli sisäinen scroll
    if (ph > maxY - minY) {
      popup.style.maxHeight = `${maxY - minY}px`;
    }
  });

  // ============ Sulku ============
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

  // ============ Hae METAR + TAF ============
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

  // ============ Rakenna sisältö ============
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
    const fmtVis = (v) => {
      if (v == null || v === '') return '–';
      const n = parseFloat(v);
      return isNaN(n) ? String(v) : (n >= 10 ? '10+ km' : n + ' km');
    };

    html += `
      <div class="notam-popup-section">
        <div class="notam-popup-head">
          <span>METAR${isStale ? ' · CACHE' : ''}</span>
          ${fltCat ? `<span class="notam-popup-badge" style="color:${catColor}; border-color:${catColor};">${fltCat}</span>` : ''}
        </div>
        <div class="notam-popup-grid">
          <div><span>Tuuli</span><b>${fmtWind(liveMetar.wdir, liveMetar.wspd, liveMetar.wgst)}</b></div>
          <div><span>Näkyvyys</span><b>${fmtVis(liveMetar.visib)}</b></div>
          <div><span>Lämpötila</span><b>${liveMetar.temp != null ? Math.round(liveMetar.temp) + '°C' : '–'}</b></div>
          <div><span>QNH</span><b>${liveMetar.altim != null ? Math.round(liveMetar.altim) + ' hPa' : '–'}</b></div>
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

  // ============ Re-clamp sisällön latauduttua ============
  // ⬅ MUUTOS: käytetään samoja insettejä kuin alkuvaiheessa
  requestAnimationFrame(() => {
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;

    let lx = parseFloat(popup.style.left);
    let ly = parseFloat(popup.style.top);

    // Vaakasuunta
    if (lx + pw > cw - PAD) lx = Math.max(PAD, px - pw - 20);
    if (lx < PAD)           lx = PAD;

    // Pystysuunta huomioi topbarin ja tabbarin
    const popupH = Math.min(ph, maxY - minY);
    if (ly + popupH > maxY) ly = maxY - popupH;
    if (ly < minY)          ly = minY;

    popup.style.left = `${lx}px`;
    popup.style.top  = `${ly}px`;

    if (ph > maxY - minY) {
      popup.style.maxHeight = `${maxY - minY}px`;
    }
  });
}
window.showAirportPopupInline = showAirportPopupInline;

/* Apuri: etsi kenttä ICAOn perusteella */
function _findAirportForIcao(icao, flight, extraAirports) {
  const dep = String(flight?.DepartureStationIcaoCode || '').toUpperCase();
  const arr = String(flight?.ArrivalStationIcaoCode || '').toUpperCase();
  if (icao === dep) {
    return {
      icao, role: 'DEP', notams: [],
      coords: (typeof _icaoCoords === 'function') ? _icaoCoords(icao) : null
    };
  }
  if (icao === arr) {
    return {
      icao, role: 'DEST', notams: [],
      coords: (typeof _icaoCoords === 'function') ? _icaoCoords(icao) : null
    };
  }
  return (extraAirports || []).find(a => a.icao === icao) || {
    icao, role: 'NOTAM', notams: [],
    coords: (typeof _icaoCoords === 'function') ? _icaoCoords(icao) : null
  };
}
window._findAirportForIcao = _findAirportForIcao;

/* --- Automaattinen päivitys kun avataan Home-tab tai palataan onlineen --- */
/* ==============================================================
 * KOTISIVUN INIT · Itsepäinen ja itsediagnosoiva
 * ============================================================== */

async function _initHomeDashboard(reason = 'boot') {
  try {
    await renderHomeDashboard();
  } catch (err) {
    console.error('[Weather] virhe:', err);
  }
}

// 1) Aja kun DOM on valmis (tai heti jos jo valmis)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(() => _initHomeDashboard('DOM'), 900));
} else {
  setTimeout(() => _initHomeDashboard('immediate'), 900);
}

// 2) Aja kun tullaan takaisin online
window.addEventListener('online', () => {
  setTimeout(() => _initHomeDashboard('online'), 1500);
});

// 3) Aja kun klikataan Home-tab — vain jos kartta on tyhjä
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.tab-btn[data-tab="home"]');
  if (!btn) return;
  setTimeout(() => {
    const mapEl = document.getElementById('fc-map');
    if (mapEl && !mapEl.querySelector('svg')) {
      _initHomeDashboard('tab-click').catch(() => {});
    }
  }, 50);
});

// 4) Aja kun roster on synkattu (loadAssignedFlights wrapper)
//    → käytetään MutationObserveria tarkkailemaan assigned-flights-container
document.addEventListener('DOMContentLoaded', () => {
  const flightsContainer = document.getElementById('assigned-flights-container');
  if (!flightsContainer) return;
  let lastLen = 0;
  const obs = new MutationObserver(() => {
    const now = flightsContainer.querySelectorAll('tbody tr').length;
    if (now !== lastLen) {
      lastLen = now;
      if (now > 0) setTimeout(() => _initHomeDashboard('roster-update'), 400);
    }
  });
  obs.observe(flightsContainer, { childList: true, subtree: true });
});


// 5) Turvaverkko: vain jos kartta ei ole vielä piirtynyt
setTimeout(() => {
  const mapEl = document.getElementById('fc-map');
  if (mapEl && !mapEl.querySelector('svg')) {
    console.log('[Home] Turvaverkko: kartta ei piirtynyt, yritetään uudelleen');
    _initHomeDashboard('retry-fallback').catch(() => {});
  }
}, 8000);

/* ==============================================================
 * Täytä MIN BLOCK FUEL -kenttä kaikille korteille joiden
 * data-flight-id löytyy DOM:sta. Ajaa taustalla ei-blokkaavasti.
 * ============================================================== */
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
    } catch (e) {
      // Ohita hiljaisesti
    }
  }
}
window._fillFuelForVisibleCards = _fillFuelForVisibleCards;

/* Kutsutaan renderHomeDashboard:in lopussa */

/* ==============================================================
 * Kotisivu · Päivän lennot + tilastot
 * ============================================================== */
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

  // Tämän päivän lennot
  const today = roster
    .filter(f => String(f.StdLt || f.Std || '').split('T')[0] === todayYMD)
    .sort((a, b) => new Date(a.StdLt || a.Std) - new Date(b.StdLt || b.Std));

  if (!today.length) {
    container.innerHTML = `
      <div class="home-day-empty">
        <span class="hde-icon">🏖</span>
        <span class="hde-text">Ei lentoja tänään</span>
      </div>`;
    updateHomeStats([], roster);
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

  updateHomeStats(today, roster);
}
window.renderHomeDayFlights = renderHomeDayFlights;

