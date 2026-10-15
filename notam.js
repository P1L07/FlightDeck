/* ==============================================================
 * NOTAM MODULE · PocketWorld API
 * ==============================================================
 * PocketWorld tarjoaa avoimen CORS-rajapinnan NOTAM-datalle.
 * Palauttaa Q-line-jäsennellyn JSONin 17 FIR:stä.
 *
 * Worker välittää pyynnön → ei CORS-ongelmia.
 * ============================================================== */

const NOTAM_CACHE_KEY = 'notam_cache_v1';
const NOTAM_CACHE_TTL = 15 * 60 * 1000;    // 15 min (PocketWorldin oma cache)
const NOTAM_MAX_AGE   = 72 * 60 * 60 * 1000; // 72 h

function _loadAutoRouterKey() {
  try { return localStorage.getItem('autorouter_key') || ''; }
  catch (e) { return ''; }
}
function saveAutoRouterKey() {
  const input = document.getElementById('autorouter_key');
  if (!input) return;
  const key = (input.value || '').trim();
  try {
    localStorage.setItem('autorouter_key', key);
    if (typeof showToast === 'function') showToast('AutoRouter-avain tallennettu.', 'success');
  } catch (e) {
    if (typeof showToast === 'function') showToast('Tallennus epäonnistui.', 'error');
  }
}
window.saveAutoRouterKey = saveAutoRouterKey;

// Käytä avainta dynaamisesti
const AUTOROUTER_KEY = _loadAutoRouterKey();

/* Käytetään samaa Worker-osoitetta kuin säämoduulissa */
function _notamProxied(targetUrl) {
  const base = (typeof WX_PROXY !== 'undefined' && WX_PROXY)
    ? WX_PROXY
    : 'https://wx-proxy.janri-kallas.workers.dev';
  return `${base}/?url=${encodeURIComponent(targetUrl)}`;
}

/* ---------------- Cache ---------------- */
function _notamCacheRead() {
  try { return JSON.parse(localStorage.getItem(NOTAM_CACHE_KEY) || '{}') || {}; }
  catch (e) { return {}; }
}
function _notamCacheWrite(c) {
  try { localStorage.setItem(NOTAM_CACHE_KEY, JSON.stringify(c)); } catch (e) {}
}
function _notamCacheGet(icao) {
  const c = _notamCacheRead();
  const hit = c[icao];
  if (!hit) return null;
  if (Date.now() - hit.t > NOTAM_CACHE_TTL) return null;
  return hit.data;
}
function _notamCacheSet(icao, data) {
  const c = _notamCacheRead();
  c[icao] = { t: Date.now(), data };
  // Rajaa 100 kenttään
  const keys = Object.keys(c);
  if (keys.length > 100) {
    keys.sort((a, b) => c[a].t - c[b].t)
        .slice(0, keys.length - 100)
        .forEach(k => delete c[k]);
  }
  _notamCacheWrite(c);
}


async function fetchNOTAMs(icao) {
  if (!icao || String(icao).length !== 4) {
    throw new Error('Invalid ICAO code');
  }
  const key = String(icao).toUpperCase().trim();

  const cached = _notamCacheGet(key);
  if (cached) return cached;

  // AutoRouter: itemas-parametri suodattaa ICAO/FIR-tasolla
  const itemas = encodeURIComponent(JSON.stringify([key]));
  const target = `https://api.autorouter.aero/v1.0/notam?itemas=${itemas}&offset=0&limit=100`;

  const headers = {};
  if (AUTOROUTER_KEY && AUTOROUTER_KEY !== 'ASETA_TÄHÄN_API_KEY') {
    headers['Authorization'] = `Bearer ${AUTOROUTER_KEY}`;
  }

  const resp = await fetch(_notamProxied(target), { headers });
  if (!resp.ok) throw new Error(`NOTAM HTTP ${resp.status}`);

  const raw = await resp.json();

  // AutoRouter palauttaa { rows: [...], rowcount: N } tai suoraan taulukon
  const list = Array.isArray(raw) ? raw
             : Array.isArray(raw?.rows) ? raw.rows
             : Array.isArray(raw?.notams) ? raw.notams
             : Array.isArray(raw?.data) ? raw.data
             : [];

  const normalized = list.map(n => _normalizeAutoRouterNOTAM(n, key))
    .filter(n => n && n.text);

  _notamCacheSet(key, normalized);
  return normalized;
}
window.fetchNOTAMs = fetchNOTAMs;

