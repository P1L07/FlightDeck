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
const BRIEFING_FLIGHT_AT_KEY = 'briefing_selected_flight_at';
const BRIEFING_PICK_TTL_MS = 3 * 60 * 60 * 1000; // käsin valinta pysyy 3 h

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

  const _std = f => new Date(f.StdLt || f.Std || 0).getTime();
  const _sta = f => new Date(f.StaLt || f.Sta || 0).getTime();

  // Käynnissä oleva lento (std-60min … sta+30min). Jos ikkunat menevät
  // päällekkäin (lyhyt kääntö), valitaan ensimmäinen joka ei ole vielä laskeutunut.
  // KORJAUS: käytä toteutuneita aikoja (ATD/ATA, takeoff/touchdown). Lennetty
  // lento ei ole enää "käynnissä", vaikka se laskeutui ennen STA:ta.
  const _act = f => (typeof getFlightActuals === 'function') ? getFlightActuals(f) : null;
  const inWindow = roster.filter(f => {
    const a = _act(f);
    if (a) return !a.done && (a.active || (now >= a.depMs - 60 * 60 * 1000 && now <= a.arrMs + 30 * 60 * 1000));
    return now >= (_std(f) - 60 * 60 * 1000) && now <= (_sta(f) + 30 * 60 * 1000);
  });
  const current = inWindow.find(f => _act(f)?.active) || inWindow[0] || null;

  // 1) Tallennettu käsin tehty valinta — KORJAUS: ei enää ikuinen.
  //    Pidetään vain jos valinta on tuore (< 3 h), tai valittu lento on
  //    vielä edessä eikä mikään muu lento ole juuri nyt käynnissä.
  let savedId = null, savedAt = 0;
  try {
    savedId = localStorage.getItem(BRIEFING_FLIGHT_KEY);
    savedAt = new Date(localStorage.getItem(BRIEFING_FLIGHT_AT_KEY) || 0).getTime() || 0;
  } catch (e) {}
  if (savedId) {
    const found = roster.find(f => String(f.ID || f.id || f.FlightID) === String(savedId));
    if (found) {
      const fresh = now - savedAt < BRIEFING_PICK_TTL_MS;
      const fa = _act(found);
      const stillAhead = fa ? !fa.done : (_sta(found) + 30 * 60 * 1000 > now);
      if (fresh || (stillAhead && (!current || current === found))) return found;
    }
    // Vanhentunut valinta → unohdetaan, jotta automaattinen valinta toimii
    try {
      localStorage.removeItem(BRIEFING_FLIGHT_KEY);
      localStorage.removeItem(BRIEFING_FLIGHT_AT_KEY);
    } catch (e) {}
  }

  // 2) Oletus: käynnissä oleva lento
  if (current) return current;

  // 3) Seuraava tuleva
  const next = roster.find(f => {
    const a = _act(f);
    return a ? (!a.done && a.depMs > now) : new Date(f.StdLt || f.Std || 0).getTime() > now;
  });
  if (next) return next;

  // 4) Muuten viimeisin mennyt
  return roster[roster.length - 1];
}

function _bfSetSelectedFlight(id) {
  try {
    localStorage.setItem(BRIEFING_FLIGHT_KEY, String(id));
    localStorage.setItem(BRIEFING_FLIGHT_AT_KEY, new Date().toISOString());
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
  _bfNotamState = {};
  _bfTafState = {};
  _bfTafTimes = {};
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
  // KORJAUS: STD/STA UTC:nä
  const std = (typeof fmtUtcHHMM === 'function') ? fmtUtcHHMM(f.Std || f.StdLt) : _bfTime(f.Std || f.StdLt);
  const sta = (typeof fmtUtcHHMM === 'function') ? fmtUtcHHMM(f.Sta || f.StaLt) : _bfTime(f.Sta || f.StaLt);
  const date = _bfDate(f.Std || f.StdLt);
  const altnRoster = _bfRosterAlternate(f);
  // TAF-korostuksen ajat: ETD/ETA jos saatavilla, muuten STD/STA (UTC)
  {
    const etd = new Date(f.Etd || f.Std || f.StdLt || 0).getTime();
    const eta = new Date(f.Eta || f.Sta || f.StaLt || 0).getTime();
    _bfTafTimes = { dep: etd, arr: eta, altn: eta };
  }
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

  const _dayInner = _bfDayCardHTML(f);
  container.innerHTML = `
    ${_bfLastDayBar}
    <div class="bf-head bf-head-merged">
      <div class="bf-head-top">
        <div class="bf-head-route">
        <div class="bf-head-icao">${_bfEsc(dep)}</div>
        <div class="bf-head-arrow">→</div>
        <div class="bf-head-icao">${_bfEsc(arr)}</div>
        </div>
        <div class="bf-head-btns">
          <button class="btn-ghost" onclick="forceRefreshBriefing()">⟳ Päivitä</button>
          <button class="btn-ghost" onclick="openBriefingOFP()">✈ Avaa OFP</button>
          <button class="btn-ghost" id="bf-copy-route" style="display:none;" onclick="_bfCopyRoute(this)">📋 Kopioi reitti</button>
          ${_bfDayNavState.n > 1 ? `<button class="btn-ghost" id="bf-day-toggle" onclick="_bfDayToggle()" data-no-i18n>${_bfDayToggleLabel()}</button>` : ''}
        </div>
      </div>
      <div class="bf-head-meta">
        <span class="bf-head-flt">${_bfEsc(flightNum)}</span>
        <span class="bf-head-sep">·</span>
        <span class="bf-head-date">${_bfEsc(date)}</span>
        <span id="bf-reqno" class="bf-head-req" style="display:none;"></span>
        ${standHtml}
        <span id="bf-head-altn" class="bf-head-stand" style="${altnRoster ? '' : 'display:none;'}"><span class="bf-head-sep">·</span> ALTN <b>${_bfEsc(altnRoster || '')}</b></span>
      </div>
      <div class="bf-head-times">
        <div><span class="bf-label">STD UTC</span><span class="bf-value">${std}</span>${_bfEstLine(f, 'dep')}</div>
        <div><span class="bf-label">STA UTC</span><span class="bf-value">${sta}</span>${_bfEstLine(f, 'arr')}</div>
        <div id="bf-ft-wrap"><span class="bf-label">FLIGHT TIME</span><span class="bf-value bf-accent" id="bf-flight-time">${flightStr}</span></div>
        <div><span class="bf-label">BLOCK</span><span class="bf-value" style="font-size:14px; opacity:0.7;">${blockStr}</span></div>
        <div id="bf-ci-wrap" style="display:none;"><span class="bf-label">CI</span><span class="bf-value" id="bf-ci" style="font-size:14px;"></span></div>
        <div id="bf-fl-wrap" style="display:none;"><span class="bf-label">FL</span><span class="bf-value" id="bf-fl" style="font-size:14px;"></span></div>
        <div id="bf-sr-wrap" style="display:none;"><span class="bf-label">MAX SR</span><span class="bf-value" id="bf-sr" style="font-size:14px;"></span></div>
        ${_bfDayNavState.n > 1 ? _bfSecNavHTML(f) : ''}
      </div>
      <div id="bf-routes" class="bf-routes" style="display:none;"></div>
      ${_dayInner}
    </div>

    <div class="bf-grid bf-grid-3">
      <div class="card" id="bf-card-dep">
        <div class="card-label">LÄHTÖ · ${_bfEsc(dep)}</div>
        <div class="weather-widget" id="bf-wx-dep"><div class="empty">Ladataan…</div></div>
      </div>
      <div class="card" id="bf-card-arr">
        <div class="card-label">SAAPUMINEN · ${_bfEsc(arr)}</div>
        <div class="weather-widget" id="bf-wx-arr"><div class="empty">Ladataan…</div></div>
      </div>
      <div class="card" id="bf-card-altn">
        <div class="card-label" id="bf-altn-label">VARAKENTTÄ${altnRoster ? ' · ' + _bfEsc(altnRoster) : ''}</div>
        <div class="weather-widget" id="bf-wx-altn"><div class="empty">${altnRoster ? 'Ladataan…' : 'Haetaan varakenttää OFP:stä…'}</div></div>
      </div>
    </div>

    <div class="card" style="padding:14px 16px;">
      <div id="bf-notam-map" style="width:100%; height:380px; border-radius:12px; background:radial-gradient(ellipse at center, rgba(0,30,60,0.4) 0%, transparent 70%); overflow:hidden; position:relative; touch-action:none;">
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

  _bfStartDayUpdates(f, myGen);
  _bfLoadWeather(dep, arr, myGen);
  _bfLoadCrew(flightId, myGen);
  _bfLoadOfpExtras(f, flightId, { dep, arr, altn: altnRoster, hasFlightTime: flightMins != null }, myGen)
    .catch(e => console.warn('[Briefing] OFP extras:', e?.message || e));
  
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


/* ==============================================================
 * PÄIVÄNÄKYMÄ · päivän sektorit, kääntöajat ja eteneminen
 * ============================================================== */
const _bfL = (fi, en) => (typeof getLang === 'function' && getLang() === 'en') ? en : fi;
const _bfId = x => String(x?.ID || x?.id || x?.FlightID || '');
let _bfDayFlightId = null;
let _bfDayTimer = null;

function _bfHHMM(ms) {
  if (ms == null) return '--:--';
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
function _bfDur(min) {
  if (min == null || !isFinite(min)) return '–';
  const neg = min < 0; min = Math.abs(Math.round(min));
  const h = Math.floor(min / 60), m = min % 60;
  return (neg ? '−' : '') + (h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`);
}
function _bfDelta(actual, planned) {
  if (actual == null || planned == null) return '';
  const d = Math.round((actual - planned) / 60e3);
  if (d === 0) return '<em class="bf-dl ok">±0</em>';
  return `<em class="bf-dl ${d < 0 ? 'early' : (d > 15 ? 'late' : 'warn')}">${d > 0 ? '+' : '−'}${Math.abs(d)}</em>`;
}
function _bfFltNum(f) {
  const c = String(f.CarrierCode || '').trim(), n = String(f.FlightNumber || '').trim();
  return (c && n.startsWith(c)) ? n : `${c}${n}`;
}

