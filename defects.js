/* ==============================================================
 * AIRCRAFT DEFECTS · ADD / CDD
 * ==============================================================
 * - Hakee koneen viat Skyplan defect-reports API:sta
 * - Cachettaa offline-käyttöön
 * - XSS-suojattu (kaikki käyttäjän/API:n data escapetaan)
 * - Race-safe (generaatiotarkistus)
 * - In-flight dedup (vain yksi pyyntö per tail)
 * - Fetch-timeout 15 s
 * - Joustava API-vastauksen käsittely
 * ============================================================== */
'use strict';

const ADD_CACHE_PREFIX      = 'add_cache_';
const ADD_CACHE_TIME_PREFIX = 'add_cache_time_';
const DEF_FETCH_TIMEOUT_MS  = 15000;

/* In-flight dedup */
const _defInFlight = new Map();   // tailNumber → Promise

/* Race-condition esto */
let _defPopupGen       = 0;
let _defCardGen        = 0;

/* ==============================================================
 * Apurit
 * ============================================================== */
function _defEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _defField(item, ...keys) {
  if (!item || typeof item !== 'object') return null;
  for (const k of keys) {
    const v = item[k];
    if (v == null) continue;
    if (typeof v === 'object') {
      // Purkaa yleinen {value: x} / {name: x} -muoto
      const inner = v.value ?? v.name ?? v.text ?? v.code ?? null;
      if (inner != null && String(inner).trim() !== '') return String(inner).trim();
      continue;
    }
    const s = String(v).trim();
    if (s !== '' && s !== '[object Object]') return s;
  }
  return null;
}

/* ==============================================================
 * Hae viat
 * ============================================================== */
async function fetchAircraftDefects(tailNumber) {
  if (!tailNumber || tailNumber === '-' || tailNumber === 'TBA') return [];

  const cleanTail = String(tailNumber).trim().toUpperCase();
  const cacheKey = ADD_CACHE_PREFIX + cleanTail;

  // 1. Cache
  let cachedDefects = null;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) cachedDefects = JSON.parse(raw);
  } catch (e) {}

  // 2. Offline → palauta cache
  if (!navigator.onLine) {
    return Array.isArray(cachedDefects) ? cachedDefects : [];
  }

  // 3. In-flight dedup
  if (_defInFlight.has(cleanTail)) {
    return await _defInFlight.get(cleanTail);
  }

  const p = (async () => {
    // 4. Token
    const token = (typeof getValidSkyplanToken === 'function')
      ? await getValidSkyplanToken().catch(() => null)
      : null;
    if (!token) return Array.isArray(cachedDefects) ? cachedDefects : [];

    // 5. Fetch + timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEF_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch('https://kcskyplanapi.airastana.com/api/v1/defect-reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ TailNumbers: [cleanTail] }),
        signal: controller.signal
      }).catch(() => null);

      if (!response || !response.ok) {
        console.warn(`[ADD] HTTP ${response?.status || 'network error'} — käytetään cachea`);
        return Array.isArray(cachedDefects) ? cachedDefects : [];
      }

      const data = await response.json();

      // 6. Joustava vastauksen käsittely
      let defects = [];
      if (Array.isArray(data)) {
        defects = data;
      } else if (Array.isArray(data.DefectReports)) {
        defects = data.DefectReports;
      } else if (Array.isArray(data.defectReports)) {
        defects = data.defectReports;
      } else if (Array.isArray(data.Results)) {
        defects = data.Results;
      } else if (Array.isArray(data.Data)) {
        defects = data.Data;
      } else {
        console.warn('[ADD] Tuntematon API-vastausmuoto. Keys:', Object.keys(data || {}));
      }

      // 7. Tallenna cache
      try {
        localStorage.setItem(cacheKey, JSON.stringify(defects));
        localStorage.setItem(ADD_CACHE_TIME_PREFIX + cleanTail, new Date().toISOString());
      } catch (e) {}

      return defects;
    } catch (e) {
      if (e.name === 'AbortError') {
        console.warn('[ADD] Timeout — käytetään cachea');
      } else {
        console.warn('[ADD] fetch failed:', e.message);
      }
      return Array.isArray(cachedDefects) ? cachedDefects : [];
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  _defInFlight.set(cleanTail, p);
  try {
    return await p;
  } finally {
    _defInFlight.delete(cleanTail);
  }
}

