/* ==============================================================
 * LOGBOOK SUMMARY · Lokikirjan yhteenveto
 * ==============================================================
 * Laskee lokikirjan kirjauksista:
 *   - Tunnit: yhteensä, PIC, Co-pilot, SPIC, multi-pilot, SE/ME,
 *     yö, IFR, FSTD
 *   - Nousut ja laskut (päivä/yö)
 *   - Recency (FCL.060: 3 nousua+laskua / 90 vrk) ja FTL-rajat
 *     (ORO.FTL.210: 100 h / 28 vrk, 900 h / kalenterivuosi,
 *      1000 h / 12 kk)
 *   - TOP-listat: kohteet, kentät, reitit, konetyypit, rekisterit,
 *     kapteenit, perämiehet, lentonumerot
 *   - Kuukausitunnit (12 kk), vuositaulukko, viikonpäivät
 *   - Ennätykset: pisin/lyhyin lento, kiireisin päivä/kuukausi
 *
 * Riippuvuudet: getLogbookEntries (logbook.js), lookupAirport
 * (airport-db.js, valinnainen etäisyyksille), getAirportName.
 * ============================================================== */
'use strict';

const LB_SUMMARY_PERIOD_KEY = 'logbook_summary_period';
const LB_VIEW_KEY = 'logbook_view_mode';