/* Kaikki dutyt (päivät) briefingin lentolistasta */
function _bfDuties(list) {
  const out = [];
  const seen = new Set();
  for (const f of list) {
    if (seen.has(_bfId(f))) continue;
    const d = getDutySectors(f, list);
    d.forEach(x => seen.add(_bfId(x)));
    out.push(d);
  }
  return out;
}

function _bfDayCardHTML(f) {
  if (typeof getDutySectors !== 'function') return '';
  const roster = _bfGetRoster();
  const sectors = getDutySectors(f, roster);
  const A = sectors.map(getFlightActuals);
  const now = Date.now();
  const selId = _bfId(f);
  const n = sectors.length;

  // Päivämäärä (UTC, ensimmäisen sektorin lähtö)
  const d0 = new Date(A[0].stdMs);
  const wd = _bfL(['SU', 'MA', 'TI', 'KE', 'TO', 'PE', 'LA'], ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'])[d0.getUTCDay()];
  const dateStr = `${wd} ${d0.getUTCDate()}.${d0.getUTCMonth() + 1}.${d0.getUTCFullYear()}`;

  // Eteneminen
  const blockMin = A.reduce((s, a) => s + Math.max(0, ((a.ataMs ?? a.staMs) - (a.atdMs ?? a.stdMs)) / 60e3), 0);
  const curIdx = A.findIndex(a => !a.done);
  let status;
  if (curIdx === -1) status = _bfL('Päivä valmis ✓', 'Day complete ✓');
  else if (A[curIdx].active) status = _bfL(`Sektori ${curIdx + 1}/${n} käynnissä`, `Sector ${curIdx + 1}/${n} in progress`);
  else if (curIdx === 0) {
    const toGo = (A[0].depMs - now) / 60e3;
    status = toGo > 0 ? _bfL(`Alkaa ${_bfDur(toGo)} päästä`, `Starts in ${_bfDur(toGo)}`) : _bfL('Lähtö nyt', 'Departing now');
  } else status = _bfL(`Kääntö ennen sektoria ${curIdx + 1}/${n}`, `Turnaround before sector ${curIdx + 1}/${n}`);

  const sub = [
    n > 1 ? _bfL(`${n} sektoria`, `${n} sectors`) : _bfL('1 sektori', '1 sector'),
    `Block ${_bfDur(blockMin)}`,
    status
  ].join(' · ');

  // Aikajana (vain jos useita sektoreita)
  let bar = '';
  if (n > 1) {
    const t0 = Math.min(...A.map(a => a.depMs)), t1 = Math.max(...A.map(a => a.arrMs));
    const span = Math.max(1, t1 - t0);
    const pct = ms => Math.max(0, Math.min(100, (ms - t0) / span * 100));
    const segs = A.map((a, i) => {
      const cls = a.done ? 'done' : a.active ? 'active' : 'planned';
      return `<div class="bf-tl-seg ${cls}${_bfId(sectors[i]) === selId ? ' sel' : ''}" style="left:${pct(a.depMs)}%; width:${Math.max(1.5, pct(a.arrMs) - pct(a.depMs))}%;"
        title="${_bfEsc(_bfFltNum(sectors[i]))}"></div>`;
    }).join('');
    const nowMark = (now > t0 && now < t1) ? `<div class="bf-tl-now" style="left:${pct(now)}%;"></div>` : '';
    bar = `<div class="bf-tl">${segs}${nowMark}</div>
      <div class="bf-tl-axis"><span>${_bfHHMM(t0)}</span><span>${_bfHHMM(t1)} UTC</span></div>`;
  }

  // Sektorit + kääntöajat
  const chip = a => {
    const m = {
      done: ['done', _bfL('Lennetty', 'Flown')],
      landed: ['active', _bfL('Laskeutunut', 'Landed')],
      air: ['active', _bfL('Ilmassa', 'Airborne')],
      out: ['active', 'Off-block'],
      planned: ['planned', _bfL('Tuleva', 'Planned')]
    }[a.state];
    return `<span class="bf-sec-chip ${m[0]}">${m[1]}</span>`;
  };
  const depCell = a => {
    if (a.atdMs) return `ATD <b>${_bfHHMM(a.atdMs)}</b> ${_bfDelta(a.atdMs, a.stdMs)}`;
    if (a.etdMs && a.etdMs !== a.stdMs) return `ETD <b>${_bfHHMM(a.etdMs)}</b> ${_bfDelta(a.etdMs, a.stdMs)}`;
    return '';
  };
  const arrCell = a => {
    if (a.ataMs) return `ATA <b>${_bfHHMM(a.ataMs)}</b> ${_bfDelta(a.ataMs, a.staMs)}`;
    if (a.etaMs && a.etaMs !== a.staMs) return `ETA <b>${_bfHHMM(a.etaMs)}</b> ${_bfDelta(a.etaMs, a.staMs)}`;
    return '';
  };

  let rows = '';
  let selGbar = '';
  sectors.forEach((s, i) => {
    const a = A[i];
    const dep = String(s.DepartureStationIcaoCode || s.DepartureStationCode || '?');
    const arr = String(s.ArrivalStationIcaoCode || s.ArrivalStationCode || '?');
    const reg = String(s.RegistrationNumber || '').trim();
    if (i > 0) {
      const p = A[i - 1], ps = sectors[i - 1];
      const plan = (a.stdMs - p.staMs) / 60e3;
      const est = (a.depMs - p.arrMs) / 60e3;
      const isNow = (p.done || p.state === 'landed') && !a.atdMs && !a.active;
      const left = isNow ? (a.depMs - now) / 60e3 : null;
      const pReg = String(ps.RegistrationNumber || '').trim();
      const tight = est < 30;
      let gbar = '';
      if (isNow) {
        const tot = Math.max(1, a.depMs - p.arrMs);
        const done = Math.max(0, Math.min(1, (now - p.arrMs) / tot));
        gbar = `<div class="bf-turn-bar${left != null && left < 15 ? ' low' : ''}"><div style="width:${(done * 100).toFixed(1)}%"></div>
          <span>${p.ataMs ? 'ATA' : 'STA'} ${_bfHHMM(p.arrMs)}</span>
          <span class="bf-gb-left">${left >= 0 ? _bfL(`jäljellä ${_bfDur(left)}`, `${_bfDur(left)} left`) : _bfL(`myöhässä ${_bfDur(-left)}`, `${_bfDur(-left)} overdue`)}</span>
          <span>${a.etdMs && !a.atdMs ? 'ETD' : 'STD'} ${_bfHHMM(a.depMs)}</span></div>`;
      }
      rows += `<div class="bf-turn${isNow ? ' is-now' : ''}${tight ? ' tight' : ''}">
        <span>⟲ ${_bfL('Kääntö', 'Turnaround')} ${_bfEsc(dep)}</span>
        <span><b>${_bfDur(est)}</b>${Math.round(est) !== Math.round(plan) ? ` <i>(${_bfL('suunn.', 'plan')} ${_bfDur(plan)})</i>` : ''}</span>
        ${isNow ? `<span class="bf-turn-left">${left >= 0 ? _bfL(`jäljellä ${_bfDur(left)}`, `${_bfDur(left)} left`) : _bfL(`lähtö myöhässä ${_bfDur(-left)}`, `departure ${_bfDur(-left)} overdue`)}</span>` : ''}
        ${reg && pReg && reg !== pReg ? `<span class="bf-turn-ac">✈ ${_bfL('konevaihto', 'aircraft change')} → ${_bfEsc(reg)}</span>` : ''}
      </div>`;
      if (_bfId(s) === selId && gbar) selGbar = gbar;
    }
    const sid = _bfId(s);
    rows += `<div class="bf-sec is-${a.done ? 'done' : a.active ? 'active' : 'planned'}${sid === selId ? ' is-sel' : ''}"
        role="button" tabindex="0" onclick="onBriefingFlightChange('${_bfEsc(sid)}')">
      <div class="bf-sec-num">${i + 1}</div>
      <div class="bf-sec-main">
        <div class="bf-sec-l1"><b>${_bfEsc(_bfFltNum(s))}</b><span>${_bfEsc(dep)} → ${_bfEsc(arr)}</span>${chip(a)}</div>
        <div class="bf-sec-l2">
          <span>STD ${_bfHHMM(a.stdMs)} ${depCell(a)}</span>
          <span>STA ${_bfHHMM(a.staMs)} ${arrCell(a)}</span>
        </div>
      </div>
      <div class="bf-sec-reg">${_bfEsc(reg || '')}</div>
    </div>`;
  });

  // Päivänavigointi
  const duties = _bfDuties(_bfGetUpcomingFlights());
  const di = duties.findIndex(d => d.some(x => _bfId(x) === selId));
  const hasPrev = di > 0, hasNext = di >= 0 && di < duties.length - 1;

  const open = _bfDayIsOpen();
  const selIdx = sectors.findIndex(x => _bfId(x) === selId);
  _bfDayNavState = { selIdx, n };

  // Ohut päiväpalkki kortin yläpuolelle
  _bfLastDayBar = `<div class="bf-daybar" id="bf-daybar" data-no-i18n>
    <button type="button" class="bf-nav-btn" ${hasPrev ? '' : 'disabled'} onclick="_bfDayNav(-1)" title="${_bfL('Edellinen päivä', 'Previous day')}">‹</button>
    <div class="bf-daybar-txt"><b>${dateStr}</b> · ${_bfEsc(sub)}</div>
    <button type="button" class="bf-nav-btn" ${hasNext ? '' : 'disabled'} onclick="_bfDayNav(1)" title="${_bfL('Seuraava päivä', 'Next day')}">›</button>
  </div>`;

  // Kortin alaosa: maassaoloaika + päivän lennot
  return `<div class="bf-day${open ? ' is-open' : ''}" id="bf-day" data-no-i18n>
    ${selGbar ? `<div class="bf-ground"><div class="bf-ground-label">${_bfL('Maassa ennen lähtöä', 'On ground before departure')}</div>${selGbar}</div>` : ''}
    ${open && n > 1 ? `${bar}<div class="bf-day-list">${rows}</div>` : ''}
  </div>`;
}

let _bfLastDayBar = '';
let _bfDayNavState = { selIdx: 0, n: 1 };

/* Sektorinvaihto ▲ ▼ (jatkuu tarvittaessa edelliseen/seuraavaan päivään) */
function _bfSecNav(dir) {
  const list = _bfGetUpcomingFlights();
  const i = list.findIndex(x => _bfId(x) === _bfDayFlightId);
  const t = list[i + dir];
  if (t) onBriefingFlightChange(_bfId(t));
}
window._bfSecNav = _bfSecNav;

function _bfSecNavHTML(f) {
  const list = _bfGetUpcomingFlights();
  const i = list.findIndex(x => _bfId(x) === _bfId(f));
  const { selIdx, n } = _bfDayNavState;
  return `<div class="bf-secnav" data-no-i18n>
    <button type="button" class="bf-nav-btn" ${i > 0 ? '' : 'disabled'} onclick="_bfSecNav(-1)" title="${_bfL('Edellinen sektori', 'Previous sector')}">▲</button>
    <div class="bf-secnav-lbl">${selIdx + 1}/${n}</div>
    <button type="button" class="bf-nav-btn" ${i >= 0 && i < list.length - 1 ? '' : 'disabled'} onclick="_bfSecNav(1)" title="${_bfL('Seuraava sektori', 'Next sector')}">▼</button>
  </div>`;
}

function _bfDayIsOpen() {
  try { return localStorage.getItem('bf_day_open') === '1'; } catch (e) { return false; }
}
function _bfDayToggleLabel() {
  const n = _bfDayNavState.n;
  return _bfDayIsOpen() ? _bfL('▴ Piilota päivä', '▴ Hide day') : _bfL(`▾ Päivän lennot (${n})`, `▾ Day's flights (${n})`);
}
function _bfDayToggle() {
  try { localStorage.setItem('bf_day_open', _bfDayIsOpen() ? '0' : '1'); } catch (e) {}
  _bfRefreshDayCard();
  const b = document.getElementById('bf-day-toggle');
  if (b) b.textContent = _bfDayToggleLabel();
}

/* ETD/ATD ja ETA/ATA STD/STA:n alle */
function _bfEstLine(f, which) {
  if (typeof getFlightActuals !== 'function') return '';
  const a = getFlightActuals(f);
  if (!a) return '';
  let lbl = '', ms = null, ref = which === 'dep' ? a.stdMs : a.staMs;
  if (which === 'dep') {
    if (a.atdMs) { lbl = 'ATD'; ms = a.atdMs; } else if (a.etdMs) { lbl = 'ETD'; ms = a.etdMs; }
  } else {
    if (a.ataMs) { lbl = 'ATA'; ms = a.ataMs; } else if (a.etaMs) { lbl = 'ETA'; ms = a.etaMs; }
  }
  if (!ms) return '';
  return `<span class="bf-est" data-no-i18n>${lbl} <b>${_bfHHMM(ms)}</b> ${_bfDelta(ms, ref)}</span>`;
}

/* OFP:n viimeistely (takeoff-aika/-polttoaine + waypoint-ajat PDF:ään) */
async function _bfFinalizeOFP() {
  const fid = _bfDayFlightId;
  if (!fid || typeof finalizeOFP !== 'function') return;
  try {
    await finalizeOFP(fid, { download: true });
  } catch (e) {
    if (typeof showToast === 'function') showToast('Viimeistely epäonnistui: ' + (e?.message || e), 'error');
  }
}
window._bfFinalizeOFP = _bfFinalizeOFP;

/* ---------- OFP-tiedot lentokorttiin ---------- */
function _bfOfpRoutes(lines, dep, arr, altn) {
  const text = (lines || []).map(l => String(l).replace(/[\u200B-\u200D\uFEFF]/g, '').trim()).join(' ').replace(/\s+/g, ' ');
  const STOP = '(?=\\bALTN\\s*\\d?\\s+ROUTE\\b|\\bDEST\\s+ROUTE\\b|\\bFUEL\\b|\\bRMK\\b|\\bREMARKS?\\b|\\bPAGE\\b|$)';
  const grab = (re) => { const m = text.match(re); return m ? m[1].trim() : ''; };
  const cut = (route, endIcao) => {
    if (!route) return '';
    const toks = route.split(' ');
    if (endIcao) {
      const k = toks.findIndex((t, i) => i > 0 && t === endIcao);
      if (k > 0) return toks.slice(0, k + 1).join(' ');
    }
    return toks.slice(0, 80).join(' ');
  };
  const dest = cut(grab(new RegExp('\\bDEST\\s+ROUTE\\s*:?\\s*([\\s\\S]*?)' + STOP, 'i')), arr);
  const altnR = grab(new RegExp('\\bALTN\\s*1?\\s+ROUTE\\s*:?\\s*([\\s\\S]*?)' + STOP, 'i'));
  const altnIcao = altn || (altnR.split(' ').filter(t => /^[A-Z]{4}$/.test(t)).slice(-1)[0] || '');
  return { dest, altn: cut(altnR, altnIcao), text };
}

function _bfOfpField(text, res) {
  for (const re of res) { const m = text.match(re); if (m) return m[1]; }
  return '';
}

function _bfFillOfpInfo(lines, dep, arr, altn) {
  const r = _bfOfpRoutes(lines, dep, arr, altn);
  const T = r.text.toUpperCase();

  // Reitit
  const box = document.getElementById('bf-routes');
  if (box && (r.dest || r.altn)) {
    window._bfDestRoute = r.dest;
    box.innerHTML = `
      ${r.dest ? `<div class="bf-route">
        <div class="bf-route-head"><span class="bf-label">DEST ROUTE</span></div>
        <div class="bf-route-txt" data-no-i18n>${_bfEsc(r.dest)}</div></div>` : ''}
      ${r.altn ? `<div class="bf-route">
        <div class="bf-route-head"><span class="bf-label">ALTN ROUTE</span></div>
        <div class="bf-route-txt" data-no-i18n>${_bfEsc(r.altn)}</div></div>` : ''}`;
    box.style.display = '';
    const cb = document.getElementById('bf-copy-route');
    if (cb && r.dest) cb.style.display = '';
  }

  // Cost index
  const ci = _bfOfpField(T, [/\bCOST\s*INDEX\s*[:=]?\s*(\d{1,4})\b/, /\bCI\s*[:=/]?\s*(\d{1,4})\b/]);
  if (ci) {
    const el = document.getElementById('bf-ci'); if (el) el.textContent = ci;
    const w = document.getElementById('bf-ci-wrap'); if (w) w.style.display = '';
  }

  // Lentopinta: OFP:n kenttä, muuten reitin F-arvoista (alku → max)
  let fl = _bfOfpField(T, [/\b(?:INIT(?:IAL)?\s*(?:CRZ\s*)?FL|CRZ\s*FL|CRUISE\s*FL|FL\s*REQ)\s*[:=]?\s*(\d{3})\b/]);
  if (!fl && r.dest) {
    const fls = [...r.dest.matchAll(/[NKM]\d{3,4}[FA](\d{3})/g)].map(m => +m[1]);
    if (fls.length) {
      const first = fls[0], max = Math.max(...fls);
      fl = first === max ? String(first) : `${first}→${max}`;
    }
  }
  if (fl) {
    const el = document.getElementById('bf-fl'); if (el) el.textContent = fl;
    const w = document.getElementById('bf-fl-wrap'); if (w) w.style.display = '';
  }

  // Max shear rate (esim. "MAX SR 05")
  const sr = _bfOfpField(T, [/\bMAX\.?\s*SR\s*[:=]?\s*(\d{1,3})\b/, /\bMAX(?:IMUM)?\s*SHEAR(?:\s*RATE)?\s*[:=]?\s*(\d{1,3})\b/]);
  if (sr) {
    const el = document.getElementById('bf-sr'); if (el) el.textContent = sr;
    const w = document.getElementById('bf-sr-wrap'); if (w) w.style.display = '';
  }

  // OFP request number
  const req = _bfOfpField(T, [
    /\bREQ(?:UEST)?\.?\s*(?:NO|NR|NUMBER|ID|#)?\.?\s*[:=]?\s*(\d{4,})\b/,
    /\bOFP\s*(?:NO|NR|NUMBER|#)\.?\s*[:=]?\s*(\d{3,})\b/
  ]);
  if (req) {
    const el = document.getElementById('bf-reqno');
    if (el) { el.innerHTML = `<span class="bf-head-sep">·</span> REQ <b>${_bfEsc(req)}</b>`; el.style.display = ''; }
  }

  // Varakenttä meta-riville
  if (altn) {
    const el = document.getElementById('bf-head-altn');
    if (el) { el.innerHTML = `<span class="bf-head-sep">·</span> ALTN <b>${_bfEsc(altn)}</b>`; el.style.display = ''; }
  }
}

async function _bfCopyRoute(btn) {
  const txt = window._bfDestRoute || '';
  if (!txt) return;
  try { await navigator.clipboard.writeText(txt); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta);
    ta.select(); try { document.execCommand('copy'); } catch (e2) {} ta.remove();
  }
  if (btn) { const o = btn.textContent; btn.textContent = '✓'; setTimeout(() => { btn.textContent = o; }, 1500); }
  if (typeof showToast === 'function') showToast('Reitti kopioitu.', 'success');
}
window._bfCopyRoute = _bfCopyRoute;

/* Vianetsintä: näyttää OFP:n rivit, joissa CI / FL / REQ esiintyy */
window.debugOFPFields = async function (fid) {
  fid = fid || _bfDayFlightId;
  const lines = await getPDFLinesForFlight(fid);
  const hits = lines.filter(l => /\b(CI|COST|REQ|OFP|FL|CRZ|ROUTE)\b/i.test(l));
  console.log(hits.join('\n'));
  return hits;
};

function _bfHasFinalizeData(fid) {
  try {
    const ctx = (typeof Cache !== 'undefined') ? Cache.get(`flight:context:${fid}`, { mode: 'persist' })?.value : null;
    if (ctx?.takeoffIso || ctx?.takeoffFuelKg != null) return true;
    if (typeof getAllWaypointLogs === 'function' && Object.keys(getAllWaypointLogs(fid)).length) return true;
  } catch (e) {}
  return false;
}
window._bfDayToggle = _bfDayToggle;

function _bfDayNav(dir) {
  const duties = _bfDuties(_bfGetUpcomingFlights());
  const di = duties.findIndex(d => d.some(x => _bfId(x) === _bfDayFlightId));
  const target = duties[di + dir];
  if (!target) return;
  const pick = target.find(x => !getFlightActuals(x).done) || target[0];
  onBriefingFlightChange(_bfId(pick));
}
window._bfDayNav = _bfDayNav;

function _bfRefreshDayCard() {
  const el = document.getElementById('bf-day');
  if (!el || !_bfDayFlightId) return;
  const f = _bfGetRoster().find(x => _bfId(x) === _bfDayFlightId);
  if (!f) return;
  el.outerHTML = _bfDayCardHTML(f);
  const bar = document.getElementById('bf-daybar');
  if (bar) bar.outerHTML = _bfLastDayBar;
}

function _bfStartDayUpdates(f, gen) {
  _bfDayFlightId = _bfId(f);
  if (typeof refreshDutyActuals === 'function') {
    refreshDutyActuals(getDutySectors(f, _bfGetRoster()))
      .then(changed => { if (changed && gen === _bfRenderGen) _bfRefreshDayCard(); })
      .catch(() => {});
  }
  if (_bfDayTimer) clearInterval(_bfDayTimer);
  _bfDayTimer = setInterval(() => {
    if (!document.querySelector('#tab-briefing.active') || !document.getElementById('bf-day')) return;
    _bfRefreshDayCard();
    const fl = _bfGetRoster().find(x => _bfId(x) === _bfDayFlightId);
    if (fl && typeof refreshDutyActuals === 'function') {
      refreshDutyActuals(getDutySectors(fl, _bfGetRoster())).then(c => { if (c) _bfRefreshDayCard(); }).catch(() => {});
    }
  }, 60 * 1000);
}

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
        _bfTafAt(el, result.taf, el.id === 'bf-wx-dep' ? 'dep' : 'arr');
        _bfDecorateNotams();
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

/* ==============================================================
 * TAF @ ETD / ETA · voimassa olevat ryhmät korostettuna
 * ============================================================== */
let _bfTafTimes = {};   // role → ms (dep: ETD, arr/altn: ETA)

/* Pilkkoo raw-TAFin ryhmiin. Ajat DDHH(mm) → ms käyttäen viiteaikaa (ref)
 * kuukauden ja vuoden päättelyyn. */
function parseTafGroups(raw, refMs) {
  const txt = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!txt) return null;
  const ref = new Date(refMs || Date.now());
  const toMs = (dd, hh, mm = 0) => {
    let y = ref.getUTCFullYear(), mo = ref.getUTCMonth();
    const d = +dd;
    const refD = ref.getUTCDate();
    if (d - refD > 15) { mo -= 1; } else if (refD - d > 15) { mo += 1; }
    return Date.UTC(y, mo, d, +hh, +mm);   // hh=24 → seuraava päivä automaattisesti
  };
  const re = /\b(FM)(\d{2})(\d{2})(\d{2})\b|\b(BECMG|TEMPO|PROB[34]0(?:\s+TEMPO)?)\s+(\d{2})(\d{2})\/(\d{2})(\d{2})\b/g;
  const marks = [];
  let m;
  while ((m = re.exec(txt))) {
    if (m[1]) marks.push({ idx: m.index, type: 'FM', from: toMs(m[2], m[3], m[4]), to: null });
    else marks.push({ idx: m.index, type: m[5].replace(/\s+/g, ' '), from: toMs(m[6], m[7]), to: toMs(m[8], m[9]) });
  }
  const vm = txt.match(/\b(\d{2})(\d{2})\/(\d{2})(\d{2})\b/);
  const validFrom = vm ? toMs(vm[1], vm[2]) : null;
  const validTo = vm ? toMs(vm[3], vm[4]) : null;
  const groups = [];
  const firstIdx = marks.length ? marks[0].idx : txt.length;
  groups.push({ type: 'BASE', from: validFrom, to: null, text: txt.slice(0, firstIdx).trim() });
  marks.forEach((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].idx : txt.length;
    groups.push({ ...mk, text: txt.slice(mk.idx, end).trim() });
  });
  // Prevailing-ryhmien (BASE/FM) loppuajat = seuraava FM tai TAF:n loppu
  const prevailing = groups.filter(g => g.type === 'BASE' || g.type === 'FM');
  prevailing.forEach((g, i) => { g.to = prevailing[i + 1]?.from ?? validTo; });
  return { groups, validFrom, validTo };
}

