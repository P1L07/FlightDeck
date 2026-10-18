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
 * RENDER FLIGHT MAP
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
  const onMarkerClick = options.onMarkerClick || null;
  const waypoints = Array.isArray(options.waypoints) ? options.waypoints : [];
  const realistic     = options.realistic === true;
  const showTz        = options.showTimezones !== false;
  const showWeather   = options.showWeather === true;
  const mapDate       = options.date ? new Date(options.date) : new Date();
  const subsolar      = (realistic && (feat.terminator || feat.cities))
    ? _getSubsolarPoint(mapDate) : null;

  // Kokoa pisteet
  const points = [];
  if (dep) points.push({ icao: depIcao, coords: dep, role: 'DEP' });
  if (arr) points.push({ icao: arrIcao, coords: arr, role: 'DEST' });
  extraAirports.forEach(a => {
    if (!a.coords || !isFinite(a.coords.lat)) return;
    if (a.icao === depIcao || a.icao === arrIcao) return;
    points.push({ icao: a.icao, coords: a.coords, role: a.role || 'NOTAM', _airport: a });
  });

  // Waypointit
  const wps = waypoints
    .filter(w => w && isFinite(w.lat) && isFinite(w.lon))
    .map(w => ({ ...w, coords: { lat: w.lat, lon: w.lon } }));

  if (!points.length) {
    container.innerHTML = `
      <div style="height:100%; display:flex; align-items:center; justify-content:center;
                  color:var(--dim); font-size:12px; text-align:center; padding:20px;">
        Ei koordinaatteja reitille
      </div>`;
    return;
  }

  await new Promise(r => requestAnimationFrame(r));

// Käytä viewportin kokoa fallbackina — koska .home-map-card on
// position: fixed; inset: 0, sen koko on aina viewportin koko
// kun se on näkyvissä. Jos container on piilotettu (display: none),
// clientWidth on 0 mutta window.innerWidth on silti oikea.
let width  = container.clientWidth  || window.innerWidth  || 400;
let height = container.clientHeight || window.innerHeight || 240;

// Jos ollaan epäilyttävän pieniä (esim. juuri renderöity, layout ei valmis),
// yritä mitata uudelleen seuraavassa framessa
if (width < 100 || height < 100) {
  await new Promise(r => requestAnimationFrame(r));
  width  = container.clientWidth  || window.innerWidth  || 400;
  height = container.clientHeight || window.innerHeight || 240;
}

