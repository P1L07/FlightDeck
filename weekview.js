/* ==============================================================
 * WEEK VIEW · Viikkonäkymä lentotehtäville
 * ==============================================================
 * - Vertikaalisesti scrollattava 7 päivän näkymä
 * - Jokainen päivä omana korttinaan (lennot / vapaapäivä)
 * - Viikkonavigaatio: ← → Tänään
 * - Vaihto taulukkonäkymään samassa tabissa
 * ============================================================== */

const WV_VIEW_KEY = 'flights_view_v1';
const WV_DAY_NAMES = ['SU','MA','TI','KE','TO','PE','LA'];
const WV_MONTHS_FI = ['tammi','helmi','maalis','huhti','touko','kesä',
                     'heinä','elo','syys','loka','marras','joulu'];

let _wvAnchor = new Date();
_wvAnchor.setHours(0, 0, 0, 0);

/* ---------------- Date helpers ---------------- */
function _wvWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function _wvISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function _wvYMD(d) {
  return `${d.getFullYear()}-${
    String(d.getMonth() + 1).padStart(2, '0')}-${
    String(d.getDate()).padStart(2, '0')}`;
}

function _wvTodayYMD() {
  return _wvYMD(new Date());
}

function _wvFmtDateRange(s, e) {
  const sm = s.getMonth() + 1, em = e.getMonth() + 1;
  const sd = s.getDate(), ed = e.getDate();
  const sy = s.getFullYear(), ey = e.getFullYear();
  if (sy !== ey) return `${sd}.${sm}.${sy} – ${ed}.${em}.${ey}`;
  if (sm !== em) return `${sd}.${sm}. – ${ed}.${em}.${sy}`;
  return `${sd}. – ${ed}.${sm}.${sy}`;
}

/* ---------------- Format helpers ---------------- */
function _wvFmtTime(iso) {
  if (!iso) return '--:--';
  const s = String(iso);
  if (s.includes('T')) return s.split('T')[1].substring(0, 5);
  return s;
}

function _wvFlightMins(f) {
  const dur = Number(f?.DurationMinutes);
  if (!isNaN(dur) && dur > 0) return dur;
  if (f?.Std && f?.Sta) {
    const d = new Date(f.Sta) - new Date(f.Std);
    if (d > 0) return Math.round(d / 60000);
  }
  return 0;
}

