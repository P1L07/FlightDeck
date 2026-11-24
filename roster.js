/* ==============================================================
 * ROSTER SYNC · Yhdistäminen, muutosvertailu ja autoload
 * ============================================================== */

/* --------------------------------------------------------------
 * Poistettujen lentojen muisti
 * --------------------------------------------------------------
 * Kun lento katoaa rosterista (dispatch poisti sen), sen ID
 * tallennetaan tähän. Auto-import ei koskaan tuo näitä lentoja,
 * vaikka journey logissa olisi ATD/ATA (joku muu lensi sen).
 * Jos lento palaa rosteriin, ID poistetaan listalta.
 * -------------------------------------------------------------- */
const ROSTER_REMOVED_KEY = 'roster_removed_flight_ids_v1';

function getRemovedRosterFlightIds() {
  try {
    const obj = JSON.parse(localStorage.getItem(ROSTER_REMOVED_KEY) || '{}');
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (e) { return {}; }
}
window.getRemovedRosterFlightIds = getRemovedRosterFlightIds;

function isFlightRemovedFromRoster(flightId) {
  if (!flightId) return false;
  return Object.prototype.hasOwnProperty.call(getRemovedRosterFlightIds(), String(flightId));
}
window.isFlightRemovedFromRoster = isFlightRemovedFromRoster;

function _updateRemovedRosterFlightIds(removedIds, presentIds) {
  try {
    const obj = getRemovedRosterFlightIds();
    const nowIso = new Date().toISOString();
    (removedIds || []).forEach(id => { if (id) obj[String(id)] = nowIso; });
    (presentIds || []).forEach(id => { delete obj[String(id)]; });
    // Siivoa yli 180 vrk vanhat merkinnät
    const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1000;
    for (const k of Object.keys(obj)) {
      if (new Date(obj[k]).getTime() < cutoff) delete obj[k];
    }
    localStorage.setItem(ROSTER_REMOVED_KEY, JSON.stringify(obj));
  } catch (e) {}
}

function _rosterFlightId(f) {
  return String((f && (f.ID || f.id || f.FlightID || f.FlightId)) || '');
}

function _rosterFlightDate(f) {
  return String((f && (f.StdLt || f.Std)) || '').split('T')[0];
}

/**
 * mergeRosterFlights(existing, incoming, window?)
 *   window = { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 * Jos window annetaan, API:n vastaus on täydellinen tälle aikavälille:
 * välimuistin lennot, joiden lähtöpäivä osuu väliin mutta jotka puuttuvat
 * API-vastauksesta, on poistettu rosterista → ne pudotetaan pois.
 */
function mergeRosterFlights(existing, incoming, window_) {
  const map = new Map();
  const incomingIds = new Set((Array.isArray(incoming) ? incoming : []).map(_rosterFlightId).filter(Boolean));
  const removedIds = [];

  // 1 vrk marginaali aikavälin päihin (API:n ja paikallisen ajan rajat voivat erota)
  if (window_ && window_.from && window_.to) {
    const shift = (ymd, days) => {
      const d = new Date(ymd + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().split('T')[0];
    };
    window_ = { from: shift(window_.from, 1), to: shift(window_.to, -1) };
    if (window_.from > window_.to) window_ = null;
  }
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  // KORJAUS: Merkitään kaikki incoming-lennot nähdyiksi juuri nyt
  (Array.isArray(incoming) ? incoming : []).forEach(f => {
    if (f && typeof f === 'object') {
      f._lastSeenInRoster = now;
    }
  });

  const addFlight = (f, isNew) => {
    if (!f || typeof f !== 'object') return;
    const id = String(f.ID || f.id || f.FlightID || f.FlightId || '');
    if (!id) return;

    const std = new Date(f.StdLt || f.Std || 0).getTime();
    if (std && std < cutoff && !isNew) return;

    map.set(id, f);
  };

  (Array.isArray(existing) ? existing : []).forEach(f => {
    if (window_ && window_.from && window_.to && f && typeof f === 'object') {
      const id = _rosterFlightId(f);
      const d = _rosterFlightDate(f);
      if (id && d && d >= window_.from && d <= window_.to && !incomingIds.has(id)) {
        removedIds.push(id);
        return; // poistettu rosterista
      }
    }
    addFlight(f, false);
  });
  (Array.isArray(incoming) ? incoming : []).forEach(f => addFlight(f, true));

  if (window_ && window_.from && window_.to) {
    if (removedIds.length) {
      console.log(`[Roster] ${removedIds.length} lentoa poistunut rosterista:`, removedIds.join(', '));
    }
    _updateRemovedRosterFlightIds(removedIds, Array.from(incomingIds));
  }

  const merged = Array.from(map.values());
  merged.sort((a, b) => {
    const ta = new Date(a.StdLt || a.Std || 0).getTime();
    const tb = new Date(b.StdLt || b.Std || 0).getTime();
    return ta - tb;
  });
  return merged;
}
window.mergeRosterFlights = mergeRosterFlights;

function _rosterEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
        <span class="rc-flight">${_rosterEsc(s.flightNum) || '–'}</span>
        <span class="rc-route">${_rosterEsc(s.dep)} → ${_rosterEsc(s.arr)}</span>
        <span class="rc-time">${_rosterEsc(s.std)}${s.stdTime ? ' · ' + _rosterEsc(s.stdTime) : ''}</span>
      </div>
    </div>`;
};

const renderChangedLine = (item) => {
  const s = _fmtFlightShort(item.flight);
  return `
    <div class="rc-item rc-item-changed">
      <div class="rc-item-main">
        <span class="rc-flight">${_rosterEsc(s.flightNum) || '–'}</span>
        <span class="rc-route">${_rosterEsc(s.dep)} → ${_rosterEsc(s.arr)}</span>
        <span class="rc-time">${_rosterEsc(s.std)}${s.stdTime ? ' · ' + _rosterEsc(s.stdTime) : ''}</span>
      </div>
      <div class="rc-diffs">
        ${item.diffs.map(d => `
          <div class="rc-diff">
            <span class="rc-diff-label">${_rosterEsc(d.label)}</span>
            <span class="rc-diff-old">${_rosterEsc(d.old)}</span>
            <span class="rc-diff-arrow">→</span>
            <span class="rc-diff-new">${_rosterEsc(d.new)}</span>
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
 *
 * - Timeout 12 s per kuukausi (AbortController)
 * - Sietää verkkokatkokset, tyhjät vastaukset ja timeoutit
 * - Käyttää vain sallittuja lentoyhtiöitä
 * ============================================================== */
function _rosterMonthRange(monthOffset) {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const lastDay  = new Date(firstDay.getFullYear(), firstDay.getMonth() + 1, 0);
  const fmt = (d) => `${d.getFullYear()}-${
    String(d.getMonth() + 1).padStart(2, '0')}-${
    String(d.getDate()).padStart(2, '0')}`;
  return { from: fmt(firstDay), to: fmt(lastDay) };
}

async function _fetchRosterRange(monthOffset) {
  // 1. Token
  // HUOM: palauttaa null jos haku epäonnistui (≠ tyhjä kuukausi []),
  // jotta poistettujen lentojen tunnistus ei tulkitse virhettä poistoksi.
  const token = (typeof getValidSkyplanToken === 'function')
    ? await getValidSkyplanToken().catch(() => null)
    : localStorage.getItem('skyplan_token');
  if (!token) return null;

  // 2. Employee ID
  const payload = (typeof decodeJWT === 'function')
    ? (decodeJWT(token) || {})
    : {};
  const empId = payload.employeeid || payload.EmployeeID || payload.employeeId
             || payload.nameid || payload.sub;
  if (!empId) return null;

  // 3. Aikaväli
  const { from: fromStr, to: toStr } = _rosterMonthRange(monthOffset);

  // 4. Fetch + timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const resp = await fetch(
      'https://kcskyplanapi.airastana.com/api/v1/crew-roster-flights-details',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          EmployeeID: String(empId),
          From: fromStr,
          To: toStr
        }),
        signal: controller.signal
      }
    );

    if (!resp.ok) {
      console.warn(`[Roster] Kuukausi ${monthOffset}: HTTP ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    if (!data || !Array.isArray(data.Flights)) return null;
    const flights = data.Flights;

    // 5. Suodata sallitut lentoyhtiöt
    const allowedCarriers = ['KC', 'KZR', 'AYN', 'FS'];
    const filtered = flights.filter(f =>
      f && allowedCarriers.includes(
        String(f.CarrierCode || '').trim().toUpperCase()
      )
    );

    return filtered;
  } catch (e) {
    if (e.name === 'AbortError') {
      console.warn(`[Roster] Kuukausi ${monthOffset}: timeout 12 s`);
    } else {
      console.warn(`[Roster] Kuukausi ${monthOffset} epäonnistui:`, e.message);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/* ==============================================================
 * forceRosterSync · In-flight dedup
 * ==============================================================
 * Estää rinnakkaiset synkkaukset. Jos kutsu tulee kun edellinen
 * on kesken, palautetaan sama Promise — ei uutta API-kierrosta.
 * ============================================================== */

let _forceRosterSyncInFlight = null;

async function forceRosterSync(options = {}) {
  const { silent = false, forceCompare = true } = options;

  if (!navigator.onLine) {
    if (!silent && typeof showToast === 'function') {
      showToast('Offline — ei voi synkata.', 'warning');
    }
    return null;
  }

  // Jos jo käynnissä → odota samaa lupausta
  if (_forceRosterSyncInFlight) {
    if (!silent) console.log('[RosterSync] Jo käynnissä — odotetaan');
    return await _forceRosterSyncInFlight;
  }

  _forceRosterSyncInFlight = (async () => {
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
      // Poistojen tunnistus vain jos KAIKKI kolme kuukautta onnistuivat
      const allMonthsOk = prevFlights !== null && currFlights !== null && nextFlights !== null;
      const syncWindow = allMonthsOk
        ? { from: _rosterMonthRange(-1).from, to: _rosterMonthRange(1).to }
        : null;

      const map = new Map();
      [...(prevFlights || []), ...(currFlights || []), ...(nextFlights || [])].forEach(f => {
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

    // 5. Päivitä cache (merge) + siivoa vanhentuneet
    try {
      const existing = JSON.parse(localStorage.getItem('assigned_flights_cache') || '[]');
      const merged = mergeRosterFlights(existing, allFlights, syncWindow);

      // Poistetaan lennot jotka ovat yli 8 vrk vanhoja (STA + 8 vrk).
      // HUOM: oli 2 vrk, mutta auto-import katsoo 7 vrk taaksepäin —
      // lento ehti pudota välimuistista ennen kuin se tuotiin lokikirjaan.
      // Perutut lennot hoitaa nyt mergeRosterFlights(syncWindow).
      const nowMs = Date.now();
      const graceMs = 8 * 24 * 60 * 60 * 1000; // 8 vrk
      const removed = [];

      const cleanedMerged = merged.filter(f => {
        const sta = new Date(f.StaLt || f.Sta || 0).getTime();
        if (!sta) return true;
        if (nowMs - sta > graceMs) {
          removed.push(f);
          return false;
        }
        return true;
      });

      if (removed.length > 0) {
        console.log(`[Roster] Poistettu ${removed.length} vanhentunutta lentoa välimuistista:`,
          removed.map(f => `${f.FlightNumber || '?'}/${String(f.StdLt || f.Std || '').split('T')[0]}`).join(', '));
      }

      localStorage.setItem('assigned_flights_cache', JSON.stringify(cleanedMerged));
      localStorage.setItem('assigned_flights_cache_time',
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

        const dates = allFlights
          .map(f => String(f.StdLt || f.Std || '').split('T')[0])
          .filter(Boolean)
          .sort();
        if (dates.length) {
          localStorage.setItem('assigned_flights_cache_range', JSON.stringify({
            from: dates[0],
            to:   dates[dates.length - 1],
            at:   new Date().toISOString()
          }));
        }
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
  })();

  try {
    return await _forceRosterSyncInFlight;
  } finally {
    _forceRosterSyncInFlight = null;
  }
}

/* ==============================================================
 * AUTOLOAD · suojattu tuplasuoritukselta
 * ============================================================== */
async function autoLoadMonthRoster() {
  if (window._rosterAutoLoadDone) return;
  if (window._rosterAutoLoadInFlight) return; 
  if (!navigator.onLine) return;

  const token = (typeof getValidSkyplanToken === 'function')
    ? await getValidSkyplanToken().catch(() => null)
    : localStorage.getItem('skyplan_token');
  if (!token) return;

  window._rosterAutoLoadInFlight = true;

  try {
    await forceRosterSync({ silent: true, forceCompare: true });
    window._rosterAutoLoadDone = true;   
  } catch (e) {
    console.warn('[AutoLoad] failed:', e);
  } finally {
    window._rosterAutoLoadInFlight = false;
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