if (width < 100 || height < 100) {
  // Ei voida mitata — älä renderöi tyhjää SVG:tä
  container.innerHTML = '';
  return;
}
  const margin = options.margin != null ? options.margin : 14;

  // Keskipiste
  const midLon = points.reduce((s, p) => s + p.coords.lon, 0) / points.length;
  const midLat = points.reduce((s, p) => s + p.coords.lat, 0) / points.length;

  // Zoom
  let maxDist = 0;
  points.forEach(p => {
    const d = d3.geoDistance([midLon, midLat], [p.coords.lon, p.coords.lat]);
    if (d > maxDist) maxDist = d;
  });

  const maxDistRad = Math.max(maxDist, 0.005);
  const sinMax = Math.sin(Math.min(maxDistRad * 1.25, Math.PI / 2 - 0.05));
  const minDim = Math.min(width, height);
  const fitPx = minDim * 0.42;
  const initialScale = fitPx / Math.max(sinMax, 0.02);

  const containerR = minDim / 2 - margin;
  const minScale = initialScale * 0.35;
  const maxScale = Math.max(initialScale * 60, containerR * 200);

  let currentScale = initialScale;
  let currentRotate = [-midLon, -midLat];
  let isUserInteracted = false;
  let currentZoomRatio = 1;

  // SVG
  const svg = d3.select(container)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .style('display', 'block')
    .style('touch-action', 'none')
    .style('cursor', 'grab');

  // Defs
  const defs = svg.append('defs');

  const glow = defs.append('filter')
    .attr('id', 'map-glow')
    .attr('x', '-50%').attr('y', '-50%')
    .attr('width', '200%').attr('height', '200%');
  glow.append('feGaussianBlur').attr('stdDeviation', 3).attr('result', 'blur');
  const merge = glow.append('feMerge');
  merge.append('feMergeNode').attr('in', 'blur');
  merge.append('feMergeNode').attr('in', 'SourceGraphic');

  const glowStrong = defs.append('filter')
    .attr('id', 'map-glow-strong')
    .attr('x', '-50%').attr('y', '-50%')
    .attr('width', '200%').attr('height', '200%');
  glowStrong.append('feGaussianBlur').attr('stdDeviation', 5).attr('result', 'blur');
  const mergeStrong = glowStrong.append('feMerge');
  mergeStrong.append('feMergeNode').attr('in', 'blur');
  mergeStrong.append('feMergeNode').attr('in', 'SourceGraphic');

  const bgGrad = defs.append('radialGradient')
    .attr('id', 'map-bg-grad')
    .attr('cx', '50%').attr('cy', '50%').attr('r', '50%');
  bgGrad.append('stop').attr('offset', '0%')
    .attr('stop-color', '#0a1e3a').attr('stop-opacity', 0.7);
  bgGrad.append('stop').attr('offset', '70%')
    .attr('stop-color', '#071528').attr('stop-opacity', 0.4);
  bgGrad.append('stop').attr('offset', '100%')
    .attr('stop-color', 'transparent').attr('stop-opacity', 0);

  const clipId = 'fm-clip-' + Math.random().toString(36).slice(2);
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

  // ============ Tähtitaivas ============
  if (feat.stars) {
    const starsG = svg.insert('g', ':first-child')
      .attr('class', 'fm-stars')
      .attr('clip-path', `url(#${clipId})`);
    _makeStars(width, height, 240).forEach(s => {
      starsG.append('circle')
        .attr('cx', s.x).attr('cy', s.y).attr('r', s.r)
        .attr('fill', '#cfe8ff').attr('opacity', s.o);
    });
  }

  content.append('circle')
    .attr('cx', width / 2).attr('cy', height / 2)
    .attr('r', currentScale + 3)
    .attr('fill', 'none').attr('stroke', '#00c2ff')
    .attr('stroke-width', 1).attr('opacity', 0.15)
    .attr('filter', 'url(#map-glow)');

  const globeBg = content.append('circle')
    .attr('cx', width / 2).attr('cy', height / 2)
    .attr('r', currentScale)
    .attr('fill', 'url(#map-bg-grad)')
    .attr('stroke', 'rgba(0, 194, 255, 0.4)')
    .attr('stroke-width', 0.8);

  // ============ Atmosfääri ============
  let atmo1 = null, atmo2 = null;
  if (feat.atmosphere) {
    atmo1 = content.append('circle')
      .attr('class', 'fm-atmo-1')
      .attr('cx', width / 2).attr('cy', height / 2)
      .attr('r', currentScale + 6)
      .attr('fill', 'none')
      .attr('stroke', 'rgba(0, 194, 255, 0.30)')
      .attr('stroke-width', 6)
      .style('filter', 'blur(5px)')
      .style('pointer-events', 'none');

    atmo2 = content.append('circle')
      .attr('class', 'fm-atmo-2')
      .attr('cx', width / 2).attr('cy', height / 2)
      .attr('r', currentScale + 14)
      .attr('fill', 'none')
      .attr('stroke', 'rgba(0, 194, 255, 0.10)')
      .attr('stroke-width', 12)
      .style('filter', 'blur(12px)')
      .style('pointer-events', 'none');
  }

  // Perusgraticule
  const graticulePath = content.append('path')
    .datum(d3.geoGraticule10())
    .attr('d', path)
    .attr('fill', 'none')
    .attr('stroke', 'rgba(0, 194, 255, 0.04)')
    .attr('stroke-width', 0.35);

  // Aikavyöhykeviivat
  let tzLinesPath = null;
  if (feat.timezones && showTz) {
    const tzCoords = [];
    for (let lon = -180; lon < 180; lon += 15) {
      const line = [];
      for (let lat = -85; lat <= 85; lat += 5) line.push([lon, lat]);
      tzCoords.push({ type: 'LineString', coordinates: line });
    }
    tzLinesPath = content.append('g').attr('class', 'fm-tz')
      .selectAll('path')
      .data(tzCoords)
      .enter().append('path')
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', 'rgba(0, 194, 255, 0.14)')
      .attr('stroke-width', 0.55)
      .attr('stroke-dasharray', '2 4');
  }

  // Maamassat
  let landPath = null;
  try {
    if (!window._mapWorldCache) {
      const url = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json';
      window._mapWorldCache = await d3.json(url);
    }
    const land = topojson.feature(window._mapWorldCache, window._mapWorldCache.objects.land);
    landPath = content.append('path')
      .datum(land)
      .attr('d', path)
      .attr('fill', 'rgba(0, 194, 255, 0.12)')
      .attr('stroke', 'rgba(0, 194, 255, 0.45)')
      .attr('stroke-width', 0.5);
  } catch (e) {
    console.warn('[Map] Maailmadatan haku epäonnistui:', e);
  }

  // ============ Terminaattori ============
  let nightPath = null;
  let terminatorLinePath = null;
  if (feat.terminator && subsolar) {
    const nightCircle = d3.geoCircle()
      .center([subsolar.lon + 180, -subsolar.lat])
      .radius(90);

    const nightPoly = nightCircle();
    nightPath = content.append('path')
      .datum(nightPoly)
      .attr('class', 'fm-night')
      .attr('d', path)
      .attr('fill', 'rgba(0, 6, 22, 0.55)')
      .style('pointer-events', 'none');

    const ringGeo = { type: 'LineString', coordinates: nightPoly.coordinates[0] };
    terminatorLinePath = content.append('path')
      .datum(ringGeo)
      .attr('class', 'fm-terminator')
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', 'rgba(0, 194, 255, 0.55)')
      .attr('stroke-width', 1.1)
      .style('filter', 'url(#map-glow)')
      .style('pointer-events', 'none');
  }

  // ============ Kaupunkien yövalot ============
  let citiesG = null;
  if (feat.cities && subsolar) {
    citiesG = content.append('g').attr('class', 'fm-cities')
      .style('pointer-events', 'none');
  }

  // ============ Reittiviiva ============
  let arcGeo = null;

  if (dep && arr) {
    const wpsForRoute = wps.filter(w => {
      const dDep = d3.geoDistance([w.coords.lon, w.coords.lat], [dep.lon, dep.lat]);
      const dArr = d3.geoDistance([w.coords.lon, w.coords.lat], [arr.lon, arr.lat]);
      return dDep > 0.001 && dArr > 0.001;
    });

    let routeCoords;
    if (wpsForRoute.length > 0) {
      routeCoords = [[dep.lon, dep.lat]];
      wpsForRoute.forEach(w => routeCoords.push([w.coords.lon, w.coords.lat]));
      routeCoords.push([arr.lon, arr.lat]);
    } else {
      const interp = d3.geoInterpolate([dep.lon, dep.lat], [arr.lon, arr.lat]);
      routeCoords = [];
      for (let i = 0; i <= 96; i++) routeCoords.push(interp(i / 96));
    }

    arcGeo = { type: 'LineString', coordinates: routeCoords };

    content.append('path')
      .datum(arcGeo)
      .attr('class', 'fm-arc-shadow')
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', '#00c2ff')
      .attr('stroke-width', 4)
      .attr('stroke-opacity', 0.22)
      .attr('filter', 'url(#map-glow)')
      .attr('stroke-linecap', 'round');

    content.append('path')
      .datum(arcGeo)
      .attr('class', 'fm-arc-main')
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', '#00c2ff')
      .attr('stroke-width', 1.6)
      .attr('filter', 'url(#map-glow)')
      .attr('stroke-linecap', 'round');
  }

  // Markerit
  const markersG = content.append('g');

  // Waypoint-pisteet
  let wpG = null;
  if (feat.waypoints) {
    wpG = content.append('g')
      .attr('class', 'fm-waypoints')
      .style('pointer-events', 'none');
  }

  const ROLE_COLORS = { DEP: '#00c2ff', DEST: '#32d74b', ALTN: '#ffb300', NOTAM: '#8ea0b8' };

  function isVisible(point) {
    const rot = projection.rotate();
    const center = [-rot[0], -rot[1]];
    return d3.geoDistance(point, center) < Math.PI / 2 - 0.02;
  }

  function redrawWaypoints() {
    if (!wpG) return;
    wpG.selectAll('*').remove();
    if (!wps.length) return;

    const showLabels = feat.waypointLabels && currentZoomRatio >= 3.0;

    // Pisteet
    wps.forEach(w => {
      if (!isVisible([w.coords.lon, w.coords.lat])) return;
      const p = projection([w.coords.lon, w.coords.lat]);
      if (!p || !isFinite(p[0])) return;
      wpG.append('circle')
        .attr('cx', p[0]).attr('cy', p[1])
        .attr('r', showLabels ? 2.6 : 2.2)
        .attr('fill', 'rgba(0, 194, 255, 0.55)')
        .attr('stroke', 'rgba(0, 194, 255, 0.9)')
        .attr('stroke-width', 0.4);
    });

    if (!showLabels) return;

    // Label-ehdokkaat
    const labels = [];
    wps.forEach(w => {
      if (!w.name || w.name === '?') return;
      if (!isVisible([w.coords.lon, w.coords.lat])) return;
      const p = projection([w.coords.lon, w.coords.lat]);
      if (!p || !isFinite(p[0])) return;
      labels.push({ name: w.name, x: p[0], y: p[1] });
    });

    labels.sort((a, b) => (a.y - b.y) || (a.x - b.x));

    const FONT_W = 6.2;
    const LABEL_H = 12;
    const PAD = 2;
    const placed = [];

    function overlaps(x1, y1, w1, h1) {
      for (const r of placed) {
        if (x1 < r.x + r.w + PAD &&
            x1 + w1 + PAD > r.x &&
            y1 < r.y + r.h + PAD &&
            y1 + h1 + PAD > r.y) return true;
      }
      return false;
    }

    labels.forEach(l => {
      const lx = l.x + 5;
      const ly = l.y - 6;
      const lw = l.name.length * FONT_W;
      const lh = LABEL_H;

      if (overlaps(lx, ly, lw, lh)) return;
      placed.push({ x: lx, y: ly, w: lw, h: lh });

      wpG.append('text')
        .attr('x', l.x + 5)
        .attr('y', l.y + 3.5)
        .attr('fill', 'rgba(0, 194, 255, 0.95)')
        .attr('font-size', 9.5)
        .attr('font-family', 'var(--font-mono, monospace)')
        .attr('font-weight', 700)
        .attr('letter-spacing', 0.5)
        .attr('paint-order', 'stroke')
        .attr('stroke', 'rgba(6, 10, 21, 0.95)')
        .attr('stroke-width', 3)
        .style('pointer-events', 'none')
        .text(l.name);
    });
  }

  function drawMarker(p) {
    if (!isVisible([p.coords.lon, p.coords.lat])) return;
    const proj = projection([p.coords.lon, p.coords.lat]);
    if (!proj || !isFinite(proj[0])) return;

    const color = ROLE_COLORS[p.role] || '#8ea0b8';
    const isMain = p.role === 'DEP' || p.role === 'DEST';
    const size = isMain ? 5.5 : 3.5;
    const clickable = p.role === 'DEP' || p.role === 'DEST' || p.role === 'ALTN' || !!onMarkerClick;

    // Hehku
    markersG.append('circle')
      .attr('cx', proj[0]).attr('cy', proj[1])
      .attr('r', size + 6)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', isMain ? 1.2 : 0.8)
      .attr('opacity', isMain ? 0.5 : 0.3)
      .style('pointer-events', 'none');

    // Klikkausalue
    if (clickable) {
      markersG.append('circle')
        .attr('cx', proj[0]).attr('cy', proj[1])
        .attr('r', size + 8)
        .attr('fill', 'transparent')
        .style('cursor', 'pointer')
        .on('pointerdown', (ev) => ev.stopPropagation())
        .on('click', (ev) => {
          ev.stopPropagation();
          const apt = p._airport || {
            icao: p.icao, role: p.role, notams: [], coords: p.coords
          };
          if (onMarkerClick) onMarkerClick(apt, ev);
          (container._markerClickCallbacks || []).forEach(fn => {
            try { fn(apt, ev); } catch (e) {}
          });
        });
    }

    // Ydin
    markersG.append('circle')
      .attr('cx', proj[0]).attr('cy', proj[1])
      .attr('r', size)
      .attr('fill', color)
      .attr('filter', isMain ? 'url(#map-glow-strong)' : 'url(#map-glow)')
      .style('pointer-events', 'none');

    // ICAO-label
    const showIcao = isMain || p.role === 'ALTN' || currentZoomRatio >= 1.5;
    if (showIcao) {
      markersG.append('text')
        .attr('x', proj[0] + size + 5).attr('y', proj[1] + 3)
        .attr('fill', color)
        .attr('font-size', isMain ? 12 : 10)
        .attr('font-family', 'var(--font-mono, monospace)')
        .attr('font-weight', 800)
        .attr('letter-spacing', 0.8)
        .attr('paint-order', 'stroke')
        .attr('stroke', 'rgba(6, 10, 21, 0.95)')
        .attr('stroke-width', 3.5)
        .style('pointer-events', 'none')
        .text(p.icao);
    }

    // Kentän nimi
    if (showIcao && feat.airportNames && currentZoomRatio >= 1.5
        && typeof window.getAirportName === 'function') {
      const name = window.getAirportName(p.icao);
      if (name) {
        markersG.append('text')
          .attr('x', proj[0] + size + 5).attr('y', proj[1] + 3 + (isMain ? 14 : 12))
          .attr('fill', color)
          .attr('font-size', isMain ? 10.5 : 9)
          .attr('font-family', 'var(--font-ui, sans-serif)')
          .attr('font-weight', 500)
          .attr('letter-spacing', 0.3)
          .attr('opacity', 0.85)
          .attr('paint-order', 'stroke')
          .attr('stroke', 'rgba(6, 10, 21, 0.95)')
          .attr('stroke-width', 3)
          .style('pointer-events', 'none')
          .text(name);
      }
    }

    // Säämerkki
    if (showWeather && feat.weatherMarkers && typeof window._notamWxGet === 'function') {
      const wx = window._notamWxGet(p.icao);
      const cat = wx && wx.metar && wx.metar.fltCat;
      if (cat) {
        const catColor = { VFR: '#32d74b', MVFR: '#00c2ff', IFR: '#ffb300', LIFR: '#ff453a' }[cat];
        if (catColor) {
          markersG.append('circle')
            .attr('cx', proj[0] - size - 5)
            .attr('cy', proj[1] - size - 5)
            .attr('r', 3.5)
            .attr('fill', catColor)
            .attr('stroke', 'rgba(6, 10, 21, 0.95)')
            .attr('stroke-width', 1.5)
            .style('pointer-events', 'none');
        }
      }
    }
  }

  function _drawCityLights() {
    if (!citiesG || !subsolar) return;
    citiesG.selectAll('*').remove();
    HOME_GLOBE_CITIES.forEach(c => {
      const dSun = d3.geoDistance([c.lon, c.lat], [subsolar.lon, subsolar.lat]);
      if (dSun < Math.PI / 2) return;
      if (!isVisible([c.lon, c.lat])) return;
      const p = projection([c.lon, c.lat]);
      if (!p || !isFinite(p[0])) return;
      const intensity = Math.min(1, (dSun - Math.PI / 2) / (Math.PI / 2));
      citiesG.append('circle')
        .attr('cx', p[0]).attr('cy', p[1])
        .attr('r', 1.6)
        .attr('fill', '#ffd58a')
        .attr('opacity', 0.35 + intensity * 0.55)
        .style('filter', 'drop-shadow(0 0 3px rgba(255, 213, 138, 0.9))');
    });
  }

  function redrawMarkers() {
    markersG.selectAll('*').remove();
    points.forEach(drawMarker);
  }

  redrawMarkers();
  redrawWaypoints();
  _drawCityLights();

  // ============ Pointer events ============
  const activePointers = new Map();
  let pinchStartDist = 0;
  let pinchStartScale = 0;
  let lastPanX = 0;
  let lastPanY = 0;

    const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    container.setPointerCapture(e.pointerId); 
    
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    
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
    const isFocused = container.contains(document.activeElement) ||
                      document.activeElement === document.body;
    if (!isFocused) return;

    if (e.key === '+' || e.key === '=') {
      currentScale = Math.min(maxScale, currentScale * 1.2);
      isUserInteracted = true;
      updateProjection();
      updateResetBtn();
      e.preventDefault();
    } else if (e.key === '-' || e.key === '_') {
      currentScale = Math.max(minScale, currentScale * 0.83);
      isUserInteracted = true;
      updateProjection();
      updateResetBtn();
      e.preventDefault();
    } else if (e.key === '0') {
      currentScale = initialScale;
      currentRotate = [-midLon, -midLat];
      isUserInteracted = false;
      updateProjection();
      updateResetBtn();
      e.preventDefault();
    }
  };

  // Estä selaimen oma vieritys, zoomaus ja tekstin maalaus
  container.style.touchAction = 'none';
  container.style.userSelect = 'none';
  container.style.webkitUserSelect = 'none';
  container.style.webkitTouchCallout = 'none';

  // iOS Safarin oman pinch-zoomin estäminen
  const preventSafariGestures = (e) => e.preventDefault();
  container.addEventListener('gesturestart', preventSafariGestures);
  container.addEventListener('gesturechange', preventSafariGestures);

  container.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  container.addEventListener('wheel', onWheel, { passive: false });
  container.setAttribute('tabindex', '0');
  container.addEventListener('keydown', onKeyDown);
  container.style.outline = 'none';

