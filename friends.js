/* ==============================================================
 * FRIENDS · Kavereiden rosterit ja yhteiset tapahtumat
 * ==============================================================
 * - Hakee kavereiden rosterit EmployeeID:llä
 * - Analysoi yhteiset: vapaapäivät, kohteet, lennot
 * - Kaikki data pysyy laitteella (localStorage)
 * ============================================================== */

const FRIENDS_KEY = '_friends_v1';
const FRIEND_ROSTER_TTL = 6 * 60 * 60 * 1000;   // 6 h
const FRIEND_LOOKAHEAD_DAYS = 60;               // analyysi-ikkuna

/* ---------------- Storage ---------------- */
function getFriends() {
  try {
    const arr = JSON.parse(localStorage.getItem(FRIENDS_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function saveFriends(list) {
  try { localStorage.setItem(FRIENDS_KEY, JSON.stringify(list)); } catch (e) {}
}
function addFriend(employeeId, name) {
  const id = String(employeeId || '').trim();
  const n = String(name || '').trim();
  if (!id) throw new Error('Employee ID vaaditaan');
  const list = getFriends();
  if (list.some(f => String(f.employeeId) === id)) {
    throw new Error('Kaveri on jo listalla');
  }
  list.push({
    id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()),
    employeeId: id,
    name: n || `#${id}`,
    addedAt: new Date().toISOString()
  });
  saveFriends(list);
  return list;
}
function removeFriend(id) {
  saveFriends(getFriends().filter(f => f.id !== id));
}
window.getFriends = getFriends;
window.addFriend = addFriend;
window.removeFriend = removeFriend;

/* ---------------- Roster cache ---------------- */
function _frCacheKey(employeeId) { return `_friend_roster_${employeeId}`; }

function _frCacheGet(employeeId) {
  try {
    const raw = localStorage.getItem(_frCacheKey(employeeId));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.at) return null;
    if (Date.now() - new Date(data.at).getTime() > FRIEND_ROSTER_TTL) return null;
    return data;
  } catch (e) { return null; }
}
function _frCacheSet(employeeId, flights) {
  try {
    localStorage.setItem(_frCacheKey(employeeId), JSON.stringify({
      at: new Date().toISOString(),
      flights
    }));
  } catch (e) {}
}


/* ---------------- Analyysi ---------------- */
function _frFmtDateYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${
    String(d.getDate()).padStart(2, '0')}`;
}

function _frIcaosOf(flight) {
  const out = [];
  const dep = String(flight.DepartureStationIcaoCode || flight.DepartureStationCode || '').toUpperCase();
  const arr = String(flight.ArrivalStationIcaoCode || flight.ArrivalStationCode || '').toUpperCase();
  if (dep.length === 4) out.push(dep);
  if (arr.length === 4) out.push(arr);
  return out;
}

/* ==============================================================
 * ANALYYSI v2 · Presence intervals + multi-person overlap
 * ============================================================== */

function _extractDate(f) {
  const raw = f?.StdLt || f?.Std || f?.Date || '';
  const s = String(raw);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  if (s.includes('T')) return s.split('T')[0];
  const m2 = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if (m2) return `${m2[3]}-${String(m2[2]).padStart(2,'0')}-${String(m2[1]).padStart(2,'0')}`;
  return '';
}

/**
 * Laskee läsnäoloikkunat per lentäjä.
 * Turnaround huomioitu: jos UAAA→UACC→UAAA, ei olla UAAA:lla koko päivää,
 * vain ennen lähtöä ja saapumisen jälkeen.
 */
function computePresenceIntervals(flights) {
  const intervals = [];
  const sorted = flights
    .slice()
    .filter(f => f && (f.StdLt || f.Std) && (f.StaLt || f.Sta))
    .sort((a, b) =>
      new Date(a.StdLt || a.Std) - new Date(b.StdLt || b.Std));

  // Rakenna tapahtumalista (saapumiset ja lähdöt aikajärjestyksessä)
  const events = [];
  sorted.forEach(f => {
    const stdT = new Date(f.StdLt || f.Std).getTime();
    const staT = new Date(f.StaLt || f.Sta).getTime();
    if (isNaN(stdT) || isNaN(staT)) return;
    const dep = String(f.DepartureStationIcaoCode || f.DepartureStationCode || '').toUpperCase();
    const arr = String(f.ArrivalStationIcaoCode   || f.ArrivalStationCode   || '').toUpperCase();
    if (dep.length === 4) events.push({ type: 'dep', time: stdT, station: dep, flight: f });
    if (arr.length === 4) events.push({ type: 'arr', time: staT, station: arr, flight: f });
  });
  events.sort((a, b) => a.time - b.time);

  // Avoin läsnäolo per asema
  const active = new Map();  // station → { startTime, flights: [] }

  events.forEach(ev => {
    if (ev.type === 'dep') {
      if (active.has(ev.station)) {
        const p = active.get(ev.station);
        const dur = ev.time - p.startTime;
        // Vähintään 15 min läsnäolo, jotta se on merkittävä
        if (dur >= 15 * 60 * 1000) {
          intervals.push({
            station: ev.station,
            from: p.startTime,
            to: ev.time,
            flights: [...p.flights, ev.flight]
          });
        }
        active.delete(ev.station);
      }
    } else if (ev.type === 'arr') {
      if (!active.has(ev.station)) {
        active.set(ev.station, { startTime: ev.time, flights: [ev.flight] });
      } else {
        active.get(ev.station).flights.push(ev.flight);
      }
    }
  });

  // Sulje avoimet läsnäolot (pilotin päivä päättyy asemalle)
  // Oletus: läsnäolo jatkuu 2 h saapumisen jälkeen
  for (const [station, p] of active) {
    intervals.push({
      station,
      from: p.startTime,
      to: p.startTime + 2 * 60 * 60 * 1000,
      flights: p.flights
    });
  }

  return intervals;
}

/**
 * Analysoi ryhmän (minä + kaverit) yhteiset tapahtumat.
 * @param {Array} members — [{ id, name, isMe, flights }]
 * @returns {Object} { dayOffs, stationOverlaps, perPerson }
 */
function analyzeGroupOverlap(members) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const now = Date.now();

  // --- 1. Kaikkien aktiiviset päivät ---
  const daysWithActivity = members.map(m => {
    const set = new Set();
    (m.flights || []).forEach(f => {
      const d = _extractDate(f);
      if (d) set.add(d);
    });
    return set;
  });

  // --- 2. Yhteiset vapaapäivät (2+ vapaata) ---
  const dayOffs = [];
  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const key = _frFmtDateYMD(d);

    // Jos päivä on jo ohi (klo 23:59 menneisyydessä), ohita
    // (tänään sallitaan)
    if (d < today) continue;

    const freeIdx = [];
    members.forEach((m, idx) => {
      if (!daysWithActivity[idx].has(key)) freeIdx.push(idx);
    });

    if (freeIdx.length >= 2) {
      // Onko tänään KAikilla jo lennetty ja ollaan illalla? → ok silti
      dayOffs.push({
        date: key,
        memberIndexes: freeIdx,
        memberNames: freeIdx.map(i => members[i].name)
      });
    }
  }

  // --- 3. Asema-overlapit (läsnäoloikkunat) ---
  const intervals = [];
  members.forEach((m, idx) => {
    computePresenceIntervals(m.flights || []).forEach(iv => {
      // Ohita pelkät menneet
      if (iv.to < now) return;
      intervals.push({ ...iv, memberIdx: idx });
    });
  });

  // Etsi pareittain overlap
  const overlapGroups = [];
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      const a = intervals[i];
      const b = intervals[j];
      if (a.memberIdx === b.memberIdx) continue;
      if (a.station !== b.station) continue;

      const from = Math.max(a.from, b.from);
      const to   = Math.min(a.to,   b.to);
      if (to - from < 30 * 60 * 1000) continue;  // < 30 min → ohita

      overlapGroups.push({
        station: a.station,
        from,
        to,
        memberIdx: new Set([a.memberIdx, b.memberIdx]),
        flights: [...(a.flights || []), ...(b.flights || [])]
      });
    }
  }

  // Yhdistä overlapit jotka ovat samalla asemalla ja limittäin
  const merged = [];
  overlapGroups.sort((a, b) => a.from - b.from);
  for (const g of overlapGroups) {
    let merged_ = false;
    for (const m of merged) {
      if (m.station !== g.station) continue;
      // Jos ajat limittäin (±30 min), yhdistä
      if (g.from <= m.to + 30 * 60 * 1000 && g.to >= m.from - 30 * 60 * 1000) {
        m.from = Math.min(m.from, g.from);
        m.to   = Math.max(m.to,   g.to);
        g.memberIdx.forEach(i => m.memberIdx.add(i));
        m.flights.push(...g.flights);
        merged_ = true;
        break;
      }
    }
    if (!merged_) {
      merged.push({
        station: g.station,
        from: g.from,
        to: g.to,
        memberIdx: new Set(g.memberIdx),
        flights: [...g.flights]
      });
    }
  }

  const stationOverlaps = merged.map(g => ({
    station: g.station,
    from: g.from,
    to: g.to,
    date: _frFmtDateYMD(new Date(g.from)),
    memberIndexes: [...g.memberIdx],
    memberNames: [...g.memberIdx].map(i => members[i].name),
    flights: g.flights
  })).sort((a, b) => a.from - b.from);

  return { dayOffs, stationOverlaps };
}

/* ---------------- Formatoinnit ---------------- */
function _frEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _frFmtDateFi(ymd) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-');
  const days = ['SU','MA','TI','KE','TO','PE','LA'];
  const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  return `${days[date.getDay()]} ${parseInt(d)}.${parseInt(m)}.`;
}

function _frFmtTime(iso) {
  if (!iso) return '--:--';
  const s = String(iso);
  return s.includes('T') ? s.split('T')[1].substring(0, 5) : s;
}

function _frFlightShort(f) {
  const carrier = String(f.CarrierCode || '').trim();
  const fltNo = String(f.FlightNumber || '').trim();
  const flightNum = (carrier && fltNo.startsWith(carrier)) ? fltNo : `${carrier}${fltNo}`;
  return {
    flightNum,
    dep: String(f.DepartureStationIcaoCode || f.DepartureStationCode || '?'),
    arr: String(f.ArrivalStationIcaoCode || f.ArrivalStationCode || '?'),
    std: _frFmtTime(f.StdLt || f.Std)
  };
}

/* ==============================================================
 * RENDER
 * ============================================================== */
async function renderFriendsView() {
  const container = document.getElementById('friends-container');
  if (!container) return;

  const friends = getFriends();
  const now = Date.now();

  // Header
  const header = `
    <div class="fr-head">
      <div class="fr-head-info">
        <span class="fr-count">${friends.length}</span>
        <span class="fr-count-label">${friends.length === 1 ? 'kaveri' : 'kaveria'}</span>
      </div>
      <div class="fr-head-actions">
        <button class="btn-ghost" onclick="showShareCodeModal()">📤 Jaa oma rosteri</button>
        <button class="btn-primary" onclick="showImportCodeModal()">📥 Liitä kaverin koodi</button>
      </div>
    </div>`;

  if (!friends.length) {
    container.innerHTML = header + `
      <div class="fr-empty">
        <div style="font-size:36px; margin-bottom:10px;">👥</div>
        <div style="font-size:15px; font-weight:700; color:var(--text);">
          Ei kavereita listalla
        </div>
        <div style="font-size:12px; color:var(--dim); margin-top:6px; max-width:340px;">
          Lisää kaveri Employee ID:llä. Näet milloin olette samoissa kohteissa
          tai teillä on yhteisiä vapaapäiviä.
        </div>
      </div>`;
    return;
  }

  // Lataa kaikkien rosterit
  const myRoster = (() => {
    try { return JSON.parse(localStorage.getItem('assigned_flights_cache') || '[]'); }
    catch (e) { return []; }
  })();

  const friendResults = friends.map(friend => {
    try {
      const raw = localStorage.getItem(`_friend_roster_${friend.employeeId}`);
      if (raw) {
        const data = JSON.parse(raw);
        return { friend, roster: data.flights || [], error: null };
      }
    } catch (e) {}
    return { friend, roster: [], error: 'Ei jaettua dataa' };
  });

  // Rakenna analyysiryhmä
  const members = [
    { id: '__me__', name: 'Sinä', isMe: true, flights: myRoster },
    ...friendResults
      .filter(r => !r.error)
      .map(r => ({
        id: r.friend.employeeId,
        name: r.friend.name,
        isMe: false,
        flights: r.roster
      }))
  ];

  const analysis = analyzeGroupOverlap(members);

  // ---- SUGGESTIONS ----
  const suggestions = [];

  // 1. Yhteiset vapaapäivät (2+ henkeä vapaana)
  analysis.dayOffs.forEach(d => {
    if (d.memberIndexes.length < 2) return;
    const names = d.memberNames;
    // Muotoile: "Sinä ja Matti" / "Sinä, Matti ja 2 muuta"
    let whoLabel;
    if (names.length === 2) whoLabel = names.join(' ja ');
    else if (names.length === 3) whoLabel = `${names[0]}, ${names[1]} ja ${names[2]}`;
    else whoLabel = `${names.slice(0, 2).join(', ')} ja ${names.length - 2} muuta`;

    suggestions.push({
      type: 'off',
      date: d.date,
      timestamp: new Date(d.date + 'T09:00:00').getTime(),
      title: `${whoLabel} vapaalla`,
      subtitle: 'Yhteinen vapaapäivä — hyvä hetki sopia tapaaminen',
      members: names,
      icon: '🏖'
    });
  });

  // 2. Asema-overlapit
  analysis.stationOverlaps.forEach(o => {
    if (o.memberIndexes.length < 2) return;
    const names = o.memberNames;
    let whoLabel;
    if (names.length === 2) whoLabel = names.join(' ja ');
    else if (names.length === 3) whoLabel = `${names[0]}, ${names[1]} ja ${names[2]}`;
    else whoLabel = `${names.slice(0, 2).join(', ')} ja ${names.length - 2} muuta`;

    const fromStr = new Date(o.from).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const toStr   = new Date(o.to).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Suosikkimiehistö samalla asemalla
    let favCrewNames = [];
    if (typeof getFlightFavorites === 'function') {
      const seen = new Set();
      (o.flights || []).forEach(f => {
        const fid = String(f.ID || f.id || f.FlightID || '');
        if (!fid) return;
        getFlightFavorites(fid).forEach(fav => {
          const full = getFavoriteFullName(fav);
          if (!seen.has(full)) {
            seen.add(full);
            favCrewNames.push(full);
          }
        });
      });
    }

    suggestions.push({
      type: 'station',
      date: o.date,
      timestamp: o.from,
      title: `${whoLabel} @ ${o.station}`,
      subtitle: `${fromStr} – ${toStr}`,
      members: names,
      station: o.station,
      icon: '📍',
      favCrew: favCrewNames
    });
  });

  // Järjestä aikajärjestykseen
  suggestions.sort((a, b) => a.timestamp - b.timestamp);

  // Yhteenveto -suggestions HTML
  let suggestionsHtml = '';
  if (!suggestions.length) {
    suggestionsHtml = `
      <div class="fr-insights-empty">
        Ei yhteisiä tapahtumia seuraavan 60 päivän aikana.
      </div>`;
  } else {
    suggestionsHtml = suggestions.slice(0, 12).map(s => {
      const favLine = (s.favCrew && s.favCrew.length)
        ? `<div class="fr-suggestion-fav">⭐ ${_frEsc(s.favCrew.join(', '))}</div>`
        : '';

      return `
        <div class="fr-suggestion fr-suggestion-${s.type}">
          <div class="fr-suggestion-icon">${s.icon}</div>
          <div class="fr-suggestion-body">
            <div class="fr-suggestion-title">${_frEsc(s.title)}</div>
            <div class="fr-suggestion-sub">${_frEsc(s.subtitle)}</div>
            ${favLine}
          </div>
          <div class="fr-suggestion-date">${_frEsc(_frFmtDateFi(s.date))}</div>
        </div>
      `;
    }).join('');
  }

  // ---- KAVERIKORTIT ----
  const cardsHtml = friendResults.map(({ friend, roster, error }) => {
    if (error) {
      return `
        <div class="fr-card fr-card-error">
          <div class="fr-card-head">
            <div>
              <div class="fr-card-name">${_frEsc(friend.name)}</div>
              <div class="fr-card-id">#${_frEsc(friend.employeeId)}</div>
            </div>
            <button class="fr-card-remove" onclick="confirmRemoveFriend('${friend.id}')">✕</button>
          </div>
          <div style="font-size:12px; color:var(--error); margin-top:8px;">
            ${_frEsc(error)}
          </div>
        </div>`;
    }

    // Seuraava lento (vain tulevat)
    const nextFlight = (roster || []).find(f =>
      new Date(f.StdLt || f.Std || 0).getTime() > now - 30 * 60 * 1000
    );

    const flightLine = nextFlight
      ? (() => {
          const s = _frFlightShort(nextFlight);
          const d = _extractDate(nextFlight);
          return `${s.flightNum} · ${s.dep} → ${s.arr} · ${_frFmtDateFi(d)} ${s.std}`;
        })()
      : 'Ei tulevia lentoja';

    // Montako yhteistä tapahtumaa tällä kaverilla
    const friendIdx = members.findIndex(m => m.id === friend.employeeId);
    const offCount = analysis.dayOffs.filter(d =>
      d.memberIndexes.includes(0) && d.memberIndexes.includes(friendIdx)
    ).length;
    const stationCount = analysis.stationOverlaps.filter(o =>
      o.memberIndexes.includes(0) && o.memberIndexes.includes(friendIdx)
    ).length;
    const totalShared = offCount + stationCount;

    let sharedLine = '';
    if (totalShared > 0) {
      const parts = [];
      if (offCount) parts.push(`${offCount} vapaapäivää`);
      if (stationCount) parts.push(`${stationCount} yhteistä kohdetta`);
      sharedLine = `<span class="fr-card-highlight">${parts.join(' · ')}</span>`;
    } else {
      sharedLine = `<span style="color:var(--dim);">Ei yhteisiä tapahtumia</span>`;
    }

    return `
      <div class="fr-card ${totalShared > 0 ? 'has-overlap' : ''}">
        <div class="fr-card-head">
          <div>
            <div class="fr-card-name">${_frEsc(friend.name)}</div>
            <div class="fr-card-id">#${_frEsc(friend.employeeId)}</div>
          </div>
          <button class="fr-card-remove" onclick="confirmRemoveFriend('${friend.id}')">✕</button>
        </div>
        <div class="fr-card-row">
          <span class="fr-card-row-label">Seuraava</span>
          <span class="fr-card-row-value">${_frEsc(flightLine)}</span>
        </div>
        <div class="fr-card-row">
          <span class="fr-card-row-label">Yhteiset</span>
          <span class="fr-card-row-value">${sharedLine}</span>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = header + `
    <div class="fr-section">
      <div class="fr-section-label">
        Ehdotukset · ${suggestions.length} ${suggestions.length === 1 ? 'osuma' : 'osumaa'}
      </div>
      ${suggestionsHtml}
    </div>

    <div class="fr-section">
      <div class="fr-section-label">Kaverit</div>
      <div class="fr-cards-grid">
        ${cardsHtml}
      </div>
    </div>
  `;
}
window.renderFriendsView = renderFriendsView;

/* ==============================================================
 * FRIEND SHARE CODES
 * ==============================================================
 * Air Astana API palauttaa vain oman rosterin — ei voi hakea
 * kaverin dataa tokenilla. Käytetään jaettavaa koodia:
 *   1. Kaveri avaa sovelluksen omalla laitteella
 *   2. Painaa "Jaa oma rosteri" → koodi kopioituu
 *   3. Lähettää sen sinulle (WhatsApp/Messenger/email)
 *   4. Sinä liität koodin → kaveri ilmestyy listalle
 * ============================================================== */

async function generateShareCode() {
  const myRoster = (() => {
    try { return JSON.parse(localStorage.getItem('assigned_flights_cache') || '[]'); }
    catch (e) { return []; }
  })();

  if (!myRoster.length) {
    throw new Error('Ei lentoja jaettavaksi. Synkkaa roster ensin.');
  }

  const minimal = myRoster.map(f => ({
    i:  String(f.ID || f.id || f.FlightID || ''),
    n:  String(f.FlightNumber || ''),
    c:  String(f.CarrierCode || ''),
    dp: String(f.DepartureStationIcaoCode || f.DepartureStationCode || ''),
    ar: String(f.ArrivalStationIcaoCode   || f.ArrivalStationCode   || ''),
    sd: String(f.StdLt || f.Std || ''),
    sa: String(f.StaLt || f.Sta || '')
  })).filter(f => f.i && f.sd);

  const payload = {
    v: 1,
    n: (() => {
      try {
        const p = decodeJWT(localStorage.getItem('skyplan_token')) || {};
        return [p.given_name || p.FirstName, p.family_name || p.LastName]
          .filter(Boolean).join(' ') || 'Anonymous';
      } catch (e) { return 'Anonymous'; }
    })(),
    e: (() => {
      try { return decodeJWT(localStorage.getItem('skyplan_token'))?.employeeid || ''; }
      catch (e) { return ''; }
    })(),
    t: new Date().toISOString(),
    f: minimal
  };

  const json = JSON.stringify(payload);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return 'FLIGHTDECK1:' + b64;
}
window.generateShareCode = generateShareCode;

async function importShareCode(code) {
  const s = String(code || '').trim();
  if (!s.startsWith('FLIGHTDECK1:')) {
    throw new Error('Virheellinen koodi. Pitää alkaa "FLIGHTDECK1:"');
  }

  let payload;
  try {
    const b64 = s.slice(8);
    const json = decodeURIComponent(escape(atob(b64)));
    payload = JSON.parse(json);
  } catch (e) {
    throw new Error('Koodin purku epäonnistui.');
  }

  if (!payload || !Array.isArray(payload.f)) {
    throw new Error('Koodi ei sisällä kelvollista dataa.');
  }

  const flights = payload.f.map(x => ({
    ID: x.i,
    FlightNumber: x.n,
    CarrierCode: x.c,
    DepartureStationIcaoCode: x.dp,
    ArrivalStationIcaoCode:   x.ar,
    StdLt: x.sd,
    StaLt: x.sa
  }));

  const friendId = String(payload.e || 'unknown-' + Date.now());
  const friendName = String(payload.n || 'Kaveri');

  const list = getFriends();
  const existing = list.find(f => String(f.employeeId) === friendId);
  if (existing) {
    existing.name = friendName;
    existing.updatedAt = new Date().toISOString();
  } else {
    list.push({
      id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()),
      employeeId: friendId,
      name: friendName,
      addedAt: new Date().toISOString(),
      source: 'share-code'
    });
  }
  saveFriends(list);

  try {
    localStorage.setItem(`_friend_roster_${friendId}`, JSON.stringify({
      at: new Date().toISOString(),
      flights,
      fromShareCode: true
    }));
  } catch (e) {}

  return { friendId, friendName, flightCount: flights.length };
}
window.importShareCode = importShareCode;

