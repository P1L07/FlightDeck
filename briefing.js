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
  const LOOKBACK_MS  = 7 * 24 * 60 * 60 * 1000;    // 7 pv taakse
  const LOOKAHEAD_MS = 30 * 24 * 60 * 60 * 1000;   // 30 pv eteenpäin

  return roster
    .filter(f => {
      const std = new Date(f.StdLt || f.Std || 0).getTime();
      const sta = new Date(f.StaLt || f.Sta || 0).getTime();
      if (!std || !sta) return false;
      return sta > (now - LOOKBACK_MS) && std < (now + LOOKAHEAD_MS);
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
    const found = roster.find(f => String(f.ID || f.id || f.FlightID) === String(savedId));
    if (found) return found;
  }

  // 2) Oletus: käynnissä oleva lento (std-30min … sta+30min)
  const current = roster.find(f => {
    const std = new Date(f.StdLt || f.Std || 0).getTime();
    const sta = new Date(f.StaLt || f.Sta || 0).getTime();
    return now >= (std - 30 * 60 * 1000) && now <= (sta + 30 * 60 * 1000);
  });
  if (current) return current;

  // 3) Seuraava tuleva
  const next = roster.find(f => new Date(f.StdLt || f.Std || 0).getTime() > now);
  if (next) return next;

  // 4) Muuten viimeisin mennyt
  return roster[roster.length - 1];
}

function _bfSetSelectedFlight(id) {
  try {
    localStorage.setItem(BRIEFING_FLIGHT_KEY, String(id));
    // Synkkaa kotiin — pinned flight
    localStorage.setItem('home_pinned_flight_id', String(id));
    localStorage.setItem('home_pinned_flight_at', new Date().toISOString());
  } catch (e) {}
}

/* ==============================================================
 * RENDER GENERATION
 * ============================================================== */
let _bfRenderGen = 0;

