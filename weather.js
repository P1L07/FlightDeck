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

  const target = `${WX_BASE}/metar?ids=${encodeURIComponent(icao)}&format=json&hours=3`;
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

function _fmtVis(visib) {
  if (visib == null || visib === '') return '–';
  const n = parseFloat(visib);
  if (isNaN(n)) return String(visib);
  if (n >= 10) return '10+ km';
  return `${n} km`;
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
      <div class="wx-cell"><span>Näkyvyys</span><b>${_fmtVis(metar.visib)}</b></div>
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

  return `
    <div class="flight-card-inner">
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
    </div>
  `;
}

async function renderHomeDashboard() {
  const { current, next } = _findCurrentAndNextFlights();

  // 1. Aktiivisen lennon kortti
  if (typeof renderActiveFlightCard === 'function') {
    renderActiveFlightCard().catch(() => {});
  }

  // 2. Seuraava lento
  const nextEl = document.getElementById('next-flight-content');
  if (nextEl) {
    nextEl.innerHTML = _flightCardHTML(next, { emptyText: 'Ei tulevia lentoja' });
  }

  // 3. Sää (alkuperäinen widget TAF:lla)
  const depEl = document.getElementById('weather-dep');
  const arrEl = document.getElementById('weather-arr');
  const depLabel = document.getElementById('home-wx-dep-label');
  const arrLabel = document.getElementById('home-wx-arr-label');
  const flight = current || next;

  if (!flight) {
    if (depEl) depEl.innerHTML = `<div class="empty">Ei lentoja</div>`;
    if (arrEl) arrEl.innerHTML = `<div class="empty">Ei lentoja</div>`;
    if (depLabel) depLabel.textContent = 'LÄHTÖ';
    if (arrLabel) arrLabel.textContent = 'SAAPUMINEN';
    return;
  }

  const depIcao = (flight.DepartureStationIcaoCode || flight.DepartureStationCode || '').toUpperCase();
  const arrIcao = (flight.ArrivalStationIcaoCode   || flight.ArrivalStationCode   || '').toUpperCase();

  if (depLabel) depLabel.textContent = `LÄHTÖ · ${depIcao || '–'}`;
  if (arrLabel) arrLabel.textContent = `SAAPUMINEN · ${arrIcao || '–'}`;

  if (depEl) depEl.innerHTML = `<div class="empty">Ladataan…</div>`;
  if (arrEl) arrEl.innerHTML = `<div class="empty">Ladataan…</div>`;

  const [depMetar, depTaf, arrMetar, arrTaf] = await Promise.all([
    depIcao ? fetchMETAR(depIcao).catch(() => null) : null,
    depIcao ? fetchTAF(depIcao).catch(() => null)   : null,
    arrIcao ? fetchMETAR(arrIcao).catch(() => null) : null,
    arrIcao ? fetchTAF(arrIcao).catch(() => null)   : null
  ]);

  if (typeof renderWeatherWidget === 'function') {
    renderWeatherWidget(depEl, depMetar, depTaf);
    renderWeatherWidget(arrEl, arrMetar, arrTaf);
  }

  setTimeout(() => {
    if (typeof _fillFuelForVisibleCards === 'function') {
      _fillFuelForVisibleCards().catch(() => {});
    }
  }, 500);
}
window.renderHomeDashboard = renderHomeDashboard;

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

// 3) Aja aina kun klikataan Home-tab
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.tab-btn[data-tab="home"]');
  if (btn) setTimeout(() => _initHomeDashboard('tab-click'), 50);
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

// 5) Turvaverkko: yritä uudelleen 5 s ja 15 s kuluttua
setTimeout(() => _initHomeDashboard('retry-5s'), 5000);
setTimeout(() => _initHomeDashboard('retry-15s'), 15000);

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

