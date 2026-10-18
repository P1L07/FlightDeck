/* ==============================================================
 * MAP · Lentoreitin kartta/maapallo
 * ==============================================================
 * - Automaattinen zoom reitin mukaan
 * - Yhden sormen pyyhkäisy = panorointi
 * - Kahden sormen nipistys = zoomaus
 * - Reset-nappi palauttaa alkuperäisen näkymän
 * - Kaikki visuaaliset elementit kytkettävissä Asetuksista
 * - EI animaatiota (ei requestAnimationFrame)
 * ============================================================== */
'use strict';

const WORLD_LAND_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json';
let _worldDataCache = null;

async function _loadWorldData() {
  if (_worldDataCache) return _worldDataCache;
  try {
    const data = await d3.json(WORLD_LAND_URL);
    _worldDataCache = data;
    return data;
  } catch (e) {
    console.warn('[Map] Maailmadatan haku epäonnistui:', e);
    return null;
  }
}

/* ==============================================================
 * MAP FEATURES · visuaalisten elementtien kytkimet
 * ============================================================== */
const MAP_FEATURES_KEY = 'flightdeck_map_features_v1';

function _isMobileDevice() {
  return /iPad|iPhone|iPod|Android/i.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function _getDefaultFeatures() {
  if (_isMobileDevice()) {
    return {
      stars: false,
      atmosphere: false,
      timezones: false,
      terminator: true,
      cities: false,
      waypoints: true,
      waypointLabels: true,
      airportNames: true,
      weatherMarkers: true
    };
  }
  return {
    stars: true,
    atmosphere: true,
    timezones: true,
    terminator: true,
    cities: true,
    waypoints: true,
    waypointLabels: true,
    airportNames: true,
    weatherMarkers: true
  };
}

function getMapFeatures() {
  try {
    const saved = JSON.parse(localStorage.getItem(MAP_FEATURES_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      return { ..._getDefaultFeatures(), ...saved };
    }
  } catch (e) {}
  return _getDefaultFeatures();
}
window.getMapFeatures = getMapFeatures;

function setMapFeatures(features) {
  try { localStorage.setItem(MAP_FEATURES_KEY, JSON.stringify(features)); } catch (e) {}
}
window.setMapFeatures = setMapFeatures;

function setMapFeature(name, enabled) {
  const f = getMapFeatures();
  f[name] = !!enabled;
  setMapFeatures(f);
}
window.setMapFeature = setMapFeature;

function resetMapFeatures() {
  try { localStorage.removeItem(MAP_FEATURES_KEY); } catch (e) {}
}
window.resetMapFeatures = resetMapFeatures;

/* ==============================================================
 * REALISTIC GLOBE · apurit
 * ============================================================== */

/* --- Subsolar point (päivä/yö-terminaattorin keskus) --- */
function _getSubsolarPoint(date) {
  const rad = Math.PI / 180;
  const d = date.valueOf() / 86400000 - 0.5 + 2440588 - 2451545;
  const M = rad * (357.5291 + 0.98560028 * d);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2*M) + 0.0003 * Math.sin(3*M));
  const P = rad * 102.9372;
  const L = M + C + P + Math.PI;
  const decl = Math.asin(Math.sin(L) * Math.sin(rad * 23.4397));
  const ra = Math.atan2(Math.sin(L) * Math.cos(rad * 23.4397), Math.cos(L));
  const GMST = (18.697374558 + 24.06570982441908 * d) % 24;
  let lon = ((ra / rad) - GMST * 15 + 180) % 360 - 180;
  if (lon < -180) lon += 360;
  return { lat: decl / rad, lon };
}