/* ---------------- Normalisoi yksi NOTAM ---------------- */
function _normalizeNOTAM(n, icao) {
  if (!n || typeof n !== 'object') return null;

  // PocketWorld saattaa käyttää eri kenttänimiä — tuetaan useita
  const id       = n.id || n.notamId || n.number || n.notamNumber || '';
  const text     = n.text || n.rawText || n.raw || n.message || n.notamText || '';
  const qline    = n.qline || n.qLine || n.q_line || '';
  const fir      = n.fir || n.FIR || '';
  const location = n.location || n.icao || n.icaoLocation || icao;
  const type     = n.type || n.notamType || '';
  const from     = n.from || n.effectiveStart || n.startDate || n.startTime || '';
  const to       = n.to   || n.effectiveEnd   || n.endDate   || n.endTime   || '';
  const purpose  = n.purpose || '';
  const scope    = n.scope || '';
  const lower    = n.lowerLimit || n.lower || '';
  const upper    = n.upperLimit || n.upper || '';
  const coord    = n.coordinates || n.coords || '';
  const radius   = n.radius || '';

  // Poimi ICAO tekstistä jos ei ole
  if (!location && text) {
    const m = String(text).match(/\b([A-Z]{4})\b/);
    if (m) location = m[1];
  }

  // Q-line parseri (jos qline on raakana)
  let qlineParsed = null;
  if (qline && typeof qline === 'string') {
    qlineParsed = _parseQLine(qline);
  }

  return {
    id: String(id),
    text: String(text),
    qline: String(qline),
    qlineParsed,
    fir: String(fir).toUpperCase(),
    location: String(location).toUpperCase(),
    type: String(type).toUpperCase(),
    from: from || '',
    to: to || '',
    purpose,
    scope,
    lowerLimit: lower,
    upperLimit: upper,
    coordinates: coord,
    radius
  };
}

/* ---------------- AutoRouter NOTAM -normalisointi ---------------- */
function _normalizeAutoRouterNOTAM(n, icao) {
  if (!n || typeof n !== 'object') return null;

  // AutoRouter-kentät (v1.0 API)
  const id       = n.id || n.notam_id || n.notamNumber || n.notamId || '';
  const text     = n.iteme || n.text || n.body || n.raw || n.itemE || '';
  const qline    = n.itemq || n.qline || n.qLine || '';
  const fir      = n.fir || n.itema || n.location || '';
  const location = n.itema || n.location || icao;
  const type     = n.type || n.notam_type || '';
  const from     = n.startvalidity || n.from || n.effective_start || n.start || '';
  const to       = n.endvalidity   || n.to   || n.effective_end   || n.end   || '';
  const lower    = n.lowerlimit || n.lower || n.itemf || '';
  const upper    = n.upperlimit || n.upper || n.itemg || '';
  const coord    = n.coordinates || n.coords || '';
  const radius   = n.radius || '';

  // Q-line parsed (jos saamme raakana)
  let qlineParsed = null;
  if (qline && typeof qline === 'string') {
    qlineParsed = _parseQLine(qline);
  }

  return {
    id: String(id),
    text: String(text),
    qline: String(qline),
    qlineParsed,
    fir: String(fir).toUpperCase(),
    location: String(location).toUpperCase(),
    type: String(type).toUpperCase(),
    from: from || '',
    to: to || '',
    lowerLimit: lower,
    upperLimit: upper,
    coordinates: coord,
    radius
  };
}

