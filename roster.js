/* ==============================================================
 * ROSTER SYNC · Yhdistäminen, muutosvertailu ja autoload
 * ============================================================== */

/* ---------------- Merge: yhdistä lennot ID:n perusteella ----------------
 * - Jos lento on molemmissa: uusi korvaa vanhan (dispatch päivitti)
 * - Jos lento vain uudessa: lisätään
 * - Jos lento vain vanhassa: säilytetään (aikaisempi aikaväli)
 * - Poistaa lennot jotka ovat yli 90 päivää vanhoja (cache trim)
 * --------------------------------------------------------------------- */
function mergeRosterFlights(existing, incoming) {
  const map = new Map();
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;

  const addFlight = (f, isNew) => {
    if (!f || typeof f !== 'object') return;
    const id = String(f.ID || f.id || f.FlightID || f.FlightId || '');
    if (!id) return;

    // Trimmaa vanhat
    const std = new Date(f.StdLt || f.Std || 0).getTime();
    if (std && std < cutoff && !isNew) return;

    map.set(id, f);
  };

  // Vanhat ensin (säilyvät jos ei uutta versiota)
  (Array.isArray(existing) ? existing : []).forEach(f => addFlight(f, false));
  // Uudet päälle (korvaavat)
  (Array.isArray(incoming) ? incoming : []).forEach(f => addFlight(f, true));

  const merged = Array.from(map.values());
  merged.sort((a, b) => {
    const ta = new Date(a.StdLt || a.Std || 0).getTime();
    const tb = new Date(b.StdLt || b.Std || 0).getTime();
    return ta - tb;
  });
  return merged;
}
window.mergeRosterFlights = mergeRosterFlights;

/* ---------------- Vertaa vanhaa ja uutta rosteria ---------------- */
function compareRosters(oldList, newList) {
  const oldMap = new Map((oldList || []).map(f => [
    String(f.ID || f.id || f.FlightID || f.FlightId || ''), f
  ]));
  const newMap = new Map((newList || []).map(f => [
    String(f.ID || f.id || f.FlightID || f.FlightId || ''), f
  ]));


  const added = [];
  const removed = [];
  const changed = [];

  // Lisätyt
  for (const [id, f] of newMap) {
    if (!oldMap.has(id)) added.push({ flight: f });
  }

  // Poistetut (vain tulevat/nykyiset — ei historiadataa)
  const now = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, f] of oldMap) {
    if (!newMap.has(id)) {
      const std = new Date(f.StdLt || f.Std || 0).getTime();
      if (std > now) removed.push({ flight: f });
    }
  }

  // Muuttuneet
  for (const [id, newF] of newMap) {
    const oldF = oldMap.get(id);
    if (!oldF) continue;

    const diffs = [];
    const check = (key, label, fmt) => {
      const o = oldF[key];
      const n = newF[key];
      if ((o || '') !== (n || '')) {
        diffs.push({
          label,
          old: fmt ? fmt(o) : (o || '–'),
          new: fmt ? fmt(n) : (n || '–')
        });
      }
    };

    const fmtTime = (iso) => {
      if (!iso) return '–';
      const s = String(iso);
      return s.includes('T') ? s.split('T')[1].substring(0, 5) : s;
    };
    const fmtDate = (iso) => {
      if (!iso) return '–';
      return String(iso).split('T')[0];
    };

    check('StdLt', 'Lähtöaika', fmtTime);
    check('StaLt', 'Saapumisaika', fmtTime);
    check('Std',   'Lähtöpäivä', fmtDate);
    check('DepartureStationIcaoCode', 'Lähtökenttä');
    check('ArrivalStationIcaoCode',   'Saapumiskenttä');
    check('RegistrationNumber',       'Rekisteri');
    check('AircraftDescription',      'Konetyyppi');
    check('FlightNumber',             'Lentonumero');

    if (diffs.length) {
      changed.push({ flight: newF, oldFlight: oldF, diffs });
    }
  }

  return { added, removed, changed, total: added.length + removed.length + changed.length };
}

