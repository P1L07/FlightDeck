/* ==============================================================
 * FLIGHT MAP — 1. OSA
 * Seaded, maailmaandmete vahemälu ja abifunktsioonid
 * Vajab D3 teeki.
 * ============================================================== */
'use strict';

const WORLD_LAND_URL =
  'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json';

let _mapWorldCache = null;
let _mapWorldPromise = null;

/* Maailmaandmed laaditakse ainult üks kord. */
async function _loadWorldData() {
  if (_mapWorldCache) return _mapWorldCache;

  if (!_mapWorldPromise) {
    _mapWorldPromise = d3.json(WORLD_LAND_URL)
      .then(data => {
        _mapWorldCache = data;
        return data;
      })
      .catch(error => {
        _mapWorldPromise = null;
        console.warn(
          '[Map] Maailmaandmete laadimine ebaõnnestus:',
          error
        );
        return null;
      });
  }

  return _mapWorldPromise;
}

/* ==============================================================
 * SEADED
 * ============================================================== */

const MAP_FEATURES_KEY = 'flightdeck_map_features_v1';

function _isMobileDevice() {
  return /iPad|iPhone|iPod|Android/i.test(navigator.userAgent)
    || (
      navigator.platform === 'MacIntel'
      && navigator.maxTouchPoints > 1
    );
}

function _getDefaultFeatures() {
  const mobile = _isMobileDevice();

  return {
    stars: !mobile,
    atmosphere: !mobile,
    timezones: !mobile,
    terminator: true,
    cities: !mobile,
    waypoints: true,
    waypointLabels: true,
    airportNames: true,
    weatherMarkers: true
  };
}

function getMapFeatures() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(MAP_FEATURES_KEY) || 'null'
    );

    if (
      saved
      && typeof saved === 'object'
      && !Array.isArray(saved)
    ) {
      return {
        ..._getDefaultFeatures(),
        ...saved
      };
    }
  } catch (_) {}

  return _getDefaultFeatures();
}

window.getMapFeatures = getMapFeatures;

function setMapFeatures(features) {
  try {
    localStorage.setItem(
      MAP_FEATURES_KEY,
      JSON.stringify(features)
    );
  } catch (_) {}
}

window.setMapFeatures = setMapFeatures;

function setMapFeature(name, enabled) {
  const features = getMapFeatures();
  features[name] = !!enabled;
  setMapFeatures(features);
}

window.setMapFeature = setMapFeature;

function resetMapFeatures() {
  try {
    localStorage.removeItem(MAP_FEATURES_KEY);
  } catch (_) {}
}

window.resetMapFeatures = resetMapFeatures;

/* ==============================================================
 * PÄIKESE ASUKOHT
 * Päev-öö terminaatori jaoks.
 * ============================================================== */

function _getSubsolarPoint(date) {
  const rad = Math.PI / 180;

  const d =
    date.valueOf() / 86400000
    - 0.5
    + 2440588
    - 2451545;

  const M = rad * (357.5291 + 0.98560028 * d);

  const C = rad * (
    1.9148 * Math.sin(M)
    + 0.02 * Math.sin(2 * M)
    + 0.0003 * Math.sin(3 * M)
  );

  const P = rad * 102.9372;
  const L = M + C + P + Math.PI;

  const decl = Math.asin(
    Math.sin(L) * Math.sin(rad * 23.4397)
  );

  const ra = Math.atan2(
    Math.sin(L) * Math.cos(rad * 23.4397),
    Math.cos(L)
  );

  const GMST = (
    (18.697374558 + 24.06570982441908 * d) % 24 + 24
  ) % 24;

  const lon = (
    (ra / rad - GMST * 15 + 180) % 360 + 360
  ) % 360 - 180;

  return {
    lat: decl / rad,
    lon
  };
}

/* ==============================================================
 * TÄHED
 * ============================================================== */

function _makeStars(width, height, count = 200) {
  const stars = [];

  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 1.1 + 0.25,
      o: Math.random() * 0.55 + 0.15
    });
  }

  return stars;
}

/* ==============================================================
 * FLIGHT MAP — 2. OSA
 * Gloobus, projektsioon, maapind ja lennumarsruut
 * ============================================================== */

