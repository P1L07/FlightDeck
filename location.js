/* ==============================================================
 * LOCATION · iPadin sijainti
 * ==============================================================
 * - getCurrentPosition: kertaluonteinen sijainti
 * - watchPosition: jatkuva seuranta (kartalla oma piste)
 * - Käsittelee luvan epäämisen siististi
 * ============================================================== */
'use strict';

const LocationService = (() => {
  let _lastPosition = null;
  let _watchId = null;
  let _permission = 'unknown'; // 'granted' | 'denied' | 'prompt' | 'unknown'

  function isSupported() {
    return 'geolocation' in navigator;
  }

  async function checkPermission() {
    if (!navigator.permissions?.query) return 'unknown';
    try {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      _permission = status.state;
      return status.state;
    } catch (e) {
      return 'unknown';
    }
  }

  function getCurrent(options = {}) {
    return new Promise((resolve, reject) => {
      if (!isSupported()) {
        reject(new Error('Sijainti ei ole tuettu tässä laitteessa'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          _lastPosition = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            altitude: pos.coords.altitude,
            heading: pos.coords.heading,
            speed: pos.coords.speed,
            timestamp: pos.timestamp
          };
          resolve(_lastPosition);
        },
        (err) => {
          const msg = _explainError(err);
          reject(new Error(msg));
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000,
          ...options
        }
      );
    });
  }

  function watch(onUpdate, onError) {
    if (!isSupported()) return null;
    if (_watchId !== null) navigator.geolocation.clearWatch(_watchId);
    _watchId = navigator.geolocation.watchPosition(
      (pos) => {
        _lastPosition = { 
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          timestamp: pos.timestamp
        };
        onUpdate?.(_lastPosition);

        // Tarkista nopeus takeoff-promptille
        if (typeof window._checkTakeoffSpeed === 'function') {
          try { window._checkTakeoffSpeed(_lastPosition); } catch (e) {}
        }
      },
      (err) => onError?.(new Error(_explain(err))),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
    return _watchId;
  }

  function stopWatch() {
    if (_watchId !== null) {
      navigator.geolocation.clearWatch(_watchId);
      _watchId = null;
    }
  }

  function getLast() {
    return _lastPosition;
  }

  function _explainError(err) {
    switch (err.code) {
      case 1: return 'Sijaintilupa evätty. Salli se Asetuksista → Safari → Sijainti.';
      case 2: return 'Sijaintia ei saatu. Tarkista että sijaintipalvelut ovat päällä.';
      case 3: return 'Sijainnin haku aikakatkaistiin.';
      default: return err.message || 'Tuntematon sijaintivirhe.';
    }
  }

  return {
    isSupported,
    checkPermission,
    getCurrent,
    watch,
    stopWatch,
    getLast
  };
})();

window.LocationService = LocationService;

/* ---------------- Debug: Mock GPS ---------------- */
window._setMockLocation = function(lat, lon) {
  LocationService.getLast = () => ({
    lat: Number(lat), lon: Number(lon),
    accuracy: 50, timestamp: Date.now()
  });
  console.log(`[Location] Mock GPS asetettu: ${lat}, ${lon}`);

  if (typeof window._resetWaypointCooldown === 'function') {
    window._resetWaypointCooldown();
  }
  if (typeof window._checkWaypointProximity === 'function') {
    window._checkWaypointProximity({ lat: Number(lat), lon: Number(lon) });
  }
  // FIX #2
  if (typeof window._updateNearestAirport === 'function') {
    try { window._updateNearestAirport(); } catch (e) {}
  }
};

window._clearMockLocation = function() {
  delete LocationService.getLast;
  console.log('[Location] Mock GPS poistettu');
  if (typeof LocationService._origGetLast === 'function') {
    LocationService.getLast = LocationService._origGetLast;
  }
  if (typeof renderHomeDashboard === 'function') {
    renderHomeDashboard().catch(() => {});
  }
};