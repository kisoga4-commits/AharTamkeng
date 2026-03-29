(() => {
  'use strict';

  const APP_VERSION = '10.23-firebase-license-check';
  const LS_INSTALL_ID = 'FAKDU_VAULT_INSTALL_ID';
  const LS_SHOP_ID = 'FAKDU_VAULT_SHOP_ID';
  const LS_LICENSE = 'FAKDU_VAULT_GENKEY';

  function now() {
    return Date.now();
  }

  function safeJsonParse(raw, fallback = null) {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function randomString(len = 10) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      const arr = new Uint32Array(len);
      window.crypto.getRandomValues(arr);
      for (let i = 0; i < len; i += 1) out += chars[arr[i] % chars.length];
      return out;
    }
    for (let i = 0; i < len; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function normalizeShopId(value = '') {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function normalizeLicenseCode(value = '') {
    return String(value || '').trim();
  }

  function ensureDbShape(db) {
    const target = db && typeof db === 'object' ? db : {};

    if (!target.recovery || typeof target.recovery !== 'object') {
      target.recovery = { phone: '', color: '', animal: '' };
    }

    if (typeof target.licenseToken !== 'string') target.licenseToken = '';
    if (typeof target.licenseActive !== 'boolean') target.licenseActive = false;
    if (typeof target.shopId !== 'string') target.shopId = '';

    if (!target.vault || typeof target.vault !== 'object') {
      target.vault = {
        installId: '',
        activatedAt: null,
        lastValidatedAt: null,
        status: 'idle',
        note: '',
        licenseId: '',
        plan: 'basic',
        features: []
      };
    }

    return target;
  }

  async function getInstallId(provided = '') {
    const direct = String(provided || '').trim();
    if (direct) {
      localStorage.setItem(LS_INSTALL_ID, direct);
      return direct;
    }

    let installId = localStorage.getItem(LS_INSTALL_ID) || '';
    if (!installId) {
      installId = `FDI-${randomString(8)}-${Date.now().toString(36).toUpperCase()}`;
      localStorage.setItem(LS_INSTALL_ID, installId);
    }
    return installId;
  }

  async function ensureShopId(db, requestedShopId = '') {
    ensureDbShape(db);
    const preferred = normalizeShopId(requestedShopId || db?.shopId || localStorage.getItem(LS_SHOP_ID) || '');
    const sid = preferred || `SHOP-${randomString(8)}`;
    if (db) db.shopId = sid;
    localStorage.setItem(LS_SHOP_ID, sid);
    return sid;
  }

  async function waitFirebaseReady(timeoutMs = 4000) {
    const startedAt = now();
    while (now() - startedAt < timeoutMs) {
      if (window.FakduFirebase && window.FakduFirebase.ready && window.FakduFirebase.app) {
        return window.FakduFirebase;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    throw new Error('Firebase ยังไม่พร้อมใช้งาน');
  }

  function getRealtimeDbUrl(firebaseRuntime) {
    const direct = String(firebaseRuntime?.app?.options?.databaseURL || '').trim();
    if (direct) return direct.replace(/\/+$/, '');
    const fromDb = String(firebaseRuntime?.db?.app?.options?.databaseURL || '').trim();
    if (fromDb) return fromDb.replace(/\/+$/, '');
    throw new Error('ไม่พบ databaseURL จาก firebase-init.js');
  }

  async function verifyLicense(shopId, licenseCode) {
    const sid = normalizeShopId(shopId);
    const code = normalizeLicenseCode(licenseCode);

    if (!sid || !code) return false;

    let firebaseRuntime;
    try {
      firebaseRuntime = await waitFirebaseReady();
    } catch (_) {
      return false;
    }

    try {
      const canUseSdk = typeof firebaseRuntime?.ref === 'function' && typeof firebaseRuntime?.get === 'function';
      let licenseDoc = null;

      if (canUseSdk) {
        const licenseRef = firebaseRuntime.ref(firebaseRuntime.db, `licenses/${sid}`);
        const snap = await firebaseRuntime.get(licenseRef);
        licenseDoc = snap.exists() ? snap.val() : null;
      } else {
        const baseUrl = getRealtimeDbUrl(firebaseRuntime);
        const pathShopId = encodeURIComponent(sid);
        const response = await fetch(`${baseUrl}/licenses/${pathShopId}.json`, {
          method: 'GET',
          cache: 'no-store'
        });
        if (!response.ok) return false;
        licenseDoc = await response.json();
      }

      if (!licenseDoc || typeof licenseDoc !== 'object') return false;
      if (licenseDoc.active !== true) return false;
      if (String(licenseDoc.licenseCode || '') !== code) return false;

      return true;
    } catch (_) {
      return false;
    }
  }

  async function checkLicenseFromRealtimeDb({ shopId = '', licenseCode = '' } = {}) {
    const sid = normalizeShopId(shopId);
    const code = normalizeLicenseCode(licenseCode);

    if (!sid) {
      return { valid: false, message: 'ไม่พบ shopId สำหรับตรวจ license' };
    }
    if (!code) {
      return { valid: false, message: 'กรอกรหัส license ก่อน' };
    }

    const valid = await verifyLicense(sid, code);
    if (!valid) {
      return { valid: false, message: 'license ไม่ถูกต้องหรือยังไม่ active' };
    }

    return {
      valid: true,
      token: code,
      payload: {
        shopId: sid,
        active: true,
        source: 'firebase_realtime_db'
      },
      message: 'ตรวจสอบ license ผ่าน'
    };
  }

  async function getActivationRequest({ shopId = '', deviceId = '', db = {} } = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId(db, shopId);
    const installId = await getInstallId(deviceId);
    const request = {
      type: 'fakdu_license_check',
      shopId: sid,
      installId,
      note: 'ระบบนี้เช็กตรงจาก Firebase Realtime Database ที่ path licenses/{shopId}'
    };
    return { ok: true, request, printable: JSON.stringify(request, null, 2) };
  }

  async function createGenKey() {
    return { ok: false, message: 'ปิด GENKEY ชั่วคราว: ใช้การเช็กจาก Firebase Realtime Database แทน' };
  }

  async function createLicenseToken() {
    return { ok: false, message: 'ใช้ licenseCode จาก owner แล้วเช็กกับ Firebase โดยตรง' };
  }

  async function validateProKey({ key = '', shopId = '', deviceId = '', db = {} } = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId(db, shopId);
    const installId = await getInstallId(deviceId);
    const code = normalizeLicenseCode(key);

    const result = await checkLicenseFromRealtimeDb({ shopId: sid, licenseCode: code });
    if (!result.valid) {
      db.licenseActive = false;
      db.vault.installId = installId;
      db.vault.lastValidatedAt = now();
      db.vault.status = 'invalid';
      db.vault.note = result.message || 'ไม่ผ่านการตรวจสอบ license';
      return result;
    }

    db.shopId = sid;
    db.licenseToken = code;
    db.licenseActive = true;
    db.vault.installId = installId;
    db.vault.activatedAt = db.vault.activatedAt || now();
    db.vault.lastValidatedAt = now();
    db.vault.status = 'active';
    db.vault.note = result.message || 'license valid';
    db.vault.licenseId = sid;
    db.vault.plan = 'pro';
    db.vault.features = ['all'];

    localStorage.setItem(LS_LICENSE, code);

    return {
      valid: true,
      token: code,
      shopId: sid,
      licenseId: db.vault.licenseId,
      plan: db.vault.plan,
      features: db.vault.features,
      message: db.vault.note
    };
  }

  async function validateLicenseToken({ token = '', shopId = '', deviceId = '', db = {} } = {}) {
    return validateProKey({ key: token, shopId, deviceId, db });
  }

  async function activateProKey({ key = '', shopId = '', deviceId = '', db = {} } = {}) {
    return validateProKey({ key, shopId, deviceId, db });
  }

  async function isProActive(db = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId(db);
    const installId = await getInstallId();
    const code = normalizeLicenseCode(db.licenseToken || localStorage.getItem(LS_LICENSE) || '');

    if (!code) {
      db.licenseActive = false;
      db.vault.installId = installId;
      db.vault.status = 'idle';
      db.vault.note = 'ยังไม่มี licenseCode';
      return false;
    }

    const result = await checkLicenseFromRealtimeDb({ shopId: sid, licenseCode: code });

    db.vault.installId = installId;
    db.vault.lastValidatedAt = now();

    if (!result.valid) {
      db.licenseActive = false;
      db.vault.status = 'invalid';
      db.vault.note = result.message || 'license ไม่ผ่านการตรวจสอบ';
      return false;
    }

    db.licenseToken = code;
    db.licenseActive = true;
    db.vault.status = 'active';
    db.vault.note = result.message || 'license valid';
    db.vault.licenseId = sid;
    db.vault.plan = 'pro';
    db.vault.features = ['all'];
    localStorage.setItem(LS_LICENSE, code);
    return true;
  }

  async function clearLicense(db = {}) {
    ensureDbShape(db);
    db.licenseToken = '';
    db.licenseActive = false;
    db.vault = {
      installId: db.vault.installId || '',
      activatedAt: null,
      lastValidatedAt: null,
      status: 'idle',
      note: '',
      licenseId: '',
      plan: 'basic',
      features: []
    };

    localStorage.removeItem(LS_LICENSE);
    return { ok: true };
  }

  async function verifyRecoveryAnswers({ phone = '', color = '', animal = '', db = {} } = {}) {
    ensureDbShape(db);
    const expected = db.recovery || {};
    const ok = String(phone || '').trim() === String(expected.phone || '').trim()
      && String(color || '').trim() === String(expected.color || '').trim()
      && String(animal || '').trim() === String(expected.animal || '').trim();
    return { valid: ok, message: ok ? 'ข้อมูลช่วยจำถูกต้อง' : 'ข้อมูลช่วยจำไม่ตรงกัน' };
  }

  async function exportVaultBackup(db = {}) {
    ensureDbShape(db);
    const payload = {
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      shopId: db.shopId || localStorage.getItem(LS_SHOP_ID) || '',
      licenseToken: String(db.licenseToken || ''),
      licenseActive: Boolean(db.licenseActive),
      vault: clone(db.vault || {})
    };
    return {
      ok: true,
      payload,
      raw: JSON.stringify(payload, null, 2),
      filename: `fakdu-vault-backup-${payload.shopId || 'unknown'}-${new Date().toISOString().slice(0, 10)}.json`
    };
  }

  async function importVaultBackup(rawText, db = {}) {
    ensureDbShape(db);
    const parsed = safeJsonParse(rawText);
    if (!parsed || typeof parsed !== 'object') return { ok: false, message: 'ไฟล์ backup ไม่ถูกต้อง' };

    db.shopId = normalizeShopId(parsed.shopId || db.shopId || '');
    if (typeof parsed.licenseToken === 'string') db.licenseToken = normalizeLicenseCode(parsed.licenseToken);
    if (typeof parsed.licenseActive === 'boolean') db.licenseActive = parsed.licenseActive;
    if (parsed.vault && typeof parsed.vault === 'object') db.vault = { ...db.vault, ...clone(parsed.vault) };

    if (db.shopId) localStorage.setItem(LS_SHOP_ID, db.shopId);
    if (db.licenseToken) localStorage.setItem(LS_LICENSE, db.licenseToken);

    return { ok: true, message: 'นำเข้าข้อมูล vault สำเร็จ' };
  }

  async function getStatus(db = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId(db);
    return {
      appVersion: APP_VERSION,
      shopId: sid,
      installId: await getInstallId(),
      licenseExists: Boolean(String(db.licenseToken || '').trim()),
      licenseActive: Boolean(db.licenseActive),
      vault: clone(db.vault || {})
    };
  }

  function buildGenKeyFromParts({ header, payload, signature }) {
    return JSON.stringify({ header: header || {}, payload: payload || {}, signature: signature || '' });
  }

  window.FakduVault = {
    APP_VERSION,
    normalizeShopId,
    verifyLicense,
    getActivationRequest,
    createGenKey,
    createLicenseToken,
    validateProKey,
    validateLicenseToken,
    activateProKey,
    isProActive,
    clearLicense,
    verifyRecoveryAnswers,
    exportVaultBackup,
    importVaultBackup,
    getStatus,
    buildGenKeyFromParts
  };
})();
