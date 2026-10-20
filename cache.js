/* ==============================================================
 * CACHE · Yhtenäinen välimuistikerros
 * ==============================================================
 * - Memory cache (nopea, session-lifetime)
 * - localStorage cache (pysyvä, selviää reloadista)
 * - getOrFetch: noutaa tai hakee, dedupoi in-flight pyynnöt
 * - Prefix-pohjainen invalidointi
 * - Stale-while-revalidate
 * ============================================================== */
'use strict';

const Cache = (() => {
  const PREFIX = 'fdcache:';
  const mem = new Map();
  const inFlight = new Map();

  function _key(k) { return PREFIX + String(k); }

  function _readLS(k) {
    try { const raw = localStorage.getItem(_key(k)); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function _writeLS(k, entry) {
    try { localStorage.setItem(_key(k), JSON.stringify(entry)); } catch (e) {}
  }
  function _deleteLS(k) {
    try { localStorage.removeItem(_key(k)); } catch (e) {}
  }

  function get(key, options = {}) {
    const { mode = 'both', allowStale = false } = options;
    const now = Date.now();

    if (mode === 'mem' || mode === 'both') {
      const m = mem.get(key);
      if (m) {
        if (!m.expiresAt || m.expiresAt > now) {
          return { value: m.value, stale: false, from: 'memory', savedAt: m.savedAt };
        }
        if (allowStale && (!m.staleAt || m.staleAt > now)) {
          return { value: m.value, stale: true, from: 'memory', savedAt: m.savedAt };
        }
        if (!allowStale) mem.delete(key);
      }
    }

    if (mode === 'persist' || mode === 'both') {
      const e = _readLS(key);
      if (e) {
        if (!e.expiresAt || e.expiresAt > now) {
          return { value: e.value, stale: false, from: 'persist', savedAt: e.savedAt };
        }
        if (allowStale && (!e.staleAt || e.staleAt > now)) {
          return { value: e.value, stale: true, from: 'persist', savedAt: e.savedAt };
        }
        if (!allowStale) _deleteLS(key);
      }
    }

    return null;
  }

  function set(key, value, options = {}) {
    const { ttlMs = 0, staleTtlMs = 0, mode = 'both' } = options;
    const now = Date.now();
    const entry = {
      value,
      expiresAt: ttlMs > 0 ? now + ttlMs : 0,
      staleAt: staleTtlMs > 0 ? now + ttlMs + staleTtlMs : 0,
      savedAt: now
    };
    if (mode === 'mem' || mode === 'both') mem.set(key, entry);
    if (mode === 'persist' || mode === 'both') _writeLS(key, entry);
    return value;
  }

  function del(key) {
    mem.delete(key);
    _deleteLS(key);
  }

  async function getOrFetch(key, options, fetcher) {
    const {
      allowStale = false, ttlMs = 0, staleTtlMs = 0,
      mode = 'both', forceRefresh = false
    } = options;

    if (!forceRefresh) {
      const hit = get(key, { mode, allowStale: false });
      if (hit) return hit.value;
    }

    if (inFlight.has(key)) return await inFlight.get(key);

    // Stale-while-revalidate
    const staleHit = !forceRefresh ? get(key, { mode, allowStale: true }) : null;
    if (staleHit && staleHit.stale) {
      if (!inFlight.has(key)) {
        const p = fetcher()
          .then(v => { set(key, v, { ttlMs, staleTtlMs, mode }); return v; })
          .catch(e => { console.warn(`[Cache] Background refresh failed (${key}):`, e.message); return null; })
          .finally(() => inFlight.delete(key));
        inFlight.set(key, p);
      }
      return staleHit.value;
    }

    const p = fetcher()
      .then(v => { set(key, v, { ttlMs, staleTtlMs, mode }); return v; })
      .finally(() => inFlight.delete(key));

    inFlight.set(key, p);
    return await p;
  }

  function invalidate(prefix) {
    const pfx = String(prefix);
    for (const k of [...mem.keys()]) {
      if (k.startsWith(pfx)) mem.delete(k);
    }
    try {
      const lsKeys = Object.keys(localStorage);
      for (const fullKey of lsKeys) {
        if (fullKey.startsWith(PREFIX + pfx)) localStorage.removeItem(fullKey);
      }
    } catch (e) {}
  }

  function invalidateAll() {
    mem.clear();
    try {
      Object.keys(localStorage).filter(k => k.startsWith(PREFIX))
        .forEach(k => localStorage.removeItem(k));
    } catch (e) {}
  }

  function stats() {
    let lsCount = 0;
    try { lsCount = Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).length; } catch (e) {}
    return { mem: mem.size, inFlight: inFlight.size, ls: lsCount };
  }

  return { get, set, delete: del, getOrFetch, invalidate, invalidateAll, stats };
})();

window.Cache = Cache;

Cache.debug = function() {
  const s = Cache.stats();
  console.log('=== Cache Debug ===');
  console.log('Memory:', s.mem, 'keys');
  console.log('In-flight:', s.inFlight, 'requests');
  console.log('Persistent:', s.ls, 'keys');
  try {
    const keys = Object.keys(localStorage)
      .filter(k => k.startsWith('fdcache:'))
      .map(k => k.replace('fdcache:', ''))
      .sort();
    console.group('Keys');
    keys.forEach(k => console.log(' ', k));
    console.groupEnd();
  } catch (e) {}
};