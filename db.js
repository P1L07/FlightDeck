/* ==============================================================
 * INDEXEDDB · Lokikirjan tallennus
 * ==============================================================
 * Hybridi:
 *   - Muisti (memory) = nopea synkroninen API
 *   - IndexedDB = pysyvä tallennus
 *   - localStorage = pieni peili (migraatio + fallback)
 *
 * Käyttö:
 *   await dbInit()          → lataa IndexedDB → muistiin
 *   dbSave(entry)           → tallenna muistiin + IDB
 *   dbReadAll()             → synkroninen luku muistista
 *   dbReplaceAll(list)      → korvaa koko lista
 * ============================================================== */

const DB_NAME = 'flightdeck';
const DB_VERSION = 1;
const DB_STORE = 'logbook';

let _db = null;
let _logbookMemory = [];       // ← synkroninen peili
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

    // Lue kaikki lähteet
    const fromIDB = await _dbReadAllFromIDB();

    let fromLS = [];
    try {
      fromLS = JSON.parse(localStorage.getItem('easa_logbook_v1') || '[]');
    } catch (e) {}

    // Etsi suurin backup localStorage:sta
    let fromBackup = [];
    let backupKey = null;
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
          backupKey = key;
        }
      } catch (e) {}
    }


    // ⚠️ VALITSE SUURIN — älä koskaan ylikirjoita suurempaa pienemmällä
    const candidates = [
      { src: 'idb',    list: fromIDB },
      { src: 'ls',     list: fromLS },
      { src: 'backup', list: fromBackup }
    ];
    candidates.sort((a, b) => b.list.length - a.list.length);

    const winner = candidates[0];

    // Jos voittaja ei ole IDB → migroi IDB:hen
    if (winner.src !== 'idb' && winner.list.length > 0) {
      console.log(`[DB] Migroidaan ${winner.src} → IndexedDB (${winner.list.length} kirjausta)`);

      // Merkintä migraatiosta
      try {
        localStorage.setItem('easa_logbook_migration_meta',
          JSON.stringify({
            at: new Date().toISOString(),
            from: winner.src,
            count: winner.list.length,
            prevIDBCount: fromIDB.length
          })
        );
      } catch (e) {}

      await _dbReplaceAllToIDB(winner.list);

      // Päivitä myös localStorage-peili jos backup oli suurempi
      if (winner.src === 'backup' && fromLS.length < winner.list.length) {
        try {
          localStorage.setItem('easa_logbook_v1', JSON.stringify(winner.list));
        } catch (e) {
          console.warn('[DB] localStorage-peili täynnä — käytetään vain IDB');
        }
      }
    }

    _logbookMemory = winner.list;
    _dbReady = true;
    return _logbookMemory;
  } catch (e) {
    console.error('[DB] Init epäonnistui:', e);
    // Viimeinen fallback: yritä lukea jokin lähde
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
  return new Promise((resolve) => {
    if (!_db || !entry?.id) return resolve();
    const tx = _db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const req = store.put(entry);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
}

function _dbDeleteOne(id) {
  return new Promise((resolve) => {
    if (!_db || !id) return resolve();
    const tx = _db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
}

function _dbClearAll() {
  return new Promise((resolve) => {
    if (!_db) return resolve();
    const tx = _db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
}

function _dbReplaceAllToIDB(list) {
  return new Promise((resolve) => {
    if (!_db) return resolve();
    const tx = _db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    store.clear();
    for (const e of list) {
      if (e?.id) store.put(e);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/* ---------------- Julkinen API (synkroninen) ---------------- */
function dbReadAll() {
  return _logbookMemory;
}

function dbGetOne(id) {
  return _logbookMemory.find(e => e.id === id) || null;
}

function dbPutOne(entry) {
  if (!entry?.id) return;
  const idx = _logbookMemory.findIndex(e => e.id === entry.id);
  if (idx >= 0) _logbookMemory[idx] = entry;
  else _logbookMemory.push(entry);

  // Taustalla: IDB + localStorage
  _dbPutOne(entry).catch(() => {});
  _mirrorToLocalStorage();
}

function dbDeleteOne(id) {
  if (!id) return;
  _logbookMemory = _logbookMemory.filter(e => e.id !== id);
  _dbDeleteOne(id).catch(() => {});
  _mirrorToLocalStorage();
}

function dbReplaceAll(list) {
  _logbookMemory = Array.isArray(list) ? list.slice() : [];
  _dbReplaceAllToIDB(_logbookMemory).catch(() => {});
  _mirrorToLocalStorage();
}

/* Estä ylikirjoitus: jos uusi data on pienempi kuin 50% vanhasta → vahvista */
function dbReplaceAllSafe(newList, options = {}) {
  const oldCount = _logbookMemory.length;
  const newCount = Array.isArray(newList) ? newList.length : 0;

  // Jos uusi on paljon pienempi → kysy
  if (!options.force && oldCount > 10 && newCount < oldCount * 0.5) {
    console.warn(`[DB] ⚠️ Ylikirjoitus: ${oldCount} → ${newCount}`);
    if (!confirm(`Lokikirjassa on ${oldCount} kirjausta, mutta uusi data sisältää vain ${newCount}.\n\nHaluatko varmasti ylikirjoittaa?`)) {
      return false;
    }
  }

  dbReplaceAll(newList);
  return true;
}
window.dbReplaceAllSafe = dbReplaceAllSafe;

function dbClearAll() {
  _logbookMemory = [];
  _dbClearAll().catch(() => {});
  _mirrorToLocalStorage();
}

/* ---------------- localStorage-peili (migraatiota varten) ---------------- */
let _lsMirrorTimer = null;
function _mirrorToLocalStorage() {
  clearTimeout(_lsMirrorTimer);
  _lsMirrorTimer = setTimeout(() => {
    try {
      // Peilaa vain jos mahtuu (~4 MB)
      const json = JSON.stringify(_logbookMemory);
      if (json.length < 3_500_000) {
        localStorage.setItem('easa_logbook_v1', json);
      } else {
        // Liian iso → tyhjennä peili ja luota IDB:hen
        localStorage.setItem('easa_logbook_v1', '[]');
        console.warn('[DB] Lokikirja liian iso localStorageen — vain IndexedDB käytössä');
      }
    } catch (e) {}
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

/* ---------------- Debug ---------------- */
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