async function renderFlightMap(
  container,
  depIcao,
  arrIcao,
  options = {}
) {
  if (!container || typeof d3 === 'undefined') return;

  if (container._mapCleanup) {
    container._mapCleanup();
    container._mapCleanup = null;
  }

  container.innerHTML = '';

  const feat = getMapFeatures();
  const mobile = _isMobileDevice();

  const dep = typeof _icaoCoords === 'function'
    ? _icaoCoords(depIcao)
    : null;

  const arr = typeof _icaoCoords === 'function'
    ? _icaoCoords(arrIcao)
    : null;

  const extraAirports = Array.isArray(options.extraAirports)
    ? options.extraAirports
    : [];

  const waypoints = Array.isArray(options.waypoints)
    ? options.waypoints
    : [];

  const onMarkerClick = options.onMarkerClick || null;

  container._lastFlight = {
    dep: depIcao,
    arr: arrIcao,
    options: { ...options }
  };

  const points = [];

  if (
    dep &&
    Number.isFinite(dep.lat) &&
    Number.isFinite(dep.lon)
  ) {
    points.push({
      icao: depIcao,
      coords: dep,
      role: 'DEP'
    });
  }

  if (
    arr &&
    Number.isFinite(arr.lat) &&
    Number.isFinite(arr.lon)
  ) {
    points.push({
      icao: arrIcao,
      coords: arr,
      role: 'DEST'
    });
  }

  for (const airport of extraAirports) {
    if (
      !airport ||
      !airport.coords ||
      !Number.isFinite(airport.coords.lat) ||
      !Number.isFinite(airport.coords.lon)
    ) {
      continue;
    }

    if (
      airport.icao === depIcao ||
      airport.icao === arrIcao
    ) {
      continue;
    }

    points.push({
      icao: airport.icao || '',
      coords: airport.coords,
      role: airport.role || 'NOTAM',
      _airport: airport
    });
  }

  const wps = waypoints
    .filter(w =>
      w &&
      Number.isFinite(w.lat) &&
      Number.isFinite(w.lon)
    )
    .map(w => ({
      ...w,
      coords: {
        lat: w.lat,
        lon: w.lon
      }
    }));

  if (!points.length) {
    container.innerHTML =
      '<div style="height:100%;display:flex;' +
      'align-items:center;justify-content:center;' +
      'color:var(--dim);font-size:12px;">' +
      'Ei koordinaatteja reitile</div>';
    return;
  }

  await new Promise(resolve => requestAnimationFrame(resolve));

  if (!container.isConnected) return;

  const width = container.clientWidth || 400;
  const height = container.clientHeight || 240;
  const minDim = Math.min(width, height);
  const margin = options.margin ?? 14;

  /*
   * Sfääriline keskpunkt.
   * Toimib paremini ka siis, kui reit ületab 180° meridiaani.
   */
  const center = points.reduce((sum, point) => {
    const lon = point.coords.lon * Math.PI / 180;
    const lat = point.coords.lat * Math.PI / 180;

    sum.x += Math.cos(lat) * Math.cos(lon);
    sum.y += Math.cos(lat) * Math.sin(lon);
    sum.z += Math.sin(lat);

    return sum;
  }, { x: 0, y: 0, z: 0 });

  const midLon = Math.atan2(center.y, center.x) * 180 / Math.PI;

  const midLat = Math.atan2(
    center.z,
    Math.hypot(center.x, center.y)
  ) * 180 / Math.PI;

  let maxDist = 0;

  for (const point of points) {
    const distance = d3.geoDistance(
      [midLon, midLat],
      [point.coords.lon, point.coords.lat]
    );

    maxDist = Math.max(maxDist, distance);
  }

  const initialScale = (minDim * 0.42) / Math.max(
    Math.sin(
      Math.min(
        Math.max(maxDist, 0.005) * 1.25,
        Math.PI / 2 * 0.05
      )
    ),
    0.02
  );

  const minScale = initialScale * 0.35;
  const maxScale = Math.max(
    initialScale * 60,
    (minDim / 2 * margin) * 200
  );

  let currentScale = initialScale;
  let currentRotate = [-midLon, -midLat];
  let isUserInteracted = false;

  container.style.touchAction = 'none';
  container.style.userSelect = 'none';
  container.style.webkitUserSelect = 'none';

  const svg = d3.select(container)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .style('display', 'block')
    .style('cursor', 'grab');

  const defs = svg.append('defs');

  const uid = 'fm-' + Math.random().toString(36).slice(2);
  const clipId = uid + '-clip';
  const glowId = uid + '-glow';
  const bgId = uid + '-bg';

  defs.append('clipPath')
    .attr('id', clipId)
    .append('rect')
    .attr('width', width)
    .attr('height', height);

  const glow = defs.append('filter')
    .attr('id', glowId)
    .attr('x', '-50%')
    .attr('y', '-50%')
    .attr('width', '200%')
    .attr('height', '200%');

  glow.append('feGaussianBlur')
    .attr('stdDeviation', 2)
    .attr('result', 'blur');

  const merge = glow.append('feMerge');
  merge.append('feMergeNode').attr('in', 'blur');
  merge.append('feMergeNode').attr('in', 'SourceGraphic');

  const bgGrad = defs.append('radialGradient')
    .attr('id', bgId)
    .attr('cx', '50%')
    .attr('cy', '50%')
    .attr('r', '50%');

  bgGrad.append('stop')
    .attr('offset', '0%')
    .attr('stop-color', '#0a1e3a')
    .attr('stop-opacity', 0.7);

  bgGrad.append('stop')
    .attr('offset', '70%')
    .attr('stop-color', '#071528')
    .attr('stop-opacity', 0.4);

  bgGrad.append('stop')
    .attr('offset', '100%')
    .attr('stop-color', 'transparent')
    .attr('stop-opacity', 0);

  defs.append('style').text(`
    .fm-interacting .fm-glow {
      filter: none !important;
    }
    .fm-interacting .fm-land {
      stroke-width: 0.35 !important;
    }
  `);

  const projection = d3.geoOrthographic()
    .scale(currentScale)
    .translate([width / 2, height / 2])
    .rotate(currentRotate)
    .clipAngle(90);

  const path = d3.geoPath().projection(projection);

  const content = svg.append('g')
    .attr('clip-path', `url(#${clipId})`);

  /* Taustatähed */
  if (feat.stars) {
    const starsG = svg.insert('g', ':first-child')
      .attr('clip-path', `url(#${clipId})`);

    for (const star of _makeStars(
      width,
      height,
      mobile ? 80 : 200
    )) {
      starsG.append('circle')
        .attr('cx', star.x)
        .attr('cy', star.y)
        .attr('r', star.r)
        .attr('fill', '#cfe8ff')
        .attr('opacity', star.o);
    }
  }

  /* Gloobuse taust */
  const globeBg = content.append('circle')
    .attr('cx', width / 2)
    .attr('cy', height / 2)
    .attr('r', currentScale)
    .attr('fill', `url(#${bgId})`)
    .attr('stroke', 'rgba(0,194,255,0.3)')
    .attr('stroke-width', 0.8);

  /* Koordinaatvõrk */
  const graticulePath = content.append('path')
    .datum(d3.geoGraticule10())
    .attr('d', path)
    .attr('fill', 'none')
    .attr('stroke', 'rgba(0,194,255,0.04)')
    .attr('stroke-width', 0.35);

  /* Maapind — laaditakse vahemälust */
  let landPath = null;

  const worldData = await _loadWorldData();

  if (!container.isConnected) return;

  if (worldData && typeof topojson !== 'undefined') {
    const land = topojson.feature(
      worldData,
      worldData.objects.land
    );

    landPath = content.append('path')
      .datum(land)
      .attr('class', 'fm-land')
      .attr('d', path)
      .attr('fill', 'rgba(0,194,255,0.12)')
      .attr('stroke', 'rgba(0,194,255,0.45)')
      .attr('stroke-width', 0.5);
  }

  /* ===================== LENNUMARSRUUT ===================== */

  const arcPaths = [];

  if (dep && arr) {
    const routeWps = wps.filter(w =>
      d3.geoDistance(
        [w.coords.lon, w.coords.lat],
        [dep.lon, dep.lat]
      ) > 0.001 &&
      d3.geoDistance(
        [w.coords.lon, w.coords.lat],
        [arr.lon, arr.lat]
      ) > 0.001
    );

    let coords;

    if (routeWps.length) {
      coords = [
        [dep.lon, dep.lat],
        ...routeWps.map(w => [
          w.coords.lon,
          w.coords.lat
        ]),
        [arr.lon, arr.lat]
      ];
    } else {
      const interpolate = d3.geoInterpolate(
        [dep.lon, dep.lat],
        [arr.lon, arr.lat]
      );

      coords = Array.from(
        { length: 97 },
        (_, i) => interpolate(i / 96)
      );
    }

    const arc = {
      type: 'LineString',
      coordinates: coords
    };

    arcPaths.push(
      content.append('path')
        .datum(arc)
        .attr('class', 'fm-glow')
        .attr('d', path)
        .attr('fill', 'none')
        .attr('stroke', '#00c2ff')
        .attr('stroke-width', 3)
        .attr('stroke-opacity', 0.2)
        .attr('filter', `url(#${glowId})`),

      content.append('path')
        .datum(arc)
        .attr('class', 'fm-glow')
        .attr('d', path)
        .attr('fill', 'none')
        .attr('stroke', '#00c2ff')
        .attr('stroke-width', 1.5)
        .attr('filter', `url(#${glowId})`)
    );
  }

/* ===================== LENNujaamade MARKERID ===================== */

  const colors = {
    DEP: '#00c2ff',
    DEST: '#32d74b',
    ALTN: '#ffb300',
    NOTAM: '#8ea0b8'
  };

  function isVisible(coords) {
    const rotation = projection.rotate();

    return d3.geoDistance(
      coords,
      [-rotation[0], -rotation[1]]
    ) < Math.PI / 2 - 0.02;
  }

  const markersG = content.append('g');
  const markerNodes = [];

  for (const point of points) {
    const main = point.role === 'DEP' || point.role === 'DEST';
    const size = main ? 6 : 5;
    const color = colors[point.role] || '#8ea0b8';

    const group = markersG.append('g')
      .style('cursor', 'pointer');

    group.append('circle')
      .attr('r', size + 6)
      .attr('fill', 'transparent');

    group.append('circle')
      .attr('r', size)
      .attr('fill', color)
      .attr('class', 'fm-glow')
      .attr('filter', `url(#${glowId})`)
      .style('pointer-events', 'none');

    const label = group.append('text')
      .attr('x', size + 6)
      .attr('y', 5)
      .attr('fill', color)
      .attr(
        'font-size',
        mobile ? (main ? 20 : 16) : (main ? 26 : 22)
      )
      .attr('font-family', 'monospace')
      .attr('font-weight', 'bold')
      .attr('paint-order', 'stroke')
      .attr('stroke', '#000')
      .attr('stroke-width', mobile ? 2.5 : 4)
      .style('pointer-events', 'none')
      .text(point.icao || '');

    if (!feat.airportNames) {
      label.style('display', 'none');
    }

    group.on('pointerdown', event => {
      event.stopPropagation();
    });

    group.on('click', event => {
      event.stopPropagation();

      if (!onMarkerClick) return;

      const airport = point._airport || {
        icao: point.icao,
        role: point.role,
        notams: [],
        coords: point.coords
      };

      onMarkerClick(airport, event);
    });

    markerNodes.push({ point, group });
  }

  function updateMarkers() {
    for (const item of markerNodes) {
      const point = item.point;

      if (!isVisible([
        point.coords.lon,
        point.coords.lat
      ])) {
        item.group.style('display', 'none');
        continue;
      }

      const xy = projection([
        point.coords.lon,
        point.coords.lat
      ]);

      if (
        !xy ||
        !Number.isFinite(xy[0]) ||
        !Number.isFinite(xy[1])
      ) {
        item.group.style('display', 'none');
        continue;
      }

      item.group
        .style('display', null)
        .attr('transform', `translate(${xy[0]},${xy[1]})`);
    }
  }

  /* ===================== TEEKONNAPUNKTID ===================== */

  const wpG = content.append('g')
    .style('pointer-events', 'none')
    .style('display', feat.waypoints ? null : 'none');

  const wpNodes = wps.map(waypoint => {
    const group = wpG.append('g');

    group.append('circle')
      .attr('r', 3)
      .attr('fill', 'rgba(0,194,255,0.8)');

    const label = group.append('text')
      .attr('x', 6)
      .attr('y', 5)
      .attr('fill', '#fff')
      .attr('font-size', mobile ? 13 : 18)
      .attr('font-family', 'monospace')
      .attr('font-weight', 'bold')
      .attr('paint-order', 'stroke')
      .attr('stroke', '#000')
      .attr('stroke-width', mobile ? 2 : 4)
      .text(
        waypoint.name && waypoint.name !== '?'
          ? waypoint.name
          : ''
      );

    if (
      !feat.waypointLabels ||
      !waypoint.name ||
      waypoint.name === '?'
    ) {
      label.style('display', 'none');
    }

    return { waypoint, group };
  });

  function updateWaypoints() {
    if (!feat.waypoints) return;

    for (const item of wpNodes) {
      const waypoint = item.waypoint;

      if (!isVisible([
        waypoint.coords.lon,
        waypoint.coords.lat
      ])) {
        item.group.style('display', 'none');
        continue;
      }

      const xy = projection([
        waypoint.coords.lon,
        waypoint.coords.lat
      ]);

      if (
        !xy ||
        !Number.isFinite(xy[0]) ||
        !Number.isFinite(xy[1])
      ) {
        item.group.style('display', 'none');
        continue;
      }

      item.group
        .style('display', null)
        .attr('transform', `translate(${xy[0]},${xy[1]})`);
    }
  }

  updateMarkers();
  updateWaypoints();

  /* ===================== PUUTEJUHTIMINE ===================== */

  const pointers = new Map();

  let pinchStartDist = 0;
  let pinchStartScale = 0;
  let lastX = 0;
  let lastY = 0;
  let frameId = 0;
  let interacting = false;

  function setInteracting(value) {
    if (interacting === value) return;

    interacting = value;

    svg.classed('fm-interacting', value);
    svg.style('cursor', value ? 'grabbing' : 'grab');
  }

  function updateResetBtn() {
    resetBtn.style.display = isUserInteracted ? 'flex' : 'none';
  }

  /*
   * Kõik muudatused koondatakse ühte kaadrisse.
   * Kiirete puutesündmuste korral ei joonistata
   * kaarti mitu korda sama ekraanikaadri jooksul.
   */
  function scheduleUpdate() {
    if (frameId) return;

    frameId = requestAnimationFrame(() => {
      frameId = 0;

      projection
        .scale(currentScale)
        .rotate(currentRotate);

      globeBg.attr('r', currentScale);
      graticulePath.attr('d', path);

      if (landPath) {
        landPath.attr('d', path);
      }

      for (const arc of arcPaths) {
        arc.attr('d', path);
      }

      updateMarkers();
      updateWaypoints();
    });
  }

  function resetView() {
    currentScale = initialScale;
    currentRotate = [-midLon, -midLat];
    isUserInteracted = false;

    scheduleUpdate();
    updateResetBtn();
  }

  const preventGesture = event => event.preventDefault();

  container.addEventListener(
    'gesturestart',
    preventGesture,
    { passive: false }
  );

  container.addEventListener(
    'gesturechange',
    preventGesture,
    { passive: false }
  );

  function onPointerDown(event) {
    if (
      event.pointerType === 'mouse' &&
      event.button !== 0
    ) {
      return;
    }

    try {
      container.setPointerCapture(event.pointerId);
    } catch (_) {}

    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    });

    setInteracting(true);

    if (pointers.size === 1) {
      lastX = event.clientX;
      lastY = event.clientY;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];

      pinchStartDist = Math.max(
        1,
        Math.hypot(a.x - b.x, a.y - b.y)
      );

      pinchStartScale = currentScale;
    }
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;

    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    });

    if (pointers.size === 1) {
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;

      lastX = event.clientX;
      lastY = event.clientY;

      const factor = 0.25 * (minDim / 2 / currentScale);

      currentRotate = [
        currentRotate[0] + dx * factor,
        Math.max(
          -85,
          Math.min(85, currentRotate[1] - dy * factor)
        )
      ];

      isUserInteracted = true;

      scheduleUpdate();
      updateResetBtn();

    } else if (pointers.size === 2 && pinchStartDist > 0) {
      const [a, b] = [...pointers.values()];

      const distance = Math.hypot(
        a.x - b.x,
        a.y - b.y
      );

      currentScale = Math.max(
        minScale,
        Math.min(
          maxScale,
          pinchStartScale * distance / pinchStartDist
        )
      );

      isUserInteracted = true;

      scheduleUpdate();
      updateResetBtn();
    }
  }

  function onPointerEnd(event) {
    pointers.delete(event.pointerId);

    if (pointers.size < 2) {
      pinchStartDist = 0;
    }

    if (pointers.size === 1) {
      const remaining = pointers.values().next().value;

      lastX = remaining.x;
      lastY = remaining.y;
    }

    if (pointers.size === 0) {
      setInteracting(false);
    }
  }

  function onWheel(event) {
    event.preventDefault();

    const factor = event.deltaY < 0 ? 1.12 : 0.89;

    currentScale = Math.max(
      minScale,
      Math.min(maxScale, currentScale * factor)
    );

    isUserInteracted = true;

    scheduleUpdate();
    updateResetBtn();
  }

  function onKeyDown(event) {
    const focused =
      container.contains(document.activeElement) ||
      document.activeElement === document.body;

    if (!focused) return;

    if (event.key === '+' || event.key === '=') {
      currentScale = Math.min(maxScale, currentScale * 1.2);
    } else if (event.key === '-' || event.key === '_') {
      currentScale = Math.max(minScale, currentScale * 0.83);
    } else if (event.key === '0') {
      resetView();
      event.preventDefault();
      return;
    } else {
      return;
    }

    isUserInteracted = true;

    scheduleUpdate();
    updateResetBtn();
    event.preventDefault();
  }

  container.addEventListener('pointerdown', onPointerDown);

  container.addEventListener(
    'pointermove',
    onPointerMove,
    { passive: true }
  );

  container.addEventListener(
    'wheel',
    onWheel,
    { passive: false }
  );

  container.addEventListener('keydown', onKeyDown);

  window.addEventListener('pointerup', onPointerEnd);
  window.addEventListener('pointercancel', onPointerEnd);

  container.setAttribute('tabindex', '0');

  /* ===================== RESET-NUPP ===================== */

  const resetBtn = document.createElement('button');

  resetBtn.className = 'map-reset-btn';
  resetBtn.type = 'button';
  resetBtn.textContent = '⟳';

  resetBtn.setAttribute(
    'aria-label',
    'Taasta kaardi algvaade'
  );

  resetBtn.style.display = 'none';

  const resetHost = container.parentElement || container;
  resetHost.appendChild(resetBtn);

  resetBtn.addEventListener('click', event => {
    event.stopPropagation();
    resetView();
  });

  /* ===================== PUHASTAMINE ===================== */

  container._mapCleanup = () => {
    if (frameId) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }

    pointers.clear();

    container.removeEventListener(
      'pointerdown',
      onPointerDown
    );

    container.removeEventListener(
      'pointermove',
      onPointerMove
    );

    container.removeEventListener(
      'wheel',
      onWheel
    );

    container.removeEventListener(
      'keydown',
      onKeyDown
    );

    container.removeEventListener(
      'gesturestart',
      preventGesture
    );

    container.removeEventListener(
      'gesturechange',
      preventGesture
    );

    window.removeEventListener(
      'pointerup',
      onPointerEnd
    );

    window.removeEventListener(
      'pointercancel',
      onPointerEnd
    );

    resetBtn.remove();

    container.style.touchAction = '';
    container.style.userSelect = '';
    container.style.webkitUserSelect = '';
  };
}

/* Tee funktsioon globaalselt kättesaadavaks. */
window.renderFlightMap = renderFlightMap;

/* ===================== SUURUSE MUUTMINE ===================== */

let _mapResizeTimer = null;

window.addEventListener('resize', () => {
  clearTimeout(_mapResizeTimer);

  _mapResizeTimer = setTimeout(() => {
    const container = document.getElementById('fc-map');
    const last = container && container._lastFlight;

    if (!container || !last) return;

    renderFlightMap(
      container,
      last.dep,
      last.arr,
      last.options || {}
    ).catch(error => {
      console.warn('[Map] Kaardi renderdamine ebaõnnestus:', error);
    });
  }, 200);
});