/* ==============================================================
 * Renderöi taulukko HTML:na (kaikki escapettu)
 * ============================================================== */
function renderDefectsTableHTML(defects, tailNumber) {
  const safeTail = _defEsc(tailNumber || '');

  if (!defects || !defects.length) {
    return `
      <div class="def-empty">
        <span class="def-empty-icon">✓</span>
        <span class="def-empty-text">Ei aktiivisia ADD / CDD -kohteita</span>
        ${safeTail ? `<span class="def-empty-tail">${safeTail}</span>` : ''}
      </div>`;
  }

  const fmtDate = (s) => {
    if (!s) return '–';
    const d = new Date(s);
    if (isNaN(d.getTime())) return _defEsc(String(s).split('T')[0]);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(-2)}`;
  };

  const rows = defects.map(item => {
    const type = _defField(item, 'DefectType', 'defectType', 'Type', 'type') || 'ADD';
    const typeClass = String(type).toUpperCase() === 'CDD' ? 'def-badge-cdd' : 'def-badge-add';
    const safeType = _defEsc(type);

    const chapter = _defField(item, 'Chapter', 'chapter', 'ATA', 'ata', 'AtaChapter');
    const ata = chapter ? `ATA ${_defEsc(chapter)}` : '–';

    // MEL — laaja fallback-ketju
    const melCat = _defField(item, 'Mel', 'MEL', 'mel');
    const melNum = _defField(item, 'MelNumber', 'MELNumber', 'melNumber');

    let mel;
    if (melCat && melNum) {
      mel = `<span class="def-mel-cat">${_defEsc(melCat)}</span> <span class="def-mel-num">${_defEsc(melNum)}</span>`;
    } else if (melCat) {
      mel = `<span class="def-mel-cat">${_defEsc(melCat)}</span>`;
    } else if (melNum) {
      mel = `<span class="def-mel-num">${_defEsc(melNum)}</span>`;
    } else {
      mel = '–';
    }

    const defect = _defField(item, 'Defect', 'defect', 'Title', 'title', 'Subject') || '';
    const desc   = _defField(item, 'Description', 'description', 'Desc', 'Text', 'DefectText') || '–';
    const deferDate = fmtDate(_defField(item, 'DeferDate', 'deferDate', 'DeferredDate'));
    const dueDate   = fmtDate(_defField(item, 'DeferToDate', 'deferToDate', 'DueDate', 'ExpiryDate'));
    const notes     = _defField(item, 'DeferNotes', 'deferNotes', 'Notes', 'notes', 'Remark', 'Remarks') || '–';

    return `
      <tr>
        <td><span class="def-badge ${typeClass}">${safeType}</span></td>
        <td class="def-ata">${ata}</td>
        <td class="def-mel">${mel}</td>
        <td class="def-desc">${defect ? `<strong>${_defEsc(defect)}</strong><br>` : ''}${_defEsc(desc)}</td>
        <td class="def-date">${deferDate}</td>
        <td class="def-date def-due">${dueDate}</td>
        <td class="def-notes">${_defEsc(notes)}</td>
      </tr>`;
  }).join('');

  return `
    <div class="def-table-wrap">
      <table class="def-table">
        <thead>
          <tr>
            <th>Tyyppi</th>
            <th>ATA</th>
            <th>MEL</th>
            <th>Vika</th>
            <th>Defer</th>
            <th>Due</th>
            <th>Huomiot</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="def-footer">
        ${defects.length} ${defects.length === 1 ? 'kohde' : 'kohdetta'} · ${safeTail}
      </div>
    </div>`;
}

/* ==============================================================
 * Popup Kotisivulta
 * ============================================================== */
async function showDefectsPopup(tailNumber) {
  if (!tailNumber || tailNumber === '-' || tailNumber === 'TBA') {
    if (typeof showToast === 'function') showToast('Ei konerekisteriä.', 'warning');
    return;
  }

  const cleanTail = String(tailNumber).trim().toUpperCase();
  const myGen = ++_defPopupGen;

  const existing = document.getElementById('defects-popup');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'defects-popup';
  overlay.className = 'rcp-overlay';
  overlay.innerHTML = `
    <div class="rcp-dialog" style="max-width:960px;">
      <div class="rcp-head">
        <div class="rcp-icon">🔧</div>
        <div class="rcp-title">
          <div class="rcp-title-main">${_defEsc(cleanTail)}</div>
          <div class="rcp-title-sub">ADD / CDD</div>
        </div>
        <button class="rcp-close" type="button" aria-label="Sulje">✕</button>
      </div>
      <div class="rcp-body" id="defects-popup-body">
        <div class="def-loading">
          <div class="loader-spinner" style="transform:scale(0.7);"><span></span><span></span><span></span></div>
          <span style="font-size:12px; color:var(--dim);">Haetaan vikoja…</span>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.style.pointerEvents = 'none';
  setTimeout(() => { overlay.style.pointerEvents = ''; }, 400);

  const close = () => {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 200);
  };
  overlay.querySelector('.rcp-close').addEventListener('click', close);

  requestAnimationFrame(() => overlay.classList.add('visible'));

  try {
    const defects = await fetchAircraftDefects(cleanTail);

    // Race-tarkistus: onko uusi popup avattu tai onko tämä suljettu?
    if (myGen !== _defPopupGen) return;
    const body = document.getElementById('defects-popup-body');
    if (!body || !overlay.isConnected) return;

    body.innerHTML = renderDefectsTableHTML(defects, cleanTail);
  } catch (e) {
    if (myGen !== _defPopupGen) return;
    const body = document.getElementById('defects-popup-body');
    if (!body) return;
    body.innerHTML = `<div class="def-error">Vikojen haku epäonnistui: ${_defEsc(e.message)}</div>`;
  }
}

