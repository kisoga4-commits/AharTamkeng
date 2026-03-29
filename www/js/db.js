(() => {
  'use strict';

  const APP_VERSION = '10.00-offline';
  const DB_NAME = 'FAKDU_OFFLINE_INDEXEDDB';
  const DB_VERSION = 3;

  const STORE_KV = 'kv';
  const STORE_META = 'meta';

  const KEY_MASTER_DB = 'master_db';
  const KEY_MASTER_SNAPSHOT = 'master_snapshot';
  const KEY_CLIENT_PROFILE = 'client_profile';
  const KEY_CLIENT_SESSION = 'client_session';
  const KEY_CLIENT_SHOP_ID = 'client_shop_id';
  const KEY_CLIENT_QUEUE = 'client_queue';
  const KEY_CLIENT_LAST_SYNC = 'client_last_sync';
  const KEY_CLIENT_APPLIED_OPERATIONS = 'client_applied_operations';
  const KEY_DRAFTS = 'drafts';
  const KEY_SETTINGS_CACHE = 'settings_cache';
  const KEY_PENDING_PAIR = 'pending_pair';
  const KEY_MENU_IMAGE_CACHE_PREFIX = 'menu_image_cache:';
  const KEY_RUNTIME_FLAGS = 'runtime_flags';

  const META_DEVICE_ID = 'device_install_id';
  const META_CREATED_AT = 'created_at';
  const META_LAST_SAVE_AT = 'last_save_at';
  const META_DB_VERSION = 'db_version';
  const META_APP_VERSION = 'app_version';
  const META_LAST_BACKUP_AT = 'last_backup_at';
  const META_LAST_IMPORT_AT = 'last_import_at';
  const META_PERSISTENT_OK = 'persistent_storage_ok';

  const LEGACY_MASTER_KEY = 'FAKDU_DB_V946';
  const LEGACY_DEVICE_KEY = 'FAKDU_DEVICE_INSTALL_ID';
  const LEGACY_CLIENT_SESSION = 'FAKDU_CLIENT_SESSION';
  const LEGACY_CLIENT_PROFILE_NAME = 'FAKDU_CLIENT_PROFILE_NAME';
  const LEGACY_CLIENT_AVATAR = 'FAKDU_CLIENT_AVATAR';
  const LEGACY_PENDING_PIN = 'FAKDU_PENDING_CLIENT_PIN';
  const LEGACY_PENDING_SHOP_ID = 'FAKDU_PENDING_MASTER_SHOP_ID';
  const LEGACY_PENDING_PAIR_REQUEST_ID = 'FAKDU_PENDING_PAIR_REQUEST_ID';
  const LEGACY_FORCE_CLIENT_MODE = 'FAKDU_FORCE_CLIENT_MODE';

  function hasIndexedDB() {
    return typeof indexedDB !== 'undefined';
  }

  function jsonClone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function nowMs() {
    return Date.now();
  }

  function randomHex(bytes = 8) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function makeDeviceId() {
    return `FDI-${randomHex(5).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  }

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function safeParse(raw, fallback = null) {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function normalizeImportedBackup(parsed) {
    if (!parsed) throw new Error('ไฟล์สำรองข้อมูลว่างหรือไม่ถูกต้อง');
    if (isObject(parsed) && isObject(parsed.payload)) return jsonClone(parsed.payload);
    if (isObject(parsed) && isObject(parsed.data)) return jsonClone(parsed.data);
    if (isObject(parsed) && isObject(parsed.db)) return jsonClone(parsed.db);
    if (isObject(parsed)) return jsonClone(parsed);
    throw new Error('รูปแบบไฟล์สำรองข้อมูลไม่รองรับ');
  }

  let dbPromise = null;

  function openIndexedDB() {
    if (!hasIndexedDB()) {
      return Promise.reject(new Error('เบราว์เซอร์นี้ไม่รองรับ IndexedDB'));
    }
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV);
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          try { db.close(); } catch (_) {}
          dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error('เปิดฐานข้อมูลไม่สำเร็จ'));
      };

      request.onblocked = () => {
        console.warn('[FAKDU DB] IndexedDB blocked');
      };
    });

    return dbPromise;
  }

  async function withStore(storeName, mode, worker) {
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error(`Transaction failed: ${storeName}`));
      tx.onabort = () => reject(tx.error || new Error(`Transaction aborted: ${storeName}`));

      Promise.resolve()
        .then(() => worker(store, tx))
        .then((value) => {
          result = value;
        })
        .catch((error) => {
          try { tx.abort(); } catch (_) {}
          reject(error);
        });
    });
  }

  function idbRequestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  async function kvGet(key) {
    return withStore(STORE_KV, 'readonly', async (store) => idbRequestToPromise(store.get(key)));
  }

  async function kvSet(key, value) {
    return withStore(STORE_KV, 'readwrite', async (store) => {
      await idbRequestToPromise(store.put(value, key));
      return true;
    });
  }

  async function kvDelete(key) {
    return withStore(STORE_KV, 'readwrite', async (store) => {
      await idbRequestToPromise(store.delete(key));
      return true;
    });
  }

  async function metaGet(key) {
    return withStore(STORE_META, 'readonly', async (store) => idbRequestToPromise(store.get(key)));
  }

  async function metaSet(key, value) {
    return withStore(STORE_META, 'readwrite', async (store) => {
      await idbRequestToPromise(store.put(value, key));
      return true;
    });
  }

  async function metaDelete(key) {
    return withStore(STORE_META, 'readwrite', async (store) => {
      await idbRequestToPromise(store.delete(key));
      return true;
    });
  }

  async function requestPersistentStorage() {
    try {
      if (!navigator.storage || typeof navigator.storage.persist !== 'function') return false;
      const granted = await navigator.storage.persist();
      await metaSet(META_PERSISTENT_OK, Boolean(granted));
      return Boolean(granted);
    } catch (_) {
      return false;
    }
  }

  async function estimateStorage() {
    try {
      if (!navigator.storage || typeof navigator.storage.estimate !== 'function') {
        return { quota: 0, usage: 0, usageDetails: {} };
      }
      return await navigator.storage.estimate();
    } catch (_) {
      return { quota: 0, usage: 0, usageDetails: {} };
    }
  }

  async function getDeviceId() {
    const fromMeta = await metaGet(META_DEVICE_ID);
    if (fromMeta) return fromMeta;

    const legacy = localStorage.getItem(LEGACY_DEVICE_KEY);
    if (legacy) {
      await metaSet(META_DEVICE_ID, legacy);
      await metaSet(META_CREATED_AT, nowIso());
      await metaSet(META_DB_VERSION, DB_VERSION);
      await metaSet(META_APP_VERSION, APP_VERSION);
      return legacy;
    }

    const freshId = makeDeviceId();
    await metaSet(META_DEVICE_ID, freshId);
    await metaSet(META_CREATED_AT, nowIso());
    await metaSet(META_DB_VERSION, DB_VERSION);
    await metaSet(META_APP_VERSION, APP_VERSION);
    try { localStorage.setItem(LEGACY_DEVICE_KEY, freshId); } catch (_) {}
    return freshId;
  }

  async function migrateLegacyIfNeeded() {
    const existing = await kvGet(KEY_MASTER_DB);
    if (existing) return existing;

    const legacyRaw = localStorage.getItem(LEGACY_MASTER_KEY);
    if (!legacyRaw) return null;

    const parsed = safeParse(legacyRaw);
    if (!parsed) return null;

    await kvSet(KEY_MASTER_DB, jsonClone(parsed));
    await metaSet(META_LAST_SAVE_AT, nowIso());
    await metaSet(META_DB_VERSION, DB_VERSION);
    await metaSet(META_APP_VERSION, APP_VERSION);
    return parsed;
  }

  async function migrateLegacyClientSessionIfNeeded() {
    const existing = await kvGet(KEY_CLIENT_SESSION);
    if (existing) return existing;

    const legacySession = safeParse(localStorage.getItem(LEGACY_CLIENT_SESSION));
    if (legacySession && legacySession.clientSessionToken) {
      await kvSet(KEY_CLIENT_SESSION, jsonClone(legacySession));
      if (legacySession.shopId) await kvSet(KEY_CLIENT_SHOP_ID, String(legacySession.shopId));
      return legacySession;
    }
    return null;
  }

  async function migrateLegacyClientProfileIfNeeded() {
    const existing = await kvGet(KEY_CLIENT_PROFILE);
    if (existing) return existing;

    const profileName = String(localStorage.getItem(LEGACY_CLIENT_PROFILE_NAME) || '').trim();
    const avatar = String(localStorage.getItem(LEGACY_CLIENT_AVATAR) || '').trim();
    if (!profileName && !avatar) return null;

    const profile = {
      profileName: profileName || 'เครื่องลูก',
      avatar,
      clientId: ''
    };
    await kvSet(KEY_CLIENT_PROFILE, jsonClone(profile));
    return profile;
  }

  async function migrateLegacyPendingPairIfNeeded() {
    const existing = await kvGet(KEY_PENDING_PAIR);
    if (existing) return existing;

    const pin = String(localStorage.getItem(LEGACY_PENDING_PIN) || '').trim();
    const shopId = String(localStorage.getItem(LEGACY_PENDING_SHOP_ID) || '').trim();
    const requestId = String(localStorage.getItem(LEGACY_PENDING_PAIR_REQUEST_ID) || '').trim();
    const forceClientMode = localStorage.getItem(LEGACY_FORCE_CLIENT_MODE) === 'true';
    if (!pin && !shopId && !requestId && !forceClientMode) return null;

    const pending = {
      pin,
      shopId,
      requestId,
      forceClientMode,
      updatedAt: nowMs()
    };
    await kvSet(KEY_PENDING_PAIR, pending);
    return pending;
  }

  async function bootstrap() {
    await requestPersistentStorage();
    await getDeviceId();
    await migrateLegacyIfNeeded();
    await migrateLegacyClientSessionIfNeeded();
    await migrateLegacyClientProfileIfNeeded();
    await migrateLegacyPendingPairIfNeeded();
  }

  async function load() {
    await bootstrap();
    const existing = await kvGet(KEY_MASTER_DB);
    return existing ? jsonClone(existing) : null;
  }

  async function save(data) {
    const cloned = jsonClone(data);
    await kvSet(KEY_MASTER_DB, cloned);
    await metaSet(META_LAST_SAVE_AT, nowIso());
    await metaSet(META_DB_VERSION, DB_VERSION);
    await metaSet(META_APP_VERSION, APP_VERSION);
    try {
      localStorage.setItem(LEGACY_MASTER_KEY, JSON.stringify(cloned));
    } catch (_) {}
    return true;
  }

  async function saveSnapshot(snapshot) {
    await kvSet(KEY_MASTER_SNAPSHOT, jsonClone(snapshot));
    return true;
  }

  async function loadSnapshot() {
    const raw = await kvGet(KEY_MASTER_SNAPSHOT);
    return raw ? jsonClone(raw) : null;
  }

  async function clearMasterData() {
    await kvDelete(KEY_MASTER_DB);
    await kvDelete(KEY_MASTER_SNAPSHOT);
    try { localStorage.removeItem(LEGACY_MASTER_KEY); } catch (_) {}
    return true;
  }

  async function loadClientProfile() {
    await bootstrap();
    const raw = await kvGet(KEY_CLIENT_PROFILE);
    return raw ? jsonClone(raw) : null;
  }

  async function saveClientProfile(profile) {
    const safeProfile = jsonClone(profile || {});
    await kvSet(KEY_CLIENT_PROFILE, safeProfile);
    try {
      if (safeProfile.profileName) localStorage.setItem(LEGACY_CLIENT_PROFILE_NAME, String(safeProfile.profileName));
      if (safeProfile.avatar) localStorage.setItem(LEGACY_CLIENT_AVATAR, String(safeProfile.avatar));
    } catch (_) {}
    return true;
  }

  async function loadClientSession() {
    await bootstrap();
    const raw = await kvGet(KEY_CLIENT_SESSION);
    return raw ? jsonClone(raw) : null;
  }

  async function saveClientSession(session) {
    const safeSession = jsonClone(session || {});
    await kvSet(KEY_CLIENT_SESSION, safeSession);
    if (safeSession && safeSession.shopId) {
      await kvSet(KEY_CLIENT_SHOP_ID, String(safeSession.shopId));
    }
    try {
      localStorage.setItem(LEGACY_CLIENT_SESSION, JSON.stringify(safeSession));
      if (safeSession.shopId) localStorage.setItem(LEGACY_PENDING_SHOP_ID, String(safeSession.shopId));
    } catch (_) {}
    return true;
  }

  async function clearClientSession() {
    await kvDelete(KEY_CLIENT_SESSION);
    await kvDelete(KEY_CLIENT_SHOP_ID);
    try {
      localStorage.removeItem(LEGACY_CLIENT_SESSION);
      localStorage.removeItem(LEGACY_FORCE_CLIENT_MODE);
    } catch (_) {}
    return true;
  }

  async function loadClientShopId() {
    await bootstrap();
    const raw = await kvGet(KEY_CLIENT_SHOP_ID);
    return raw ? String(raw) : '';
  }

  async function saveClientShopId(shopId = '') {
    const safeShopId = String(shopId || '').trim();
    if (!safeShopId) {
      await kvDelete(KEY_CLIENT_SHOP_ID);
      return true;
    }
    await kvSet(KEY_CLIENT_SHOP_ID, safeShopId);
    return true;
  }

  async function loadClientQueue() {
    const raw = await kvGet(KEY_CLIENT_QUEUE);
    return Array.isArray(raw) ? jsonClone(raw) : [];
  }

  async function saveClientQueue(queue) {
    const safeQueue = Array.isArray(queue) ? jsonClone(queue).slice(-500) : [];
    await kvSet(KEY_CLIENT_QUEUE, safeQueue);
    return true;
  }

  async function clearClientQueue() {
    await kvDelete(KEY_CLIENT_QUEUE);
    return true;
  }

  async function loadClientLastSync() {
    const raw = await kvGet(KEY_CLIENT_LAST_SYNC);
    return raw ? jsonClone(raw) : null;
  }

  async function saveClientLastSync(payload) {
    await kvSet(KEY_CLIENT_LAST_SYNC, jsonClone(payload || null));
    return true;
  }

  async function loadClientAppliedOperations() {
    const raw = await kvGet(KEY_CLIENT_APPLIED_OPERATIONS);
    return Array.isArray(raw) ? [...raw] : [];
  }

  async function saveClientAppliedOperations(opIds) {
    const safe = Array.isArray(opIds)
      ? opIds.filter(Boolean).map((v) => String(v)).slice(-1000)
      : [];
    await kvSet(KEY_CLIENT_APPLIED_OPERATIONS, safe);
    return true;
  }

  async function loadDrafts() {
    const raw = await kvGet(KEY_DRAFTS);
    return isObject(raw) ? jsonClone(raw) : {};
  }

  async function saveDrafts(drafts) {
    await kvSet(KEY_DRAFTS, isObject(drafts) ? jsonClone(drafts) : {});
    return true;
  }

  async function loadSettingsCache() {
    const raw = await kvGet(KEY_SETTINGS_CACHE);
    return isObject(raw) ? jsonClone(raw) : {};
  }

  async function saveSettingsCache(settings) {
    await kvSet(KEY_SETTINGS_CACHE, isObject(settings) ? jsonClone(settings) : {});
    return true;
  }

  async function loadMenuImageCache(shopId = 'DEFAULT') {
    const raw = await kvGet(`${KEY_MENU_IMAGE_CACHE_PREFIX}${String(shopId || 'DEFAULT')}`);
    return isObject(raw) ? jsonClone(raw) : {};
  }

  async function saveMenuImageCache(shopId = 'DEFAULT', cache = {}) {
    await kvSet(`${KEY_MENU_IMAGE_CACHE_PREFIX}${String(shopId || 'DEFAULT')}`, isObject(cache) ? jsonClone(cache) : {});
    return true;
  }

  async function clearMenuImageCache(shopId = 'DEFAULT') {
    await kvDelete(`${KEY_MENU_IMAGE_CACHE_PREFIX}${String(shopId || 'DEFAULT')}`);
    return true;
  }

  async function loadPendingPair() {
    await bootstrap();
    const raw = await kvGet(KEY_PENDING_PAIR);
    return raw ? jsonClone(raw) : null;
  }

  async function savePendingPair(payload) {
    const safe = isObject(payload) ? jsonClone(payload) : {};
    safe.updatedAt = nowMs();
    await kvSet(KEY_PENDING_PAIR, safe);
    try {
      if (safe.pin) localStorage.setItem(LEGACY_PENDING_PIN, String(safe.pin));
      if (safe.shopId) localStorage.setItem(LEGACY_PENDING_SHOP_ID, String(safe.shopId));
      if (safe.requestId) localStorage.setItem(LEGACY_PENDING_PAIR_REQUEST_ID, String(safe.requestId));
      if (safe.forceClientMode === true) localStorage.setItem(LEGACY_FORCE_CLIENT_MODE, 'true');
    } catch (_) {}
    return true;
  }

  async function clearPendingPair() {
    await kvDelete(KEY_PENDING_PAIR);
    try {
      localStorage.removeItem(LEGACY_PENDING_PIN);
      localStorage.removeItem(LEGACY_PENDING_SHOP_ID);
      localStorage.removeItem(LEGACY_PENDING_PAIR_REQUEST_ID);
      localStorage.removeItem(LEGACY_FORCE_CLIENT_MODE);
    } catch (_) {}
    return true;
  }

  async function loadRuntimeFlags() {
    const raw = await kvGet(KEY_RUNTIME_FLAGS);
    return isObject(raw) ? jsonClone(raw) : {};
  }

  async function saveRuntimeFlags(flags) {
    await kvSet(KEY_RUNTIME_FLAGS, isObject(flags) ? jsonClone(flags) : {});
    return true;
  }

  async function exportBackup() {
    const payload = {
      version: APP_VERSION,
      exportedAt: nowIso(),
      data: await load(),
      snapshot: await loadSnapshot(),
      clientProfile: await loadClientProfile(),
      clientSession: await loadClientSession(),
      drafts: await loadDrafts(),
      settings: await loadSettingsCache()
    };
    await metaSet(META_LAST_BACKUP_AT, nowIso());
    return payload;
  }

  async function importBackup(rawInput) {
    const parsed = typeof rawInput === 'string' ? safeParse(rawInput) : rawInput;
    const normalized = normalizeImportedBackup(parsed);
    await save(normalized);
    await metaSet(META_LAST_IMPORT_AT, nowIso());
    return true;
  }

  async function wipeClientLocal() {
    await clearClientSession();
    await clearClientQueue();
    await kvDelete(KEY_CLIENT_PROFILE);
    await kvDelete(KEY_CLIENT_LAST_SYNC);
    await kvDelete(KEY_CLIENT_APPLIED_OPERATIONS);
    await clearPendingPair();
    return true;
  }

  async function getStorageInfo() {
    return estimateStorage();
  }

  const api = {
    APP_VERSION,
    DB_NAME,
    DB_VERSION,
    load,
    save,
    saveSnapshot,
    loadSnapshot,
    clearMasterData,
    loadClientProfile,
    saveClientProfile,
    loadClientSession,
    saveClientSession,
    clearClientSession,
    loadClientShopId,
    saveClientShopId,
    loadClientQueue,
    saveClientQueue,
    clearClientQueue,
    loadClientLastSync,
    saveClientLastSync,
    loadClientAppliedOperations,
    saveClientAppliedOperations,
    loadDrafts,
    saveDrafts,
    loadSettingsCache,
    saveSettingsCache,
    loadMenuImageCache,
    saveMenuImageCache,
    clearMenuImageCache,
    loadPendingPair,
    savePendingPair,
    clearPendingPair,
    loadRuntimeFlags,
    saveRuntimeFlags,
    exportBackup,
    importBackup,
    wipeClientLocal,
    getStorageInfo,
    requestPersistentStorage,
    estimateStorage,
    getDeviceId,
    bootstrap,
    _kvGet: kvGet,
    _kvSet: kvSet,
    _kvDelete: kvDelete,
    _metaGet: metaGet,
    _metaSet: metaSet,
    _metaDelete: metaDelete
  };

  window.FakduDB = api;
})();
