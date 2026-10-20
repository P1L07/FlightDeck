/* ==============================================================
 * NOTAM MODULE · AutoRouter API (proxyn kautta)
 * ==============================================================
 * - Hakee NOTAMit AutoRouter API:sta Worker-proxyn kautta
 * - 15 min TTL + 72 h stale-fallback
 * - Q-line parseri + kategorisointi
 * - Stale-cache fallback kun API epäonnistuu
 * - Dynaaminen AUTOROUTER_KEY (ei const)
 * ============================================================== */
'use strict';

const NOTAM_CACHE_KEY = 'notam_cache_v1';
const NOTAM_CACHE_TTL = 15 * 60 * 1000;    // 15 min
const NOTAM_MAX_AGE   = 72 * 60 * 60 * 1000; // 72 h (stale fallback)

/* ==============================================================
 * AutoRouter-avaimen hallinta
 * ============================================================== */
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
    if (typeof showToast === 'function') {
      showToast('AutoRouter-avain tallennettu.', 'success');
    }
  } catch (e) {
    if (typeof showToast === 'function') {
      showToast('Tallennus epäonnistui.', 'error');
    }
  }
}
window.saveAutoRouterKey = saveAutoRouterKey;

/* ==============================================================
 * Proxy
 * ============================================================== */
function _notamProxied(targetUrl) {
  const base = (typeof WX_PROXY !== 'undefined' && WX_PROXY)
    ? WX_PROXY
    : 'https://wx-proxy.janri-kallas.workers.dev';
  return `${base}/?url=${encodeURIComponent(targetUrl)}`;
}


/* ==============================================================
 * Hae NOTAMit
 * ============================================================== */