function _wvFmtMins(mins) {
  if (!mins || mins < 0) return '0h 00m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function _wvEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------------- Data ---------------- */
function _wvLoadRoster() {
  try {
    const raw = localStorage.getItem('assigned_flights_cache');
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

/* ==============================================================
 * RENDER
 * ============================================================== */
function renderWeekView(anchorDate) {
  const container = document.getElementById('week-view-container');
  if (!container) return;

  const weekStart = _wvWeekStart(anchorDate || _wvAnchor);
  _wvAnchor = weekStart;
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  // Päivitä otsikko
  const label = document.getElementById('wk-label');
  if (label) {
    label.textContent =
      `Viikko ${_wvISOWeek(weekStart)} · ${_wvFmtDateRange(weekStart, weekEnd)}`;
  }

  const roster = _wvLoadRoster();
  const todayYMD = _wvTodayYMD();

  // Ryhmittele lennot päivittäin
  const byDay = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    byDay[_wvYMD(d)] = [];
  }
  roster.forEach(f => {
    const ymd = String(f?.StdLt || f?.Std || '').split('T')[0];
    if (byDay[ymd]) byDay[ymd].push(f);
  });
  Object.values(byDay).forEach(arr => {
    arr.sort((a, b) => {
      const ta = new Date(a.StdLt || a.Std || 0).getTime();
      const tb = new Date(b.StdLt || b.Std || 0).getTime();
      return ta - tb;
    });
  });

  // Yhteenveto
  let totalFlights = 0, totalMins = 0, dutyDays = 0;
  Object.values(byDay).forEach(flights => {
    if (flights.length) {
      dutyDays++;
      totalFlights += flights.length;
      totalMins += flights.reduce((s, f) => s + _wvFlightMins(f), 0);
    }
  });

  // Jos roster on tyhjä → näytä ohje
  if (!roster.length) {
    container.innerHTML = `
      <div style="padding:32px 22px; text-align:center;
                  background:var(--panel); border:1px solid var(--border);
                  border-radius:var(--radius);">
        <div style="font-size:28px; margin-bottom:10px;">📋</div>
        <div style="font-size:14px; color:var(--text); font-weight:600;">
          Roster ei ole synkattu
        </div>
        <div style="font-size:12px; color:var(--dim); margin-top:6px;">
          Vaihda taulukkonäkymään ja paina <b>Hae</b>.
        </div>
      </div>`;
    return;
  }

  let html = '';

  // Yhteenvetopalkki
  html += `
    <div class="wv-summary">
      <div class="wv-summary-item">
        <span class="wv-summary-label">Lentoja</span>
        <span class="wv-summary-value accent">${totalFlights}</span>
      </div>
      <div class="wv-summary-item">
        <span class="wv-summary-label">Block-aika</span>
        <span class="wv-summary-value">${_wvFmtMins(totalMins)}</span>
      </div>
      <div class="wv-summary-item">
        <span class="wv-summary-label">Työpäiviä</span>
        <span class="wv-summary-value">
          ${dutyDays}<span class="wv-summary-sub"> / 7</span>
        </span>
      </div>
    </div>`;

  // Päivät
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const ymd = _wvYMD(d);
    const isToday = ymd === todayYMD;
    const isPast  = d < new Date() && !isToday;
    const flights = byDay[ymd];
    const dayMins = flights.reduce((s, f) => s + _wvFlightMins(f), 0);

    const cls = ['wv-day'];
    if (isToday) cls.push('is-today');
    else if (isPast) cls.push('is-past');
    if (!flights.length) cls.push('is-off');

    html += `<div class="${cls.join(' ')}">`;

    // Header
    html += `
      <div class="wv-day-head">
        <div class="wv-day-title">
          <span class="wv-day-name">${WV_DAY_NAMES[d.getDay()]}</span>
          <span class="wv-day-date">${d.getDate()}.${d.getMonth() + 1}.</span>
          ${isToday ? '<span class="wv-day-badge">TÄNÄÄN</span>' : ''}
        </div>
        <div class="wv-day-meta">
          ${flights.length
            ? `<span><span class="count">${flights.length}</span> ${
                flights.length === 1 ? 'lento' : 'lentoa'}</span>
               <span class="wv-day-block">${_wvFmtMins(dayMins)}</span>`
            : `<span class="wv-day-off-label">Ei lentotehtäviä</span>`}
        </div>
      </div>`;

    // Body
    if (flights.length) {
      html += `<div class="wv-day-body">`;
      flights.forEach(f => { html += _wvRenderFlightCard(f); });
      html += `</div>`;
    }

    html += `</div>`;
  }

  container.innerHTML = html;
}
window.renderWeekView = renderWeekView;

/* ==============================================================
 * Flight card
 * ============================================================== */
function _wvRenderFlightCard(f) {
  const flightId = f.ID || f.id || f.FlightID || f.FlightId || '';
  const carrier  = String(f.CarrierCode || '').trim();
  const fltNo    = String(f.FlightNumber || '').trim();
  const flightNum = (carrier && fltNo.startsWith(carrier)) ? fltNo : `${carrier}${fltNo}`;
  const dep = String(f.DepartureStationIcaoCode || f.DepartureStationCode || 'XXXX').trim();
  const arr = String(f.ArrivalStationIcaoCode   || f.ArrivalStationCode   || 'XXXX').trim();
  const std = _wvFmtTime(f.StdLt || f.Std);
  const sta = _wvFmtTime(f.StaLt || f.Sta);
  const reg = String(f.RegistrationNumber || f.AircraftDescription || 'TBA').trim();
  const dateStr = String(f.StdLt || f.Std || '').split('T')[0];
  const blockMins = _wvFlightMins(f);
  const blockStr  = _wvFmtMins(blockMins);

  // Finalization-tila (vain väriä varten kortissa)
  let isFinalized = false;
  try {
    if (typeof isFlightFinalized === 'function') {
      const cachedOFPs = (typeof getCachedOFPs === 'function') ? [] : [];
      isFinalized = !!isFlightFinalized(f, cachedOFPs);
    }
    if (!isFinalized && flightId) {
      isFinalized = localStorage.getItem(`skyplan_finalized_${flightId}`) === 'true';
    }
  } catch (e) {}

  const safeId     = _wvEsc(flightId);
  const safeFlight = _wvEsc(flightNum);
  const safeDate   = _wvEsc(dateStr);
  const safeDep    = _wvEsc(dep);
  const safeArr    = _wvEsc(arr);

  return `
    <div class="wv-flight ${isFinalized ? 'is-finalized' : 'is-preview'}">
      <div class="wv-flight-time">
        <span>${std}</span>
        <span class="sta">${sta}</span>
      </div>
      <div class="wv-flight-info">
        <div class="wv-flight-line1">
          <span class="wv-flight-num">${safeFlight}</span>
          <span class="wv-flight-route">${_wvEsc(dep)} → ${_wvEsc(arr)}</span>
        </div>
        <div class="wv-flight-line2">
          <span class="wv-flight-reg">${_wvEsc(reg)}</span>
          <span class="wv-flight-sep">·</span>
          <span class="wv-flight-block">Block ${blockStr}</span>
        </div>
      </div>
      <div class="wv-flight-actions">
        <button class="wv-flight-btn wv-flight-btn-crew"
          onclick="showFlightCrewModal('${safeId}', '${safeFlight}', '${safeDate}', '${safeDep}', '${safeArr}')">
          👥 Miehistö
        </button>
      </div>
    </div>`;
}

/* ==============================================================
 * Navigaatio + automaattinen roster-sync
 * ==============================================================
 * Kun siirrytään viikolle, joka ei ole välimuistissa, haetaan
 * uusi roster loadAssignedFlights():n kautta. Tämä pitää myös
 * taulukkonäkymän ajan tasalla.
 * ============================================================== */

let _wvSyncInFlight = false;

/* Näytä latausindikaattori viikkonäkymän sisällä */
function _wvShowLoading(anchor) {
  const container = document.getElementById('week-view-container');
  if (!container) return;
  const weekStart = _wvWeekStart(anchor);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  container.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center;
                justify-content:center; padding:60px 20px; gap:14px;
                background:var(--panel); border:1px solid var(--border);
                border-radius:var(--radius);">
      <div class="loader-spinner"><span></span><span></span><span></span></div>
      <div style="font-size:14px; font-weight:600; color:var(--text);">
        Haetaan viikkoa ${_wvISOWeek(weekStart)}…
      </div>
      <div style="font-size:12px; color:var(--dim); font-family:var(--font-mono);">
        ${_wvFmtDateRange(weekStart, weekEnd)}
      </div>
    </div>`;
}

async function _wvSyncAndRender(anchor) {
  if (_wvSyncInFlight) return;

  const weekStart = _wvWeekStart(anchor);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  // 1) Renderöi HETI cachesta — ei odota verkkoa
  renderWeekView(anchor);

  // Jos offline → done
  if (!navigator.onLine) {
    if (typeof showToast === 'function') {
      showToast('Offline — näytetään välimuistissa oleva data.', 'info');
    }
    return;
  }

  // 2) Onko viikko jo cachessa? Jos on, älä hae uudelleen
  if (_wvCacheCoversRange(weekStart, weekEnd)) {
    // Data on jo cachessa → ei tarvitse hakea
    return;
  }

  // 3) Hae taustalla (ei blokkaa UI:ta)
  _wvSyncInFlight = true;

  // Päivitä piilotetut päivämääräkentät
  const fromInput = document.getElementById('assigned-date-from');
  const toInput   = document.getElementById('assigned-date-to');
  if (fromInput) fromInput.value = _wvYMD(weekStart);
  if (toInput)   toInput.value   = _wvYMD(weekEnd);

  try {
    if (typeof window.loadAssignedFlights === 'function') {
      await window.loadAssignedFlights(true, true);
    }
  } catch (e) {
    console.warn('[WeekView] sync failed:', e);
  } finally {
    _wvSyncInFlight = false;
    // Uudelleenrenderöi päivitetyllä datalla
    renderWeekView(anchor);
  }
}

/* Tarkista onko viikko jo cachessa. Käyttää rosterin omaa aikaväliä:
 * jos koko viikko on cache-range:n sisällä, ei tarvitse hakea.
 */
function _wvCacheCoversRange(start, end) {
  try {
    const cacheRange = localStorage.getItem('assigned_flights_cache_range');
    if (!cacheRange) return false;
    const { from, to } = JSON.parse(cacheRange);
    if (!from || !to) return false;
    const startYMD = _wvYMD(start);
    const endYMD   = _wvYMD(end);
    // Viikko on cachessa jos se on kokonaan aikavälin sisällä
    return from <= startYMD && to >= endYMD;
  } catch (e) {
    return false;
  }
}
function weekViewPrev() {
  const d = new Date(_wvAnchor);
  d.setDate(d.getDate() - 7);
  return _wvSyncAndRender(d);
}
function weekViewNext() {
  const d = new Date(_wvAnchor);
  d.setDate(d.getDate() + 7);
  return _wvSyncAndRender(d);
}
function weekViewToday() {
  return _wvSyncAndRender(new Date());
}
window.weekViewPrev  = weekViewPrev;
window.weekViewNext  = weekViewNext;
window.weekViewToday = weekViewToday;

/* ==============================================================
 * Näkymän vaihto
 * ============================================================== */
function setFlightsView(view) {
  const tableEl      = document.getElementById('assigned-flights-container');
  const weekEl       = document.getElementById('week-view-container');
  const toolbarTable = document.getElementById('toolbar-table');
  const toolbarWeek  = document.getElementById('toolbar-week');
  const toggleBtns   = document.querySelectorAll('#flights-view-toggle .vt-btn');

  if (!tableEl || !weekEl) return;

  if (view === 'week') {
    tableEl.style.display = 'none';
    weekEl.style.display = '';
    if (toolbarTable) toolbarTable.style.display = 'none';
    if (toolbarWeek)  toolbarWeek.style.display  = '';
    renderWeekView();
  } else {
    tableEl.style.display = '';
    weekEl.style.display = 'none';
    if (toolbarTable) toolbarTable.style.display = '';
    if (toolbarWeek)  toolbarWeek.style.display  = 'none';
  }

  toggleBtns.forEach(b => b.classList.toggle('active', b.dataset.view === view));

  try { localStorage.setItem(WV_VIEW_KEY, view); } catch (e) {}
}
window.setFlightsView = setFlightsView;

/* ==============================================================
 * Init
 * ============================================================== */
function _wvRestoreView() {
  let saved = 'table';
  try { saved = localStorage.getItem(WV_VIEW_KEY) || 'table'; } catch (e) {}
  if (saved === 'week') setFlightsView('week');
}

function _wvSyncCaptainName() {
  const src = document.getElementById('user-name');
  const dst = document.getElementById('flights-captain-name');
  if (!src || !dst) return;

  const update = () => {
    const t = (src.textContent || '').trim();
    if (t && t !== 'Kapteeni' && t !== '–') {
      dst.textContent = t;
    }
  };
  update();
  try {
    new MutationObserver(update).observe(src, {
      childList: true, characterData: true, subtree: true
    });
  } catch (e) {}
}


/* ==============================================================
 * Wrap loadAssignedFlights → tallenna haetun aikavälin range
 * ==============================================================
 * Tämä mahdollistaa _wvCacheCoversRange-tarkistuksen: jos sama
 * aikaväli on jo haettu, ei haeta turhaan uudelleen.
 * ============================================================== */
(function _wvWrapLoadRange() {
  if (typeof window.loadAssignedFlights !== 'function') return;
  const orig = window.loadAssignedFlights;
  window.loadAssignedFlights = async function (...args) {
    const result = await orig.apply(this, args);

    // Tallenna haettu aikaväli
    try {
      const fromInput = document.getElementById('assigned-date-from');
      const toInput   = document.getElementById('assigned-date-to');
      if (fromInput?.value && toInput?.value) {
        localStorage.setItem('assigned_flights_cache_range', JSON.stringify({
          from: fromInput.value,
          to:   toInput.value,
          at:   new Date().toISOString()
        }));
      }
    } catch (e) {}

    return result;
  };
})();

/* Boot */
function _wvBoot() {
  _wvSyncCaptainName();
  _wvRestoreView();

  // Jos viikkonäkymä on auki, kuuntele kun data päivittyy cacheen
  window.addEventListener('storage', (ev) => {
    if (ev.key === 'assigned_flights_cache') {
      const weekActive = document.querySelector(
        '#flights-view-toggle .vt-btn[data-view="week"].active'
      );
      if (weekActive) renderWeekView();
    }
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _wvBoot);
} else {
  _wvBoot();
}