/* Lentosääluokka ryhmän tekstistä (näkyvyys + alin BKN/OVC/VV) */
function tafCategory(text) {
  const t = ' ' + String(text || '').toUpperCase() + ' ';
  let vis = null, ceil = null;
  if (/\bCAVOK\b/.test(t)) { vis = 10000; }
  const vm = t.match(/\s(\d{4})(?:NDV)?\s/);
  if (vm) vis = +vm[1];
  const sm = t.match(/\s(P?)(\d+)?\s?(\d\/\d)?SM\s/);
  if (sm) { let v = (+sm[2] || 0); if (sm[3]) { const [a, b] = sm[3].split('/'); v += a / b; } vis = Math.round(v * 1609); }
  for (const c of t.matchAll(/\b(BKN|OVC|VV)(\d{3})/g)) {
    const ft = +c[2] * 100;
    if (ceil == null || ft < ceil) ceil = ft;
  }
  if (vis == null && ceil == null) return '';
  const v = vis ?? 99999, c = ceil ?? 99999;
  if (c < 500 || v < 1600) return 'LIFR';
  if (c < 1000 || v < 5000) return 'IFR';
  if (c <= 3000 || v <= 8000) return 'MVFR';
  return 'VFR';
}

/* Ryhmät, jotka ovat voimassa ajanhetkellä T (TEMPO/PROB: ±1 h ikkuna) */
function tafGroupsAt(parsed, T) {
  if (!parsed) return [];
  const H = 3600e3;
  const out = [];
  let prev = null;
  for (const g of parsed.groups) {
    if ((g.type === 'BASE' || g.type === 'FM') && g.from != null && g.from <= T && (g.to == null || T < g.to)) prev = g;
  }
  if (!prev) prev = parsed.groups[0];
  out.push(prev);
  for (const g of parsed.groups) {
    if (g.type === 'BECMG' && g.from <= T && g.from >= (prev.from ?? 0)) out.push(g);
    if (/^(TEMPO|PROB)/.test(g.type) && g.from < T + H && g.to > T - H) out.push(g);
  }
  return out;
}