async function fetchFriendRoster(employeeId) {
  try {
    const raw = localStorage.getItem(`jarvis_friend_roster_${employeeId}`);
    if (raw) {
      const data = JSON.parse(raw);
      if (data?.flights && Array.isArray(data.flights)) return data.flights;
    }
  } catch (e) {}
  return [];
}
window.fetchFriendRoster = fetchFriendRoster;

/* ---------------- Jaa oma rosteri -modaali ---------------- */
async function showShareCodeModal() {
  let code = '';
  let error = null;
  try {
    code = await generateShareCode();
  } catch (e) {
    error = e.message;
  }

  if (error) {
    createModal({
      title: 'Jaon virhe',
      message: error,
      icon: '⚠️',
      type: 'error',
      confirmText: 'Sulje',
      compact: true
    });
    return;
  }

  const myRoster = JSON.parse(localStorage.getItem('assigned_flights_cache') || '[]');
  const bodyHTML = `
    <div style="font-size:13px; color:var(--dim); margin-bottom:12px; line-height:1.5;">
      Lähetä tämä koodi kaverille (WhatsApp, Messenger, email).
      Koodi sisältää <b style="color:var(--text);">${myRoster.length} lennon</b> tiedot
      (päivämäärät, reitit, ajat) — ei henkilökohtaisia tietoja.
    </div>
    <textarea id="fr-share-code" readonly
      style="width:100%; height:160px; padding:12px; border-radius:8px;
             background:var(--input); color:var(--text);
             border:1px solid var(--border); font-family:var(--font-mono);
             font-size:11px; line-height:1.4; resize:vertical;
             word-break:break-all; box-sizing:border-box;">${code}</textarea>
    <div style="display:flex; gap:10px; margin-top:12px;">
      <button type="button" id="fr-copy-btn"
        style="flex:1; padding:12px; background:var(--accent); color:#001018;
               border:none; border-radius:8px; font-weight:700; cursor:pointer;">
        📋 Kopioi
      </button>
      <button type="button" id="fr-share-native-btn"
        style="flex:1; padding:12px; background:var(--input); color:var(--text);
               border:1px solid var(--border); border-radius:8px;
               font-weight:700; cursor:pointer;">
        📤 Jaa
      </button>
    </div>
  `;

  createModal({
    title: 'Jaa oma rosteri',
    icon: '📤',
    bodyHTML,
    confirmText: 'Sulje',
    maxWidth: '540px',
    onConfirm: () => {}
  });

  setTimeout(() => {
    const copyBtn = document.getElementById('fr-copy-btn');
    const shareBtn = document.getElementById('fr-share-native-btn');
    const ta = document.getElementById('fr-share-code');

    copyBtn?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code);
        if (typeof showToast === 'function') showToast('Koodi kopioitu.', 'success');
      } catch (e) {
        ta.select(); document.execCommand('copy');
        if (typeof showToast === 'function') showToast('Koodi kopioitu.', 'success');
      }
    });

    shareBtn?.addEventListener('click', async () => {
      if (navigator.share) {
        try {
          await navigator.share({ text: code });
        } catch (e) {
          if (e.name !== 'AbortError' && typeof showToast === 'function') {
            showToast('Jakaminen peruutettu.', 'info');
          }
        }
      } else {
        ta.select(); document.execCommand('copy');
        if (typeof showToast === 'function') {
          showToast('Laite ei tue natiivijakoa — koodi kopioitu.', 'info');
        }
      }
    });
  }, 50);
}
window.showShareCodeModal = showShareCodeModal;