container._mapCleanup = () => {
    container.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    container.removeEventListener('wheel', onWheel);
    container.removeEventListener('keydown', onKeyDown);
    
    container.removeEventListener('gesturestart', preventSafariGestures);
    container.removeEventListener('gesturechange', preventSafariGestures);

    try {
      if (resetBtn.parentElement) resetBtn.parentElement.removeChild(resetBtn);
    } catch (e) {}
  };

  // ============ Päivitys ============
  let _updatePending = false;
  function updateProjection() {
    if (_updatePending) return;
    _updatePending = true;
    requestAnimationFrame(() => {
      _updatePending = false;
      projection.scale(currentScale).rotate(currentRotate);
      currentZoomRatio = currentScale / initialScale;
      globeBg.attr('r', currentScale);
      if (atmo1) atmo1.attr('r', currentScale + 6);
      if (atmo2) atmo2.attr('r', currentScale + 14);
      graticulePath.attr('d', path);
      if (tzLinesPath) tzLinesPath.attr('d', path);
      if (landPath) landPath.attr('d', path);
      if (nightPath) nightPath.attr('d', path);
      if (terminatorLinePath) terminatorLinePath.attr('d', path);
      content.selectAll('.fm-arc-shadow, .fm-arc-main').attr('d', path);
      redrawMarkers();
      redrawWaypoints();
      _drawCityLights();
    });
  }

    // Reset-nappi — lisää isäntäkorttiin, ei itse karttaan
  // (kartan sisällä nappi jäisi overlayn alle z-indexin takia)
  const resetBtn = document.createElement('button');
  resetBtn.className = 'map-reset-btn';
  resetBtn.type = 'button';
  resetBtn.title = 'Palauta näkymä';
  resetBtn.innerHTML = '⟳';
  resetBtn.style.display = 'none';

  const resetHost = container.parentElement || container;
  resetHost.appendChild(resetBtn);

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

  // ============ Apurit ============
  container._getMarkerPosition = (icao) => {
    const p = points.find(x => x.icao === icao);
    if (!p) return null;
    if (!isVisible([p.coords.lon, p.coords.lat])) return null;
    const proj = projection([p.coords.lon, p.coords.lat]);
    if (!proj || !isFinite(proj[0])) return null;
    return { x: proj[0], y: proj[1] };
  };

  container._markerClickCallbacks = [];
  container._onMarkerClick = (fn) => {
    container._markerClickCallbacks.push(fn);
  };

  // Tallenna renderöintiparametrit resizea varten
  container._lastFlight = {
    dep: depIcao,
    arr: arrIcao,
    options: {
      ...options,
      onMarkerClick: options.onMarkerClick
    }
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