/* ==============================================================
 * FAVORITE CREW · suosikkimiehistön tallennus ja tunnistus
 * ============================================================== */

const FAVORITES_KEY = '_favorite_crew_v1';
const FLIGHT_CREW_CACHE_KEY = '_flight_crew_cache_v1';

/* ---------------- Tallennus ---------------- */
function getFavoriteCrew() {
  try {
    const arr = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function saveFavoriteCrew(list) {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(list)); } catch (e) {}
}

function getFavoriteStaffIds() {
  return new Set(getFavoriteCrew().map(f => String(f.staffId)));
}

function isFavoriteCrew(staffId) {
  if (!staffId) return false;
  const id = String(staffId);
  return getFavoriteCrew().some(f => String(f.staffId) === id);
}

function addFavoriteCrew(member) {
  if (!member || !member.staffId) return false;
  const id = String(member.staffId);
  const list = getFavoriteCrew();
  if (list.some(f => String(f.staffId) === id)) return false;
  list.push({
    staffId: id,
    firstName: member.firstName || '',
    lastName: member.lastName || '',
    position: member.position || '',
    addedAt: new Date().toISOString()
  });
  saveFavoriteCrew(list);
  return true;
}

function removeFavoriteCrew(staffId) {
  const id = String(staffId);
  saveFavoriteCrew(getFavoriteCrew().filter(f => String(f.staffId) !== id));
}

function toggleFavoriteCrew(member) {
  if (!member || !member.staffId) return false;
  if (isFavoriteCrew(member.staffId)) {
    removeFavoriteCrew(member.staffId);
    return false;
  }
  addFavoriteCrew(member);
  return true;
}

function getFavoriteFullName(f) {
  return [f.firstName, f.lastName].filter(Boolean).join(' ') || `#${f.staffId}`;
}

