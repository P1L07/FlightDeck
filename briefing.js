/* ==============================================================
 * BRIEFING · Lennon valmistelunäkymä
 * ==============================================================
 * Kokoaa yhteen:
 *   - Lennon perustiedot (aika, reitti, kone, block)
 *   - METAR + TAF lähtö- ja saapumiskentille
 *   - OFP-linkki (avaa previewOFPFromSkyplan)
 *   - Miehistö (jos saatavilla journey-logista)
 *   - NOTAM-placeholder
 *
 * Näyttää oletuksena seuraavan tulevan lennon. Käyttäjä voi
 * vaihtaa lennon "Vaihda lento" -valinnalla (dropdown).
 * ============================================================== */

const BRIEFING_FLIGHT_KEY = 'briefing_selected_flight_id';

/* ---------------- Apurit ---------------- */
function _bfEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _bfTime(iso) {
  if (!iso) return '--:--';
  const s = String(iso);
  if (s.includes('T')) return s.split('T')[1].substring(0, 5);
  return s;
}

function _bfDate(iso) {
  if (!iso) return '';
  return String(iso).split('T')[0];
}

function _bfFlightMins(f) {
  const dur = Number(f?.DurationMinutes);
  if (!isNaN(dur) && dur > 0) return dur;
  if (f?.Std && f?.Sta) {
    const d = new Date(f.Sta) - new Date(f.Std);
    if (d > 0) return Math.round(d / 60000);
  }
  return 0;
}