/* ---------------- Q-line parseri ---------------- */
function _parseQLine(q) {
  // ICAO Q-line: Q) KJFK/QMALC/IV/NBO/A/000/999/4038N07346W005
  // Esim: Q) UAAA/QMALC/IV/NBO/A/000/999/4315N07654E005
  try {
    const s = String(q).trim();
    // Poista "Q) " jos on
    const body = s.replace(/^Q\)\s*/, '');
    const parts = body.split('/');

    const q = parts[0] || '';  // esim. KJFK
    const code = parts[1] || ''; // esim. QMALC
    const traffic = parts[2] || ''; // IV
    const purpose = parts[3] || ''; // NBO
    const scope = parts[4] || ''; // A
    const lower = parts[5] || '';
    const upper = parts[6] || '';
    const coord = parts[7] || ''; // 4038N07346W
    const radius = parts[8] || '';

    // Pura coordinaatit: 4038N07346W → { lat: 40.633, lon: -73.766 }
    let lat = null, lon = null;
    const cm = coord.match(/^(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])$/);
    if (cm) {
      const latDeg = parseInt(cm[1], 10) + parseInt(cm[2], 10) / 60;
      const lonDeg = parseInt(cm[4], 10) + parseInt(cm[5], 10) / 60;
      lat = cm[3] === 'S' ? -latDeg : latDeg;
      lon = cm[6] === 'W' ? -lonDeg : lonDeg;
    }

    return {
      raw: s, icao: q, code, traffic, purpose, scope,
      lower, upper, coord, radius, lat, lon
    };
  } catch (e) {
    return { raw: String(q) };
  }
}

/* ---------------- Järjestä NOTAMit ---------------- */
function _sortNOTAMs(list) {
  return list.slice().sort((a, b) => {
    // 1) Kiireellisyys: NOTAMit joissa on "RWY" tai "CLSD" ensin
    const urgentA = /RWY|CLSD|CLOSED|FUEL|AVBL|U\/S/i.test(a.text) ? 1 : 0;
    const urgentB = /RWY|CLSD|CLOSED|FUEL|AVBL|U\/S/i.test(b.text) ? 1 : 0;
    if (urgentA !== urgentB) return urgentB - urgentA;

    // 2) Sitten voimassaoloajan mukaan (uusimmat ensin)
    const ta = new Date(a.from).getTime() || 0;
    const tb = new Date(b.from).getTime() || 0;
    return tb - ta;
  });
}

/* ---------------- Suodata vanhentuneet ---------------- */
function _filterActive(list) {
  const now = Date.now();
  return list.filter(n => {
    if (n.to) {
      const t = new Date(n.to).getTime();
      if (isFinite(t) && t < now) return false;
    }
    return true;
  });
}

/* ==============================================================
 * UI · NOTAM-lista
 * ============================================================== */

function _notamCategory(n) {
  const t = String(n.text || '').toUpperCase();
  const q = String(n.qline || '').toUpperCase();

  // Q-koodi kertoo tarkemmin kuin pelkkä teksti
  if (q.includes('/QR'))  return { k: 'RWY', l: 'Kiitotie', c: 'var(--error)' };
  if (q.includes('/QN'))  return { k: 'NAV', l: 'Navigointi', c: 'var(--accent)' };
  if (q.includes('/QF'))  return { k: 'SVC', l: 'Palvelut', c: 'var(--warning)' };
  if (q.includes('/QO'))  return { k: 'OBST', l: 'Este', c: 'var(--warning)' };
  if (q.includes('/QA'))  return { k: 'AIR', l: 'Ilmatila', c: 'var(--error)' };
  if (q.includes('/QC'))  return { k: 'COM', l: 'Viestintä', c: 'var(--accent)' };
  if (q.includes('/QW'))  return { k: 'WARN', l: 'Varoitus', c: 'var(--error)' };

  // Fallback tekstianalyysiin
  if (/RWY|TWY|APRON|STAND|CLSD|CLOSED/.test(t)) return { k: 'RWY', l: 'Kiitotie', c: 'var(--error)' };
  if (/NAV|VOR|NDB|ILS|GPS|GNSS|DME|TACAN/.test(t)) return { k: 'NAV', l: 'Navigointi', c: 'var(--accent)' };
  if (/FUEL|AVBL|U\/S|SERVICE/.test(t)) return { k: 'SVC', l: 'Palvelut', c: 'var(--warning)' };
  if (/OBST|CRANE|TOWER/.test(t)) return { k: 'OBST', l: 'Este', c: 'var(--warning)' };
  if (/AIRSPACE|TFR|RESTRICTED|PROHIBITED/.test(t)) return { k: 'AIR', l: 'Ilmatila', c: 'var(--error)' };
  if (/COM|FREQ|ATIS/.test(t)) return { k: 'COM', l: 'Viestintä', c: 'var(--accent)' };
  return { k: 'GEN', l: 'Yleinen', c: 'var(--dim)' };
}

