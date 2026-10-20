/* ==============================================================
 * NOTAM-MAP · Karttanäkymä kaikille NOTAM-kentille
 * ==============================================================
 * - Pallomainen näkymä (d3-geo orthographic)
 * - Pan + pinch-zoom + reset
 * - Klikkaus markeriin → popup: NOTAMit + tuore METAR/TAF
 * ============================================================== */
'use strict';

const NOTAM_MAP_ROLE_COLORS = {
  DEP:   '#00c2ff',   // cyan
  DEST:  '#32d74b',   // vihreä
  ALTN:  '#ffb300',   // keltainen
  NOTAM: '#8ea0b8'    // harmaa
};

/* In-flight tracker — estä saman kentän tuplat */
const _wxPreloadInFlight = new Map();   // icao → Promise
const _wxPreloadFailed = new Map();     // icao → timestamp (cooldown)
const _WX_FAIL_COOLDOWN = 5 * 60 * 1000; // 5 min

let _nmWorldCache = null;

async function _nmLoadWorld() {
  if (_nmWorldCache) return _nmWorldCache;
  try {
    const url = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json';
    _nmWorldCache = await d3.json(url);
    return _nmWorldCache;
  } catch (e) {
    console.warn('[NotamMap] Maailmadatan haku epäonnistui:', e);
    return null;
  }
}

/* ==============================================================
 * Renderöi kartta
 * ============================================================== */