let _bfTafState = {};   // role → { cat, hhmm, lbl, outside }
const _BF_TAF_RANK = { '': 0, VFR: 1, MVFR: 2, IFR: 3, LIFR: 4 };

function _bfTafAt(el, taf, role) {
  if (!el) return;
  el.querySelectorAll('.bf-taf-at').forEach(x => x.remove());
  delete _bfTafState[role];
  if (!taf?.rawTAF) { _bfPlaceTafBadge(role); return; }
  const T = _bfTafTimes[role];
  const parsed = parseTafGroups(taf.rawTAF, T || Date.now());
  if (!parsed) { _bfPlaceTafBadge(role); return; }

  const lbl = role === 'dep' ? 'ETD' : 'ETA';
  const hasT = !!T && isFinite(T);
  const hhmm = hasT ? new Date(T).toISOString().slice(11, 16) : '';
  const outside = !hasT || (parsed.validFrom && T < parsed.validFrom) || (parsed.validTo && T > parsed.validTo);
  const active = outside ? [] : tafGroupsAt(parsed, T);

  // Pahin luokka ETD/ETA-hetkellä
  let worst = '';
  for (const g of active) {
    const c = tafCategory(g.text);
    if (_BF_TAF_RANK[c] > _BF_TAF_RANK[worst]) worst = c;
  }
  _bfTafState[role] = { cat: worst, hhmm, lbl, outside };

  // Värjää oleelliset ryhmät raw-TAFissa luokan mukaan
  const details = el.querySelector('details.wx-taf');
  const pre = details?.querySelector('pre.wx-raw');
  if (pre && active.length) {
    let html = _bfEsc(parsed.groups.map(g => g.text).join('\n'));
    for (const g of active) {
      const e = _bfEsc(g.text);
      const c = tafCategory(g.text) || 'NA';
      html = html.replace(e, `<mark class="bf-taf-mark cat-${c}">${e}</mark>`);
    }
    pre.innerHTML = html;
  }
  _bfPlaceTafBadge(role);
}