/* ---------------- Formatoi lento lyhyesti ---------------- */
function _fmtFlightShort(f) {
  if (!f) return '';
  const carrier = String(f.CarrierCode || '').trim();
  const fltNo = String(f.FlightNumber || '').trim();
  const flightNum = (carrier && fltNo.startsWith(carrier)) ? fltNo : `${carrier}${fltNo}`;
  const dep = String(f.DepartureStationIcaoCode || f.DepartureStationCode || '?').trim();
  const arr = String(f.ArrivalStationIcaoCode || f.ArrivalStationCode || '?').trim();
  const std = String(f.StdLt || f.Std || '').split('T')[0];
  const stdTime = String(f.StdLt || f.Std || '').split('T')[1]?.substring(0, 5) || '';
  return { flightNum, dep, arr, std, stdTime };
}

/* ==============================================================
 * PYSYVÄ POPUP · Roster-muutokset
 * ==============================================================
 * Ei käytä jaettua createModalia — oma overlay joka:
 *   - ei reagoi klikkauksiin ensimmäiseen 800 ms aikana
 *   - ei sulkeudu vahingossa
 *   - sulkeutuu vain ✕-napista
 *   - korkein mahdollinen z-index
 * ============================================================== */
function showRosterChangeModal(changes, previousSyncTime) {
  if (!changes || changes.total === 0) return;

  const { added, removed, changed } = changes;

  const section = (title, color, items, renderItem) => {
    if (!items.length) return '';
    return `
      <div class="rc-section">
        <div class="rc-section-head" style="color:${color}; border-color:${color};">
          ${title} <span class="rc-count">${items.length}</span>
        </div>
        <div class="rc-items">
          ${items.map(renderItem).join('')}
        </div>
      </div>`;
  };

  const renderFlightLine = (item) => {
    const s = _fmtFlightShort(item.flight);
    return `
      <div class="rc-item">
        <div class="rc-item-main">
          <span class="rc-flight">${s.flightNum || '–'}</span>
          <span class="rc-route">${s.dep} → ${s.arr}</span>
          <span class="rc-time">${s.std}${s.stdTime ? ' · ' + s.stdTime : ''}</span>
        </div>
      </div>`;
  };

  const renderChangedLine = (item) => {
    const s = _fmtFlightShort(item.flight);
    return `
      <div class="rc-item rc-item-changed">
        <div class="rc-item-main">
          <span class="rc-flight">${s.flightNum || '–'}</span>
          <span class="rc-route">${s.dep} → ${s.arr}</span>
          <span class="rc-time">${s.std}${s.stdTime ? ' · ' + s.stdTime : ''}</span>
        </div>
        <div class="rc-diffs">
          ${item.diffs.map(d => `
            <div class="rc-diff">
              <span class="rc-diff-label">${d.label}</span>
              <span class="rc-diff-old">${d.old}</span>
              <span class="rc-diff-arrow">→</span>
              <span class="rc-diff-new">${d.new}</span>
            </div>
          `).join('')}
        </div>
      </div>`;
  };

  // Poista vanha popup jos sellainen on jo
  const existing = document.getElementById('roster-change-popup');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'roster-change-popup';
  overlay.className = 'rcp-overlay';
  overlay.innerHTML = `
    <div class="rcp-dialog">
      <div class="rcp-head">
        <div class="rcp-icon">📋</div>
        <div class="rcp-title">
          <div class="rcp-title-main">Roster päivitetty</div>
          <div class="rcp-title-sub">
            ${previousSyncTime ? `Edellinen synkronointi: <b>${previousSyncTime}</b>` : 'Uusia muutoksia dispatchilta'}
          </div>
        </div>
        <button class="rcp-close" type="button" aria-label="Sulje">✕</button>
      </div>
      <div class="rcp-body">
        ${section('▲ Lisätty', 'var(--success)', added, renderFlightLine)}
        ${section('✕ Poistettu', 'var(--error)', removed, renderFlightLine)}
        ${section('◆ Muutettu', 'var(--warning)', changed, renderChangedLine)}
      </div>
      <div class="rcp-foot">
        <button class="rcp-btn" type="button">Selvä, kiitos</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Estä klikkaukset ensimmäisen 800 ms ajan (phantom touch -suoja)
  overlay.style.pointerEvents = 'none';
  setTimeout(() => { overlay.style.pointerEvents = ''; }, 800);

  // Sulku
  const close = () => {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 200);
  };
  overlay.querySelector('.rcp-close').addEventListener('click', close);
  overlay.querySelector('.rcp-btn').addEventListener('click', close);
  // Klikkaus overlayn taustaan → ei sulje (tahallinen: estää vahinkosulkemisen)

  requestAnimationFrame(() => overlay.classList.add('visible'));
}
window.showRosterChangeModal = showRosterChangeModal;

/* ==============================================================
 * APURI · Hae roster kuukausi kerrallaan
 * ==============================================================
 * Air Astana API ei palauta dataa yli ~30-60 päivän aikaväliltä.
 * Haetaan 3 kuukautta kolmella erillisellä kutsulla.
 * ============================================================== */
async function _fetchRosterRange(monthOffset) {
  const token = typeof getValidSkyplanToken === 'function'
    ? await getValidSkyplanToken().catch(() => null)
    : localStorage.getItem('skyplan_token');
  if (!token) return [];

  const payload = decodeJWT(token) || {};
  const empId = payload.employeeid || payload.EmployeeID || payload.employeeId
             || payload.nameid || payload.sub;
  if (!empId) return [];

  const now = new Date();
  const targetMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const firstDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);
  const lastDay  = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0);
  const fmt = (d) => `${d.getFullYear()}-${
    String(d.getMonth() + 1).padStart(2, '0')}-${
    String(d.getDate()).padStart(2, '0')}`;

  const fromStr = fmt(firstDay);
  const toStr   = fmt(lastDay);

  try {
    const resp = await fetch('https://kcskyplanapi.airastana.com/api/v1/crew-roster-flights-details', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ EmployeeID: String(empId), From: fromStr, To: toStr })
    });

    if (!resp.ok) {
      console.warn(`[Roster] Kuukausi ${monthOffset}: HTTP ${resp.status}`);
      return [];
    }

    const data = await resp.json();
    const flights = Array.isArray(data.Flights) ? data.Flights : [];

    const allowedCarriers = ['KC', 'KZR', 'AYN', 'FS'];
    const filtered = flights.filter(f =>
      f && allowedCarriers.includes(String(f.CarrierCode || '').trim().toUpperCase())
    );

    return filtered;
  } catch (e) {
    console.warn(`[Roster] Kuukausi ${monthOffset} epäonnistui:`, e.message);
    return [];
  }
}

async function forceRosterSync(options = {}) {
  const { silent = false, forceCompare = true } = options;

  if (!navigator.onLine) {
    if (!silent && typeof showToast === 'function') {
      showToast('Offline — ei voi synkata.', 'warning');
    }
    return null;
  }

  // 1. Lue edellinen API-vastaus vertailua varten
  let previousAPI = null;
  try {
    const raw = localStorage.getItem('assigned_flights_last_api');
    previousAPI = raw ? JSON.parse(raw) : null;
  } catch (e) {}

  try {
    // 2. Hae kolme kuukautta erikseen: edellinen, nykyinen, seuraava

    const [prevFlights, currFlights, nextFlights] = await Promise.all([
      _fetchRosterRange(-1),
      _fetchRosterRange(0),
      _fetchRosterRange(1)
    ]);

    // 3. Yhdistä — poista duplikaatit ID:n perusteella
    const map = new Map();
    [...prevFlights, ...currFlights, ...nextFlights].forEach(f => {
      const id = String(f.ID || f.id || f.FlightID || '');
      if (id) map.set(id, f);
    });
    const allFlights = Array.from(map.values());

    // SUOJA: jos kaikki kolme palauttivat 0 → API-ongelma
    if (allFlights.length === 0) {
      console.warn('[RosterSync] Kaikki 3 kuukautta palauttivat 0 — ohitetaan');
      if (!silent && typeof showToast === 'function') {
        showToast('API ei palauttanut dataa. Yritä myöhemmin uudelleen.', 'warning');
      }
      return null;
    }

    // 4. Tallenna raaka API-vastaus vertailua varten
    window._lastRosterAPIResponse = allFlights.slice();

    // Aikaväli-tagi: käytetään "3kk" -tunnistetta (koska data on 3 kk ikkunasta)
    const rangeTag = '3kk-window';
    try {
      localStorage.setItem('assigned_flights_last_api', JSON.stringify({
        from: rangeTag,
        to: rangeTag,
        at: new Date().toISOString(),
        flights: allFlights
      }));
    } catch (e) {
      console.warn('[Roster] API-vastauksen tallennus epäonnistui:', e);
    }

    // 5. Päivitä cache (merge)
    try {
      const existing = JSON.parse(localStorage.getItem('assigned_flights_cache') || '[]');
      const merged = mergeRosterFlights(existing, allFlights);
      localStorage.setItem('assigned_flights_cache', JSON.stringify(merged));
      localStorage.setItem('assigned_flights_cache_time',
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
      console.warn('[RosterSync] Cache-tallennus epäonnistui:', e);
    }

    // 6. Päivitä UI
    if (typeof renderWeekView === 'function') {
      const weekActive = document.querySelector(
        '#flights-view-toggle .vt-btn[data-view="week"].active'
      );
      if (weekActive) renderWeekView();
    }
    if (typeof renderLogbookTable === 'function'
        && document.querySelector('.tab-btn[data-tab="logbook"].active')) {
      renderLogbookTable();
    }

    // 7. Vertaa edelliseen API-vastaukseen
    if (!forceCompare || !previousAPI || !Array.isArray(previousAPI.flights)) {
      if (!silent && typeof showToast === 'function') {
        showToast(`Roster synkronoitu: ${allFlights.length} lentoa.`, 'success');
      }
      return null;
    }

    const changes = compareRosters(previousAPI.flights, allFlights);

    if (changes.total > 0) {
      const prevTime = previousAPI.at
        ? new Date(previousAPI.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';
      showRosterChangeModal(changes, prevTime);
    } else if (!silent && typeof showToast === 'function') {
      showToast('Roster on ajan tasalla.', 'success');
    }
    return changes;

  } catch (e) {
    console.warn('[RosterSync] failed:', e);
    if (!silent && typeof showToast === 'function') {
      showToast('Roster-sync epäonnistui.', 'error');
    }
    return null;
  }
}

/* ==============================================================
 * AUTOLOAD · suojattu tuplasuoritukselta
 * ============================================================== */
async function autoLoadMonthRoster() {
  if (window._rosterAutoLoadDone) return;
  if (!navigator.onLine) return;

  const token = (typeof getValidSkyplanToken === 'function')
    ? await getValidSkyplanToken().catch(() => null)
    : localStorage.getItem('skyplan_token');
  if (!token) return;

  window._rosterAutoLoadDone = true;

  try {
    await forceRosterSync({ silent: true, forceCompare: true });
  } catch (e) {
    console.warn('[AutoLoad] failed:', e);
  }
}

let _rosterBooted = false;
function _rosterBoot() {
  if (_rosterBooted) return;
  _rosterBooted = true;
  setTimeout(() => autoLoadMonthRoster().catch(() => {}), 1500);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _rosterBoot);
} else {
  _rosterBoot();
}