/* ---------------- Flight crew -cache ---------------- */
function cacheFlightCrew(flightId, crewDuty) {
  if (!flightId || !Array.isArray(crewDuty)) return;
  try {
    const cache = JSON.parse(localStorage.getItem(FLIGHT_CREW_CACHE_KEY) || '{}');
    cache[String(flightId)] = {
      at: new Date().toISOString(),
      crew: crewDuty.map(c => ({
        staffId: String(c.staffId || ''),
        firstName: c.firstName || '',
        lastName: c.lastName || '',
        position: c.position || ''
      })).filter(c => c.staffId)
    };
    // Rajaa 500 entryyn
    const keys = Object.keys(cache);
    if (keys.length > 500) {
      keys.sort((a, b) => new Date(cache[a].at) - new Date(cache[b].at))
        .slice(0, keys.length - 500)
        .forEach(k => delete cache[k]);
    }
    localStorage.setItem(FLIGHT_CREW_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {}
}

function getCachedFlightCrew(flightId) {
  try {
    const cache = JSON.parse(localStorage.getItem(FLIGHT_CREW_CACHE_KEY) || '{}');
    return cache[String(flightId)]?.crew || null;
  } catch (e) { return null; }
}

/* ---------------- Tunnistus ---------------- */
function getFlightFavorites(flightId) {
  const crew = getCachedFlightCrew(flightId);
  if (!crew || !crew.length) return [];
  const favIds = getFavoriteStaffIds();
  return crew.filter(c => c.staffId && favIds.has(c.staffId));
}

/* ---------------- Wrapper: cache crew journey-logista ---------------- */
(function _wrapJourneyLogCache() {
  if (typeof window._cacheJourneyLog !== 'function') return;
  const orig = window._cacheJourneyLog;
  window._cacheJourneyLog = function (flightId, log) {
    const r = orig.apply(this, arguments);
    if (log?.crewDuty?.length) {
      try { cacheFlightCrew(flightId, log.crewDuty); } catch (e) {}
    }
    return r;
  };
})();

/* ---------------- Expose ---------------- */
window.getFavoriteCrew       = getFavoriteCrew;
window.addFavoriteCrew       = addFavoriteCrew;
window.removeFavoriteCrew    = removeFavoriteCrew;
window.toggleFavoriteCrew    = toggleFavoriteCrew;
window.isFavoriteCrew        = isFavoriteCrew;
window.getFavoriteFullName   = getFavoriteFullName;
window.getFlightFavorites    = getFlightFavorites;
window.cacheFlightCrew       = cacheFlightCrew;
window.getCachedFlightCrew   = getCachedFlightCrew;
window.saveFavoriteCrew      = saveFavoriteCrew;

/* ---------------- Klikkaus-handler tähtinapille ---------------- */
window.toggleFavoriteFromBtn = function (btn, staffId, firstName, lastName, position) {
  const isFav = toggleFavoriteCrew({ staffId, firstName, lastName, position });
  btn.textContent = isFav ? '★' : '☆';
  btn.classList.toggle('is-fav', isFav);

  // Päivitä kaikki saman staffId:n tähdet sivulla
  document.querySelectorAll(`[data-fav-staff="${staffId}"]`).forEach(el => {
    el.textContent = isFav ? '★' : '☆';
    el.classList.toggle('is-fav', isFav);
  });

  if (typeof showToast === 'function') {
    const name = [firstName, lastName].filter(Boolean).join(' ') || `#${staffId}`;
    showToast(isFav ? `${name} lisätty suosikiksi.` : `${name} poistettu suosikeista.`, 'success', 2500);
  }
};

/* ---------------- Tyhjennä kaikki ---------------- */
window.clearAllFavorites = function () {
  if (!confirm('Poistetaanko kaikki suosikkimiehistöt?')) return;
  saveFavoriteCrew([]);
  if (typeof showToast === 'function') showToast('Kaikki suosikit poistettu.', 'info');
};

/* ==============================================================
 * BACKGROUND CREW PRELOAD · lataa tulevien lentojen miehistöt
 * ==============================================================
 * Kun rosteri synkataan, käydään läpi seuraavan 7 pv lennot ja
 * haetaan crew journey-logista. Tallennetaan cacheen, jotta
 * suosikki-tunnistus toimii viikko- ja kaveri-näkymissä.
 * ============================================================== */

const CREW_PRELOAD_KEY = 'jarvis_crew_preload_state_v1';
const CREW_PRELOAD_DAYS = 7;              // kuinka monta päivää eteenpäin
const CREW_PRELOAD_DELAY_MS = 300;        // viive pyyntöjen välillä
const CREW_PRELOAD_MIN_INTERVAL = 30 * 60 * 1000;   // min 30 min välein

async function preloadUpcomingCrews(reason = 'auto') {
  if (window._crewPreloadRunning) {
    console.log(`[CrewPreload] Skip (${reason}): jo käynnissä`);
    return;
  }

  if (!navigator.onLine) {
    console.log(`[CrewPreload] Skip (${reason}): offline`);
    return;
  }

  // Rate-limit
  let state = {};
  try { state = JSON.parse(localStorage.getItem(CREW_PRELOAD_KEY) || '{}'); }
  catch (e) {}
  const lastRun = state.lastRun ? new Date(state.lastRun).getTime() : 0;
  if (Date.now() - lastRun < CREW_PRELOAD_MIN_INTERVAL && reason !== 'manual') {
    const mins = Math.round((Date.now() - lastRun) / 60000);
    console.log(`[CrewPreload] Skip (${reason}): ${mins} min viime ajosta`);
    return;
  }

  const token = (typeof getValidSkyplanToken === 'function')
    ? await getValidSkyplanToken().catch(() => null)
    : null;
  if (!token) {
    console.log(`[CrewPreload] Skip (${reason}): ei tokenia`);
    return;
  }

  // Hae tulevat lennot seuraavalta N päivältä
  const roster = (() => {
    try { return JSON.parse(localStorage.getItem('assigned_flights_cache') || '[]'); }
    catch (e) { return []; }
  })();

  if (!roster.length) return;

  const now = Date.now();
  const cutoff = now + CREW_PRELOAD_DAYS * 24 * 60 * 60 * 1000;

  // Suodata: tulevat lennot tai käynnissä olevat, joilla ei ole vielä crew-cachea
  const candidates = roster.filter(f => {
    const std = new Date(f.StdLt || f.Std || 0).getTime();
    const sta = new Date(f.StaLt || f.Sta || 0).getTime();
    if (!std || !sta) return false;
    // Aikavälillä: mennyt alle 24h sitten … seuraavat N päivää
    if (sta < now - 24 * 60 * 60 * 1000) return false;
    if (std > cutoff) return false;

    // Onko jo cachessa?
    const fid = String(f.ID || f.id || f.FlightID || '');
    if (!fid) return false;
    const cached = getCachedFlightCrew(fid);
    if (cached && cached.length) return false;

    return true;
  });

  if (!candidates.length) {
    console.log(`[CrewPreload] Kaikki tulevat lennot jo cachessa`);
    state.lastRun = new Date().toISOString();
    state.reason = reason;
    localStorage.setItem(CREW_PRELOAD_KEY, JSON.stringify(state));
    return;
  }

  console.log(`[CrewPreload] Aloitetaan (${reason}): ${candidates.length} lentoa`);
  window._crewPreloadRunning = true;

  let loaded = 0, skipped = 0, errors = 0;

  try {
    for (let i = 0; i < candidates.length; i++) {
      const f = candidates[i];
      const fid = String(f.ID || f.id || f.FlightID || '');

      try {
        // Hae journey-log (cache-ensin)
        let log = (typeof getCachedJourneyLog === 'function')
          ? getCachedJourneyLog(fid)
          : null;

        if (!log || !log.crewDuty || !log.crewDuty.length) {
          log = await fetchJourneyLog(fid, token);
          if (log && typeof _cacheJourneyLog === 'function') {
            _cacheJourneyLog(fid, log);
          }
        }

        if (log?.crewDuty?.length) {
          // Varmista että crew menee flight-crew-cacheen
          cacheFlightCrew(fid, log.crewDuty);
          loaded++;
        } else {
          skipped++;
        }
      } catch (e) {
        errors++;
        // 422 = crew ei vielä julkaistu → odota
        if (!/422|not generated|not available/i.test(e.message || '')) {
          console.warn(`[CrewPreload] ${fid}:`, e.message);
        }
      }

      // Rate-limit
      if (i < candidates.length - 1) {
        await new Promise(r => setTimeout(r, CREW_PRELOAD_DELAY_MS));
      }
    }

    state.lastRun = new Date().toISOString();
    state.reason = reason;
    state.lastStats = { loaded, skipped, errors, total: candidates.length };
    localStorage.setItem(CREW_PRELOAD_KEY, JSON.stringify(state));

    console.log(`[CrewPreload] Valmis: +${loaded} uutta, ${skipped} ei vielä julkaistu, ${errors} virhettä`);

    // Jos ladattiin uusia → päivitä näkymiä
    if (loaded > 0) {
      // Päivitä kaverit jos aktiivinen
      if (document.querySelector('.tab-btn[data-tab="friends"].active')) {
        if (typeof renderFriendsView === 'function') renderFriendsView();
      }
      // Päivitä viikkonäkymä jos aktiivinen
      if (document.querySelector('#flights-view-toggle .vt-btn[data-view="week"].active')) {
        if (typeof renderWeekView === 'function') renderWeekView();
      }
    }
  } catch (e) {
    console.warn('[CrewPreload] Virhe:', e);
  } finally {
    window._crewPreloadRunning = false;
  }
}
window.preloadUpcomingCrews = preloadUpcomingCrews;

/* ==============================================================
 * Laukaisimet
 * ============================================================== */

// 1. Kun rosteri synkataan
(function _wrapForceRosterSync() {
  if (typeof window.forceRosterSync !== 'function') return;
  const orig = window.forceRosterSync;
  window.forceRosterSync = async function (...args) {
    const result = await orig.apply(this, args);
    // Käynnistä taustalla
    setTimeout(() => {
      preloadUpcomingCrews('after-roster-sync').catch(() => {});
    }, 4000);
    return result;
  };
})();

// 2. Sovelluksen käynnistyksessä
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => preloadUpcomingCrews('app-launch').catch(() => {}), 8000);
  });
} else {
  setTimeout(() => preloadUpcomingCrews('app-launch').catch(() => {}), 8000);
}

// 3. Online-paluu
window.addEventListener('online', () => {
  setTimeout(() => preloadUpcomingCrews('online').catch(() => {}), 5000);
});

// 4. Periodinen tarkistus (2 h välein)
setInterval(() => {
  preloadUpcomingCrews('interval').catch(() => {});
}, 2 * 60 * 60 * 1000);