async function renderNotamMap(container, airports, options = {}) {
  if (!container) return;

  if (container._mapAnimation) cancelAnimationFrame(container._mapAnimation);
  if (container._mapCleanup) container._mapCleanup();
  container.innerHTML = '';

  if (typeof d3 === 'undefined') return;

    const valid = (airports || []).filter(a =>
    a.coords && isFinite(a.coords.lat) && isFinite(a.coords.lon)
  );

  /* --- Statusvärit: laske jos flight annettu --- */
  if (options.flight && typeof _getAirportStatus === 'function') {
    valid.forEach(a => {
      if (!a._status) {
        a._status = _getAirportStatus(a, options.flight);
      }
    });
  }

  if (!valid.length) {
    container.innerHTML = `
      <div style="height:100%; display:flex; align-items:center; justify-content:center;
                  color:var(--dim); font-size:12px; text-align:center; padding:20px;">
        Ei koordinaatteja NOTAM-kentille
      </div>`;
    return;
  }

  await new Promise(r => requestAnimationFrame(r));

  const width = container.clientWidth || 400;
  const height = container.clientHeight || 240;
  const margin = 14;

  // Keskipiste + zoom
  const midLon = valid.reduce((s, a) => s + a.coords.lon, 0) / valid.length;
  const midLat = valid.reduce((s, a) => s + a.coords.lat, 0) / valid.length;

  let maxDist = 0;
  valid.forEach(a => {
    const d = d3.geoDistance([midLon, midLat], [a.coords.lon, a.coords.lat]);
    if (d > maxDist) maxDist = d;
  });
    // ============ Zoom: sovita kaukaisin piste nätisti ruutuun ============
  const maxDistRad = Math.max(maxDist, 0.005);
  const sinMax = Math.sin(Math.min(maxDistRad * 1.25, Math.PI / 2 - 0.05));
  const minDim = Math.min(width, height);
  const fitPx = minDim * 0.42;
  const initialScale = fitPx / Math.max(sinMax, 0.02);

  const containerR = minDim / 2 - margin;
  const minScale = initialScale * 0.4;
  const maxScale = initialScale * 8;

  let currentScale = initialScale;
  let currentRotate = [-midLon, -midLat];
  let isUserInteracted = false;

  // ============ SVG ============
  const svg = d3.select(container)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .style('display', 'block')
    .style('touch-action', 'none')
    .style('cursor', 'grab');

  const defs = svg.append('defs');

  const glow = defs.append('filter')
    .attr('id', 'nm-glow')
    .attr('x', '-50%').attr('y', '-50%')
    .attr('width', '200%').attr('height', '200%');
  glow.append('feGaussianBlur').attr('stdDeviation', 3).attr('result', 'blur');
  const merge = glow.append('feMerge');
  merge.append('feMergeNode').attr('in', 'blur');
  merge.append('feMergeNode').attr('in', 'SourceGraphic');

  const bgGrad = defs.append('radialGradient')
    .attr('id', 'nm-bg')
    .attr('cx', '50%').attr('cy', '50%').attr('r', '50%');
  bgGrad.append('stop').attr('offset', '0%')
    .attr('stop-color', '#0a1e3a').attr('stop-opacity', 0.6);
  bgGrad.append('stop').attr('offset', '70%')
    .attr('stop-color', '#071528').attr('stop-opacity', 0.35);
  bgGrad.append('stop').attr('offset', '100%')
    .attr('stop-color', 'transparent').attr('stop-opacity', 0);

  const clipId = 'nm-clip-' + Math.random().toString(36).slice(2);
  defs.append('clipPath').attr('id', clipId)
    .append('rect').attr('x', 0).attr('y', 0)
    .attr('width', width).attr('height', height);

  const projection = d3.geoOrthographic()
    .scale(currentScale)
    .translate([width / 2, height / 2])
    .rotate(currentRotate)
    .clipAngle(90);

  const path = d3.geoPath().projection(projection);

  const content = svg.append('g').attr('clip-path', `url(#${clipId})`);

  content.append('circle')
    .attr('cx', width / 2).attr('cy', height / 2)
    .attr('r', currentScale + 3)
    .attr('fill', 'none').attr('stroke', '#00c2ff')
    .attr('stroke-width', 1).attr('opacity', 0.15)
    .attr('filter', 'url(#nm-glow)');

  const globeBg = content.append('circle')
    .attr('cx', width / 2).attr('cy', height / 2)
    .attr('r', currentScale)
    .attr('fill', 'url(#nm-bg)')
    .attr('stroke', 'rgba(0, 194, 255, 0.4)')
    .attr('stroke-width', 0.8);

  const graticulePath = content.append('path')
    .datum(d3.geoGraticule10())
    .attr('d', path)
    .attr('fill', 'none')
    .attr('stroke', 'rgba(0, 194, 255, 0.06)')
    .attr('stroke-width', 0.4);

  let landPath = null;
  const worldData = await _nmLoadWorld();
  if (worldData) {
    const land = topojson.feature(worldData, worldData.objects.land);
    landPath = content.append('path')
      .datum(land)
      .attr('d', path)
      .attr('fill', 'rgba(0, 194, 255, 0.12)')
      .attr('stroke', 'rgba(0, 194, 255, 0.45)')
      .attr('stroke-width', 0.5);
  }

  const markersG = content.append('g');
    /* ============ Reittiviiva DEP → DEST ============ */
  const arcG = content.append('g');

  const depAirport = valid.find(a => a.role === 'DEP');
  const destAirport = valid.find(a => a.role === 'DEST');

  if (depAirport && destAirport) {
    const interpolate = d3.geoInterpolate(
      [depAirport.coords.lon, depAirport.coords.lat],
      [destAirport.coords.lon, destAirport.coords.lat]
    );
    const arcPoints = [];
    for (let i = 0; i <= 96; i++) arcPoints.push(interpolate(i / 96));
    const arcGeo = { type: 'LineString', coordinates: arcPoints };

    // Varjo (leveämpi)
    arcG.append('path')
      .datum(arcGeo)
      .attr('class', 'nm-arc-shadow')
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', '#00c2ff')
      .attr('stroke-width', 4)
      .attr('stroke-opacity', 0.2)
      .attr('filter', 'url(#nm-glow)')
      .attr('stroke-linecap', 'round');

    // Pääviiva
    arcG.append('path')
      .datum(arcGeo)
      .attr('class', 'nm-arc-main')
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', '#00c2ff')
      .attr('stroke-width', 1.5)
      .attr('filter', 'url(#nm-glow)')
      .attr('stroke-linecap', 'round');

    // Liikkuva pulssi
    const pulseCore = arcG.append('circle')
      .attr('class', 'nm-arc-pulse-core')
      .attr('r', 4)
      .attr('fill', '#00c2ff')
      .attr('filter', 'url(#nm-glow)')
      .attr('opacity', 0);

    let arcT = 0;
    let arcLastTime = 0;

    function animateArc(time) {
      if (!arcLastTime) arcLastTime = time;
      const dt = (time - arcLastTime) / 1000;
      arcLastTime = time;
      arcT = (arcT + dt * 0.15) % 1;

      const pos = interpolate(arcT);
      const proj = projection(pos);

      // Näkyvyystarkistus
      const rot = projection.rotate();
      const center = [-rot[0], -rot[1]];
      const visible = d3.geoDistance(pos, center) < Math.PI / 2 - 0.02;

      if (proj && isFinite(proj[0]) && visible) {
        pulseCore.attr('cx', proj[0]).attr('cy', proj[1]).attr('opacity', 1);
      } else {
        pulseCore.attr('opacity', 0);
      }

      if (container._mapAnimation) {
        container._mapAnimation = requestAnimationFrame(animateArc);
      }
    }

    // Peru vanha animaatio ja käynnistä uusi
    if (container._mapAnimation) cancelAnimationFrame(container._mapAnimation);
    container._mapAnimation = requestAnimationFrame(animateArc);
  }

  /* ============ Päivitys: arc mukana ============ */
  function isVisible(point) {
    const rot = projection.rotate();
    const center = [-rot[0], -rot[1]];
    return d3.geoDistance(point, center) < Math.PI / 2 - 0.02;
  }

  function drawMarker(airport) {
    const p = projection([airport.coords.lon, airport.coords.lat]);
    if (!p || !isFinite(p[0]) || !isFinite(p[1])) return;
    if (!isVisible([airport.coords.lon, airport.coords.lat])) return;

    const color = (airport._status && airport._status.color)
      ? airport._status.color
      : (NOTAM_MAP_ROLE_COLORS[airport.role] || '#8ea0b8');
    const isMain = airport.role === 'DEP' || airport.role === 'DEST';
    const isAltn = airport.role === 'ALTN';
    const size = isMain ? 5 : isAltn ? 4.5 : 3.5;
    const notamCount = airport.notams.length;
    const hasCritical = airport.notams.some(n => n.severity === 'critical')
                     || (airport._status && airport._status.status === 'critical');

    // Hehku
    markersG.append('circle')
      .attr('cx', p[0]).attr('cy', p[1])
      .attr('r', size + 5)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 1)
      .attr('opacity', 0.35)
      .style('pointer-events', 'none');

    // Ydin (klikattava)
    markersG.append('circle')
      .attr('cx', p[0]).attr('cy', p[1])
      .attr('r', size + 4)  // laajempi klikkausalue
      .attr('fill', 'transparent')
      .style('cursor', 'pointer')
      .on('pointerdown', (ev) => ev.stopPropagation())
      .on('click', (ev) => {
        ev.stopPropagation();
        showAirportNotamModal(airport);
      })
      .on('mouseover', function () { d3.select(this).attr('fill', color).attr('fill-opacity', 0.15); })
      .on('mouseout', function () { d3.select(this).attr('fill', 'transparent'); });

    markersG.append('circle')
      .attr('cx', p[0]).attr('cy', p[1])
      .attr('r', size)
      .attr('fill', color)
      .attr('filter', 'url(#nm-glow)')
      .style('pointer-events', 'none');

    // Kriittinen pulssi
    if (hasCritical) {
      markersG.append('circle')
        .attr('cx', p[0]).attr('cy', p[1])
        .attr('r', size + 8)
        .attr('fill', 'none')
        .attr('stroke', '#ff453a')
        .attr('stroke-width', 1.5)
        .attr('opacity', 0.7)
        .style('pointer-events', 'none')
        .append('animate')
        .attr('attributeName', 'r')
        .attr('values', `${size + 4};${size + 12};${size + 4}`)
        .attr('dur', '2s')
        .attr('repeatCount', 'indefinite');
    }

    // ICAO-label
    markersG.append('text')
      .attr('x', p[0] + size + 4).attr('y', p[1] + 3)
      .attr('fill', color)
      .attr('font-size', 10)
      .attr('font-family', 'var(--font-mono, monospace)')
      .attr('font-weight', 700)
      .attr('letter-spacing', 0.5)
      .attr('paint-order', 'stroke')
      .attr('stroke', 'rgba(6, 10, 21, 0.95)')
      .attr('stroke-width', 3)
      .style('pointer-events', 'none')
      .text(airport.icao);
  }

  function redrawMarkers() {
    markersG.selectAll('*').remove();
    valid.forEach(drawMarker);
  }

  redrawMarkers();

  // ============ Pointer events ============
  const activePointers = new Map();
  let pinchStartDist = 0;
  let pinchStartScale = 0;
  let lastPanX = 0;
  let lastPanY = 0;
  let movedSinceDown = false;

  const onPointerDown = (e) => {
    try { container.setPointerCapture(e.pointerId); } catch (err) {}
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    movedSinceDown = false;

    if (activePointers.size === 1) {
      lastPanX = e.clientX;
      lastPanY = e.clientY;
      svg.style('cursor', 'grabbing');
    } else if (activePointers.size === 2) {
      const ps = [...activePointers.values()];
      pinchStartDist = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
      pinchStartScale = currentScale;
    }
  };

  const onPointerMove = (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 1) {
      const dx = e.clientX - lastPanX;
      const dy = e.clientY - lastPanY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) movedSinceDown = true;
      lastPanX = e.clientX;
      lastPanY = e.clientY;

      const factor = 0.25 * (containerR / currentScale);
      const rot = projection.rotate();
      let newLon = rot[0] + dx * factor;
      let newLat = rot[1] - dy * factor;
      newLat = Math.max(-85, Math.min(85, newLat));
      currentRotate = [newLon, newLat];
      isUserInteracted = true;
      updateProjection();
      updateResetBtn();
    } else if (activePointers.size === 2) {
      const ps = [...activePointers.values()];
      const d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
      if (pinchStartDist > 0) {
        const factor = d / pinchStartDist;
        currentScale = Math.max(minScale, Math.min(maxScale, pinchStartScale * factor));
        isUserInteracted = true;
        updateProjection();
        updateResetBtn();
      }
    }
  };

  const onPointerUp = (e) => {
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) pinchStartDist = 0;
    if (activePointers.size === 1) {
      const [p] = [...activePointers.values()];
      lastPanX = p.x; lastPanY = p.y;
    } else if (activePointers.size === 0) {
      svg.style('cursor', 'grab');
    }
  };

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  container._mapCleanup = () => {
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  };

  // ============ Päivitys ============
  let _updatePending = false;
    function updateProjection() {
    if (_updatePending) return;
    _updatePending = true;
    requestAnimationFrame(() => {
      _updatePending = false;
      projection.scale(currentScale).rotate(currentRotate);
      globeBg.attr('r', currentScale);
      graticulePath.attr('d', path);
      if (landPath) landPath.attr('d', path);
      // Päivitä reittiviiva
      arcG.selectAll('.nm-arc-shadow, .nm-arc-main').attr('d', path);
      // Päivitä markerit
      redrawMarkers();
    });
  }
  // ============ Reset-nappi ============
  const resetBtn = document.createElement('button');
  resetBtn.className = 'map-reset-btn';
  resetBtn.type = 'button';
  resetBtn.title = 'Palauta näkymä';
  resetBtn.innerHTML = '⟳';
  resetBtn.style.display = 'none';
  container.appendChild(resetBtn);
  resetBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  resetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    currentScale = initialScale;
    currentRotate = [-midLon, -midLat];
    isUserInteracted = false;
    updateProjection();
    updateResetBtn();
  });

  function updateResetBtn() {
    resetBtn.style.display = isUserInteracted ? 'flex' : 'none';
  }
}
window.renderNotamMap = renderNotamMap;