/* ==============================================================
 * Kortti Briefing-sivulle
 * ============================================================== */
async function renderDefectsCardContent(containerId, tailNumber) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!tailNumber || tailNumber === '-' || tailNumber === 'TBA') {
    el.innerHTML = '<div class="empty">Ei konerekisteriä</div>';
    return;
  }

  const cleanTail = String(tailNumber).trim().toUpperCase();
  const myGen = ++_defCardGen;

  el.innerHTML = `
    <div class="def-loading">
      <div class="loader-spinner" style="transform:scale(0.7);"><span></span><span></span><span></span></div>
      <span style="font-size:12px; color:var(--dim);">Haetaan vikoja…</span>
    </div>`;

  try {
    const defects = await fetchAircraftDefects(cleanTail);

    // Race-tarkistus
    if (myGen !== _defCardGen) return;
    if (!el.isConnected) return;

    el.innerHTML = renderDefectsTableHTML(defects, cleanTail);
  } catch (e) {
    if (myGen !== _defCardGen) return;
    if (!el.isConnected) return;
    el.innerHTML = `<div class="def-error">Vikojen haku epäonnistui: ${_defEsc(e.message)}</div>`;
  }
}

/* ==============================================================
 * Expose
 * ============================================================== */
window.fetchAircraftDefects      = fetchAircraftDefects;
window.showDefectsPopup          = showDefectsPopup;
window.renderDefectsCardContent  = renderDefectsCardContent;
window.renderDefectsTableHTML    = renderDefectsTableHTML;

/* ==============================================================
 * Debug-apuri
 * ============================================================== */
window.debugDefects = async function(tailNumber) {
  const t = tailNumber || 'EI-KDD';
  const raw = await fetchAircraftDefects(t);
  console.log(`[Defects debug] ${t}: ${raw.length} kohdetta`);
  if (!raw.length) return raw;

  console.log('--- Kaikkien itemien MEL-kentät ---');
  raw.forEach((item, i) => {
    console.log(`#${i}:`, {
      DefectType: item.DefectType,
      Chapter:    item.Chapter,
      Mel:        item.Mel,
      MelNumber:  item.MelNumber,
      DefectItem: item.DefectItem,
      Defect:     item.Defect,
      Desc:       item.Description
    });
  });

  console.table(raw.map(i => ({
    Type:       i.DefectType,
    Chapter:    i.Chapter,
    Mel:        i.Mel,
    MelNumber:  i.MelNumber,
    DefectItem: i.DefectItem
  })));

  return raw;
};