/* --- Isoimmat kaupungit (yövalot) --- */
const HOME_GLOBE_CITIES = [
  { lat: 55.75, lon:  37.62 }, { lat: 59.94, lon:  30.31 }, { lat: 43.24, lon:  76.89 },
  { lat: 51.17, lon:  71.43 }, { lat: 37.57, lon: 126.98 }, { lat: 35.68, lon: 139.69 },
  { lat: 39.90, lon: 116.41 }, { lat: 31.23, lon: 121.47 }, { lat: 22.32, lon: 114.17 },
  { lat: 41.01, lon:  28.98 }, { lat: 25.20, lon:  55.27 }, { lat: 24.47, lon:  54.37 },
  { lat: 51.51, lon:  -0.13 }, { lat: 48.86, lon:   2.35 }, { lat: 50.11, lon:   8.68 },
  { lat: 52.37, lon:   4.90 }, { lat: 40.42, lon:  -3.70 }, { lat: 41.90, lon:  12.50 },
  { lat: 40.71, lon: -74.01 }, { lat: 34.05, lon: -118.24 },{ lat: 41.88, lon: -87.63 },
  { lat: 43.65, lon: -79.38 }, { lat: 19.43, lon: -99.13 }, { lat: -23.55,lon: -46.63 },
  { lat: -34.60,lon: -58.38 }, { lat: 30.04, lon:  31.24 }, { lat:  6.52, lon:   3.38 },
  { lat: -26.20,lon:  28.04 }, { lat: 19.08, lon:  72.88 }, { lat: 28.61, lon:  77.21 },
  { lat: 13.76, lon: 100.50 }, { lat:  1.35, lon: 103.82 }, { lat: -6.21, lon: 106.85 },
  { lat: -33.87,lon: 151.21 }, { lat: -36.85,lon: 174.76 }, { lat: 47.37, lon:   8.54 },
  { lat: 52.52, lon:  13.40 }, { lat: 55.68, lon:  12.57 }, { lat: 59.33, lon:  18.07 },
  { lat: 60.17, lon:  24.94 }, { lat: 59.91, lon:  10.75 }, { lat: 50.08, lon:  14.44 },
  { lat: 48.21, lon:  16.37 }, { lat: 47.50, lon:  19.04 }, { lat: 44.43, lon:  26.10 },
  { lat: 41.01, lon:  21.43 }, { lat: 37.98, lon:  23.73 }, { lat: 32.09, lon:  34.78 }
];

/* --- Tähtitaivas --- */
function _makeStars(w, h, count = 240) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.1 + 0.25,
      o: Math.random() * 0.55 + 0.15
    });
  }
  return stars;
}

/* ==============================================================
 * RENDER FLIGHT MAP (Optimoitu & Sujuva)
 * ============================================================== */