function _bfFmtMins(mins) {
  if (!mins || mins < 0) return '–';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function _bfFlightLabel(f) {
  if (!f) return '–';
  const carrier = String(f.CarrierCode || '').trim();
  const fltNo = String(f.FlightNumber || '').trim();
  const flightNum = (carrier && fltNo.startsWith(carrier)) ? fltNo : `${carrier}${fltNo}`;
  const dep = String(f.DepartureStationIcaoCode || f.DepartureStationCode || '?');
  const arr = String(f.ArrivalStationIcaoCode   || f.ArrivalStationCode   || '?');
  const std = new Date(f.StdLt || f.Std || 0).getTime();
  const date = String(f.StdLt || f.Std || '').split('T')[0];
  const time = _bfTime(f.StdLt || f.Std);

  // Merkitse onko mennyt / tänään / tuleva
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const flightDay = new Date(f.StdLt || f.Std || 0);
  flightDay.setHours(0, 0, 0, 0);

  let marker = '';
  if (flightDay.getTime() === today.getTime()) {
    marker = '★ ';        // tänään
  } else if (std < Date.now()) {
    marker = '· ';        // mennyt
  } else {
    marker = '→ ';        // tuleva
  }

  return `${marker}${flightNum} · ${dep} → ${arr} · ${date} ${time}`;
}

/* ---------------- Datan haku ---------------- */
function _bfGetRoster() {
  try {
    const raw = localStorage.getItem('assigned_flights_cache');
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function _bfGetUpcomingFlights() {
  const now = Date.now();
  const roster = _bfGetRoster();
  const LOOKBACK_MS  = 30 * 24 * 60 * 60 * 1000;   // 30 pv taakse
  const LOOKAHEAD_MS = 60 * 24 * 60 * 60 * 1000;   // 60 pv eteenpäin

  return roster
    .filter(f => {
      const std = new Date(f.StdLt || f.Std || 0).getTime();
      const sta = new Date(f.StaLt || f.Sta || 0).getTime();
      if (!std || !sta) return false;
      return sta > now - LOOKBACK_MS && std < now + LOOKAHEAD_MS;
    })
    .sort((a, b) => {
      const ta = new Date(a.StdLt || a.Std || 0).getTime();
      const tb = new Date(b.StdLt || b.Std || 0).getTime();
      return ta - tb;   // kronologinen (vanhin ensin)
    });
}

function _bfGetSelectedFlight() {
  const roster = _bfGetUpcomingFlights();
  if (!roster.length) return null;

  const now = Date.now();

  // 1) Tallennettu valinta
  let savedId = null;
  try { savedId = localStorage.getItem(BRIEFING_FLIGHT_KEY); } catch (e) {}
  if (savedId) {
    const found = roster.find(f =>
      String(f.ID || f.id || f.FlightID) === String(savedId)
    );
    if (found) return found;
  }

  // 2) Oletus: käynnissä oleva lento (std-30min … sta+30min)
  const current = roster.find(f => {
    const std = new Date(f.StdLt || f.Std || 0).getTime();
    const sta = new Date(f.StaLt || f.Sta || 0).getTime();
    return now >= std - 30 * 60 * 1000 && now <= sta + 30 * 60 * 1000;
  });
  if (current) return current;

  // 3) Seuraava tuleva
  const next = roster.find(f =>
    new Date(f.StdLt || f.Std || 0).getTime() > now
  );
  if (next) return next;

  // 4) Muuten viimeisin mennyt (Trip Info -täyttöä varten)
  return roster[roster.length - 1];
}

function _bfSetSelectedFlight(id) {
  try { localStorage.setItem(BRIEFING_FLIGHT_KEY, String(id)); } catch (e) {}
}

/* ---------------- Renderöi briefing ---------------- */
async function renderBriefing() {
  const container = document.getElementById('briefing-container');
  if (!container) return;

  const upcoming = _bfGetUpcomingFlights();
  if (!upcoming.length) {
    container.innerHTML = `
      <div style="padding:40px 22px; text-align:center;
                  background:var(--panel); border:1px solid var(--border);
                  border-radius:var(--radius);">
        <div style="font-size:34px; margin-bottom:10px;">✈</div>
        <div style="font-size:15px; font-weight:700; color:var(--text);">
          Ei tulevia lentoja
        </div>
        <div style="font-size:12px; color:var(--dim); margin-top:6px;">
          Synkkaa roster tai valitse mennyt lento Lennot-välilehdeltä.
        </div>
      </div>`;
    return;
  }

  const f = _bfGetSelectedFlight();
  if (!f) return;

  const flightId = f.ID || f.id || f.FlightID || '';
  const carrier = String(f.CarrierCode || '').trim();
  const fltNo = String(f.FlightNumber || '').trim();
  const flightNum = (carrier && fltNo.startsWith(carrier)) ? fltNo : `${carrier}${fltNo}`;
  const dep = String(f.DepartureStationIcaoCode || f.DepartureStationCode || 'XXXX').trim();
  const arr = String(f.ArrivalStationIcaoCode   || f.ArrivalStationCode   || 'XXXX').trim();
  const std = _bfTime(f.StdLt || f.Std);
  const sta = _bfTime(f.StaLt || f.Sta);
  const date = _bfDate(f.StdLt || f.Std);
  const reg = String(f.RegistrationNumber || f.AircraftDescription || 'TBA').trim();
  // Hae journey-log lentoaikaa varten (cache-ensin)
  let _bfLog = null;
  if (typeof getCachedJourneyLog === 'function') {
    _bfLog = getCachedJourneyLog(flightId);
  }

  const flightMins = _bfFlightTimeMins(f, _bfLog);
  const flightStr  = flightMins != null ? _bfFmtMins(flightMins) : '–';
  const blockMins  = _bfFlightMins(f);
  const blockStr   = _bfFmtMins(blockMins);

  // Dropdown valintaan
  const dropdownOptions = upcoming.map(x => {
    const xid = String(x.ID || x.id || x.FlightID || '');
    const label = _bfFlightLabel(x);
    const selected = xid === String(flightId) ? ' selected' : '';
    return `<option value="${_bfEsc(xid)}"${selected}>${_bfEsc(label)}</option>`;
  }).join('');

  // Onko jo lokikirjassa?
  const logbookEntry = (typeof getLogbookEntryByFlightId === 'function')
    ? getLogbookEntryByFlightId(flightId)
    : null;

  container.innerHTML = `
    <div class="bf-head">
      <div class="bf-head-route">
        <div class="bf-head-icao">${_bfEsc(dep)}</div>
        <div class="bf-head-arrow">→</div>
        <div class="bf-head-icao">${_bfEsc(arr)}</div>
      </div>
      <div class="bf-head-meta">
        <span class="bf-head-flt">${_bfEsc(flightNum)}</span>
        <span class="bf-head-sep">·</span>
        <span class="bf-head-date">${_bfEsc(date)}</span>
        ${(() => {
          const stand = (typeof extractStandNumber === 'function')
            ? extractStandNumber(f, null)
            : null;
          return stand ? `
            <span class="bf-head-sep">·</span>
            <span class="bf-head-stand">STAND <b>${_bfEsc(stand.value)}</b></span>
          ` : '';
        })()}
      </div>
      <div class="bf-head-times">
        <div><span class="bf-label">STD</span><span class="bf-value">${std}</span></div>
        <div><span class="bf-label">STA</span><span class="bf-value">${sta}</span></div>
        <div><span class="bf-label">FLIGHT TIME</span><span class="bf-value bf-accent">${flightStr}</span></div>
        <div><span class="bf-label">BLOCK</span><span class="bf-value" style="font-size:14px; opacity:0.7;">${blockStr}</span></div>
      </div>
      <div class="bf-head-actions">
        <select id="bf-flight-select" class="bf-select" onchange="onBriefingFlightChange(this.value)">
          ${dropdownOptions}
        </select>
        ${logbookEntry ? `
          <span class="bf-chip bf-chip-logged">✔ Lokikirjassa</span>
        ` : ''}
      </div>
    </div>

    <div class="bf-grid">
      <div class="card">
        <div class="card-label">SÄÄ · LÄHTÖ · ${_bfEsc(dep)}</div>
        <div class="weather-widget" id="bf-wx-dep">
          <div class="empty">Ladataan…</div>
        </div>
      </div>
      <div class="card">
        <div class="card-label">SÄÄ · SAAPUMINEN · ${_bfEsc(arr)}</div>
        <div class="weather-widget" id="bf-wx-arr">
          <div class="empty">Ladataan…</div>
        </div>
      </div>
    </div>

    <div class="card" style="padding:14px 16px;">
      <div id="bf-notam-map" style="width:100%; height:280px; border-radius:12px;
          background:radial-gradient(ellipse at center, rgba(0,30,60,0.4) 0%, transparent 70%);
          overflow:hidden; position:relative; touch-action:none;">
        <div style="height:100%; display:flex; align-items:center; justify-content:center;
                    color:var(--dim); font-size:12px;">
          Ladataan..
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-label">ADD · ${_bfEsc(reg)}</div>
      <div id="bf-defects">
        <div class="def-loading">
          <div class="loader-spinner" style="transform:scale(0.7);"><span></span><span></span><span></span></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-label">TRIP INFO</div>
      <div id="bf-tripinfo">
        <div class="def-loading">
          <div class="loader-spinner" style="transform:scale(0.7);"><span></span><span></span><span></span></div>
          <span style="font-size:12px; color:var(--dim);">Ladataan tietoja…</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-label">MIEHISTÖ</div>
      <div id="bf-crew">
        <div class="empty">Ladataan…</div>
      </div>
    </div>
  `;

  _bfLoadWeather(dep, arr);
  _bfLoadCrew(flightId);
  if (typeof renderDefectsCardContent === 'function') {
    renderDefectsCardContent('bf-defects', reg).catch(() => {});
  }
  // Lataa Trip Info
  if (typeof renderTripInfoCard === 'function') {
    renderTripInfoCard('bf-tripinfo', f).catch(() => {});
  }
  // NOTAM-kartta
  if (typeof _bfLoadNotamMap === 'function') {
    _bfLoadNotamMap(f, flightId).catch(err => {
      console.warn('[Briefing] NOTAM-map epäonnistui:', err);
    });
  }
}
window.renderBriefing = renderBriefing;

/* ---------------- Lennon vaihto ---------------- */
function onBriefingFlightChange(id) {
  if (!id) return;
  _bfSetSelectedFlight(id);
  renderBriefing();
}
window.onBriefingFlightChange = onBriefingFlightChange;

/* ---------------- Sää ---------------- */
async function _bfLoadWeather(depIcao, arrIcao) {
  const depEl = document.getElementById('bf-wx-dep');
  const arrEl = document.getElementById('bf-wx-arr');

  const load = async (el, icao) => {
    if (!el || !icao || icao.length !== 4) {
      if (el) el.innerHTML = '<div class="empty">Ei ICAO-koodia</div>';
      return;
    }
    if (typeof fetchMETAR !== 'function') {
      if (el) el.innerHTML = '<div class="empty">Säämoduuli ei ole ladattu</div>';
      return;
    }
    try {
      const [metar, taf] = await Promise.all([
        fetchMETAR(icao).catch(() => null),
        fetchTAF(icao).catch(() => null)
      ]);
      if (typeof renderWeatherWidget === 'function') {
        renderWeatherWidget(el, metar, taf);
      } else {
        el.innerHTML = '<div class="empty">Sää-widget puuttuu</div>';
      }
    } catch (e) {
      console.warn('[Briefing] WX failed:', e);
      if (el) el.innerHTML = '<div class="empty">Sään haku epäonnistui</div>';
    }
  };

  await Promise.all([
    load(depEl, depIcao),
    load(arrEl, arrIcao)
  ]);
}

/* ---------------- Miehistö ---------------- */
async function _bfLoadCrew(flightId) {
  const el = document.getElementById('bf-crew');
  if (!el) return;

  if (!flightId) {
    el.innerHTML = '<div class="empty">Ei Flight ID:tä</div>';
    return;
  }

  // 1) Lokikirjasta
  const entry = (typeof getLogbookEntryByFlightId === 'function')
    ? getLogbookEntryByFlightId(flightId)
    : null;

  if (entry && entry.picName) {
    el.innerHTML = `
      <div class="bf-crew-list">
        <div class="bf-crew-item">
          <span class="bf-crew-role">PIC</span>
          <span class="bf-crew-name">${_bfEsc(entry.picName)}</span>
        </div>
      </div>
      <div style="font-size:11px; color:var(--dim); margin-top:10px;">
        Lähde: lokikirja
      </div>`;
    return;
  }

  if (typeof fetchJourneyLog !== 'function') {
    el.innerHTML = '<div class="empty">Journey-log-palvelu ei ole ladattu</div>';
    return;
  }

  el.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px; padding:10px 0;">
      <div class="loader-spinner" style="transform:scale(0.7);"><span></span><span></span><span></span></div>
      <span style="font-size:12px; color:var(--dim);">Ladataan miehistöä…</span>
    </div>`;

  try {
    let log = (typeof getCachedJourneyLog === 'function')
      ? getCachedJourneyLog(flightId)
      : null;

    if (!log) {
      const token = (typeof getValidSkyplanToken === 'function')
        ? await getValidSkyplanToken().catch(() => null)
        : null;
      log = await fetchJourneyLog(flightId, token);
      if (typeof _cacheJourneyLog === 'function') {
        _cacheJourneyLog(flightId, log);
      }
    }

    if (!log?.crewDuty?.length) {
      el.innerHTML = `
        <div class="empty">
          Miehistöä ei ole vielä julkaistu.
          <div style="font-size:11px; color:var(--faint); margin-top:6px;">
            Dispatch julkaisee miehistön yleensä 24 h ennen lähtöä.
          </div>
        </div>`;
      return;
    }

    // Järjestä: flight deck ensin (PIC, FO), sitten IFS, sitten muu cabin
    const ROLE_ORDER = {
      PIC: 1, CP: 1, CAPT: 1,
      FO: 2, SIC: 2,
      IS: 3, IFS: 3, PUR: 3, PURSER: 3,
      FY: 4, CABIN: 4, FA: 4
    };

    const rowsHtml = log.crewDuty
      .map(c => {
        const pos = String(c.position || '').toUpperCase().trim();
        const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.employeeId || '–';

        let label = pos;
        if (['CP','CAPT','PIC','P1'].includes(pos)) label = 'PIC';
        else if (['FO','SIC','P2','SO'].includes(pos)) label = 'FO';
        else if (['IS','IFS','PUR','PURSER','SCC','SCCM','CSD'].includes(pos)) label = 'IFS';
        else if (['FY','FA','CABIN'].includes(pos)) label = 'CC';

        const order = ROLE_ORDER[pos] || 9;
        const staffId = c.staffId || '';
        const isFav = staffId && (typeof isFavoriteCrew === 'function') && isFavoriteCrew(staffId);

        const safeFirst = String(c.firstName || '').replace(/'/g, "\\'");
        const safeLast = String(c.lastName || '').replace(/'/g, "\\'");
        const safePos = pos.replace(/'/g, "\\'");

        return {
          name, label, order, rawPos: pos, staffId, isFav,
          safeFirst, safeLast, safePos
        };
      })
      .sort((a, b) => a.order - b.order)
      .map(c => `
        <div class="bf-crew-item">
          <span class="bf-crew-role">${_bfEsc(c.label)}</span>
          <span class="bf-crew-name">${_bfEsc(c.name)}</span>
          ${c.staffId ? `
            <button class="crew-fav-btn ${c.isFav ? 'is-fav' : ''}"
                    data-fav-staff="${c.staffId}"
                    onclick="toggleFavoriteFromBtn(this, '${c.staffId}', '${c.safeFirst}', '${c.safeLast}', '${c.safePos}')"
                    title="${c.isFav ? 'Poista suosikeista' : 'Lisää suosikiksi'}">
              ${c.isFav ? '★' : '☆'}
            </button>
          ` : ''}
        </div>
      `).join('');

    el.innerHTML = `
      <div class="bf-crew-list">${rowsHtml}</div>
      <div style="font-size:11px; color:var(--dim); margin-top:10px;">
        ${log.crewDuty.length} miehistön jäsentä · Lähde: Skyplan journey-log
      </div>`;
  } catch (e) {
    console.warn('[Briefing] Crew failed:', e);
    el.innerHTML = `<div class="empty">Miehistön haku epäonnistui: ${_bfEsc(e.message)}</div>`;
  }
}

/* ---------------- OFP ---------------- */
function openBriefingOFP() {
  const f = _bfGetSelectedFlight();
  if (!f) return;

  const flightId = String(f.ID || f.id || f.FlightID || '');
  const carrier = String(f.CarrierCode || '').trim();
  const fltNo = String(f.FlightNumber || '').trim();
  const flightNum = (carrier && fltNo.startsWith(carrier)) ? fltNo : `${carrier}${fltNo}`;
  const dateStr = _bfDate(f.StdLt || f.Std);
  const tail = String(f.RegistrationNumber || '');

  if (typeof previewOFPFromSkyplan !== 'function') {
    if (typeof showToast === 'function') showToast('OFP-moduuli ei ole ladattu.', 'error');
    return;
  }
  previewOFPFromSkyplan(flightId, flightNum, dateStr, tail);
}
window.openBriefingOFP = openBriefingOFP;

/* ---------------- Tuo lokikirjaan ---------------- */
async function importBriefingToLogbook() {
  const f = _bfGetSelectedFlight();
  if (!f) return;

  const flightId = String(f.ID || f.id || f.FlightID || '');
  const carrier = String(f.CarrierCode || '').trim();
  const fltNo = String(f.FlightNumber || '').trim();
  const flightNum = (carrier && fltNo.startsWith(carrier)) ? fltNo : `${carrier}${fltNo}`;
  const dateStr = _bfDate(f.StdLt || f.Std);

  if (typeof importLogbookFromJourneyLog !== 'function') {
    if (typeof showToast === 'function') showToast('Lokikirjamoduuli ei ole ladattu.', 'error');
    return;
  }

  await importLogbookFromJourneyLog(flightId, flightNum, dateStr, {
    depIcao: f.DepartureStationIcaoCode,
    arrIcao: f.ArrivalStationIcaoCode,
    aircraftReg: f.RegistrationNumber,
    aircraftModel: f.AircraftDescription
  });

  // Päivitä näkymä
  renderBriefing();
}
window.importBriefingToLogbook = importBriefingToLogbook;


/* ==============================================================
 * Flight time (lentoaika) — takeoff → touchdown
 * ==============================================================
 * 1. Journey-log: todellinen FlightTime (lennon jälkeen)
 * 2. Roster: ETA - ETD (arvio ennen lentoa)
 * 3. Fallback: null (näytetään "–")
 * ============================================================== */
function _bfFlightTimeMins(f, log) {
  // 1. Journey-log FlightTime ("01:35:00" → 95 min)
  if (log?.flightTime) {
    const parts = String(log.flightTime).split(':');
    if (parts.length >= 2) {
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      if (!isNaN(h) && !isNaN(m)) return h * 60 + m;
    }
  }

  // 2. Roster: ETA - ETD
  const etd = f.EtdLt || f.Etd;
  const eta = f.EtaLt || f.Eta;
  if (etd && eta) {
    const diff = new Date(eta).getTime() - new Date(etd).getTime();
    if (diff > 0) return Math.round(diff / 60000);
  }

  // 3. Ei dataa → null
  return null;
}

/* ---------------- Init ---------------- */
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.tab-btn[data-tab="briefing"]');
  if (btn) setTimeout(renderBriefing, 50);
});

// Autoload kun sivu valmis
document.addEventListener('DOMContentLoaded', () => {
  // Jos briefing-tab on oletusnäkymä tai käyttäjä on jo siinä
  if (document.querySelector('.tab-btn[data-tab="briefing"].active')) {
    setTimeout(renderBriefing, 300);
  }
});

/* ==============================================================
 * NOTAM-KARTTA · Briefing-sivun NOTAM-kartta
 * ============================================================== */
/* ==============================================================
 * NOTAM-KARTTA · Briefing-sivun NOTAM-kartta
 * ============================================================== */
async function _bfLoadNotamMap(flight, flightId) {
  const mapEl = document.getElementById('bf-notam-map');
  if (!mapEl) return;

  if (!flightId) {
    mapEl.innerHTML = `
      <div style="height:100%; display:flex; align-items:center; justify-content:center;
                  color:var(--dim); font-size:12px;">
        Ei Flight ID:tä — roster ei ole synkattu.
      </div>`;
    return;
  }

  try {
    // Hae NOTAMit OFP:stä
    const data = await parseOFPsForNotams(flightId);

    // Varmista että flight-objekti on täysi (hae rosterista jos tarpeen)
    let fullFlight = flight;
    try {
      const roster = JSON.parse(localStorage.getItem('assigned_flights_cache') || '[]');
      const m = roster.find(x => String(x.ID || x.id || x.FlightID) === String(flightId));
      if (m) fullFlight = { ...m, ...flight };
    } catch (e) {}

    // Rakenna kenttädata
    const airports = buildAirportData(data.notams, fullFlight);
    const valid = airports.filter(a => a.coords);

    if (!valid.length) {
      mapEl.innerHTML = `
        <div style="height:100%; display:flex; flex-direction:column; align-items:center;
                    justify-content:center; color:var(--dim); font-size:12px;
                    text-align:center; padding:20px; gap:6px;">
          <div style="font-size:24px;">📡</div>
          <div>Ei NOTAM-kenttiä OFP:ssä.</div>
        </div>`;
      if (legendEl) legendEl.innerHTML = '';
      return;
    }

    // ============ Esilataa METAR/TAF kaikille kentille ============
    // (toimii taustalla, ei blokkaa renderöintiä)
    _preloadWxForAirports(valid).catch(() => {});

    // Renderöi kartta
    if (typeof renderNotamMap === 'function') {
      await renderNotamMap(mapEl, valid);
    }

  } catch (e) {
    console.error('[Briefing] NOTAM-parse epäonnistui:', e);
    mapEl.innerHTML = `
      <div style="height:100%; display:flex; align-items:center; justify-content:center;
                  color:var(--error); font-size:12px; text-align:center; padding:20px;">
        NOTAM-haku epäonnistui:<br>
        <span style="font-size:11px;">${String(e.message || '')}</span>
      </div>`;
  }
}
window._bfLoadNotamMap = _bfLoadNotamMap;