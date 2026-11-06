/* ==============================================================
 * INDEXEDDB · Lokikirjan tallennus
 * ============================================================== */
'use strict';

const DB_NAME = 'flightdeck';
const DB_VERSION = 1;
const DB_STORE = 'logbook';

let _db = null;
let _logbookMemory = [];
let _dbReady = false;

/* ---------------- Init ---------------- */
async function dbInit() {
  if (_dbReady) return _logbookMemory;

  if (!window.indexedDB) {
    console.warn('[DB] IndexedDB ei tuettu — käytetään localStoragea');
    _logbookMemory = JSON.parse(localStorage.getItem('easa_logbook_v1') || '[]');
    _dbReady = true;
    return _logbookMemory;
  }

  try {
    _db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          const store = db.createObjectStore(DB_STORE, { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('signedAt', 'signedAt', { unique: false });
        }
      };
    });

    const fromIDB = await _dbReadAllFromIDB();

    let fromLS = [];
    try {
      fromLS = JSON.parse(localStorage.getItem('easa_logbook_v1') || '[]');
    } catch (e) {}

    let fromBackup = [];
    const backupKeys = [
      'easa_logbook_backup_before_nightrecalc',
      'easa_logbook_backup_before_sync',
      'easa_logbook_autobackup_v1'
    ];
    for (const key of backupKeys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const data = JSON.parse(raw);
        const arr = data.entries || data;
        if (Array.isArray(arr) && arr.length > fromBackup.length) {
          fromBackup = arr;
        }
      } catch (e) {}
    }

    // KORJAUS: IDB voittaa AINA, jos siinä on yhtään dataa.
    // Näin varmistetaan, ettei vanha backup ylikirjoita allekirjoitettuja lentoja.
    let winner;
    if (fromIDB.length > 0) {
      winner = { src: 'idb', list: fromIDB };
    } else {
      const candidates = [
        { src: 'ls',     list: fromLS },
        { src: 'backup', list: fromBackup }
      ];
      candidates.sort((a, b) => b.list.length - a.list.length);
      winner = candidates[0];
    }

    if (winner.src !== 'idb' && winner.list.length > 0) {
      console.log(`[DB] Migroidaan ${winner.src} → IndexedDB (${winner.list.length} kirjausta)`);
      await _dbReplaceAllToIDB(winner.list);
      if (winner.src === 'backup' && fromLS.length < winner.list.length) {
        try {
          localStorage.setItem('easa_logbook_v1', JSON.stringify(winner.list));
        } catch (e) {}
      }
    }

    _logbookMemory = winner.list;
    _dbReady = true;
    return _logbookMemory;
  } catch (e) {
    console.error('[DB] Init epäonnistui:', e);
    try {
      const ls = JSON.parse(localStorage.getItem('easa_logbook_v1') || '[]');
      if (ls.length) { _logbookMemory = ls; _dbReady = true; return ls; }
    } catch (e2) {}
    _logbookMemory = [];
    _dbReady = true;
    return _logbookMemory;
  }
}