/* ---------------- Liitä kaverin koodi -modaali ---------------- */
function showImportCodeModal() {
  const bodyHTML = `
    <div style="font-size:13px; color:var(--dim); margin-bottom:12px; line-height:1.5;">
      Liitä kaverin lähettämä koodi (alkaa <span class="mono">FLIGHTDECK1:</span>).
    </div>
    <textarea id="fr-import-code" placeholder="FLIGHTDECK1:eyJ2IjoxLCJuIjoi..."
      style="width:100%; height:140px; padding:12px; border-radius:8px;
             background:var(--input); color:var(--text);
             border:1px solid var(--border); font-family:var(--font-mono);
             font-size:11px; line-height:1.4; resize:vertical;
             word-break:break-all; box-sizing:border-box;"></textarea>
  `;

  createModal({
    title: 'Liitä kaverin koodi',
    icon: '📥',
    bodyHTML,
    confirmText: 'Liitä',
    cancelText: 'Peruuta',
    maxWidth: '540px',
    onConfirm: async () => {
      const code = document.getElementById('fr-import-code')?.value.trim();
      if (!code) {
        if (typeof showToast === 'function') showToast('Anna koodi.', 'warning');
        return;
      }
      try {
        const result = await importShareCode(code);
        if (typeof showToast === 'function') {
          showToast(`${result.friendName} lisätty (${result.flightCount} lentoa).`, 'success');
        }
        setTimeout(renderFriendsView, 200);
      } catch (e) {
        if (typeof showToast === 'function') showToast(e.message, 'error');
      }
    }
  });
}
window.showImportCodeModal = showImportCodeModal;

/* ---------------- Poista kaveri ---------------- */
function confirmRemoveFriend(id) {
  const friend = getFriends().find(f => f.id === id);
  if (!friend) return;

  createModal({
    title: 'Poista kaveri?',
    message: `Poistetaanko <strong>${friend.name}</strong> (#${friend.employeeId}) listalta?`,
    icon: '⚠️',
    confirmText: 'Poista',
    cancelText: 'Peruuta',
    compact: true,
    onConfirm: () => {
      removeFriend(id);
      if (typeof showToast === 'function') {
        showToast('Kaveri poistettu.', 'info');
      }
      setTimeout(renderFriendsView, 100);
    }
  });
}
window.confirmRemoveFriend = confirmRemoveFriend;

/* ---------------- Init ---------------- */
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.tab-btn[data-tab="friends"]');
  if (btn) setTimeout(renderFriendsView, 50);
});

document.addEventListener('DOMContentLoaded', () => {
  if (document.querySelector('.tab-btn[data-tab="friends"].active')) {
    setTimeout(renderFriendsView, 300);
  }
});