function _bfPlaceTafBadge(role) {
  const card = document.getElementById(`bf-card-${role}`);
  if (!card) return;
  card.querySelectorAll('.bf-taf-badge').forEach(b => b.remove());
  const st = _bfTafState[role];
  if (!st) return;
  const cls = st.outside ? 'na' : ({ VFR: 'ok', MVFR: 'mvfr', IFR: 'warn', LIFR: 'bad' }[st.cat] || 'na');
  const title = st.outside
    ? `${st.lbl}${st.hhmm ? ' ' + st.hhmm + ' UTC' : ''} · Aika ei ole TAF:n voimassaoloajalla.`
    : `TAF @ ${st.lbl} ${st.hhmm} UTC${st.cat ? ' · ' + st.cat : ''}`;
  const html = `<button type="button" class="bf-notam-badge bf-taf-badge ${cls}" title="${_bfEsc(title)}"
    onclick="_bfOpenTaf('${role}')">TAF</button>`;

  const notam = card.querySelector('.bf-notam-badge:not(.bf-taf-badge)');
  if (notam) { notam.insertAdjacentHTML('beforebegin', html); return; }
  const head = card.querySelector('.wx-head');
  const cat = head?.querySelector('.wx-cat');
  if (cat) {
    if (!cat.parentElement.classList.contains('wx-badges')) {
      const wrap = document.createElement('div');
      wrap.className = 'wx-badges';
      cat.replaceWith(wrap);
      wrap.appendChild(cat);
    }
    cat.insertAdjacentHTML('afterend', html);
    return;
  }
  const lbl = card.querySelector('.card-label');
  if (lbl && !lbl.classList.contains('bf-card-head')) {
    lbl.classList.add('bf-card-head');
    lbl.innerHTML = `<span>${lbl.innerHTML}</span>`;
  }
  lbl?.insertAdjacentHTML('beforeend', html);
}