/* ==============================================================
 * POPUP · NOTAMit + tuore METAR/TAF
 * ============================================================== */
async function showAirportNotamModal(airport) {
  const existing = document.getElementById('notam-airport-popup');
  if (existing) existing.remove();

  const roleLabels = { DEP: 'LÄHTÖ', DEST: 'SAAPUMINEN', ALTN: 'VARAKENTTÄ', NOTAM: 'NOTAM-KENTTÄ' };
  const roleColors = {
    DEP: 'var(--accent)',
    DEST: 'var(--success)',
    ALTN: 'var(--warning)',
    NOTAM: 'var(--dim)'
  };

  const overlay = document.createElement('div');
  overlay.id = 'notam-airport-popup';
  overlay.className = 'rcp-overlay';
  overlay.innerHTML = `
    <div class="rcp-dialog" style="max-width:820px;">
      <div class="rcp-head">
        <div class="rcp-icon">📡</div>
        <div class="rcp-title">
          <div class="rcp-title-main">${airport.icao}</div>
          <div class="rcp-title-sub">
            <span style="color:${roleColors[airport.role]}; font-weight:700;">
              ${roleLabels[airport.role]}
            </span>
            ${airport.notams.length ? ` · ${airport.notams.length} NOTAMia` : ''}
          </div>
        </div>
        <button class="rcp-close" type="button">✕</button>
      </div>
      <div class="rcp-body" id="notam-airport-body">
        <div class="def-loading">
          <div class="loader-spinner" style="transform:scale(0.7);"><span></span><span></span><span></span></div>
          <span style="font-size:12px; color:var(--dim);">Haetaan tuore METAR / TAF…</span>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.style.pointerEvents = 'none';
  setTimeout(() => { overlay.style.pointerEvents = ''; }, 300);

  const close = () => {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 200);
  };
  overlay.querySelector('.rcp-close').addEventListener('click', close);
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) close();
  });

  requestAnimationFrame(() => overlay.classList.add('visible'));

  // Hae METAR + TAF (cache-ensin)
  let liveMetar = null;
  let liveTaf = null;
  let isStale = false;

  try {
    const r = await fetchWXForAirport(airport.icao);
    liveMetar = r.metar;
    liveTaf = r.taf;
    isStale = !!r.isStale;
  } catch (e) {
    console.warn('[NotamPopup] WX fetch failed:', e);
  }

  const body = document.getElementById('notam-airport-body');
  if (!body) return;

  const esc = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let html = '';

  /* --- METAR (live) --- */
  if (liveMetar) {
    const fltCat = liveMetar.fltCat || '';
    const catColor = { VFR: 'var(--success)', MVFR: 'var(--accent)', IFR: 'var(--warning)', LIFR: 'var(--error)' }[fltCat] || 'var(--dim)';
    const fmtWind = (d, s, g) => d == null ? '–'
      : `${String(d).padStart(3, '0')}° / ${Math.round(s)}kt${g ? ' G' + Math.round(g) : ''}`;


    html += `
      <div class="notam-popup-section">
        <div class="notam-popup-head">
          <span>METAR${isStale ? ' · Vanha' : ' · Tuore'}</span>
          ${fltCat ? `<span class="notam-popup-badge" style="color:${catColor}; border-color:${catColor};">${fltCat}</span>` : ''}
          ${isStale ? `<span class="notam-popup-badge" style="color:var(--warning); border-color:var(--warning);">⚡ CACHE</span>` : ''}
        </div>
        <div class="notam-popup-grid">
          <div><span>Tuuli</span><b>${fmtWind(liveMetar.wdir, liveMetar.wspd, liveMetar.wgst)}</b></div>
          <div><span>Näkyvyys</span><b>${typeof _fmtVis === 'function' ? _fmtVis(liveMetar.visib, liveMetar.rawOb) : liveMetar.visib}</b></div>
          <div><span>Lämpötila</span><b>${liveMetar.temp != null ? Math.round(liveMetar.temp) + '°C' : '–'}</b></div>
          <div><span>Kastepiste</span><b>${liveMetar.dewp != null ? Math.round(liveMetar.dewp) + '°C' : '–'}</b></div>
          <div><span>QNH</span><b>${liveMetar.altim != null ? Math.round(liveMetar.altim) + ' hPa' : '–'}</b></div>
          <div><span>Pilvet</span><b>${typeof _fmtClouds === 'function' ? _fmtClouds(liveMetar.clouds) : esc(liveMetar.clouds || '–')}</b></div>
        </div>
        ${liveMetar.rawOb ? `<pre class="notam-popup-raw">${esc(liveMetar.rawOb)}</pre>` : ''}
      </div>`;
  } else {
    html += `<div class="notam-popup-section">
      <div class="notam-popup-head"><span>METAR</span></div>
      <div style="font-size:12px; color:var(--dim); padding:6px 0;">Ei saatavilla juuri nyt.</div>
    </div>`;
  }

  /* --- TAF (live) --- */
  if (liveTaf?.rawTAF) {
    html += `
      <div class="notam-popup-section">
        <div class="notam-popup-head"><span>TAF · Tuore</span></div>
        <pre class="notam-popup-raw">${esc(liveTaf.rawTAF)}</pre>
      </div>`;
  }

  /* --- NOTAMit --- */
  if (airport.notams && airport.notams.length) {
    // Ryhmittele vakavuuden mukaan
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    const sorted = [...airport.notams].sort((a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity]
    );

    html += `<div class="notam-popup-section">
      <div class="notam-popup-head">
        <span>NOTAMit OFP:stä</span>
        <span class="notam-popup-badge" style="color:var(--error); border-color:var(--error);">${airport.notams.length}</span>
      </div>`;

    sorted.forEach(n => {
      const sevColor = n.severity === 'critical' ? 'var(--error)'
                     : n.severity === 'warning' ? 'var(--warning)'
                     : 'var(--accent)';
      const sevLabel = n.severity === 'critical' ? 'KRIITTINEN'
                     : n.severity === 'warning' ? 'HUOMIO'
                     : 'TIEDOTE';

      html += `
        <div class="notam-popup-item" style="border-left-color:${sevColor};">
          <div class="notam-popup-item-head">
            ${n.id ? `<span class="notam-popup-id">${esc(n.id)}</span>` : ''}
            <span class="notam-popup-sev" style="color:${sevColor}; border-color:${sevColor};">${sevLabel}</span>
            <span class="notam-popup-type">${esc(n.type || '')}</span>
          </div>
          <div class="notam-popup-text">${esc(n.text)}</div>
        </div>`;
    });

    html += `</div>`;
  } else {
    html += `<div class="notam-popup-section">
      <div class="notam-popup-head"><span>NOTAMit</span></div>
      <div style="font-size:12px; color:var(--dim); padding:6px 0;">Ei NOTAMeja tälle kentälle.</div>
    </div>`;
  }

  body.innerHTML = html;
}
window.showAirportNotamModal = showAirportNotamModal;


/* ==============================================================
 * NOTAM-WX-CACHE · METAR/TAF välimuisti offline-käyttöä varten
 * ==============================================================
 * HUOM: Käyttää eri cache-avainta kuin weather.js, jotta
 * ei tule "already declared" -virhettä.
 * ============================================================== */

const NOTAM_WX_CACHE_KEY = 'notam_wx_cache_v2';
const NOTAM_WX_CACHE_TTL_MS   = 60 * 60 * 1000;
const NOTAM_WX_CACHE_STALE_MS = 6 * 60 * 60 * 1000;

function _notamWxRead() {
  try {
    return JSON.parse(localStorage.getItem(NOTAM_WX_CACHE_KEY) || '{}');
  } catch (e) { return {}; }
}

function _notamWxWrite(cache) {
  try {
    const keys = Object.keys(cache);
    if (keys.length > 100) {
      keys.sort((a, b) => (cache[b].at || 0) - (cache[a].at || 0))
        .slice(100)
        .forEach(k => delete cache[k]);
    }
    localStorage.setItem(NOTAM_WX_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {}
}

function _notamWxGet(icao) {
  const m = Cache.get(`wx:metar:${icao}`, { allowStale: true, mode: 'persist' });
  const t = Cache.get(`wx:taf:${icao}`, { allowStale: true, mode: 'persist' });
  if (!m && !t) return null;
  return {
    metar: m?.value || null,
    taf: t?.value || null,
    at: m?.savedAt ? new Date(m.savedAt).toISOString() : new Date().toISOString(),
    isStale: (m?.stale || t?.stale) || false
  };
}

function _notamWxSet(icao, metar, taf) {
  if (metar) Cache.set(`wx:metar:${icao}`, metar, { ttlMs: 20 * 60 * 1000, staleTtlMs: 6 * 60 * 60 * 1000, mode: 'persist' });
  if (taf)   Cache.set(`wx:taf:${icao}`,   taf,   { ttlMs: 20 * 60 * 1000, staleTtlMs: 6 * 60 * 60 * 1000, mode: 'persist' });
}

async function fetchWXForAirport(icao, options = {}) {
  const { forceRefresh = false } = options;

  if (!navigator.onLine) {
    const cached = _notamWxGet(icao);
    if (cached) return { metar: cached.metar, taf: cached.taf, fromCache: true, isStale: true };
    return { metar: null, taf: null, fromCache: false };
  }

  if (typeof fetchMETAR !== 'function' || typeof fetchTAF !== 'function') {
    const cached = _notamWxGet(icao);
    return cached
      ? { metar: cached.metar, taf: cached.taf, fromCache: true, isStale: true }
      : { metar: null, taf: null, fromCache: false };
  }

  try {
    const [metar, taf] = await Promise.all([
      Cache.getOrFetch(`wx:metar:${icao}`,
        { forceRefresh, ttlMs: 20 * 60 * 1000, staleTtlMs: 6 * 60 * 60 * 1000, mode: 'persist' },
        () => fetchMETAR(icao)).catch(() => null),
      Cache.getOrFetch(`wx:taf:${icao}`,
        { forceRefresh, ttlMs: 20 * 60 * 1000, staleTtlMs: 6 * 60 * 60 * 1000, mode: 'persist' },
        () => fetchTAF(icao)).catch(() => null)
    ]);

    const cached = _notamWxGet(icao);
    const finalMetar = metar || cached?.metar || null;
    const finalTaf   = taf   || cached?.taf   || null;

    if (!finalMetar && !finalTaf) {
      return { metar: null, taf: null, fromCache: false };
    }
    return { metar: finalMetar, taf: finalTaf, fromCache: false };
  } catch (e) {
    const cached = _notamWxGet(icao);
    if (cached) return { metar: cached.metar, taf: cached.taf, fromCache: true, isStale: true };
    return { metar: null, taf: null, fromCache: false };
  }
}

/* ==============================================================
 * Esilataa sää kaikille kentille
 * ============================================================== */
async function _preloadWxForAirports(airports) {
  if (!Array.isArray(airports) || !airports.length) return;

  if (typeof fetchMETAR !== 'function' || typeof fetchTAF !== 'function') {
    console.warn('[WX Preload] fetchMETAR/fetchTAF puuttuvat');
    return;
  }

  const todo = [];
  const inFlightWait = [];

  airports.forEach(a => {
    const icao = String(a.icao || '').toUpperCase();

    // Ohita FIR/legacy
    if (typeof window.lookupAirport === 'function') {
      const hit = window.lookupAirport(icao);
      if (hit && (hit.type === 'FIR' || hit.type === 'legacy')) return;
    }

    // Jos jo käynnissä → odota se loppuun (älä käynnistä tuplana)
    if (_wxPreloadInFlight.has(icao)) {
      inFlightWait.push(_wxPreloadInFlight.get(icao));
      return;
    }

    // Ohita jos äskettäin epäonnistui (cooldown)
    const failedAt = _wxPreloadFailed.get(icao);
    if (failedAt && Date.now() - failedAt < _WX_FAIL_COOLDOWN) return;

    // Ohita jos jo cachessa
    const cached = _notamWxGet(icao);
    if (cached && cached.metar && cached.taf) return;

    todo.push(icao);
  });

  // Odota jo käynnissä olevat — jotta tämä kutsu ei palaa ennen kuin data on cachessa
  if (inFlightWait.length) {
    await Promise.all(inFlightWait).catch(() => {});
  }

  if (!todo.length) return;

  await Promise.all(todo.map(async icao => {
    const p = (async () => {
      try {
        const [metar, taf] = await Promise.all([
          fetchMETAR(icao).catch(() => null),
          fetchTAF(icao).catch(() => null)
        ]);
        if (metar || taf) {
          _notamWxSet(icao, metar, taf);
          _wxPreloadFailed.delete(icao);
          return { icao, ok: true };
        }
        _wxPreloadFailed.set(icao, Date.now());
        return { icao, ok: false };
      } catch (e) {
        _wxPreloadFailed.set(icao, Date.now());
        return { icao, ok: false };
      } finally {
        _wxPreloadInFlight.delete(icao);
      }
    })();
    _wxPreloadInFlight.set(icao, p);
    return p;
  }));
}
window._preloadWxForAirports = _preloadWxForAirports;

