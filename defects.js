/* ==============================================================
 * AIRCRAFT DEFECTS · ADD / CDD
 * ==============================================================
 * Hakee koneen viat Skyplanin defect-reports API:sta.
 * - Cachettaa offline-käyttöön
 * - Popup Kotisivun konerekisteristä klikkaamalla
 * - Kortti Briefing-sivulla NOTAMien jälkeen
 * ============================================================== */

const ADD_CACHE_PREFIX      = 'add_cache_';
const ADD_CACHE_TIME_PREFIX = 'add_cache_time_';

/* ---------------- Kenttien poiminta usealla fallbackilla ---------------- */
function _defField(item, ...keys) {
  if (!item || typeof item !== 'object') return null;
  for (const k of keys) {
    const v = item[k];
    if (v != null && String(v).trim() !== '') return v;
  }
  return null;
}

/* ---------------- Hae viat ---------------- */
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
    console.log(`[ADD Offline] Cache ${cleanTail}: ${cachedDefects?.length || 0} kohdetta`);
    return cachedDefects || [];
  }

  // 3. Token
  const token = (typeof getValidSkyplanToken === 'function')
    ? await getValidSkyplanToken().catch(() => null)
    : null;
  if (!token) return cachedDefects || [];

  try {
    const response = await fetch('https://kcskyplanapi.airastana.com/api/v1/defect-reports', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ TailNumbers: [cleanTail] })
    }).catch(() => null);

    if (!response || !response.ok) {
      console.warn(`[ADD] HTTP ${response?.status || 'network error'} — käytetään cachea`);
      return cachedDefects || [];
    }

    const data = await response.json();
    const defects = Array.isArray(data.DefectReports) ? data.DefectReports : [];

    // 4. Tallenna cache
    try {
      localStorage.setItem(cacheKey, JSON.stringify(defects));
      localStorage.setItem(ADD_CACHE_TIME_PREFIX + cleanTail, new Date().toISOString());
    } catch (e) {}

    return defects;
  } catch (e) {
    console.warn('[ADD] fetch failed:', e.message);
    return cachedDefects || [];
  }
}