async function renderFlightMap(container, depIcao, arrIcao, options = {}) {
  if (!container) return;

  if (container._mapCleanup) {
    container._mapCleanup();
    container._mapCleanup = null;
  }
  container.innerHTML = '';

  if (typeof d3 === 'undefined') return;

  const feat = getMapFeatures();

  const dep = (typeof _icaoCoords === 'function') ? _icaoCoords(depIcao) : null;
  const arr = (typeof _icaoCoords === 'function') ? _icaoCoords(arrIcao) : null;
  const extraAirports = Array.isArray(options.extraAirports) ? options.extraAirports : [];
  const waypoints = Array.isArray(options.waypoints) ? options.waypoints : [];
  const onMarkerClick = options.onMarkerClick || null;
  const realistic     = options.realistic === true;
  const mapDate       = options.date ? new Date(options.date) : new Date();

  const points = [];
  if (dep) points.push({ icao: depIcao, coords: dep, role: 'DEP' });
  if (arr) points.push({ icao: arrIcao, coords: arr, role: 'DEST' });
  
  extraAirports.forEach(a => {
    if (!a.coords || !isFinite(a.coords.lat)) return;
    if (a.icao === depIcao || a.icao === arrIcao) return;
    points.push({ icao: a.icao, coords: a.coords, role: a.role || 'NOTAM', _airport: a });
  });

  const wps = waypoints
    .filter(w => w && isFinite(w.lat) && isFinite(w.lon))
    .map(w => ({ ...w, coords: { lat: w.lat, lon: w.lon } }));

  if (!points.length) {
    container.innerHTML = `<div style="height:100%; display:flex; align-items:center; justify-content:center; color:var(--dim); font-size:12px;">Ei koordinaatteja reitille</div>`;
    return;
  }

  await new Promise(r => requestAnimationFrame(r));

  let width  = container.clientWidth  || window.innerWidth  || 400;
  let height = container.clientHeight || window.innerHeight || 240;

  if (width < 100 || height < 100) {
    await new Promise(r => requestAnimationFrame(r));
    width  = container.clientWidth  || 400;
    height = container.clientHeight || 240;
  }

  const margin = options.margin != null ? options.margin : 14;

  const midLon = points.reduce((s, p) => s + p.coords.lon, 0) / points.length;
  const midLat = points.reduce((s, p) => s + p.coords.lat, 0) / points.length;

  let maxDist = 0;
  points.forEach(p => {
    const d = d3.geoDistance([midLon, midLat], [p.coords.lon, p.coords.lat]);
    if (d > maxDist) maxDist = d;
  });

  const maxDistRad = Math.max(maxDist, 0.005);
  const minDim = Math.min(width, height);
  const initialScale = (minDim * 0.42) / Math.max(Math.sin(Math.min(maxDistRad * 1.25, Math.PI / 2 * 0.05)), 0.02);

  const minScale = initialScale * 0.35;
  const maxScale = Math.max(initialScale * 60, (minDim / 2 * margin) * 200);

  let currentScale = initialScale;
  let currentRotate = [-midLon, -midLat];
  let isUserInteracted = false;
  let currentZoomRatio = 1;

  container.style.touchAction = 'none';
  container.style.userSelect = 'none';
  container.style.webkitUserSelect = 'none';
  const preventSafariGestures = (e) => e.preventDefault();
  container.addEventListener('gesturestart', preventSafariGestures);
  container.addEventListener('gesturechange', preventSafariGestures);

  const svg = d3.select(container)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .style('display', 'block')
    .style('cursor', 'grab');

  const defs = svg.append('defs');

  const glow = defs.append('filter').attr('id', 'map-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
  glow.append('feGaussianBlur').attr('stdDeviation', 2).attr('result', 'blur');
  const merge = glow.append('feMerge');
  merge.append('feMergeNode').attr('in', 'blur');
  merge.append('feMergeNode').attr('in', 'SourceGraphic');

  const bgGrad = defs.append('radialGradient').attr('id', 'map-bg-grad').attr('cx', '50%').attr('cy', '50%').attr('r', '50%');
  bgGrad.append('stop').attr('offset', '0%').attr('stop-color', '#0a1e3a').attr('stop-opacity', 0.7);
  bgGrad.append('stop').attr('offset', '70%').attr('stop-color', '#071528').attr('stop-opacity', 0.4);
  bgGrad.append('stop').attr('offset', '100%').attr('stop-color', 'transparent').attr('stop-opacity', 0);

  const clipId = 'fm-clip-' + Math.random().toString(36).slice(2);
  defs.append('clipPath').attr('id', clipId).append('rect').attr('width', width).attr('height', height);

  const projection = d3.geoOrthographic().scale(currentScale).translate([width / 2, height / 2]).rotate(currentRotate).clipAngle(90);
  const path = d3.geoPath().projection(projection);

  const content = svg.append('g').attr('clip-path', `url(#${clipId})`).attr('class', 'map-content-layer');

  if (feat.stars) {
    const starsG = svg.insert('g', ':first-child').attr('class', 'fm-stars').attr('clip-path', `url(#${clipId})`);
    _makeStars(width, height, 200).forEach(s => {
      starsG.append('circle').attr('cx', s.x).attr('cy', s.y).attr('r', s.r).attr('fill', '#cfe8ff').attr('opacity', s.o);
    });
  }

  const globeBg = content.append('circle').attr('cx', width / 2).attr('cy', height / 2).attr('r', currentScale)
    .attr('fill', 'url(#map-bg-grad)').attr('stroke', 'rgba(0, 194, 255, 0.3)').attr('stroke-width', 0.8);

  const graticulePath = content.append('path').datum(d3.geoGraticule10()).attr('d', path)
    .attr('fill', 'none').attr('stroke', 'rgba(0, 194, 255, 0.04)').attr('stroke-width', 0.35);

  let landPath = null;
  try {
    if (!window._mapWorldCache) {
      window._mapWorldCache = await d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json');
    }
    const land = topojson.feature(window._mapWorldCache, window._mapWorldCache.objects.land);
    landPath = content.append('path').datum(land).attr('d', path)
      .attr('fill', 'rgba(0, 194, 255, 0.12)').attr('stroke', 'rgba(0, 194, 255, 0.45)').attr('stroke-width', 0.5);
  } catch (e) {}

  let arcGeo = null;
  if (dep && arr) {
    const wpsForRoute = wps.filter(w => d3.geoDistance([w.coords.lon, w.coords.lat], [dep.lon, dep.lat]) > 0.001 && d3.geoDistance([w.coords.lon, w.coords.lat], [arr.lon, arr.lat]) > 0.001);
    
    let routeCoords = [];
    if (wpsForRoute.length > 0) {
      routeCoords.push([dep.lon, dep.lat]);
      wpsForRoute.forEach(w => routeCoords.push([w.coords.lon, w.coords.lat]));
      routeCoords.push([arr.lon, arr.lat]);
    } else {
      const interp = d3.geoInterpolate([dep.lon, dep.lat], [arr.lon, arr.lat]);
      for (let i = 0; i <= 96; i++) routeCoords.push(interp(i / 96));
    }
    
    arcGeo = { type: 'LineString', coordinates: routeCoords };
    
    content.append('path').datum(arcGeo).attr('class', 'fm-arc-shadow').attr('d', path)
      .attr('fill', 'none').attr('stroke', '#00c2ff').attr('stroke-width', 3).attr('stroke-opacity', 0.2).attr('filter', 'url(#map-glow)');
    content.append('path').datum(arcGeo).attr('class', 'fm-arc-main').attr('d', path)
      .attr('fill', 'none').attr('stroke', '#00c2ff').attr('stroke-width', 1.5).attr('filter', 'url(#map-glow)');
  }

  const markersG = content.append('g');
  let wpG = feat.waypoints ? content.append('g').style('pointer-events', 'none') : null;

  const ROLE_COLORS = { DEP: '#00c2ff', DEST: '#32d74b', ALTN: '#ffb300', NOTAM: '#8ea0b8' };

  function isVisible(point) {
    const rot = projection.rotate();
    return d3.geoDistance(point, [-rot[0], -rot[1]]) < Math.PI / 2 - 0.02;
  }

  function redrawWaypoints() {
    if (!wpG) return;
    wpG.selectAll('*').remove();
    if (!wps.length) return;
    
    // Nimet näkyvät vasta kun on zoomattu hieman (1.8x)
    const showLabels = feat.waypointLabels && currentZoomRatio >= 1.8;

    wps.forEach(w => {
      if (!isVisible([w.coords.lon, w.coords.lat])) return;
      const p = projection([w.coords.lon, w.coords.lat]);
      if (!p || !isFinite(p[0])) return;
      
      wpG.append('circle').attr('cx', p[0]).attr('cy', p[1]).attr('r', showLabels ? 3 : 2)
        .attr('fill', 'rgba(0, 194, 255, 0.8)');
        
      if (showLabels && w.name && w.name !== '?') {
        wpG.append('text').attr('x', p[0] + 5).attr('y', p[1] + 4)
          .attr('fill', '#ffffff') 
          .attr('font-size', 12)   // Palautettu järkevään kokoon
          .attr('font-family', 'monospace')
          .attr('font-weight', 'bold')
          .attr('paint-order', 'stroke')
          .attr('stroke', '#000000') 
          .attr('stroke-width', 2.5) // Ohuempi varjo
          .text(w.name);
      }
    });
  }

  function drawMarker(p) {
    if (!isVisible([p.coords.lon, p.coords.lat])) return;
    const proj = projection([p.coords.lon, p.coords.lat]);
    if (!proj || !isFinite(proj[0])) return;

    const color = ROLE_COLORS[p.role] || '#8ea0b8';
    const isMain = p.role === 'DEP' || p.role === 'DEST';
    const size = isMain ? 6 : 4.5;

    markersG.append('circle').attr('cx', proj[0]).attr('cy', proj[1]).attr('r', size + 6)
      .attr('fill', 'transparent').style('cursor', 'pointer')
      .on('pointerdown', (ev) => ev.stopPropagation())
      .on('click', (ev) => {
        ev.stopPropagation();
        const apt = p._airport || { icao: p.icao, role: p.role, notams: [], coords: p.coords };
        if (onMarkerClick) onMarkerClick(apt, ev);
      });

    markersG.append('circle').attr('cx', proj[0]).attr('cy', proj[1]).attr('r', size)
      .attr('fill', color).attr('filter', 'url(#map-glow)').style('pointer-events', 'none');

    // Kenttien nimet näkyvät aina, mutta maltillisen kokoisina
    const showIcao = isMain || p.role === 'ALTN' || p.role === 'NOTAM' || currentZoomRatio >= 1.2;
    if (showIcao) {
      markersG.append('text').attr('x', proj[0] + size + 5).attr('y', proj[1] + 4)
        .attr('fill', color)
        .attr('font-size', isMain ? 14 : 11) // Pienennetty koko
        .attr('font-family', 'monospace').attr('font-weight', 'bold')
        .attr('paint-order', 'stroke').attr('stroke', '#000000').attr('stroke-width', 2.5)
        .style('pointer-events', 'none').text(p.icao);
    }
  }
  
  function redrawMarkers() {
    markersG.selectAll('*').remove();
    points.forEach(drawMarker);
  }

  redrawMarkers();
  redrawWaypoints();

  const activePointers = new Map();
  let pinchStartDist = 0, pinchStartScale = 0, lastPanX = 0, lastPanY = 0;

  const onPointerDown = (e) => {
    try { container.setPointerCapture(e.pointerId); } catch (err) {}
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    content.style('filter', 'none'); 
    
    if (activePointers.size === 1) {
      lastPanX = e.clientX; lastPanY = e.clientY;
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
      lastPanX = e.clientX; lastPanY = e.clientY;
      const factor = 0.25 * (minDim / 2 / currentScale);
      const rot = projection.rotate();
      let newLat = Math.max(-85, Math.min(85, rot[1] - dy * factor));
      currentRotate = [rot[0] + dx * factor, newLat];
      isUserInteracted = true;
      updateProjection();
      updateResetBtn();
    } else if (activePointers.size === 2) {
      const ps = [...activePointers.values()];
      if (pinchStartDist > 0) {
        currentScale = Math.max(minScale, Math.min(maxScale, pinchStartScale * (Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) / pinchStartDist)));
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
      content.style('filter', ''); 
    }
  };

  const onWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    const newScale = Math.max(minScale, Math.min(maxScale, currentScale * factor));
    if (newScale === currentScale) return;
    currentScale = newScale;
    isUserInteracted = true;
    updateProjection();
    updateResetBtn();
  };

  const onKeyDown = (e) => {
    const isFocused = container.contains(document.activeElement) || document.activeElement === document.body;
    if (!isFocused) return;
    if (e.key === '+' || e.key === '=') {
      currentScale = Math.min(maxScale, currentScale * 1.2);
      isUserInteracted = true;
      updateProjection(); updateResetBtn(); e.preventDefault();
    } else if (e.key === '-' || e.key === '_') {
      currentScale = Math.max(minScale, currentScale * 0.83);
      isUserInteracted = true;
      updateProjection(); updateResetBtn(); e.preventDefault();
    } else if (e.key === '0') {
      currentScale = initialScale; currentRotate = [-midLon, -midLat];
      isUserInteracted = false;
      updateProjection(); updateResetBtn(); e.preventDefault();
    }
  };

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  container.addEventListener('wheel', onWheel, { passive: false });
  container.setAttribute('tabindex', '0');
  container.addEventListener('keydown', onKeyDown);
  container.style.outline = 'none';

  let _updatePending = false;
  function updateProjection() {
    if (_updatePending) return;
    _updatePending = true;
    requestAnimationFrame(() => {
      _updatePending = false;
      projection.scale(currentScale).rotate(currentRotate);
      currentZoomRatio = currentScale / initialScale;
      globeBg.attr('r', currentScale);
      graticulePath.attr('d', path);
      if (landPath) landPath.attr('d', path);
      content.selectAll('.fm-arc-shadow, .fm-arc-main').attr('d', path);
      redrawMarkers();
      redrawWaypoints();
    });
  }

  const resetBtn = document.createElement('button');
  resetBtn.className = 'map-reset-btn';
  resetBtn.type = 'button';
  resetBtn.innerHTML = '⟳';
  resetBtn.style.display = 'none';
  const resetHost = container.parentElement || container;
  resetHost.appendChild(resetBtn);

  resetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    currentScale = initialScale; currentRotate = [-midLon, -midLat];
    isUserInteracted = false;
    updateProjection(); updateResetBtn();
  });

  function updateResetBtn() { resetBtn.style.display = isUserInteracted ? 'flex' : 'none'; }

  container._mapCleanup = () => {
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    container.removeEventListener('wheel', onWheel);
    container.removeEventListener('keydown', onKeyDown);
    container.removeEventListener('gesturestart', preventSafariGestures);
    container.removeEventListener('gesturechange', preventSafariGestures);
    if (resetBtn.parentElement) resetBtn.parentElement.removeChild(resetBtn);
  };
}
window.renderFlightMap = renderFlightMap;

/* Resize handler */
let _mapResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_mapResizeTimer);
  _mapResizeTimer = setTimeout(() => {
    const el = document.getElementById('fc-map');
    if (el && el._lastFlight) {
      renderFlightMap(el, el._lastFlight.dep, el._lastFlight.arr).catch(() => {});
    }
  }, 300);
});