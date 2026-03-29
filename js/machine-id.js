/**
 * Standalone Triple Layer Persistent Seed module.
 * Vanilla JS (ES6), no external dependencies.
 */

const DB_NAME = 'sec-layer-db';
const STORE_NAME = 'seeds';
const STORE_KEY = 'machine-seed';
const CACHE_NAME = 'sec-layer-cache';
const CACHE_KEY = '/__sec_seed__';
const LS_SEED_KEY = 'sec_seed_id';
const LS_INSTALLED_AT_KEY = 'sec_first_install_ts';
const LS_CANVAS_FP_KEY = 'sec_canvas_fp';

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    return (
      hex.slice(0, 4).join('') + '-' +
      hex.slice(4, 6).join('') + '-' +
      hex.slice(6, 8).join('') + '-' +
      hex.slice(8, 10).join('') + '-' +
      hex.slice(10, 16).join('')
    );
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function safeNowISO() {
  try {
    return new Date().toISOString();
  } catch (err) {
    return String(Date.now());
  }
}

function getCanvasFingerprint() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 220;
    canvas.height = 60;

    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(5, 5, 150, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('MachineID-FP', 8, 8);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText(navigator.userAgent || 'ua', 8, 28);

    return canvas.toDataURL();
  } catch (err) {
    return '';
  }
}

function openSeedDB() {
  return new Promise((resolve, reject) => {
    try {
      if (!('indexedDB' in window)) {
        resolve(null);
        return;
      }

      const req = indexedDB.open(DB_NAME, 1);

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    } catch (err) {
      reject(err);
    }
  });
}

async function readFromIndexedDB() {
  try {
    const db = await openSeedDB();
    if (!db) return null;

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(STORE_KEY);

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
      tx.onabort = () => db.close();
    });
  } catch (err) {
    return null;
  }
}

async function writeToIndexedDB(seed) {
  try {
    const db = await openSeedDB();
    if (!db) return false;

    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(seed, STORE_KEY);

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error('IndexedDB write failed'));
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error || new Error('IndexedDB write aborted'));
      };
    });

    return true;
  } catch (err) {
    return false;
  }
}

async function readFromCache() {
  try {
    if (!('caches' in window)) return null;
    const cache = await caches.open(CACHE_NAME);
    const res = await cache.match(CACHE_KEY);
    if (!res) return null;
    const text = await res.text();
    return text || null;
  } catch (err) {
    return null;
  }
}

async function writeToCache(seed) {
  try {
    if (!('caches' in window)) return false;
    const cache = await caches.open(CACHE_NAME);
    await cache.put(
      CACHE_KEY,
      new Response(seed, {
        headers: { 'Content-Type': 'text/plain' }
      })
    );
    return true;
  } catch (err) {
    return false;
  }
}

function readFromLocalStorageLayer() {
  try {
    const seed = localStorage.getItem(LS_SEED_KEY);
    const installedAt = localStorage.getItem(LS_INSTALLED_AT_KEY);
    const canvasFp = localStorage.getItem(LS_CANVAS_FP_KEY);

    return {
      seed: seed || null,
      installedAt: installedAt || null,
      canvasFp: canvasFp || null
    };
  } catch (err) {
    return { seed: null, installedAt: null, canvasFp: null };
  }
}

function writeToLocalStorageLayer(seed) {
  try {
    localStorage.setItem(LS_SEED_KEY, seed);

    if (!localStorage.getItem(LS_INSTALLED_AT_KEY)) {
      localStorage.setItem(LS_INSTALLED_AT_KEY, safeNowISO());
    }

    if (!localStorage.getItem(LS_CANVAS_FP_KEY)) {
      localStorage.setItem(LS_CANVAS_FP_KEY, getCanvasFingerprint());
    }

    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Triple Layer self-healing Machine ID.
 * - Check all 3 layers (IndexedDB, Cache API, LocalStorage)
 * - If at least one exists: choose one and restore missing layers
 * - If none exists: generate new UUID and write to all layers
 */
export async function getOrGenerateMachineID() {
  const [idbSeed, cacheSeed] = await Promise.all([
    readFromIndexedDB(),
    readFromCache()
  ]);

  const lsLayer = readFromLocalStorageLayer();
  const lsSeed = lsLayer.seed;

  const masterSeed = idbSeed || cacheSeed || lsSeed || generateUUID();

  // Self-healing: ensure all layers are restored
  await Promise.all([
    idbSeed === masterSeed ? Promise.resolve(true) : writeToIndexedDB(masterSeed),
    cacheSeed === masterSeed ? Promise.resolve(true) : writeToCache(masterSeed)
  ]);

  if (lsSeed !== masterSeed || !lsLayer.installedAt || !lsLayer.canvasFp) {
    writeToLocalStorageLayer(masterSeed);
  }

  return masterSeed;
}