function _bfOpenTaf(role) {
  const card = document.getElementById(`bf-card-${role}`);
  const d = card?.querySelector('details.wx-taf');
  if (!d) return;
  d.open = !d.open;
  if (d.open) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
window._bfOpenTaf = _bfOpenTaf;
window.parseTafGroups = parseTafGroups;
window.tafGroupsAt = tafGroupsAt;
window.tafCategory = tafCategory;

/* ==============================================================
 * OFP-LISÄT · flight time, varakenttä, NOTAM-tila korteille
 * ============================================================== */
let _bfNotamState = {};   // role → { icao, notams, status, na }

function _bfRosterAlternate(f) {
  for (const k of ['Alternate1IcaoCode', 'Alternate1', 'AlternateIcaoCode', 'AlternateIcao',
                   'Alternate', 'DestinationAlternateIcaoCode', 'Altn1', 'Altn']) {
    const v = String(f?.[k] || '').toUpperCase().trim();
    if (/^[A-Z]{4}$/.test(v)) return v;
  }
  return '';
}

/* TRIP-rivi: "TRIP 2.45 7600" tai "TRIP 02:45 7600" → minuutit */
function _bfParseTripMins(lines) {
  for (const raw of lines || []) {
    const m = String(raw).trim().match(/^TRIP\s+(\d{1,2})[.:](\d{2})\b/i);
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  return null;
}

/* Varakenttä OFP:stä: "ALTN1 UAAA", "ALTN: UAAA", "ALTN UAAA/..." tai
 * NOTAM-briefin "ALTERNATE:"-osion ensimmäinen kenttä. */
function _bfParseAlternate(lines, dep, arr) {
  const skip = new Set([dep, arr]);
  for (const raw of lines || []) {
    const m = String(raw).toUpperCase().match(/\bALTN\s*1?\s*[:\-/]?\s*([A-Z]{4})\b/);
    if (m && !skip.has(m[1]) && m[1] !== 'ROUT' && m[1] !== 'FUEL') return m[1];
  }
  let inAlt = false;
  for (const raw of lines || []) {
    const t = String(raw).trim().toUpperCase();
    if (t.startsWith('ALTERNATE:')) {
      inAlt = true;
      const m = t.match(/^ALTERNATE:\s*([A-Z]{4})\b/);
      if (m && !skip.has(m[1])) return m[1];
      continue;
    }
    if (inAlt) {
      const m = t.match(/^(?:-\s*)?([A-Z]{4})\s+[A-Z]{1,2}\d{4}\/\d{2}/);
      if (m && !skip.has(m[1])) return m[1];
      if (/^(ARRIVAL|DEPARTURE|OTHER|ENROUTE|FIR):/.test(t)) inAlt = false;
    }
  }
  return '';
}

/* NOTAM-tila: punainen = kenttä tai kiitotie suljettu, keltainen = muu
 * merkittävä (RWY/ILS/U/S/NOT AVBL/WIP tai sanakirjan warning/critical),
 * vihreä = ei merkittäviä. Vain lennon aikaan (STD−2 h … STA+3 h) voimassa olevat. */
const _BF_CLOSED_RE = /\b(?:AD|AERODROME|ARPT|APRT|AIRPORT)\s+(?:CLSD|CLOSED)\b|\bRWY\s*\d{2}[LRC]?(?:\s*\/\s*\d{2}[LRC]?)?\s+(?:CLSD|CLOSED)\b/i;
const _BF_WARN_RE = /\bRWY\b|\bILS\b|U\/S|NOT\s+AVBL|UNSERVICEABLE|\bWIP\b|\bCLSD\b|\bCLOSED\b/i;

function _bfNotamLevel(n) {
  const t = _bfNotamBody(n.text);
  if (_BF_CLOSED_RE.test(t)) return 'bad';
  if (n.severity === 'critical' || n.severity === 'warning' || _BF_WARN_RE.test(t)) return 'warn';
  return 'ok';
}

/* NOTAM-teksti ilman perään jääneitä kategoriarivejä ("RWY") */
function _bfNotamBody(text) {
  const lines = String(text || '').split('\n').filter(l => !l.startsWith('#CAT '));
  while (lines.length > 1 && /^[A-Z/]{2,8}$/.test(lines[lines.length - 1].trim())) lines.pop();
  return lines.join('\n');
}


/* NOTAM-kategoriat (järjestys = näyttöjärjestys; ensimmäinen osuma voittaa) */
const NOTAM_CATEGORIES = [
  { k: 'AD',    l: 'Kenttä',               re: /\b(?:AD|AERODROME|ARPT|APRT|AIRPORT)\s+(?:CLSD|CLOSED)\b|\bAD\s+HR|\bOPR\s+HR|\bHOURS?\s+OF\s+(?:OPS|OPERATION)/ },
  { k: 'LGT',   l: 'Valot',                re: /\bLGT|\bLIGHT|\bLIGHTING|\bALS\b|\bPAPI\b|\bVASIS?\b|\bAPAPI\b|\bREDL\b|\bRCLL?\b|\bTDZL?\b|\bTWYL\b|\bSTOP\s*BAR|\bBEACON\b|\bABN\b/ },
  { k: 'PROC',  l: 'Menetelmät (SID/STAR/APCH)', re: /\bSID\b|\bSTAR\b|\bIAP\b|\bAPCH\b|\bAPPROACH\b|\bRNP\b|\bRNAV\b|\bMISSED\b|\bMNM\b|\bMINIMA\b|\bHOLDING\b|\bPROC/ },
  { k: 'NAV',   l: 'Navigointi / ILS',     re: /\bILS\b|\bLOC\b|\bLLZ\b|\bGP\b|\bG\/S\b|\bGLIDE|\bVOR\b|\bDVOR\b|\bDME\b|\bNDB\b|\bGNSS\b|\bGPS\b|\bRAIM\b|\bMKR\b|\bTACAN\b/ },
  { k: 'PRK',   l: 'Pysäköinti / standit', re: /\bSTAND|\bSTANDS\b|\bAPRON\b|\bAPN\b|\bPRKG\b|\bPARKING\b|\bACFT\s+STAND|\bTOWING\b|\bPUSH\s*BACK|\bGATE\b/ },
  { k: 'TWY',   l: 'Rullaus',              re: /\bTWY|\bTAXIWAY|\bTAXI\b|\bTAXIING\b|\bTAXILANE\b/ },
  { k: 'RWY',   l: 'Kiitotie',             re: /\bRWY|\bRUNWAY|\bTORA\b|\bTODA\b|\bASDA\b|\bLDA\b|\bTHR\b|\bRWYCC\b|\bBRAKING/ },
  { k: 'ASP',   l: 'Ilmatila',             re: /\bTSA\b|\bTRA\b|\bDANGER\b|\bRESTRICTED\b|\bPROHIBITED\b|\bAREA\b|\bAIRSPACE\b|\bCTR\b|\bTMA\b|\bUAS\b|\bDRONE|\bUAV\b|\bMIL(?:ITARY)?\b|\bFIRING\b|\bPJE\b/ },
  { k: 'OBST',  l: 'Esteet',               re: /\bOBST|\bCRANE|\bMAST\b|\bTOWER\b/ },
  { k: 'WILD',  l: 'Linnut / eläimet',     re: /\bBIRD|\bWILDLIFE|\bBA\s+ACT|\bANIMALS?\b/ },
  { k: 'MET',   l: 'Sää (MET)',            re: /\bMET\b|\bAWOS\b|\bAMOS\b|\bRVR\b|\bCEILOMETER|\bWX\s+RDR|\bMET\s+RDR/ },
  { k: 'SVC',   l: 'Palvelut (polttoaine, jäänpoisto, RFF)', re: /\bFUEL|\bDE-?ICING|\bANTI-?ICING|\bRFF\b|\bFIRE\b|\bCAT\s*\d+\s*FIRE|\bGPU\b|\bATC\b|\bATIS\b|\bFREQ/ },
  { k: 'OTHER', l: 'Muut',                 re: /.*/ }
];

function notamCategory(n) {
  // Ensimmäinen rivi = otsikko (ID, voimassaolo) → ei luokitella sen perusteella
  const body = _bfNotamBody(n.text).toUpperCase().split('\n').slice(1).join('\n') || String(n.text || '').toUpperCase();
  const hit = NOTAM_CATEGORIES.find(c => c.re.test(body)) || NOTAM_CATEGORIES[NOTAM_CATEGORIES.length - 1];
  if (hit.k !== 'OTHER') return hit;
  // Tekstistä ei löytynyt → käytä OFP:n kategoriaotsikkoa (esim. "ACFT STAND", "RWY")
  const hint = (String(n.text || '').match(/^#CAT (.+)$/m) || [])[1];
  if (hint) {
    const h = NOTAM_CATEGORIES.find(c => c.k !== 'OTHER' && c.re.test(hint));
    if (h) return h;
  }
  return hit;
}
window.notamCategory = notamCategory;

/* Ryhmittele NOTAMit kategorioittain → HTML. itemFn(n) piirtää yksittäisen NOTAMin. */
function renderNotamGroups(list, itemFn, opts = {}) {
  const order = { bad: 0, warn: 1, ok: 2 };
  const groups = new Map();
  for (const n of list || []) {
    const c = notamCategory(n);
    if (!groups.has(c.k)) groups.set(c.k, { c, items: [] });
    groups.get(c.k).items.push(n);
  }
  const sorted = NOTAM_CATEGORIES.filter(c => groups.has(c.k)).map(c => groups.get(c.k));
  const hs = opts.small ? 'font-size:10.5px;' : 'font-size:12px;';
  return sorted.map(({ c, items }) => {
    items.sort((a, b) => order[_bfNotamLevel(a)] - order[_bfNotamLevel(b)]);
    const worst = _bfNotamLevel(items[0]);
    const col = worst === 'bad' ? 'var(--error)' : worst === 'warn' ? 'var(--warning)' : 'var(--dim)';
    return `<div class="notam-group" style="margin-top:12px;">
      <div style="${hs} font-weight:700; letter-spacing:.5px; color:${col}; display:flex; justify-content:space-between;">
        <span>${_bfEsc(c.l)}</span><span>${items.length}</span>
      </div>
      ${items.map(itemFn).join('')}
    </div>`;
  }).join('');
}
window.renderNotamGroups = renderNotamGroups;

const _BF_MON = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };

/* Voimassaolo + aikataulu NOTAM-tekstistä.
 * Tukee: B)/C) YYMMDDHHMM (validFrom/validTo valmiina), sekä OFP-muoto
 *   "21NOV0554-21FEB1000 2027" / "25OCT1000-PERM"
 * Aikataulu: "DLY 1000-1100", "DAILY 2200-0400", "MON-FRI 0600-1400",
 *   "MON TUE 0800-1200", useita aikavälejä samalla rivillä. */
function _bfNotamTiming(n) {
  const text = String(n.text || '').toUpperCase();
  let from = n.validFrom || null, to = n.validTo || null, perm = !!n.permanent;

  if (!from) {
    const m = text.match(/\b(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})(\d{2})\s*-\s*(?:(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})(\d{2})|(PERM|UFN))(?:\s+(\d{4}))?/);
    if (m) {
      const nowY = new Date().getUTCFullYear();
      const sMon = _BF_MON[m[2]];
      if (m[9]) {
        perm = true;
        const y = m[10] ? +m[10] : nowY;
        from = Date.UTC(y, sMon, +m[1], +m[3], +m[4]);
      } else {
        const eMon = _BF_MON[m[6]];
        const eY = m[10] ? +m[10] : (eMon < sMon ? nowY + 1 : nowY);
        const sY = sMon > eMon ? eY - 1 : eY;
        from = Date.UTC(sY, sMon, +m[1], +m[3], +m[4]);
        to = Date.UTC(eY, eMon, +m[5], +m[7], +m[8]);
      }
    }
  }

  // Aikataulu (UTC, minuutit vuorokaudesta) + viikonpäivät (0=su)
  let sched = null;
  const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const sm = text.match(/(?:^|\n|\bD\)\s*)\s*((?:DLY|DAILY|(?:MON|TUE|WED|THU|FRI|SAT|SUN)(?:\s*[-/ ]\s*(?:MON|TUE|WED|THU|FRI|SAT|SUN))*))\s+((?:\d{4}-\d{4}[\s,]*)+)/);
  if (sm) {
    let days = null;
    const d = sm[1].replace(/\s+/g, ' ').trim();
    if (!/^(DLY|DAILY)$/.test(d)) {
      days = new Set();
      const rng = d.match(/^(\w{3})\s*-\s*(\w{3})$/);
      if (rng) {
        let a = DAYS.indexOf(rng[1]); const b = DAYS.indexOf(rng[2]);
        for (let i = 0; i < 7; i++) { days.add(a); if (a === b) break; a = (a + 1) % 7; }
      } else d.split(/[\s/]+/).forEach(x => { const i = DAYS.indexOf(x); if (i >= 0) days.add(i); });
    }
    const wins = [...sm[2].matchAll(/(\d{2})(\d{2})-(\d{2})(\d{2})/g)]
      .map(w => [(+w[1]) * 60 + (+w[2]), (+w[3]) * 60 + (+w[4])]);
    if (wins.length) sched = { days, wins };
  }
  return { from, to, perm, sched };
}