function _fmtNotamTime(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (isNaN(d)) {
    // Yritä NOTAM-muotoa YYMMDDHHMM
    const s = String(iso).replace(/\D/g, '');
    if (s.length === 10) {
      const yy = parseInt(s.slice(0, 2), 10);
      const mo = parseInt(s.slice(2, 4), 10) - 1;
      const dd = parseInt(s.slice(4, 6), 10);
      const hh = parseInt(s.slice(6, 8), 10);
      const mm = parseInt(s.slice(8, 10), 10);
      const year = yy > 50 ? 1900 + yy : 2000 + yy;
      return new Date(year, mo, dd, hh, mm).toLocaleString();
    }
    return String(iso);
  }
  return d.toLocaleString();
}

function _renderNotamList(container, notams, icao) {
  if (!container) return;

  if (!notams || !notams.length) {
    container.innerHTML = `
      <div class="notam-empty">
        <div style="font-size:32px; margin-bottom:8px;">✓</div>
        <div style="font-weight:600; color:var(--success);">Ei aktiivisia NOTAMeja</div>
        <div style="font-size:12px; color:var(--dim); margin-top:4px;">
          ${icao || ''}
        </div>
      </div>`;
    return;
  }

  const sorted = _sortNOTAMs(_filterActive(notams));

  const html = sorted.map(n => {
    const cat = _notamCategory(n);
    const isUrgent = /RWY|CLSD|CLOSED/.test(n.text);
    return `
      <div class="notam-item ${isUrgent ? 'notam-urgent' : ''}"
           style="border-left-color: ${cat.c};">
        <div class="notam-head">
          <span class="notam-cat" style="color:${cat.c}; border-color:${cat.c};">
            ${cat.l}
          </span>
          ${n.id ? `<span class="notam-id">${_esc(n.id)}</span>` : ''}
          ${n.fir ? `<span class="notam-fir">${_esc(n.fir)}</span>` : ''}
        </div>
        <div class="notam-text">${_highlightNotam(n.text)}</div>
        <div class="notam-meta">
          <span>📅 ${_fmtNotamTime(n.from)}</span>
          <span>→ ${_fmtNotamTime(n.to)}</span>
          ${n.lowerLimit || n.upperLimit
            ? `<span>↕ ${_esc(n.lowerLimit || '–')} / ${_esc(n.upperLimit || '–')}</span>`
            : ''}
        </div>
      </div>`;
  }).join('');

  container.innerHTML = html;
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* Korosta kriittiset sanat NOTAM-tekstissä */
function _highlightNotam(text) {
  const esc = _esc(text);
  const keys = [
    'CLSD','CLOSED','U/S','UNSERVICEABLE','NOT AVBL','FUEL','RWY',
    'RESTRICTED','PROHIBITED','TFR','CAUTION','HAZARD','OBST'
  ];
  let out = esc;
  for (const k of keys) {
    const re = new RegExp(`\\b${k}\\b`, 'gi');
    out = out.replace(re, m =>
      `<span style="color:var(--error); font-weight:700;">${m}</span>`);
  }
  return out;
}

/* ==============================================================
 * Sää-välilehden NOTAM-osio
 * ============================================================== */
async function loadNOTAMsForStation(icao) {
  const container = document.getElementById('notam-output');
  if (!container) return;

  const code = String(icao || '').toUpperCase().trim();
  if (code.length !== 4) {
    container.innerHTML = `<div class="empty">Anna 4-kirjaiminen ICAO-koodi.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="notam-loading">
      <div class="loader-spinner"><span></span><span></span><span></span></div>
      <div style="margin-top:8px; font-size:13px; color:var(--dim);">
        Haetaan NOTAMeja ${code}…
      </div>
    </div>`;

  try {
    const notams = await fetchNOTAMs(code);
    _renderNotamList(container, notams, code);
  } catch (err) {
    console.error('[NOTAM] load failed:', err);
    container.innerHTML = `
      <div class="notam-error">
        <div style="font-size:24px; margin-bottom:6px;">⚠</div>
        <div style="font-weight:600; color:var(--error);">NOTAM-haku epäonnistui</div>
        <div style="font-size:12px; color:var(--dim); margin-top:4px;">
          ${_esc(err.message)}
        </div>
      </div>`;
  }
}
window.loadNOTAMsForStation = loadNOTAMsForStation;

/* ==============================================================
 * Kotisivun NOTAM-widget
 * ============================================================== */
async function loadHomeNOTAMs(icao) {
  const container = document.getElementById('notam-list');
  if (!container) return;

  const code = String(icao || '').toUpperCase().trim();
  if (code.length !== 4) return;

  container.innerHTML = `
    <div class="notam-loading">
      <div class="loader-spinner"><span></span><span></span><span></span></div>
    </div>`;

  try {
    const notams = await fetchNOTAMs(code);
    const active = _filterActive(notams);
    if (!active.length) {
      container.innerHTML = `
        <div class="notam-empty" style="padding:20px; text-align:center;">
          <div style="font-size:22px; color:var(--success);">✓</div>
          <div style="font-size:12px; color:var(--dim); margin-top:4px;">
            Ei aktiivisia NOTAMeja · ${code}
          </div>
        </div>`;
      return;
    }

    // Näytä korkeintaan 3 tärkeintä
    const sorted = _sortNOTAMs(active).slice(0, 3);
    container.innerHTML = sorted.map(n => {
      const cat = _notamCategory(n);
      const isUrgent = /RWY|CLSD|CLOSED|U\/S/.test(n.text);
      return `
        <div class="notam-item ${isUrgent ? 'notam-urgent' : ''}"
             style="border-left-color: ${cat.c};">
          <div class="notam-head">
            <span class="notam-cat" style="color:${cat.c}; border-color:${cat.c};">
              ${cat.l}
            </span>
            <span class="notam-fir">${_esc(n.fir || code)}</span>
          </div>
          <div class="notam-text" style="font-size:12.5px;">
            ${_highlightNotam(_truncate(n.text, 180))}
          </div>
        </div>`;
    }).join('');

    // Jos enemmän kuin 3, näytä "Näytä kaikki" -nappi
    if (active.length > 3) {
      container.insertAdjacentHTML('beforeend', `
        <button class="btn-ghost" style="width:100%; margin-top:8px; font-size:12px;"
          onclick="switchTab('weather'); document.getElementById('wx-icao').value='${code}'; loadWeatherForStation();">
          Näytä kaikki (${active.length}) →
        </button>`);
    }
  } catch (err) {
    console.warn('[Home NOTAM]', err);
    container.innerHTML = `
      <div style="font-size:12px; color:var(--dim); padding:12px; text-align:center;">
        NOTAMit eivät ole saatavilla juuri nyt.
      </div>`;
  }
}
window.loadHomeNOTAMs = loadHomeNOTAMs;

function _truncate(s, max) {
  const str = String(s || '');
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}