(() => {
  'use strict';

  const APP_VERSION = '10.24-genkey-offline-skeleton';
  const LS_INSTALL_ID = 'FAKDU_VAULT_INSTALL_ID';
  const LS_SHOP_ID = 'FAKDU_VAULT_SHOP_ID';
  const LS_LICENSE = 'FAKDU_VAULT_GENKEY';
  const LS_PRO_UNLOCKED = 'FAKDU_PRO_UNLOCKED';
  const LS_PRO_SHOP_ID = 'FAKDU_PRO_SHOP_ID';

  function lsGet(key, fallback = '') {
    try { return localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (_) { return false; }
  }
  function lsRemove(key) {
    try { localStorage.removeItem(key); return true; } catch (_) { return false; }
  }

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

  function saveProStatus(shopId = '') {
    const sid = normalizeShopId(shopId);
    if (!sid) return false;
    lsSet(LS_PRO_UNLOCKED, 'true');
    lsSet(LS_PRO_SHOP_ID, sid);
    return true;
  }

  function clearProStatus() {
    lsRemove(LS_PRO_UNLOCKED);
    lsRemove(LS_PRO_SHOP_ID);
  }

  function loadProStatus(shopId = '') {
    const sid = normalizeShopId(shopId);
    const unlocked = lsGet(LS_PRO_UNLOCKED) === 'true';
    const storedShopId = normalizeShopId(lsGet(LS_PRO_SHOP_ID) || '');

    if (!unlocked) return { unlocked: false, shopId: storedShopId };
    if (!storedShopId) {
      clearProStatus();
      return { unlocked: false, shopId: '' };
    }
    if (sid && sid !== storedShopId) {
      clearProStatus();
      return { unlocked: false, shopId: storedShopId };
    }
    return { unlocked: true, shopId: storedShopId };
  }

  async function initProStatus({ db = {}, shopId = '' } = {}) {
    const proUnlocked = lsGet(LS_PRO_UNLOCKED) === 'true';
    const proShopId = normalizeShopId(lsGet(LS_PRO_SHOP_ID) || '');

    if (!proUnlocked || !proShopId) return false;

    const currentShopId = normalizeShopId(
      shopId
      || db?.shopId
      || getShopIdFromUnlockUi()
      || lsGet(LS_SHOP_ID)
      || ''
    );

    if (currentShopId && currentShopId !== proShopId) {
      clearProStatus();
      return false;
    }

    const currentLicenseCode = normalizeLicenseCode(db?.licenseToken || lsGet(LS_LICENSE) || '');
    if (!currentLicenseCode) {
      clearProStatus();
      return false;
    }

    const verifyResult = await verifyLicenseDetail(currentLicenseCode, { db, shopId: proShopId });
    if (!verifyResult.valid) {
      clearProStatus();
      return false;
    }

    saveProStatus(proShopId);
    return true;
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
      lsSet(LS_INSTALL_ID, direct);
      return direct;
    }

    let installId = lsGet(LS_INSTALL_ID) || '';
    if (!installId) {
      installId = `FDI-${randomString(8)}-${Date.now().toString(36).toUpperCase()}`;
      lsSet(LS_INSTALL_ID, installId);
    }
    return installId;
  }

  function getShopIdFromUnlockUi() {
    const el = document.getElementById('display-hwid');
    const uiShopId = normalizeShopId(el?.textContent || '');
    return uiShopId || '';
  }

  function getCurrentShopId({ db = {}, shopId = '' } = {}) {
    const sid = normalizeShopId(
      shopId
      || getShopIdFromUnlockUi()
      || db?.shopId
      || lsGet(LS_SHOP_ID)
      || ''
    );
    if (sid) lsSet(LS_SHOP_ID, sid);
    return sid;
  }

  function parseGenkeyPayload(genkey = '') {
    const raw = normalizeLicenseCode(genkey);
    const parsed = safeJsonParse(raw, null);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.payload || typeof parsed.payload !== 'object') return null;
    return parsed;
  }

  async function getRequestCode({ shopId = '', deviceId = '', db = {} } = {}) {
    ensureDbShape(db);
    const sid = getCurrentShopId({ db, shopId });
    if (!sid) return { ok: false, message: 'ไม่พบ SHOP ID ของร้านนี้' };
    const installId = await getInstallId(deviceId);
    const request = {
      type: 'fakdu_genkey_offline_request',
      version: 1,
      shopId: sid,
      installId,
      issuedAt: now(),
      note: 'โค้ดคำขอสำหรับออก GENKEY offline (รอบนี้ยังไม่ตรวจลายเซ็นจริง)'
    };
    return { ok: true, request, printable: JSON.stringify(request, null, 2) };
  }

  async function activateWithGenkey(genkey = '', { shopId = '', deviceId = '', db = {} } = {}) {
    ensureDbShape(db);
    const sid = getCurrentShopId({ db, shopId });
    if (!sid) return { valid: false, message: 'ไม่พบ SHOP ID ของร้านนี้' };
    const installId = await getInstallId(deviceId);
    const code = normalizeLicenseCode(genkey);
    if (!code) return { valid: false, message: 'กรอกรหัสปลดล็อกก่อน' };

    const parsed = parseGenkeyPayload(code);
    if (!parsed) {
      if (code.length < 6) return { valid: false, message: 'รหัสปลดล็อกไม่ถูกต้อง' };
      return {
        valid: true,
        token: code,
        payload: {
          shopId: sid,
          installId,
          plan: 'pro',
          features: ['all'],
          source: 'legacy_offline'
        },
        message: 'เปิดใช้โหมด Offline ชั่วคราว (ยังไม่ตรวจลายเซ็น GENKEY)'
      };
    }

    const payload = parsed.payload || {};
    const payloadShopId = normalizeShopId(payload.shopId || '');
    if (!payloadShopId) return { valid: false, message: 'GENKEY ไม่มี shopId' };
    if (payloadShopId !== sid) return { valid: false, message: 'GENKEY ไม่ตรงกับ SHOP ID นี้' };

    const payloadInstallId = String(payload.installId || '').trim();
    if (payloadInstallId && payloadInstallId !== installId) {
      return { valid: false, message: 'GENKEY ไม่ตรงกับอุปกรณ์นี้' };
    }

    const expiresAt = Number(payload.expiresAt || 0);
    if (Number.isFinite(expiresAt) && expiresAt > 0 && now() > expiresAt) {
      return { valid: false, message: 'GENKEY หมดอายุแล้ว' };
    }

    return {
      valid: true,
      token: code,
      payload: {
        shopId: payloadShopId,
        installId: payloadInstallId || installId,
        plan: String(payload.plan || 'pro'),
        features: Array.isArray(payload.features) ? payload.features : ['all'],
        source: 'genkey_offline'
      },
      message: 'ตรวจสอบ GENKEY (offline) สำเร็จ'
    };
  }

  async function verifyLicenseDetail(inputCode = '', { db = {}, shopId = '' } = {}) {
    const sid = getCurrentShopId({ db, shopId });
    const code = normalizeLicenseCode(inputCode);

    if (!sid) {
      return { valid: false, message: 'ไม่พบ SHOP ID ของร้านนี้' };
    }
    if (!code) {
      return { valid: false, message: 'กรอกรหัสปลดล็อกก่อน' };
    }

    const result = await activateWithGenkey(code, { db, shopId: sid });
    return { valid: Boolean(result.valid), message: result.message || '' };
  }

  async function verifyLicense(inputCode = '', context = {}) {
    const result = await verifyLicenseDetail(inputCode, context);
    const sid = getCurrentShopId(context);

    if (result.valid && sid) {
      saveProStatus(sid);
      return true;
    }

    clearProStatus();
    return false;
  }

  async function checkLicenseFromRealtimeDb({ shopId = '', licenseCode = '', deviceId = '', db = {} } = {}) {
    const sid = getCurrentShopId({ shopId });
    const code = normalizeLicenseCode(licenseCode);

    if (!sid) {
      return { valid: false, message: 'ไม่พบ shopId สำหรับตรวจ license' };
    }
    if (!code) {
      return { valid: false, message: 'กรอกรหัส license ก่อน' };
    }

    return activateWithGenkey(code, { shopId: sid, deviceId, db });
  }

  async function getActivationRequest({ shopId = '', deviceId = '', db = {} } = {}) {
    return getRequestCode({ shopId, deviceId, db });
  }

  async function createGenKey() {
    return { ok: false, message: 'ยังไม่เปิดสร้าง GENKEY อัตโนมัติในแอป (รองรับเฉพาะ activate offline)' };
  }

  async function createLicenseToken() {
    return { ok: false, message: 'ยกเลิก license token แบบ Firebase แล้ว ให้ใช้ GENKEY offline แทน' };
  }

  async function validateProKey({ key = '', shopId = '', deviceId = '', db = {} } = {}) {
    ensureDbShape(db);
    const sid = getCurrentShopId({ db, shopId });
    if (!sid) {
      db.licenseActive = false;
      return { valid: false, message: 'ไม่พบ SHOP ID ของร้านนี้' };
    }
    const installId = await getInstallId(deviceId);
    const code = normalizeLicenseCode(key);

    const result = await activateWithGenkey(code, { shopId: sid, deviceId: installId, db });
    if (!result.valid) {
      db.licenseActive = false;
      db.vault.installId = installId;
      db.vault.lastValidatedAt = now();
      db.vault.status = 'invalid';
      db.vault.note = result.message || 'ไม่ผ่านการตรวจสอบ license';
      clearProStatus();
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
    db.vault.plan = result?.payload?.plan || 'pro';
    db.vault.features = Array.isArray(result?.payload?.features) ? result.payload.features : ['all'];

    lsSet(LS_LICENSE, code);
    saveProStatus(sid);

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
    const sid = getCurrentShopId({ db });
    const installId = await getInstallId();
    if (!sid) {
      db.licenseActive = false;
      db.vault.installId = installId;
      db.vault.status = 'invalid';
      db.vault.note = 'ไม่พบ SHOP ID ของร้านนี้';
      clearProStatus();
      return false;
    }
    if (await initProStatus({ db, shopId: sid })) {
      db.shopId = sid;
      db.licenseActive = true;
      db.vault.installId = installId;
      db.vault.lastValidatedAt = now();
      db.vault.status = 'active';
      db.vault.note = 'โหลดสถานะ Pro จากเครื่องนี้ (ผ่านการรีเช็กแบบ offline)';
      db.vault.licenseId = sid;
      db.vault.plan = 'pro';
      db.vault.features = ['all'];
      return true;
    }
    const code = normalizeLicenseCode(db.licenseToken || lsGet(LS_LICENSE) || '');

    if (!code) {
      db.licenseActive = false;
      db.vault.installId = installId;
      db.vault.status = 'idle';
      db.vault.note = 'ยังไม่มี licenseCode';
      clearProStatus();
      return false;
    }

    const result = await activateWithGenkey(code, { shopId: sid, deviceId: installId, db });

    db.vault.installId = installId;
    db.vault.lastValidatedAt = now();

    if (!result.valid) {
      db.licenseActive = false;
      db.vault.status = 'invalid';
      db.vault.note = result.message || 'license ไม่ผ่านการตรวจสอบ';
      clearProStatus();
      return false;
    }

    db.licenseToken = code;
    db.licenseActive = true;
    db.vault.status = 'active';
    db.vault.note = result.message || 'license valid';
    db.vault.licenseId = sid;
    db.vault.plan = result?.payload?.plan || 'pro';
    db.vault.features = Array.isArray(result?.payload?.features) ? result.payload.features : ['all'];
    lsSet(LS_LICENSE, code);
    saveProStatus(sid);
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

    lsRemove(LS_LICENSE);
    clearProStatus();
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
      shopId: db.shopId || lsGet(LS_SHOP_ID) || '',
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

    if (db.shopId) lsSet(LS_SHOP_ID, db.shopId);
    if (db.licenseToken) lsSet(LS_LICENSE, db.licenseToken);

    return { ok: true, message: 'นำเข้าข้อมูล vault สำเร็จ' };
  }

  async function getStatus(db = {}) {
    ensureDbShape(db);
    const sid = getCurrentShopId({ db });
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
    getCurrentShopId,
    verifyLicense,
    getActivationRequest,
    getRequestCode,
    createGenKey,
    createLicenseToken,
    validateProKey,
    validateLicenseToken,
    activateProKey,
    activateWithGenkey,
    isProActive,
    clearLicense,
    verifyRecoveryAnswers,
    exportVaultBackup,
    importVaultBackup,
    getStatus,
    buildGenKeyFromParts,
    initProStatus,
    saveProStatus,
    loadProStatus,
    clearProStatus
  };
})();