/* ---------------- IndexedDB-operaatiot ---------------- */
function _dbReadAllFromIDB() {
  return new Promise((resolve) => {
    if (!_db) return resolve([]);
    const tx = _db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

function _dbPutOne(entry) {
  return new Promise((resolve, reject) => {
    if (!_db || !entry?.id) return resolve();
    const tx = _db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const req = store.put(entry);
    req.onsuccess = () => resolve();
    req.onerror = (e) => {
      console.error('[DB] IDB write failed:', e.target?.error);
      reject(e.target?.error || new Error('IDB write failed'));
    };
  });
}

function _dbDeleteOne(id) {
  return new Promise((resolve, reject) => {
    if (!_db || !id) return resolve();
    const tx = _db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target?.error);
  });
}

function _dbClearAll() {
  return new Promise((resolve, reject) => {
    if (!_db) return resolve();
    const tx = _db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target?.error);
  });
}

function _dbReplaceAllToIDB(list) {
  return new Promise((resolve, reject) => {
    if (!_db) return resolve();
    const tx = _db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    store.clear();
    for (const e of list) {
      if (e?.id) store.put(e);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target?.error);
  });
}

/* ---------------- Julkinen API ---------------- */
function dbReadAll() {
  return _logbookMemory.slice();
}

function dbGetOne(id) {
  return _logbookMemory.find(e => e.id === id) || null;
}

function dbPutOne(entry) {
  if (!entry?.id) return Promise.resolve();
  const idx = _logbookMemory.findIndex(e => e.id === entry.id);
  if (idx >= 0) _logbookMemory[idx] = entry;
  else _logbookMemory.push(entry);

  // Palautetaan IDB:n promise, jotta kutsuja voi odottaa tallennusta
  const p = _dbPutOne(entry);
  _mirrorToLocalStorage();
  return p;
}

function dbDeleteOne(id) {
  if (!id) return Promise.resolve();
  _logbookMemory = _logbookMemory.filter(e => e.id !== id);
  const p = _dbDeleteOne(id);
  _mirrorToLocalStorage();
  return p;
}

function dbReplaceAll(list) {
  _logbookMemory = Array.isArray(list) ? list.slice() : [];
  const p = _dbReplaceAllToIDB(_logbookMemory);
  _mirrorToLocalStorage();
  return p;
}

async function dbReplaceAllSafe(newList, options = {}) {
  const oldCount = _logbookMemory.length;
  const newCount = Array.isArray(newList) ? newList.length : 0;

  const isDangerous = oldCount > 0 && newCount < oldCount * 0.5;

  if (!options.force && isDangerous) {
    console.warn(`[DB] ⚠️ Ylikirjoitus: ${oldCount} → ${newCount}`);
    if (!confirm(`Lokikirjassa on ${oldCount} kirjausta, mutta uusi data sisältää vain ${newCount}.\n\nHaluatko varmasti ylikirjoittaa?`)) {
      return false;
    }
  }

  await dbReplaceAll(newList);
  return true;
}
window.dbReplaceAllSafe = dbReplaceAllSafe;

async function dbClearAll(options = {}) {
  if (!options.force && _logbookMemory.length > 0) {
    if (!confirm(`Poistetaanko kaikki ${_logbookMemory.length} kirjausta pysyvästi?`)) {
      return false;
    }
  }
  _logbookMemory = [];
  await _dbClearAll().catch(() => {});
  _mirrorToLocalStorage();
  return true;
}

/* ---------------- localStorage-peili ---------------- */
let _lsMirrorTimer = null;
function _mirrorToLocalStorage() {
  clearTimeout(_lsMirrorTimer);
  _lsMirrorTimer = setTimeout(() => {
    try {
      if (_logbookMemory.length > 500) {
        // KORJAUS: Älä tyhjennä, jos liian iso. Jätetään vanha peili.
        console.warn('[DB] Lokikirja liian iso localStorageen — säilytetään vanha peili');
        return;
      }
      const json = JSON.stringify(_logbookMemory);
      if (json.length < 3_500_000) {
        localStorage.setItem('easa_logbook_v1', json);
      } else {
        console.warn('[DB] Lokikirja liian iso localStorageen — säilytetään vanha peili');
      }
    } catch (e) {
      console.warn('[DB] localStorage-peilin päivitys epäonnistui', e);
    }
  }, 500);
}

/* ---------------- Expose ---------------- */
window.dbInit = dbInit;
window.dbReadAll = dbReadAll;
window.dbGetOne = dbGetOne;
window.dbPutOne = dbPutOne;
window.dbDeleteOne = dbDeleteOne;
window.dbReplaceAll = dbReplaceAll;
window.dbClearAll = dbClearAll;

window.dbDebug = async function () {
  const all = dbReadAll();
  console.log('=== IndexedDB Debug ===');
  console.log('Kirjauksia muistissa:', all.length);
  console.log('IndexedDB tuettu:', !!window.indexedDB);
  console.log('DB valmis:', _dbReady);
  console.log('localStorage peili:', (localStorage.getItem('easa_logbook_v1') || '').length, 'merkkiä');

  if (navigator.storage?.estimate) {
    const est = await navigator.storage.estimate();
    console.log('Arvioitu käyttö:', Math.round(est.usage / 1024), 'KB /',
                Math.round(est.quota / 1024 / 1024), 'MB');
  }
};