/* Onko NOTAM voimassa jollain hetkellä aikavälillä [a, b] (ms, UTC)? */
function _bfNotamRelevant(n, a, b) {
  const t = _bfNotamTiming(n);
  if (t.from && t.from > b) return false;
  if (t.to && !t.perm && t.to < a) return false;
  if (!t.sched) return true;
  const lo = Math.max(a, t.from || a), hi = Math.min(b, (t.to && !t.perm) ? t.to : b);
  for (let x = lo - (lo % 60000); x <= hi; x += 5 * 60000) {
    const d = new Date(x);
    if (t.sched.days && !t.sched.days.has(d.getUTCDay())) continue;
    const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
    for (const [s, e] of t.sched.wins) {
      if (s <= e ? (mins >= s && mins <= e) : (mins >= s || mins <= e)) return true;
    }
  }
  return false;
}

function _bfOpenNotamPopup(role) {
  const st = _bfNotamState[role];
  if (!st || st.na) return;
  const order = { bad: 0, warn: 1, ok: 2 };
  const item = ({ n, lvl }) => {
    return `<pre class="wx-raw" style="margin-top:8px; text-align:left;">${_bfEsc(_bfNotamBody(n.text))}</pre>`;
  };
  const rel = st.relevant.map(n => ({ n, lvl: _bfNotamLevel(n) })).sort((x, y) => order[x.lvl] - order[y.lvl]);
  const irr = st.other.map(n => ({ n, lvl: _bfNotamLevel(n) })).sort((x, y) => order[x.lvl] - order[y.lvl]);
  const fmt = ms => isFinite(ms) ? new Date(ms).toISOString().slice(11, 16) : '–';
  const body = `
    <div style="text-align:left;">
      <div style="font-size:12px; color:var(--dim); margin-bottom:10px;">
        Lennon aikaikkuna: ${fmt(st.winA)}–${fmt(st.winB)} UTC
      </div>
      <div style="font-weight:700; margin:6px 0 2px;">Oleelliset (${rel.length})</div>
      ${rel.length ? renderNotamGroups(rel.map(x => x.n), n => item({ n, lvl: _bfNotamLevel(n) })) : '<div class="empty" style="padding:6px 0;">Ei voimassa olevia NOTAMeja lennon aikana.</div>'}
      <details style="margin-top:16px;">
        <summary style="cursor:pointer; font-weight:700; color:var(--dim);">Ei oleelliset · eivät voimassa lennon aikana (${irr.length})</summary>
        ${irr.length ? renderNotamGroups(irr.map(x => x.n), n => item({ n, lvl: _bfNotamLevel(n) })) : '<div class="empty" style="padding:6px 0;">Ei muita.</div>'}
      </details>
    </div>`;
  if (typeof createModal === 'function') {
    createModal({ title: `NOTAM · ${st.icao}`, icon: '📡', bodyHTML: body, confirmText: 'Sulje', maxWidth: '720px' });
  }
}
window._bfOpenNotamPopup = _bfOpenNotamPopup;
window._bfNotamRelevant = _bfNotamRelevant;
window._bfNotamLevel = _bfNotamLevel;
window._bfNotamBody = _bfNotamBody;

/* Jaa kenttien NOTAMit oleellisiin (notams) ja ei-oleellisiin (otherNotams)
 * lennon aikaikkunan mukaan. Käytetään kotisivun kartalla. */
function splitAirportNotamsForFlight(airports, flight) {
  const stdMs = new Date(flight?.Std || flight?.StdLt || 0).getTime();
  const staMs = new Date(flight?.Sta || flight?.StaLt || 0).getTime();
  if (!isFinite(stdMs) || !isFinite(staMs) || !stdMs || !staMs) return airports;
  const H = 3600e3;
  const win = { DEP: [stdMs - H, stdMs + H], DEST: [staMs - H, staMs + H],
                ALTN: [staMs, staMs + 2 * H], NOTAM: [stdMs - H, staMs + H] };
  for (const a of airports || []) {
    const all = [...(a.notams || []), ...(a.otherNotams || [])];
    const [lo, hi] = win[a.role] || win.NOTAM;
    a.notams = all.filter(n => _bfNotamRelevant(n, lo, hi));
    a.otherNotams = all.filter(n => !a.notams.includes(n));
  }
  return airports;
}
window.splitAirportNotamsForFlight = splitAirportNotamsForFlight;

function _bfDecorateNotams() {
  for (const role of ['dep', 'arr', 'altn']) {
    const st = _bfNotamState[role];
    const card = document.getElementById(`bf-card-${role}`);
    if (!card) continue;
    if (!st) { _bfPlaceTafBadge(role); continue; }

    const cls = st.na ? 'na' : st.status;
    const title = st.na ? 'OFP ei vielä saatavilla'
      : st.status === 'bad' ? 'Kenttä tai kiitotie suljettu lennon aikana'
      : st.status === 'warn' ? 'Huomioitavia NOTAMeja lennon aikana' : 'Ei merkittäviä NOTAMeja lennon aikana';
    const badge = `<button type="button" class="bf-notam-badge ${cls}" title="${_bfEsc(title)}"
      ${st.na ? 'disabled' : `onclick="_bfOpenNotamPopup('${role}')"`}>NOTAM</button>`;

    card.querySelectorAll('.bf-notam-badge:not(.bf-taf-badge)').forEach(b => b.remove());
    const head = card.querySelector('.wx-head');
    const cat = head?.querySelector('.wx-cat');
    if (cat) {
      if (!cat.parentElement.classList.contains('wx-badges')) {
        const wrap = document.createElement('div');
        wrap.className = 'wx-badges';
        cat.replaceWith(wrap);
        wrap.appendChild(cat);
      }
      cat.insertAdjacentHTML('afterend', badge);
    } else {
      const lbl = card.querySelector('.card-label');
      if (lbl && !lbl.classList.contains('bf-card-head')) {
        lbl.classList.add('bf-card-head');
        lbl.innerHTML = `<span>${lbl.innerHTML}</span>`;
      }
      lbl?.insertAdjacentHTML('beforeend', badge);
    }
    _bfPlaceTafBadge(role);
  }
}