async function fetchNOTAMs(icao) {
  if (!icao || String(icao).length !== 4) {
    throw new Error('Invalid ICAO code');
  }
  const key = String(icao).toUpperCase().trim();

  // 1. Fresh cache
  const cached = _notamCacheGet(key);
  if (cached) return cached;

  // 2. Hae dynaaminen AutoRouter-avain (ei enää const!)
  const autorouterKey = _loadAutoRouterKey();

  const itemas = encodeURIComponent(JSON.stringify([key]));
  const target = `https://api.autorouter.aero/v1.0/notam?itemas=${itemas}&offset=0&limit=100`;

  const headers = {};
  if (autorouterKey && autorouterKey !== 'ASETA_TÄHÄN_API_KEY') {
    headers['Authorization'] = `Bearer ${autorouterKey}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const resp = await fetch(_notamProxied(target), {
      headers,
      signal: controller.signal
    });

    if (!resp.ok) throw new Error(`NOTAM HTTP ${resp.status}`);

    const raw = await resp.json();

    // Joustava vastauksen käsittely
    const list = Array.isArray(raw) ? raw
               : Array.isArray(raw?.rows) ? raw.rows
               : Array.isArray(raw?.notams) ? raw.notams
               : Array.isArray(raw?.data) ? raw.data
               : [];

    const normalized = list
      .map(n => _normalizeAutoRouterNOTAM(n, key))
      .filter(n => n && n.text);

    _notamCacheSet(key, normalized);
    return normalized;
  } catch (e) {
    // 3. Stale-cache fallback
    const stale = _notamCacheGetStale(key);
    if (stale) {
      console.warn(`[NOTAM] Fetch epäonnistui (${e.message}) — käytetään stale-cachea`);
      return stale;
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}
window.fetchNOTAMs = fetchNOTAMs;

/* ==============================================================
 * Normalisoi AutoRouter NOTAM
 * ============================================================== */
function _normalizeAutoRouterNOTAM(n, icao) {
  if (!n || typeof n !== 'object') return null;

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

/* ==============================================================
 * Q-line parseri
 * ==============================================================
 * KORJATTU: käyttää eri muuttujanimiä sisäkkäisessä scopessa
 * (aiemmin `const q = parts[0]` shadowasi parametrin `q` → SyntaxError)
 * ============================================================== */
function _parseQLine(qline) {
  try {
    const s = String(qline).trim();
    const body = s.replace(/^Q\)\s*/, '');
    const parts = body.split('/');

    const icaoPart = parts[0] || '';
    const code     = parts[1] || '';
    const traffic  = parts[2] || '';
    const purpose  = parts[3] || '';
    const scope    = parts[4] || '';
    const lower    = parts[5] || '';
    const upper    = parts[6] || '';
    const coord    = parts[7] || '';
    const radius   = parts[8] || '';

    // Pura koordinaatit: 4038N07346W → { lat, lon }
    let lat = null, lon = null;
    const cm = coord.match(/^(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])$/);
    if (cm) {
      const latDeg = parseInt(cm[1], 10) + parseInt(cm[2], 10) / 60;
      const lonDeg = parseInt(cm[4], 10) + parseInt(cm[5], 10) / 60;
      lat = cm[3] === 'S' ? -latDeg : latDeg;
      lon = cm[6] === 'W' ? -lonDeg : lonDeg;
    }

    return {
      raw: s,
      icao: icaoPart,
      code,
      traffic,
      purpose,
      scope,
      lower,
      upper,
      coord,
      radius,
      lat,
      lon
    };
  } catch (e) {
    return { raw: String(qline) };
  }
}

/* ==============================================================
 * Järjestä ja suodata
 * ============================================================== */
function _sortNOTAMs(list) {
  return list.slice().sort((a, b) => {
    const urgentA = /RWY|CLSD|CLOSED|FUEL|AVBL|U\/S/i.test(a.text) ? 1 : 0;
    const urgentB = /RWY|CLSD|CLOSED|FUEL|AVBL|U\/S/i.test(b.text) ? 1 : 0;
    if (urgentA !== urgentB) return urgentB - urgentA;

    const ta = new Date(a.from).getTime() || 0;
    const tb = new Date(b.from).getTime() || 0;
    return tb - ta;
  });
}

/* Parsi NOTAM-muotoinen aikaleima (YYMMDDHHMM) */
function _parseNotamTime(str) {
  if (!str) return NaN;
  const s = String(str).replace(/\D/g, '');
  if (s.length === 10) {
    const yy = parseInt(s.slice(0, 2), 10);
    const mo = parseInt(s.slice(2, 4), 10) - 1;
    const dd = parseInt(s.slice(4, 6), 10);
    const hh = parseInt(s.slice(6, 8), 10);
    const mm = parseInt(s.slice(8, 10), 10);
    const year = yy > 50 ? 1900 + yy : 2000 + yy;
    return new Date(year, mo, dd, hh, mm).getTime();
  }
  return NaN;
}

function _notamToTimeMs(str) {
  if (!str) return NaN;
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.getTime();
  return _parseNotamTime(str);
}

function _filterActive(list) {
  const now = Date.now();
  return list.filter(n => {
    if (!n.to) return true;
    const t = _notamToTimeMs(n.to);
    if (isFinite(t) && t < now) return false;
    return true;
  });
}

/* ==============================================================
 * Kategorisointi (Q-koodi + fallback)
 * ============================================================== */
function _notamCategory(n) {
  const t = String(n.text || '').toUpperCase();
  const code = (n.qlineParsed?.code || '').toUpperCase();
  const q = String(n.qline || '').toUpperCase();

  // 1. Q-koodi (parsittu)
  if (code) {
    if (code.startsWith('QR')) return { k: 'RWY',  l: 'Kiitotie',   c: 'var(--error)' };
    if (code.startsWith('QL')) return { k: 'LGT',  l: 'Valot',      c: 'var(--warning)' };
    if (code.startsWith('QN')) return { k: 'NAV',  l: 'Navigointi', c: 'var(--accent)' };
    if (code.startsWith('QF')) return { k: 'SVC',  l: 'Palvelut',   c: 'var(--warning)' };
    if (code.startsWith('QO')) return { k: 'OBST', l: 'Este',       c: 'var(--warning)' };
    if (code.startsWith('QA')) return { k: 'AIR',  l: 'Ilmatila',   c: 'var(--error)' };
    if (code.startsWith('QC')) return { k: 'COM',  l: 'Viestintä',  c: 'var(--accent)' };
    if (code.startsWith('QS') || code.startsWith('QW')) {
      return { k: 'WARN', l: 'Varoitus', c: 'var(--error)' };
    }
  }

  // 2. Q-koodi raakana
  if (/\/QR/.test(q)) return { k: 'RWY',  l: 'Kiitotie',   c: 'var(--error)' };
  if (/\/QN/.test(q)) return { k: 'NAV',  l: 'Navigointi', c: 'var(--accent)' };
  if (/\/QF/.test(q)) return { k: 'SVC',  l: 'Palvelut',   c: 'var(--warning)' };
  if (/\/QO/.test(q)) return { k: 'OBST', l: 'Este',       c: 'var(--warning)' };
  if (/\/QA/.test(q)) return { k: 'AIR',  l: 'Ilmatila',   c: 'var(--error)' };
  if (/\/QC/.test(q)) return { k: 'COM',  l: 'Viestintä',  c: 'var(--accent)' };
  if (/\/QW|\/QS/.test(q)) return { k: 'WARN', l: 'Varoitus', c: 'var(--error)' };

  // 3. Teksti-fallback
  if (/RWY|TWY|APRON|STAND|CLSD|CLOSED/.test(t)) return { k: 'RWY',  l: 'Kiitotie',   c: 'var(--error)' };
  if (/NAV|VOR|NDB|ILS|GPS|GNSS|DME|TACAN/.test(t)) return { k: 'NAV', l: 'Navigointi', c: 'var(--accent)' };
  if (/FUEL|AVBL|U\/S|SERVICE/.test(t))          return { k: 'SVC',  l: 'Palvelut',   c: 'var(--warning)' };
  if (/OBST|CRANE|TOWER/.test(t))                return { k: 'OBST', l: 'Este',       c: 'var(--warning)' };
  if (/AIRSPACE|TFR|RESTRICTED|PROHIBITED/.test(t)) return { k: 'AIR', l: 'Ilmatila', c: 'var(--error)' };
  if (/COM|FREQ|ATIS/.test(t))                   return { k: 'COM',  l: 'Viestintä',  c: 'var(--accent)' };

  return { k: 'GEN', l: 'Yleinen', c: 'var(--dim)' };
}

/* ==============================================================
 * Formatointi
 * ============================================================== */
function _fmtNotamTime(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (!isNaN(d.getTime())) return d.toLocaleString();

  // NOTAM-muoto YYMMDDHHMM
  const ms = _parseNotamTime(iso);
  if (isFinite(ms)) return new Date(ms).toLocaleString();

  return String(iso);
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _highlightNotam(text) {
  const esc = _esc(text);
  const keys = [
    'CLSD', 'CLOSED', 'U/S', 'UNSERVICEABLE', 'NOT AVBL', 'FUEL', 'RWY',
    'RESTRICTED', 'PROHIBITED', 'TFR', 'CAUTION', 'HAZARD', 'OBST'
  ];
  let out = esc;
  for (const k of keys) {
    const escapedKey = k.replace(/[/\\^$.*+?()[\]{}|]/g, '\\$&');
    const re = new RegExp(`\\b${escapedKey}\\b`, 'gi');
    out = out.replace(re, m =>
      `<span style="color:var(--error); font-weight:700;">${m}</span>`);
  }
  return out;
}

function _truncate(s, max) {
  const str = String(s || '');
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

/* ==============================================================
 * NOTAM-listan renderöinti
 * ============================================================== */
function _renderNotamList(container, notams, icao) {
  if (!container) return;

  if (!notams || !notams.length) {
    container.innerHTML = `
      <div class="notam-empty">
        <div style="font-size:32px; margin-bottom:8px;">✓</div>
        <div style="font-weight:600; color:var(--success);">Ei aktiivisia NOTAMeja</div>
        <div style="font-size:12px; color:var(--dim); margin-top:4px;">
          ${_esc(icao || '')}
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
        Haetaan NOTAMeja ${_esc(code)}…
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
            Ei aktiivisia NOTAMeja · ${_esc(code)}
          </div>
        </div>`;
      return;
    }

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

    if (active.length > 3) {
      // Turvallinen onclick: käytetään data-attribuuttia + erillistä
      // addEventListeneriä (ei inline-onclick, ei XSS-riskiä)
      const btn = document.createElement('button');
      btn.className = 'btn-ghost';
      btn.style.cssText = 'width:100%; margin-top:8px; font-size:12px;';
      btn.textContent = `Näytä kaikki (${active.length}) →`;
      btn.dataset.icao = code;
      btn.addEventListener('click', () => {
        if (typeof switchTab === 'function') switchTab('weather');
        const input = document.getElementById('wx-icao');
        if (input) input.value = btn.dataset.icao;
        if (typeof loadWeatherForStation === 'function') loadWeatherForStation();
        if (typeof loadNOTAMsForStation === 'function') {
          loadNOTAMsForStation(btn.dataset.icao);
        }
      });
      container.appendChild(btn);
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