/* ---------------- Apurit ---------------- */
function _lsEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _lsMins(hhmm) {
  if (hhmm == null || hhmm === '') return 0;
  const s = String(hhmm).trim();
  const m = s.match(/^(\d+):(\d{1,2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(s);
  return isFinite(n) ? Math.round(n * 60) : 0; // desimaalitunnit
}

function _lsFmt(mins) {
  mins = Math.max(0, Math.round(mins || 0));
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
}

function _lsDate(e) {
  const d = String(e.date || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}

function _lsDayMs(ymd) { return new Date(ymd + 'T00:00:00').getTime(); }

function _lsYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _lsIsFSTD(e) {
  return !!e.skyplan?.isFSTD || !!(e.fstd?.totalTime && !e.departure?.place && !e.arrival?.place);
}

function _lsIsSPIC(e) { return /SPIC/i.test(e.remarks || ''); }

// Sama henkilö eri järjestyksessä: Skyplan "Etunimi Sukunimi", AIMS "SUKUNIMI ETUNIMI"
function _lsNameKey(n) {
  return String(n || '').trim().toUpperCase().split(/\s+/).filter(Boolean).sort().join(' ');
}

function _lsTitleCase(n) {
  return String(n || '').trim().replace(/\s+/g, ' ')
    .toLowerCase().replace(/(^|[\s\-'])\S/g, c => c.toUpperCase());
}

function _lsDistNm(a, b) {
  if (typeof lookupAirport !== 'function') return null;
  const A = lookupAirport(a), B = lookupAirport(b);
  if (!A || !B || !isFinite(A.lat) || !isFinite(B.lat)) return null;
  const R = 3440.065; // NM
  const rad = x => x * Math.PI / 180;
  const dLat = rad(B.lat - A.lat), dLon = rad(B.lon - A.lon);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(A.lat)) * Math.cos(rad(B.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function _lsApName(icao) {
  if (typeof getAirportName !== 'function') return '';
  try { return getAirportName(icao) || ''; } catch (e) { return ''; }
}

/* Laskuri: key → { label, count, mins } */
function _lsCounter() {
  const m = new Map();
  return {
    add(key, label, mins) {
      if (!key) return;
      const r = m.get(key) || { key, label: label || key, count: 0, mins: 0 };
      r.count++; r.mins += mins || 0;
      m.set(key, r);
    },
    top(n = 10) {
      return Array.from(m.values())
        .sort((a, b) => b.count - a.count || b.mins - a.mins)
        .slice(0, n);
    },
    size() { return m.size; }
  };
}

/* ---------------- Aikavälit ---------------- */
const LB_SUMMARY_PERIODS = [
  { id: 'all',  label: 'Kaikki' },
  { id: 'year', label: 'Tämä vuosi' },
  { id: '12m',  label: '12 kk' },
  { id: '90d',  label: '90 vrk' },
  { id: '28d',  label: '28 vrk' }
];

function _lsPeriodStart(id) {
  const now = new Date();
  const back = days => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - days + 1); return _lsYmd(d); };
  switch (id) {
    case 'year': return `${now.getFullYear()}-01-01`;
    case '12m': { const d = new Date(now.getFullYear(), now.getMonth() - 11, 1); return _lsYmd(d); }
    case '90d': return back(90);
    case '28d': return back(28);
    default: return '';
  }
}

/* ==============================================================
 * computeLogbookSummary · puhdas laskenta (testattava)
 * ============================================================== */
function computeLogbookSummary(allEntries, periodId = 'all', today = new Date()) {
  const from = _lsPeriodStart(periodId);
  const entries = (allEntries || []).filter(e => {
    const d = _lsDate(e);
    return d && (!from || d >= from);
  });

  const S = {
    period: periodId, from,
    flights: 0, sectorsWithTime: 0,
    total: 0, pic: 0, copilot: 0, spic: 0, dual: 0, instructor: 0,
    multiPilot: 0, se: 0, me: 0, night: 0, ifr: 0,
    fstd: 0, fstdSessions: 0,
    toDay: 0, toNight: 0, ldgDay: 0, ldgNight: 0,
    signed: 0, unsigned: 0, pending: 0,
    distanceNm: 0, distanceFlights: 0,
    firstDate: '', lastDate: '',
    longest: null, shortest: null,
    busiestDay: null, busiestMonth: null,
    destinations: _lsCounter(), departures: _lsCounter(), airports: _lsCounter(),
    routes: _lsCounter(), types: _lsCounter(), regs: _lsCounter(),
    captains: _lsCounter(), firstOfficers: _lsCounter(), flightNumbers: _lsCounter(),
    months: new Map(), years: new Map(),
    weekdays: Array.from({ length: 7 }, () => ({ count: 0, mins: 0 })),
    hasCrewData: false
  };

  const perDay = new Map();

  for (const e of entries) {
    const d = _lsDate(e);
    const total = _lsMins(e.totalTimeOfFlight);

    if (_lsIsFSTD(e)) {
      S.fstd += _lsMins(e.fstd?.totalTime);
      S.fstdSessions++;
      continue;
    }

    S.flights++;
    if (total > 0) S.sectorsWithTime++;
    S.total += total;

    const isSpic = _lsIsSPIC(e);
    const picM = _lsMins(e.pilotFunction?.pic);
    const copM = _lsMins(e.pilotFunction?.copilot);
    S.pic += picM;
    S.copilot += copM;
    if (isSpic) S.spic += picM || copM || total;
    S.dual += _lsMins(e.pilotFunction?.dual);
    S.instructor += _lsMins(e.pilotFunction?.instructor);
    S.multiPilot += _lsMins(e.multiPilot);
    S.se += _lsMins(e.singlePilot?.se);
    S.me += _lsMins(e.singlePilot?.me);
    S.night += _lsMins(e.operationalCondition?.night);
    S.ifr += _lsMins(e.operationalCondition?.ifr);

    S.toDay += Number(e.takeoffs?.day || 0);
    S.toNight += Number(e.takeoffs?.night || 0);
    S.ldgDay += Number(e.landings?.day || 0);
    S.ldgNight += Number(e.landings?.night || 0);

    if (e.signatureDataUrl) S.signed++; else S.unsigned++;
    if (e.skyplan?.takeoffPending || e.skyplan?.landingPending) S.pending++;

    if (!S.firstDate || d < S.firstDate) S.firstDate = d;
    if (!S.lastDate || d > S.lastDate) S.lastDate = d;

    const dep = String(e.departure?.place || '').toUpperCase().trim();
    const arr = String(e.arrival?.place || '').toUpperCase().trim();
    if (arr) S.destinations.add(arr, arr, total);
    if (dep) S.departures.add(dep, dep, total);
    if (dep) S.airports.add(dep, dep, 0);
    if (arr) S.airports.add(arr, arr, 0);
    if (dep && arr) S.routes.add(`${dep}-${arr}`, `${dep} → ${arr}`, total);

    const type = String(e.aircraft?.model || '').trim();
    const reg = String(e.aircraft?.registration || '').toUpperCase().trim();
    if (type) S.types.add(type.toUpperCase(), type, total);
    if (reg) S.regs.add(reg, reg, total);

    const fn = String(e.skyplan?.flightNumber || '').toUpperCase().trim();
    if (fn) S.flightNumbers.add(fn, fn, total);

    // Kapteenit: lennot joilla en ollut itse PIC
    if (!picM || copM) {
      const k = _lsNameKey(e.picName);
      if (k && k !== 'SELF') S.captains.add(k, _lsTitleCase(e.picName), total);
    }
    // Perämiehet / muut ohjaajat (vain uudemmat tuonnit tallentavat tämän)
    const crew = Array.isArray(e.skyplan?.crewPilots) ? e.skyplan.crewPilots : [];
    if (crew.length) S.hasCrewData = true;
    if (picM && !copM) {
      for (const c of crew) {
        if (c.isMe) continue;
        if (['CP', 'CAPT', 'PIC', 'P1'].includes(c.position)) continue;
        const k = _lsNameKey(c.name);
        if (k) S.firstOfficers.add(k, _lsTitleCase(c.name), total);
      }
    }

    // Etäisyys
    if (dep && arr) {
      const nm = _lsDistNm(dep, arr);
      if (nm != null) { S.distanceNm += nm; S.distanceFlights++; }
    }

    // Ennätykset
    if (total > 0) {
      if (!S.longest || total > S.longest.mins) S.longest = { mins: total, entry: e };
      if (!S.shortest || total < S.shortest.mins) S.shortest = { mins: total, entry: e };
    }

    // Päivä / kk / vuosi / viikonpäivä
    const pd = perDay.get(d) || { date: d, count: 0, mins: 0 };
    pd.count++; pd.mins += total; perDay.set(d, pd);

    const mk = d.slice(0, 7);
    const mo = S.months.get(mk) || { key: mk, count: 0, mins: 0, pic: 0, copilot: 0 };
    mo.count++; mo.mins += total; mo.pic += picM; mo.copilot += copM;
    S.months.set(mk, mo);

    const yk = d.slice(0, 4);
    const yr = S.years.get(yk) || { key: yk, count: 0, mins: 0, pic: 0, copilot: 0, night: 0, ldg: 0 };
    yr.count++; yr.mins += total; yr.pic += picM; yr.copilot += copM;
    yr.night += _lsMins(e.operationalCondition?.night);
    yr.ldg += Number(e.landings?.day || 0) + Number(e.landings?.night || 0);
    S.years.set(yk, yr);

    const wd = (new Date(d + 'T12:00:00').getDay() + 6) % 7; // ma=0
    S.weekdays[wd].count++; S.weekdays[wd].mins += total;
  }

  for (const pd of perDay.values()) {
    if (!S.busiestDay || pd.count > S.busiestDay.count ||
        (pd.count === S.busiestDay.count && pd.mins > S.busiestDay.mins)) S.busiestDay = pd;
  }
  for (const mo of S.months.values()) {
    if (!S.busiestMonth || mo.mins > S.busiestMonth.mins) S.busiestMonth = mo;
  }

  S.recency = computeLogbookRecency(allEntries, today);
  return S;
}
window.computeLogbookSummary = computeLogbookSummary;

/* ==============================================================
 * Recency + FTL-rajat (aina suhteessa tähän päivään)
 * ============================================================== */
function computeLogbookRecency(allEntries, today = new Date()) {
  const t0 = new Date(today); t0.setHours(0, 0, 0, 0);
  const todayYmd = _lsYmd(t0);
  const daysAgo = n => { const d = new Date(t0); d.setDate(d.getDate() - n + 1); return _lsYmd(d); };

  const from90 = daysAgo(90), from28 = daysAgo(28);
  const from12m = (() => { const d = new Date(t0); d.setFullYear(d.getFullYear() - 1); d.setDate(d.getDate() + 1); return _lsYmd(d); })();
  const yearStart = `${t0.getFullYear()}-01-01`;

  const R = {
    to90: 0, ldg90: 0, nightTo90: 0, nightLdg90: 0,
    mins28: 0, minsYear: 0, mins12m: 0, mins7: 0,
    lastLanding: '', recencyValidUntil: ''
  };
  const from7 = daysAgo(7);
  const landingDates = [];

  for (const e of (allEntries || [])) {
    const d = _lsDate(e);
    if (!d || d > todayYmd || _lsIsFSTD(e)) continue;
    const total = _lsMins(e.totalTimeOfFlight);
    const ldg = Number(e.landings?.day || 0) + Number(e.landings?.night || 0);
    const to = Number(e.takeoffs?.day || 0) + Number(e.takeoffs?.night || 0);

    for (let i = 0; i < ldg; i++) landingDates.push(d);
    if (ldg && (!R.lastLanding || d > R.lastLanding)) R.lastLanding = d;

    if (d >= from90) {
      R.to90 += to; R.ldg90 += ldg;
      R.nightTo90 += Number(e.takeoffs?.night || 0);
      R.nightLdg90 += Number(e.landings?.night || 0);
    }
    if (d >= from28) R.mins28 += total;
    if (d >= from7) R.mins7 += total;
    if (d >= from12m) R.mins12m += total;
    if (d >= yearStart) R.minsYear += total;
  }

  // FCL.060(b)(1): 3. viimeisimmän laskun päivä + 90 vrk
  landingDates.sort();
  if (landingDates.length >= 3) {
    const third = landingDates[landingDates.length - 3];
    const d = new Date(third + 'T00:00:00'); d.setDate(d.getDate() + 90);
    R.recencyValidUntil = _lsYmd(d);
  }
  return R;
}
window.computeLogbookRecency = computeLogbookRecency;

/* ==============================================================
 * RENDER
 * ============================================================== */
function _lsTopList(title, rows, opts = {}) {
  const { withName = false, unit = 'lentoa', empty = 'Ei dataa' } = opts;
  if (!rows.length) {
    return `<div class="lbs-card"><div class="card-label">${_lsEsc(title)}</div>
      <div class="lbs-empty">${_lsEsc(empty)}</div></div>`;
  }
  const max = rows[0].count || 1;
  const items = rows.map((r, i) => {
    const sub = withName ? _lsApName(r.key) : '';
    return `
      <li class="lbs-row">
        <span class="lbs-rank">${i + 1}</span>
        <span class="lbs-label">
          <span class="lbs-label-main">${_lsEsc(r.label)}</span>
          ${sub ? `<span class="lbs-label-sub">${_lsEsc(sub)}</span>` : ''}
          <span class="lbs-bar"><span style="width:${Math.max(4, Math.round(r.count / max * 100))}%"></span></span>
        </span>
        <span class="lbs-val">
          <b>${r.count}</b> <span class="lbs-unit">${unit}</span>
          ${r.mins ? `<span class="lbs-hours">${_lsFmt(r.mins)} h</span>` : ''}
        </span>
      </li>`;
  }).join('');
  return `<div class="lbs-card"><div class="card-label">${_lsEsc(title)}</div><ol class="lbs-list">${items}</ol></div>`;
}

function _lsStat(label, value, sub = '', cls = '') {
  return `<div class="lbs-stat ${cls}">
    <div class="lbs-stat-label">${_lsEsc(label)}</div>
    <div class="lbs-stat-value">${value}</div>
    ${sub ? `<div class="lbs-stat-sub">${sub}</div>` : ''}
  </div>`;
}

function _lsLimit(label, mins, limitH, sub) {
  const pct = Math.min(100, Math.round(mins / (limitH * 60) * 100));
  const cls = pct >= 95 ? 'lbs-bad' : pct >= 80 ? 'lbs-warn' : 'lbs-ok';
  return `<div class="lbs-limit ${cls}">
    <div class="lbs-limit-head"><span>${_lsEsc(label)}</span><b>${_lsFmt(mins)} / ${limitH} h</b></div>
    <div class="lbs-meter"><span style="width:${pct}%"></span></div>
    <div class="lbs-stat-sub">${_lsEsc(sub)} · ${pct} %</div>
  </div>`;
}

function _lsFlightLine(rec) {
  if (!rec) return '–';
  const e = rec.entry;
  const fn = e.skyplan?.flightNumber ? `${_lsEsc(e.skyplan.flightNumber)} · ` : '';
  return `<b>${_lsFmt(rec.mins)} h</b><br><span class="lbs-stat-sub">${fn}${_lsEsc(e.departure?.place || '?')} → ${_lsEsc(e.arrival?.place || '?')} · ${_lsEsc(e.date)}</span>`;
}

const _LS_MONTHS_FI = ['tam', 'hel', 'maa', 'huh', 'tou', 'kes', 'hei', 'elo', 'syy', 'lok', 'mar', 'jou'];

function renderLogbookSummary() {
  const container = document.getElementById('logbook-summary');
  if (!container) return;

  const all = (typeof getLogbookEntries === 'function') ? getLogbookEntries() : [];
  let period = 'all';
  try { period = localStorage.getItem(LB_SUMMARY_PERIOD_KEY) || 'all'; } catch (e) {}
  if (!LB_SUMMARY_PERIODS.some(p => p.id === period)) period = 'all';

  const S = computeLogbookSummary(all, period);
  const R = S.recency;

  const periodBtns = LB_SUMMARY_PERIODS.map(p => `
    <button type="button" class="lbs-chip ${p.id === period ? 'active' : ''}"
      onclick="setLogbookSummaryPeriod('${p.id}')">${_lsEsc(p.label)}</button>`).join('');

  if (!S.flights && !S.fstdSessions) {
    container.innerHTML = `
      <div class="lbs-periods">${periodBtns}</div>
      <div class="lbs-empty lbs-empty-big">Ei kirjauksia valitulla aikavälillä.</div>`;
    return;
  }

  const pct = (part) => S.total ? `${Math.round(part / S.total * 100)} %` : '';
  const avg = S.sectorsWithTime ? _lsFmt(S.total / S.sectorsWithTime) : '–';
  const ldgTot = S.ldgDay + S.ldgNight, toTot = S.toDay + S.toNight;

  /* Recency */
  const todayYmd = _lsYmd(new Date());
  const recOk = R.recencyValidUntil && R.recencyValidUntil >= todayYmd;
  const recencyHTML = `
    <div class="lbs-card">
      <div class="card-label">Recency · FCL.060</div>
      <div class="lbs-grid lbs-grid-3">
        ${_lsStat('Nousut 90 vrk', R.to90, `yö ${R.nightTo90}`, R.to90 >= 3 ? 'lbs-ok' : 'lbs-bad')}
        ${_lsStat('Laskut 90 vrk', R.ldg90, `yö ${R.nightLdg90}`, R.ldg90 >= 3 ? 'lbs-ok' : 'lbs-bad')}
        ${_lsStat('Voimassa', R.recencyValidUntil ? _lsEsc(R.recencyValidUntil) : '–',
            recOk ? '3 laskua / 90 vrk' : 'Ei 3 laskua 90 vrk sisällä', recOk ? 'lbs-ok' : 'lbs-bad')}
      </div>
      <div class="lbs-stat-sub" style="margin-top:8px;">Viimeisin lasku: ${_lsEsc(R.lastLanding || '–')} · Vain kirjatut nousut/laskut (⏳-odottavat eivät ole mukana)</div>
    </div>`;

  /* FTL */
  const ftlHTML = `
    <div class="lbs-card">
      <div class="card-label">Lentoaikarajat · ORO.FTL.210 (block)</div>
      ${_lsLimit('28 vrk', R.mins28, 100, 'Liukuva 28 vrk')}
      ${_lsLimit('Kalenterivuosi', R.minsYear, 900, String(new Date().getFullYear()))}
      ${_lsLimit('12 kk', R.mins12m, 1000, 'Liukuvat 12 kk')}
      <div class="lbs-stat-sub" style="margin-top:6px;">Viimeiset 7 vrk: ${_lsFmt(R.mins7)} h</div>
    </div>`;

  /* Kuukaudet (12 viimeisintä kalenterikuukautta) */
  const now = new Date();
  const monthsArr = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthsArr.push({ k, label: _LS_MONTHS_FI[d.getMonth()], ...(S.months.get(k) || { count: 0, mins: 0, pic: 0, copilot: 0 }) });
  }
  // Kuukausikaavio käyttää aina koko dataa (ei aikavälisuodatusta)
  const SA = period === 'all' ? S : computeLogbookSummary(all, 'all');
  monthsArr.forEach(m => Object.assign(m, SA.months.get(m.k) || { count: 0, mins: 0, pic: 0, copilot: 0 }));
  const maxM = Math.max(1, ...monthsArr.map(m => m.mins));
  const monthsHTML = `
    <div class="lbs-card">
      <div class="card-label">Block-tunnit kuukausittain · 12 kk</div>
      <div class="lbs-months">
        ${monthsArr.map(m => `
          <div class="lbs-month" title="${_lsEsc(m.k)}: ${_lsFmt(m.mins)} h · ${m.count} lentoa (PIC ${_lsFmt(m.pic)}, COP ${_lsFmt(m.copilot)})">
            <div class="lbs-month-val">${m.mins ? Math.round(m.mins / 60) : ''}</div>
            <div class="lbs-month-bar"><span style="height:${Math.round(m.mins / maxM * 100)}%"></span></div>
            <div class="lbs-month-label">${_lsEsc(m.label)}</div>
          </div>`).join('')}
      </div>
    </div>`;

  /* Vuodet */
  const yearsArr = Array.from(SA.years.values()).sort((a, b) => b.key.localeCompare(a.key));
  const yearsHTML = `
    <div class="lbs-card">
      <div class="card-label">Vuosittain</div>
      <table class="lbs-table">
        <thead><tr><th>Vuosi</th><th>Lennot</th><th>Yht</th><th>PIC</th><th>COP</th><th>Yö</th><th>LDG</th></tr></thead>
        <tbody>${yearsArr.map(y => `
          <tr><td>${_lsEsc(y.key)}</td><td>${y.count}</td><td><b>${_lsFmt(y.mins)}</b></td>
          <td>${_lsFmt(y.pic)}</td><td>${_lsFmt(y.copilot)}</td><td>${_lsFmt(y.night)}</td><td>${y.ldg}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  /* Viikonpäivät */
  const wdNames = ['ma', 'ti', 'ke', 'to', 'pe', 'la', 'su'];
  const maxW = Math.max(1, ...S.weekdays.map(w => w.count));
  const weekdayHTML = `
    <div class="lbs-card">
      <div class="card-label">Viikonpäivät</div>
      <div class="lbs-weekdays">
        ${S.weekdays.map((w, i) => `
          <div class="lbs-wd" title="${w.count} lentoa · ${_lsFmt(w.mins)} h">
            <div class="lbs-month-bar"><span style="height:${Math.round(w.count / maxW * 100)}%"></span></div>
            <div class="lbs-month-label">${wdNames[i]}</div>
            <div class="lbs-stat-sub">${w.count}</div>
          </div>`).join('')}
      </div>
    </div>`;

  const nm = Math.round(S.distanceNm);
  const foEmpty = S.hasCrewData
    ? 'Ei PIC-lentoja perämiehen kanssa'
    : 'Tallentuu uusista tuonneista (miehistötieto)';

  container.innerHTML = `
    <div class="lbs-periods">${periodBtns}
      <span class="lbs-range">${S.firstDate ? `${_lsEsc(S.firstDate)} – ${_lsEsc(S.lastDate)}` : ''}</span>
    </div>

    <div class="lbs-grid lbs-grid-hero">
      ${_lsStat('Lennot', S.flights, `${S.sectorsWithTime ? 'ka. ' + avg + ' h / lento' : ''}`)}
      ${_lsStat('Yhteensä', _lsFmt(S.total), 'block-tunnit', 'lbs-accent')}
      ${_lsStat('PIC', _lsFmt(S.pic), pct(S.pic))}
      ${_lsStat('Co-pilot', _lsFmt(S.copilot), pct(S.copilot))}
      ${_lsStat('Yö', _lsFmt(S.night), pct(S.night))}
      ${_lsStat('IFR', _lsFmt(S.ifr), pct(S.ifr))}
      ${_lsStat('Multi-pilot', _lsFmt(S.multiPilot), '')}
      ${_lsStat('Nousut', toTot, `päivä ${S.toDay} · yö ${S.toNight}`)}
      ${_lsStat('Laskut', ldgTot, `päivä ${S.ldgDay} · yö ${S.ldgNight}`)}
      ${S.spic ? _lsStat('SPIC', _lsFmt(S.spic), '') : ''}
      ${(S.se || S.me) ? _lsStat('Single-pilot', _lsFmt(S.se + S.me), `SE ${_lsFmt(S.se)} · ME ${_lsFmt(S.me)}`) : ''}
      ${(S.dual || S.instructor) ? _lsStat('Dual / Instr.', `${_lsFmt(S.dual)} / ${_lsFmt(S.instructor)}`, '') : ''}
      ${S.fstdSessions ? _lsStat('FSTD', _lsFmt(S.fstd), `${S.fstdSessions} sessiota`) : ''}
      ${nm ? _lsStat('Matka', `${nm.toLocaleString('fi-FI')} NM`, `${Math.round(nm * 1.852).toLocaleString('fi-FI')} km${S.distanceFlights < S.flights ? ` · ${S.distanceFlights}/${S.flights} lentoa` : ''}`) : ''}
      ${_lsStat('Kentät', S.airports.size(), `${S.routes.size()} reittiä`)}
      ${_lsStat('Koneet', S.regs.size(), `${S.types.size()} tyyppiä`)}
      ${_lsStat('Allekirjoitettu', `${S.signed}/${S.flights}`, S.pending ? `⏳ ${S.pending} odottaa Skyplania` : '', S.unsigned ? 'lbs-warn' : 'lbs-ok')}
    </div>

    <div class="lbs-grid lbs-grid-2 lbs-stretch">
      ${recencyHTML}
      ${ftlHTML}
    </div>

    <div class="lbs-masonry">
      ${_lsTopList('Eniten lennetyt kohteet', S.destinations.top(10), { withName: true })}
      ${_lsTopList('Eniten lennetty kapteenin kanssa', S.captains.top(10), { empty: 'Ei co-pilot-lentoja' })}
      ${_lsTopList('Eniten lennetty perämiehen kanssa', S.firstOfficers.top(10), { empty: foEmpty })}
      ${_lsTopList('Reitit', S.routes.top(10))}
      ${_lsTopList('Kentät (lähtö + saapuminen)', S.airports.top(10), { withName: true, unit: 'käyntiä' })}
      ${_lsTopList('Lähtökentät', S.departures.top(10), { withName: true })}
      ${_lsTopList('Konetyypit', S.types.top(10))}
      ${_lsTopList('Rekisterit', S.regs.top(10))}
      ${_lsTopList('Lentonumerot', S.flightNumbers.top(10))}
      <div class="lbs-card">
        <div class="card-label">Ennätykset</div>
        <div class="lbs-grid lbs-grid-2 lbs-tight">
          ${_lsStat('Pisin lento', _lsFlightLine(S.longest))}
          ${_lsStat('Lyhyin lento', _lsFlightLine(S.shortest))}
          ${_lsStat('Kiireisin päivä', S.busiestDay ? `${S.busiestDay.count} ${S.busiestDay.count === 1 ? 'sektori' : 'sektoria'}` : '–',
              S.busiestDay ? `${_lsEsc(S.busiestDay.date)} · ${_lsFmt(S.busiestDay.mins)} h` : '')}
          ${_lsStat('Kiireisin kuukausi', S.busiestMonth ? `${_lsFmt(S.busiestMonth.mins)} h` : '–',
              S.busiestMonth ? `${_lsEsc(S.busiestMonth.key)} · ${S.busiestMonth.count} lentoa` : '')}
          ${_lsStat('Ensimmäinen lento', _lsEsc(S.firstDate || '–'))}
          ${_lsStat('Viimeisin lento', _lsEsc(S.lastDate || '–'))}
        </div>
      </div>
    </div>

    ${monthsHTML}

    <div class="lbs-grid lbs-grid-2 lbs-stretch">
      ${yearsHTML}
      ${weekdayHTML}
    </div>
  `;
}
window.renderLogbookSummary = renderLogbookSummary;

function setLogbookSummaryPeriod(id) {
  try { localStorage.setItem(LB_SUMMARY_PERIOD_KEY, id); } catch (e) {}
  renderLogbookSummary();
}
window.setLogbookSummaryPeriod = setLogbookSummaryPeriod;

/* ---------------- Näkymän vaihto: Kirjaukset / Yhteenveto ---------------- */
function setLogbookView(mode) {
  if (mode !== 'summary') mode = 'list';
  try { localStorage.setItem(LB_VIEW_KEY, mode); } catch (e) {}
  const list = document.getElementById('logbook-container');
  const sum = document.getElementById('logbook-summary');
  if (list) list.style.display = mode === 'list' ? '' : 'none';
  if (sum) sum.style.display = mode === 'summary' ? '' : 'none';
  document.querySelectorAll('#logbook-view-toggle .vt-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === mode));
  if (mode === 'summary') renderLogbookSummary();
}
window.setLogbookView = setLogbookView;

/* Päivitä yhteenveto aina kun lokikirja renderöidään (jos näkyvissä) */
(function wrapRenderForSummary() {
  const hook = () => {
    if (typeof window.renderLogbookTable !== 'function' || window.renderLogbookTable._lbsWrapped) return;
    const orig = window.renderLogbookTable;
    const wrapped = function (...args) {
      const r = orig.apply(this, args);
      const sum = document.getElementById('logbook-summary');
      if (sum && sum.style.display !== 'none') {
        try { renderLogbookSummary(); } catch (e) { console.warn('[Summary] render failed:', e); }
      }
      return r;
    };
    wrapped._lbsWrapped = true;
    window.renderLogbookTable = wrapped;
  };
  hook();
  const init = () => {
    hook();
    let mode = 'list';
    try { mode = localStorage.getItem(LB_VIEW_KEY) || 'list'; } catch (e) {}
    setLogbookView(mode);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