async function _bfLoadOfpExtras(f, flightId, ctx, gen) {
  const { dep, arr } = ctx;
  let altn = ctx.altn;
  const stale = () => gen != null && gen !== _bfRenderGen;
  // Aikaikkunat per kenttä (UTC): lähtö STD ±1 h, saapuminen STA ±1 h, varakenttä STA…STA+2 h
  const stdMs = new Date(f.Std || f.StdLt || 0).getTime();
  const staMs = new Date(f.Sta || f.StaLt || 0).getTime();
  const H = 3600e3;
  const wins = { dep: [stdMs - H, stdMs + H], arr: [staMs - H, staMs + H], altn: [staMs, staMs + 2 * H] };

  let lines = null;
  try {
    if (flightId && typeof getPDFLinesForFlight === 'function') lines = await getPDFLinesForFlight(flightId);
  } catch (e) { lines = null; }
  if (stale()) return;


  // 0. OFP puuttuu → piilota flight time (jos ei muuta lähdettä), varakenttä (jos ei rosterista) ja trip info
  if (!lines) {
    if (!ctx.hasFlightTime) { const w = document.getElementById('bf-ft-wrap'); if (w) w.style.display = 'none'; }
    const ti = document.getElementById('bf-tripinfo')?.closest('.card');
    if (ti) ti.style.display = 'none';
  }

  // 1. FLIGHT TIME OFP:n TRIP-ajasta (jos journey log / ETA ei antanut)
  if (lines && !ctx.hasFlightTime) {
    const trip = _bfParseTripMins(lines);
    const el = document.getElementById('bf-flight-time');
    if (trip && el) { el.textContent = _bfFmtMins(trip); el.title = 'OFP: TRIP'; }
  }

  // 2. Varakenttä
  if (!altn && lines) altn = _bfParseAlternate(lines, dep, arr);
  // OFP-tiedot lentokorttiin: reitit, CI, FL, request number, varakenttä
  if (lines) { try { _bfFillOfpInfo(lines, dep, arr, altn); } catch (e) { console.warn('[Briefing] OFP info:', e); } }
  const altnLabel = document.getElementById('bf-altn-label');
  const altnEl = document.getElementById('bf-wx-altn');
  if (altnLabel) altnLabel.textContent = `VARAKENTTÄ${altn ? ' · ' + altn : ''}`;
  if (altn && altnEl) {
    if (!ctx.altn) _bfLoadWeatherOne(altnEl, altn, gen);
  } else if (altnEl) {
    if (!lines) {
      // Ei OFP:tä eikä varakenttää → koko kortti piiloon
      const card = document.getElementById('bf-card-altn');
      if (card) {
        card.style.display = 'none';
        card.parentElement?.classList.replace('bf-grid-3', 'bf-grid-2');
      }
    } else {
      altnEl.innerHTML = `<div class="empty">Varakenttää ei löytynyt OFP:stä</div>`;
    }
  }
  if (ctx.altn) _bfLoadWeatherOne(altnEl, altn, gen);

  // 3. NOTAMit
  let notams = [], na = !lines;
  try {
    if (flightId && typeof parseOFPsForNotams === 'function') {
      const data = await parseOFPsForNotams(flightId);
      notams = data?.notams || [];
      if (data?.is422) na = true;
    }
  } catch (e) { na = true; }
  if (stale()) return;

  const norm = (typeof normalizeIcao === 'function') ? normalizeIcao : (x => String(x || '').toUpperCase());
  const mk = (icao, role) => {
    if (!icao) return null;
    const [a, b] = wins[role];
    const all = notams.filter(n => norm(n.airport) === norm(icao));
    const relevant = all.filter(n => _bfNotamRelevant(n, a, b));
    const other = all.filter(n => !relevant.includes(n));
    const lv = relevant.map(_bfNotamLevel);
    const status = lv.includes('bad') ? 'bad' : lv.includes('warn') ? 'warn' : 'ok';
    return { icao, relevant, other, status, na, winA: a, winB: b };
  };
  _bfNotamState = { dep: mk(dep, 'dep'), arr: mk(arr, 'arr'), altn: mk(altn, 'altn') };
  _bfDecorateNotams();
}

async function _bfLoadWeatherOne(el, icao, gen) {
  if (!el || !icao) return;
  try {
    let result = { metar: null, taf: null };
    if (typeof fetchWXForAirport === 'function') result = await fetchWXForAirport(icao);
    else if (typeof fetchMETAR === 'function') {
      const [metar, taf] = await Promise.all([fetchMETAR(icao).catch(() => null), fetchTAF(icao).catch(() => null)]);
      result = { metar, taf };
    }
    if ((gen != null && gen !== _bfRenderGen) || !el.isConnected) return;
    if (typeof renderWeatherWidget === 'function') renderWeatherWidget(el, result.metar, result.taf);
    _bfTafAt(el, result.taf, 'altn');
    _bfDecorateNotams();
  } catch (e) {
    if (el.isConnected) el.innerHTML = '<div class="empty">Sään haku epäonnistui</div>';
  }
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

  // Avataan suoraan. app.js tarkistaa välimuistin ensin ja hoitaa 422-virheen.
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
        if (typeof splitAirportNotamsForFlight === 'function') splitAirportNotamsForFlight(airports, flight);
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
    // Sama kenttäpopup kuin kotisivulla
    await renderNotamMap(mapEl, valid, {
      flight,
      onMarkerClick: (airport, evt) => {
        if (typeof showAirportPopupInline !== 'function') return;
        const rect = mapEl.getBoundingClientRect();
        const px = evt ? (evt.clientX - rect.left) : mapEl.clientWidth / 2;
        const py = evt ? (evt.clientY - rect.top)  : mapEl.clientHeight / 2;
        showAirportPopupInline(airport, { x: px, y: py }, mapEl, airports, { topInset: 8, bottomInset: 8 });
      }
    });
  }

  if (valid.length && typeof _preloadWxForAirports === 'function') {
    _preloadWxForAirports(valid).catch(() => {});
  }
}
window._bfLoadNotamMap = _bfLoadNotamMap;

async function forceRefreshBriefing() {
  const f = _bfGetSelectedFlight();
  if (!f) return;

  const flightId = String(f.ID || f.id || f.FlightID || '');
  const dep = String(f.DepartureStationIcaoCode || f.DepartureStationCode || '').toUpperCase();
  const arr = String(f.ArrivalStationIcaoCode || f.ArrivalStationCode || '').toUpperCase();

  if (typeof showToast === 'function') showToast('Haetaan tuoreet tiedot...', 'info');

  // 1. Sää — tyhjennä kaikki wx-cachet (koko lento + kaikki kentät)
  Cache.invalidate('wx:');

  // 2. OFP PDF-tavut ja rivit
  if (typeof window._invalidatePDFCache === 'function') {
    window._invalidatePDFCache(flightId);
  }

  // 3. OFP:stä johdetut cachet (NOTAMit, waypointit, painot)
  Cache.invalidate(`notam:ofp2:${flightId}`);
  Cache.invalidate(`notam:wp:${flightId}`);
  Cache.invalidate(`blockfuel:${flightId}`);
  Cache.invalidate(`blockfuel:neg:${flightId}`);

  // 4. Journey-log (miehistö)
  Cache.invalidate(`journey:log:${flightId}`);

  // 5. Päivitä lennon perustiedot rosterista (stand)
  if (typeof refreshSingleFlightFromRoster === 'function') {
    try {
      const fresh = await refreshSingleFlightFromRoster(flightId, f.StdLt || f.Std);
      if (fresh) {
        const roster = JSON.parse(localStorage.getItem('assigned_flights_cache') || '[]');
        const idx = roster.findIndex(x => String(x.ID || x.id || x.FlightID) === flightId);
        if (idx >= 0) {
          roster[idx] = { ...roster[idx], ...fresh };
          localStorage.setItem('assigned_flights_cache', JSON.stringify(roster));
        }
      }
    } catch (e) {}
  }

  // 6. Renderöi uudelleen
  await renderBriefing();
  if (typeof showToast === 'function') showToast('Briefing päivitetty.', 'success');
}
window.forceRefreshBriefing = forceRefreshBriefing;