/* ---------------- Renderöi taulukko HTML:na ---------------- */
function renderDefectsTableHTML(defects, tailNumber) {
  if (!defects || !defects.length) {
    return `
      <div class="def-empty">
        <span class="def-empty-icon">✓</span>
        <span class="def-empty-text">Ei aktiivisia ADD / CDD -kohteita</span>
        ${tailNumber ? `<span class="def-empty-tail">${tailNumber}</span>` : ''}
      </div>`;
  }

  const fmtDate = (s) => {
    if (!s) return '–';
    const d = new Date(s);
    if (isNaN(d.getTime())) return String(s).split('T')[0];
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(-2)}`;
  };

  const rows = defects.map(item => {
    const type = _defField(item, 'DefectType', 'defectType', 'Type', 'type') || 'ADD';
    const typeClass = String(type).toUpperCase() === 'CDD' ? 'def-badge-cdd' : 'def-badge-add';

    const chapter = _defField(item, 'Chapter', 'chapter', 'ATA', 'ata', 'AtaChapter');
    const ata = chapter ? `ATA ${chapter}` : '–';

    // MEL — laaja fallback-ketju
    const melCat = _defField(item, 'Mel', 'MEL', 'mel');
    const melNum = _defField(item, 'MelNumber', 'MELNumber', 'melNumber');
    const melItem = _defField(item, 'MelItem', 'MelRef', 'MelCode', 'DefectItem');

    // Rakenna näytettävä merkkijono
    let mel;
    if (melCat && melNum) {
      mel = `<span class="def-mel-cat">${melCat}</span> <span class="def-mel-num">${melNum}</span>`;
    } else if (melCat) {
      mel = `<span class="def-mel-cat">${melCat}</span>`;
    } else if (melNum) {
      mel = `<span class="def-mel-num">${melNum}</span>`;
    } else {
      mel = '–';
    }

    const defect = _defField(item, 'Defect', 'defect', 'Title', 'title', 'Subject') || '';
    const desc = _defField(item, 'Description', 'description', 'Desc', 'Text', 'DefectText') || '–';
    const deferDate = fmtDate(_defField(item, 'DeferDate', 'deferDate', 'DeferredDate'));
    const dueDate = fmtDate(_defField(item, 'DeferToDate', 'deferToDate', 'DueDate', 'ExpiryDate'));
    const notes = _defField(item, 'DeferNotes', 'deferNotes', 'Notes', 'notes', 'Remark', 'Remarks') || '–';

    return `
      <tr>
        <td><span class="def-badge ${typeClass}">${type}</span></td>
        <td class="def-ata">${ata}</td>
        <td class="def-mel">${mel}</td>
        <td class="def-desc">${defect ? `<strong>${defect}</strong><br>` : ''}${desc}</td>
        <td class="def-date">${deferDate}</td>
        <td class="def-date def-due">${dueDate}</td>
        <td class="def-notes">${notes}</td>
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
        ${defects.length} ${defects.length === 1 ? 'kohde' : 'kohdetta'} · ${tailNumber}
      </div>
    </div>`;
}

/* ---------------- Popup Kotisivulta ---------------- */
async function showDefectsPopup(tailNumber) {
  if (!tailNumber || tailNumber === '-' || tailNumber === 'TBA') {
    if (typeof showToast === 'function') showToast('Ei konerekisteriä.', 'warning');
    return;
  }

  const cleanTail = String(tailNumber).trim().toUpperCase();

  // Käytä uutta pysyvää popup-rakennetta (kuten roster-muutos)
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
          <div class="rcp-title-main">Koneen viat · ${cleanTail}</div>
          <div class="rcp-title-sub">ADD / CDD · Skyplan defect-reports</div>
        </div>
        <button class="rcp-close" type="button" aria-label="Sulje">✕</button>
      </div>
      <div class="rcp-body" id="defects-popup-body">
        <div class="def-loading">
          <div class="loader-spinner" style="transform:scale(0.7);"><span></span><span></span><span></span></div>
          <span style="font-size:12px; color:var(--dim);">Haetaan vikoja…</span>
        </div>
      </div>
      <div class="rcp-foot">
        <button class="rcp-btn" type="button">Sulje</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Estä klikkaukset ensimmäisen 400 ms ajan
  overlay.style.pointerEvents = 'none';
  setTimeout(() => { overlay.style.pointerEvents = ''; }, 400);

  const close = () => {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 200);
  };
  overlay.querySelector('.rcp-close').addEventListener('click', close);
  overlay.querySelector('.rcp-btn').addEventListener('click', close);

  requestAnimationFrame(() => overlay.classList.add('visible'));

  // Hae ja renderöi
  try {
    const defects = await fetchAircraftDefects(cleanTail);
    const body = document.getElementById('defects-popup-body');
    if (body) body.innerHTML = renderDefectsTableHTML(defects, cleanTail);
  } catch (e) {
    const body = document.getElementById('defects-popup-body');
    if (body) body.innerHTML = `<div class="def-error">Vikojen haku epäonnistui: ${e.message}</div>`;
  }
}

/* ---------------- Kortti Briefing-sivulle ---------------- */
async function renderDefectsCardContent(containerId, tailNumber) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!tailNumber || tailNumber === '-' || tailNumber === 'TBA') {
    el.innerHTML = '<div class="empty">Ei konerekisteriä</div>';
    return;
  }

  const cleanTail = String(tailNumber).trim().toUpperCase();
  el.innerHTML = `
    <div class="def-loading">
      <div class="loader-spinner" style="transform:scale(0.7);"><span></span><span></span><span></span></div>
      <span style="font-size:12px; color:var(--dim);">Haetaan vikoja…</span>
    </div>`;

  try {
    const defects = await fetchAircraftDefects(cleanTail);
    el.innerHTML = renderDefectsTableHTML(defects, cleanTail);
  } catch (e) {
    el.innerHTML = `<div class="def-error">Vikojen haku epäonnistui: ${e.message}</div>`;
  }
}

/* ---------------- Expose ---------------- */
window.fetchAircraftDefects      = fetchAircraftDefects;
window.showDefectsPopup          = showDefectsPopup;
window.renderDefectsCardContent  = renderDefectsCardContent;
window.renderDefectsTableHTML    = renderDefectsTableHTML;

/* ---------------- Debug-apuri ---------------- */
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

  // Taulukkona helpompi lukea
  console.table(raw.map(i => ({
    Type:       i.DefectType,
    Chapter:    i.Chapter,
    Mel:        i.Mel,
    MelNumber:  i.MelNumber,
    DefectItem: i.DefectItem
  })));

  return raw;
};