async function renderBriefing() {
  const container = document.getElementById('briefing-container');
  if (!container) return;

  const myGen = ++_bfRenderGen;
  const upcoming = _bfGetUpcomingFlights();
  
  if (!upcoming.length) {
    container.innerHTML = `
      <div style="padding:40px 22px; text-align:center; background:var(--panel); border:1px solid var(--border); border-radius:var(--radius);">
        <div style="font-size:34px; margin-bottom:10px;">✈</div>
        <div style="font-size:15px; font-weight:700; color:var(--text);">Ei tulevia lentoja</div>
        <div style="font-size:12px; color:var(--dim); margin-top:6px;">Synkkaa roster tai valitse mennyt lento Lennot-välilehdeltä.</div>
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
  
  let _bfLog = null;
  if (typeof getCachedJourneyLog === 'function') {
    _bfLog = getCachedJourneyLog(flightId);
  }

  const flightMins = _bfFlightTimeMins(f, _bfLog);
  const flightStr  = flightMins != null ? _bfFmtMins(flightMins) : '–';
  const blockMins  = _bfFlightMins(f);
  const blockStr   = _bfFmtMins(blockMins);

  const dropdownOptions = upcoming.map(x => {
    const xid = String(x.ID || x.id || x.FlightID || '');
    const label = _bfFlightLabel(x);
    const selected = xid === String(flightId) ? ' selected' : '';
    return `<option value="${_bfEsc(xid)}"${selected}>${_bfEsc(label)}</option>`;
  }).join('');

  const logbookEntry = (typeof getLogbookEntryByFlightId === 'function') ? getLogbookEntryByFlightId(flightId) : null;
  let standHtml = '';
  
  if (typeof extractStandNumber === 'function') {
    const stand = extractStandNumber(f, null);
    if (stand) {
      standHtml = `<span class="bf-head-sep">·</span><span class="bf-head-stand">STAND <b>${_bfEsc(stand.value)}</b></span>`;
    }
  }

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
        ${standHtml}
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
        ${logbookEntry ? `<span class="bf-chip bf-chip-logged">✔ Lokikirjassa</span>` : ''}
      </div>
    </div>

    <div class="bf-grid">
      <div class="card">
        <div class="card-label">SÄÄ · LÄHTÖ · ${_bfEsc(dep)}</div>
        <div class="weather-widget" id="bf-wx-dep"><div class="empty">Ladataan…</div></div>
      </div>
      <div class="card">
        <div class="card-label">SÄÄ · SAAPUMINEN · ${_bfEsc(arr)}</div>
        <div class="weather-widget" id="bf-wx-arr"><div class="empty">Ladataan…</div></div>
      </div>
    </div>

    <div class="card" style="padding:14px 16px;">
      <div id="bf-notam-map" style="width:100%; height:280px; border-radius:12px; background:radial-gradient(ellipse at center, rgba(0,30,60,0.4) 0%, transparent 70%); overflow:hidden; position:relative; touch-action:none;">
        <div style="height:100%; display:flex; align-items:center; justify-content:center; color:var(--dim); font-size:12px;">Ladataan..</div>
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
      <div id="bf-crew"><div class="empty">Ladataan…</div></div>
    </div>
  `;

  _bfLoadWeather(dep, arr, myGen);
  _bfLoadCrew(flightId, myGen);
  
  if (typeof renderDefectsCardContent === 'function') {
    renderDefectsCardContent('bf-defects', reg).catch(() => {});
  }
  if (typeof renderTripInfoCard === 'function') {
    renderTripInfoCard('bf-tripinfo', f).catch(() => {});
  }
  if (typeof _bfLoadNotamMap === 'function') {
    _bfLoadNotamMap(f, flightId).catch(() => {});
  }
}
window.renderBriefing = renderBriefing;

/* ---------------- Lennon vaihto ---------------- */
function onBriefingFlightChange(id) {
  if (!id) return;
  _bfSetSelectedFlight(id);
  renderBriefing();
  
  // Päivitetään kotisivu välittömästi, jotta valinta synkronoituu Dashboardille
  if (typeof renderHomeDashboard === 'function') {
    renderHomeDashboard().catch(() => {});
  }
}
window.onBriefingFlightChange = onBriefingFlightChange;

/* ---------------- Sää ---------------- */
async function _bfLoadWeather(depIcao, arrIcao, gen = null) {
  const depEl = document.getElementById('bf-wx-dep');
  const arrEl = document.getElementById('bf-wx-arr');

  const load = async (el, icao) => {
    if (!el || !icao || icao.length !== 4) {
      if (el) el.innerHTML = '<div class="empty">Ei ICAO-koodia</div>';
      return;
    }

    try {
      let result = { metar: null, taf: null };
      if (typeof fetchWXForAirport === 'function') {
        result = await fetchWXForAirport(icao);
      } else if (typeof fetchMETAR === 'function') {
        const [metar, taf] = await Promise.all([
          fetchMETAR(icao).catch(() => null),
          fetchTAF(icao).catch(() => null)
        ]);
        result = { metar, taf };
      } else {
        if (el) el.innerHTML = '<div class="empty">Säämoduuli ei ole ladattu</div>';
        return;
      }

      if (gen != null && gen !== _bfRenderGen) return;
      if (!el.isConnected) return;

      if (typeof renderWeatherWidget === 'function') {
        renderWeatherWidget(el, result.metar, result.taf);
      } else {
        el.innerHTML = '<div class="empty">Sää-widget puuttuu</div>';
      }
    } catch (e) {
      if (gen != null && gen !== _bfRenderGen) return;
      if (!el.isConnected) return;
      if (el) el.innerHTML = '<div class="empty">Sään haku epäonnistui</div>';
    }
  };

  await Promise.all([load(depEl, depIcao), load(arrEl, arrIcao)]);
}

/* ---------------- Miehistö ---------------- */
const _bfCrewInFlight   = new Map();
const _bfCrewFailed422  = new Map();
const CREW_422_COOLDOWN = 15 * 60 * 1000;   // 15 min

async function _bfLoadCrew(flightId, gen = null) {
  const el = document.getElementById('bf-crew');
  if (!el) return;

  if (!flightId) {
    el.innerHTML = '<div class="empty">Ei Flight ID:tä</div>';
    return;
  }

  const isStale = () => (gen != null && gen !== _bfRenderGen) || !el.isConnected;

  const renderCrew = (log) => {
    if (isStale()) return;

    if (!log?.crewDuty?.length) {
      el.innerHTML = `<div class="empty">Miehistöä ei ole vielä julkaistu.</div>`;
      return;
    }

    const ROLE_ORDER = { PIC: 1, CP: 1, CAPT: 1, P1: 1, FO: 2, SIC: 2, SO: 2, P2: 2, IS: 3, IFS: 3, PUR: 3, PURSER: 3, SCC: 3, SCCM: 3, CSD: 3, FY: 4, CABIN: 4, FA: 4, CC: 4 };

    const rows = log.crewDuty
      .map((c, i) => {
        const pos = String(c.position || '').toUpperCase().trim();
        const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.employeeId || '–';

        let label = pos || '?';
        if (['CP','CAPT','PIC','P1'].includes(pos)) label = 'PIC';
        else if (['FO','SIC','P2','SO'].includes(pos)) label = 'FO';
        else if (['IS','IFS','PUR','PURSER','SCC','SCCM','CSD'].includes(pos)) label = 'IFS';
        else if (['FY','FA','CABIN','CC'].includes(pos)) label = 'CC';

        const order = ROLE_ORDER[pos] || 9;
        const staffId = String(c.staffId || '');
        const isFav = staffId && (typeof isFavoriteCrew === 'function') && isFavoriteCrew(staffId);

        return {
          name, label, order, staffId, isFav,
          safeFirst: String(c.firstName || '').replace(/'/g, "\\'"),
          safeLast:  String(c.lastName  || '').replace(/'/g, "\\'"),
          safePos:   pos.replace(/'/g, "\\'"),
          origIndex: i
        };
      })
      .sort((a, b) => (a.order - b.order) || (a.origIndex - b.origIndex))
      .map(c => `
        <div class="bf-crew-item">
          <span class="bf-crew-role">${_bfEsc(c.label)}</span>
          <span class="bf-crew-name">${_bfEsc(c.name)}</span>
          ${c.staffId ? `
            <button class="crew-fav-btn ${c.isFav ? 'is-fav' : ''}" data-fav-staff="${c.staffId}" onclick="toggleFavoriteFromBtn(this, '${c.staffId}', '${c.safeFirst}', '${c.safeLast}', '${c.safePos}')" title="${c.isFav ? 'Poista suosikeista' : 'Lisää suosikiksi'}">
              ${c.isFav ? '★' : '☆'}
            </button>
          ` : ''}
        </div>
      `).join('');

    el.innerHTML = `
      <div class="bf-crew-list">${rows}</div>
      <div style="font-size:11px; color:var(--dim); margin-top:10px;">${log.crewDuty.length} miehistön jäsentä · Lähde: Skyplan journey-log</div>`;
  };

  const renderError = (err) => {
    if (isStale()) return;
    const msg = String(err?.message || '');
    const isNotPublished = msg.includes('422') || msg.includes('not available') || msg.includes('not been completed') || msg.includes('not yet') || msg.includes('Journey log');

    if (isNotPublished) {
      el.innerHTML = `<div class="empty">Miehistöä ei ole vielä julkaistu.<div style="font-size:11px; color:var(--faint); margin-top:6px;">Dispatch julkaisee miehistön yleensä 24 h ennen lähtöä.</div></div>`;
    } else {
      el.innerHTML = `<div class="empty">Miehistön haku epäonnistui.<div style="font-size:11px; color:var(--faint); margin-top:6px;">${_bfEsc(msg)}</div></div>`;
    }
  };

  const showLoader = () => {
    if (isStale()) return;
    el.innerHTML = `<div style="display:flex; align-items:center; gap:10px; padding:10px 0;"><div class="loader-spinner" style="transform:scale(0.7);"><span></span><span></span><span></span></div><span style="font-size:12px; color:var(--dim);">Ladataan miehistöä…</span></div>`;
  };

  const entry = (typeof getLogbookEntryByFlightId === 'function') ? getLogbookEntryByFlightId(flightId) : null;
  if (entry && entry.picName) {
    if (isStale()) return;
    el.innerHTML = `<div class="bf-crew-list"><div class="bf-crew-item"><span class="bf-crew-role">PIC</span><span class="bf-crew-name">${_bfEsc(entry.picName)}</span></div></div><div style="font-size:11px; color:var(--dim); margin-top:10px;">Lähde: lokikirja</div>`;
    return;
  }

  if (typeof fetchJourneyLog !== 'function') {
    if (isStale()) return;
    el.innerHTML = '<div class="empty">Journey-log-palvelu ei ole ladattu</div>';
    return;
  }

  const cachedLog = (typeof getCachedJourneyLog === 'function') ? getCachedJourneyLog(flightId) : null;
  if (cachedLog?.crewDuty?.length) {
    renderCrew(cachedLog);
    return;
  }

  const failedAt = _bfCrewFailed422.get(flightId);
  if (failedAt && (Date.now() - failedAt) < CREW_422_COOLDOWN) {
    renderError({ message: 'Journey log not available yet' });
    return;
  }

  if (_bfCrewInFlight.has(flightId)) {
    showLoader();
    try {
      const log = await _bfCrewInFlight.get(flightId);
      renderCrew(log);
    } catch (e) {
      renderError(e);
    }
    return;
  }

  showLoader();

  const p = (async () => {
    const token = (typeof getValidSkyplanToken === 'function') ? await getValidSkyplanToken().catch(() => null) : null;
    const log = await fetchJourneyLog(flightId, token);
    if (typeof _cacheJourneyLog === 'function') {
      try { _cacheJourneyLog(flightId, log); } catch (e) {}
    }
    return log;
  })();

  _bfCrewInFlight.set(flightId, p);

  try {
    const log = await p;
    renderCrew(log);
  } catch (e) {
    const msg = String(e?.message || '');
    if (msg.includes('422') || msg.includes('not available') || msg.includes('not been completed') || msg.includes('not yet')) {
      _bfCrewFailed422.set(flightId, Date.now());
    }
    renderError(e);
  } finally {
    _bfCrewInFlight.delete(flightId);
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

  (async () => {
    try {
      if (typeof getValidSkyplanToken !== 'function') {
        previewOFPFromSkyplan(flightId, flightNum, dateStr, tail);
        return;
      }
      const token = await getValidSkyplanToken().catch(() => null);
      if (!token) {
        previewOFPFromSkyplan(flightId, flightNum, dateStr, tail);
        return;
      }

      const v2Resp = await fetch(`https://kcskyplanapi.airastana.com/api/v2/flights/${flightId}/ofp`, { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null);

      if (v2Resp && v2Resp.status === 422) {
        if (typeof createModal === 'function') {
          createModal({ title: 'OFP ei vielä saatavilla', icon: '✈', type: 'info', message: 'Lennon OFP:tä ei ole vielä generoitu. Dispatch julkaisee sen yleensä 12–24 h ennen lähtöä.', confirmText: 'OK', compact: true });
        } else if (typeof showToast === 'function') {
          showToast('OFP ei vielä saatavilla — yritä myöhemmin.', 'info', 4000);
        }
        return;
      }

      previewOFPFromSkyplan(flightId, flightNum, dateStr, tail);
    } catch (e) {
      previewOFPFromSkyplan(flightId, flightNum, dateStr, tail);
    }
  })();
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

  renderBriefing();
}
window.importBriefingToLogbook = importBriefingToLogbook;

/* ==============================================================
 * Flight time (lentoaika) — takeoff → touchdown
 * ============================================================== */
function _bfFlightTimeMins(f, log) {
  if (log?.flightTime) {
    const parts = String(log.flightTime).split(':');
    if (parts.length >= 2) {
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      if (!isNaN(h) && !isNaN(m)) return (h * 60) + m;
    }
  }

  const etd = f.EtdLt || f.Etd;
  const eta = f.EtaLt || f.Eta;
  if (etd && eta) {
    const diff = new Date(eta).getTime() - new Date(etd).getTime();
    if (diff > 0) return Math.round(diff / 60000);
  }

  return null;
}

/* ---------------- Init ---------------- */
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.tab-btn[data-tab="briefing"]');
  if (btn) setTimeout(renderBriefing, 50);
});

document.addEventListener('DOMContentLoaded', () => {
  if (document.querySelector('.tab-btn[data-tab="briefing"].active')) {
    setTimeout(renderBriefing, 300);
  }
});

/* ==============================================================
 * NOTAM-KARTTA · Briefing-sivun NOTAM-kartta
 * ============================================================== */
async function _bfLoadNotamMap(flight, flightId) {
  const mapEl = document.getElementById('bf-notam-map');
  if (!mapEl) return;

  const dep = String(flight?.DepartureStationIcaoCode || flight?.DepartureStationCode || '').toUpperCase();
  const arr = String(flight?.ArrivalStationIcaoCode   || flight?.ArrivalStationCode   || '').toUpperCase();

  let airports = [];
  try {
    if (flightId && typeof parseOFPsForNotams === 'function') {
      const data = await parseOFPsForNotams(flightId);
      if (typeof buildAirportData === 'function') {
        airports = buildAirportData(data.notams, flight);
      }
    }
  } catch (e) {
    const msg = String(e?.message || '');
    const isAuthIssue = msg.includes('token missing') || msg.includes('token expired') || msg.includes('authentication rejected');
    if (!msg.includes('422') && !msg.includes('not generated') && !isAuthIssue) {
      console.warn('[Briefing] NOTAM parse failed:', e);
    }
  }

  const ensureAirport = (icao, role) => {
    if (!icao || icao.length !== 4) return;
    if (airports.find(a => a.icao === icao)) return;
    airports.push({
      icao, role, notams: [],
      coords: (typeof _icaoCoords === 'function') ? _icaoCoords(icao) : null
    });
  };
  
  ensureAirport(dep, 'DEP');
  ensureAirport(arr, 'DEST');

  const valid = airports.filter(a => a.coords && isFinite(a.coords.lat));
  if (!valid.length) {
    mapEl.innerHTML = `<div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; color:var(--dim); font-size:12px; text-align:center; padding:20px; gap:6px;"><div style="font-size:24px;">📡</div><div>Ei koordinaatteja reitille.</div></div>`;
    return;
  }

  if (typeof renderNotamMap === 'function') {
    await renderNotamMap(mapEl, valid);
  }

  if (valid.length && typeof _preloadWxForAirports === 'function') {
    _preloadWxForAirports(valid).catch(() => {});
  }
}
window._bfLoadNotamMap = _bfLoadNotamMap;