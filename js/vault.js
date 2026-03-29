(() => {
  'use strict';

  const APP_VERSION = '10.20-online-activation';
  const LS_INSTALL_ID = 'FAKDU_VAULT_INSTALL_ID';
  const LS_VAULT_STATE = 'FAKDU_VAULT_STATE_V1020';
  const LS_LAST_SHOP_ID = 'FAKDU_VAULT_LAST_SHOP_ID';
  const LS_LAST_LICENSE = 'FAKDU_VAULT_LAST_LICENSE_V1020';
  const LS_ACTIVATION_CACHE = 'FAKDU_VAULT_ACTIVATION_CACHE_V1020';

   Placeholder/config key only. Real signing secret must stay on owner/server side.
  const VAULT_SECRET_CONFIG_NAME = 'FAKDU_VAULT_MASTER_SECRET';



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

  function getLicenseApi() {
    const api = window.FakduLicenseApi;
    if (!api || typeof api !== 'object') return null;
    return api;
  }


  function getConfiguredVaultSecretName() {
    const configured = String(window?.[VAULT_SECRET_CONFIG_NAME] || '').trim();
    return configured || VAULT_SECRET_CONFIG_NAME;



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
        installRef: '',
        softRef: '',
        activatedAt: null,
        lastValidatedAt: null,
        status: 'idle',
        note: '',
        licenseId: '',
        keyRef: '',
        plan: 'basic'
      };
    }

    return target;
  }

  function buildSoftFingerprintSeed() {
    const parts = [
      navigator.userAgent || '',
      navigator.language || '',
      navigator.platform || '',
      navigator.hardwareConcurrency || 0,
      screen.width || 0,
      screen.height || 0,
      screen.colorDepth || 0,
      Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      new Date().getTimezoneOffset()
    ];
    return parts.join('|');
  }

  async function sha256Hex(message) {
    const bytes = new TextEncoder().encode(String(message || ''));
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hashBuffer))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  async function shortHash(message, len = 24) {
    return (await sha256Hex(message)).slice(0, len);
  }

  function parseShopIdFromGenkey(key = '') {
    const raw = String(key || '').trim();
    const parts = raw.split('.');
    if (parts.length < 2) return '';
    try {
      const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
      const payload = JSON.parse(atob(padded));
      return normalizeShopId(payload?.shopId || '');
    } catch (_) {
      return '';
    }
  }

  function getVaultState() {
    return safeJsonParse(localStorage.getItem(LS_VAULT_STATE), {
      installId: '',
      installRef: '',
      softRef: '',
      shopId: '',
      activatedAt: null,
      lastValidatedAt: null,
      status: 'idle',
      note: '',
      licenseId: '',
      keyRef: '',
      plan: 'basic'
    });
  }

  function setVaultState(patch = {}) {
    const current = getVaultState();
    const next = { ...current, ...clone(patch) };
    localStorage.setItem(LS_VAULT_STATE, JSON.stringify(next));
    if (next.shopId) localStorage.setItem(LS_LAST_SHOP_ID, next.shopId);
    return next;
  }

  function getActivationCache() {
    return safeJsonParse(localStorage.getItem(LS_ACTIVATION_CACHE), {
      shopId: '',
      installRef: '',
      softRef: '',
      activatedAt: null,
      verifiedAt: null
    });
  }

  function setActivationCache(payload = {}) {
    const next = { ...getActivationCache(), ...clone(payload) };
    localStorage.setItem(LS_ACTIVATION_CACHE, JSON.stringify(next));
    return next;
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

  async function buildBindingRefs(shopId, installId = '') {
    const sid = normalizeShopId(shopId);
    const iid = await getInstallId(installId);
    const softSeed = buildSoftFingerprintSeed();

    const installRef = await shortHash(`${sid}|INSTALL|${iid}|${APP_VERSION}`, 24);
    const softRef = await shortHash(`${sid}|SOFT|${softSeed}|${APP_VERSION}`, 24);

    return {
      shopId: sid,
      installId: iid,
      installRef,
      softRef,
      softSeed
    };
  }

  async function ensureShopId(db, fallbackFromKey = '') {
    ensureDbShape(db);
    let sid = normalizeShopId(db?.shopId || localStorage.getItem(LS_LAST_SHOP_ID) || '');
    if (!sid && fallbackFromKey) sid = normalizeShopId(fallbackFromKey);
    if (!sid) sid = `SHOP-${randomString(8)}`;
    if (db) db.shopId = sid;
    localStorage.setItem(LS_LAST_SHOP_ID, sid);
    return sid;
  }

  async function getActivationRequest({ shopId = '', deviceId = '', db = {} } = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId({ ...db, shopId });
    const refs = await buildBindingRefs(sid, deviceId);
    const request = {
      kind: 'activation_request',
      appVersion: APP_VERSION,
      shopId: sid,
      installId: refs.installId,
      installRef: refs.installRef,
      softRef: refs.softRef,
      requestedAt: now(),
      note: 'Activation must be verified online by owner/server.'
    };
    return { ok: true, request, printable: JSON.stringify(request, null, 2) };
  }

  async function createGenKey() {
    return { ok: false, message: 'ปิดการสร้าง GENKEY ในแอป (ต้องทำฝั่ง owner/server)' };
  }

  async function createLicenseToken() {
    return { ok: false, message: 'ปิดการสร้าง license ในแอป (ต้องทำฝั่ง owner/server)' };
  }

  async function validateProKey({ key = '', shopId = '', deviceId = '', db = {} } = {}) {
    ensureDbShape(db);
    const keyShopId = parseShopIdFromGenkey(key);
    const sid = await ensureShopId({ ...db, shopId }, keyShopId);
    const refs = await buildBindingRefs(sid, deviceId);

    if (!navigator.onLine) {
      return { valid: false, message: 'ต้องเชื่อมต่ออินเทอร์เน็ตเพื่อยืนยัน GENKEY ครั้งแรก' };
    }

    const api = getLicenseApi();
    if (!api || typeof api.verifyGenKeyOnline !== 'function') {
      return { valid: false, message: 'ยังไม่ได้ตั้งค่า License API ฝั่งเซิร์ฟเวอร์' };
    }

    try {
      const result = await api.verifyGenKeyOnline({
        key: String(key || '').trim(),
        shopId: sid,
        installId: refs.installId,
        installRef: refs.installRef,
        softRef: refs.softRef,
        appVersion: APP_VERSION
      });

      if (!result || result.valid !== true) {
        return { valid: false, message: result?.message || 'GENKEY ไม่ผ่านการยืนยัน' };
      }

      return {
        valid: true,
        message: result.message || 'ยืนยัน GENKEY สำเร็จ',
        shopId: normalizeShopId(result.shopId || sid),
        keyRef: String(result.keyRef || ''),
        plan: String(result.plan || 'pro')
      };
    } catch (_) {
      return { valid: false, message: 'เชื่อมต่อเซิร์ฟเวอร์ยืนยัน GENKEY ไม่สำเร็จ' };
    }
  }

  async function validateLicenseToken({ token = '', shopId = '', deviceId = '', db = {} } = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId({ ...db, shopId });
    const refs = await buildBindingRefs(sid, deviceId);

    if (!navigator.onLine) {
      return { valid: false, message: 'ต้องออนไลน์เพื่อตรวจสอบ license' };
    }

    const api = getLicenseApi();
    if (!api || typeof api.verifyLicenseOnline !== 'function') {
      return { valid: false, message: 'ยังไม่ได้ตั้งค่า License API ฝั่งเซิร์ฟเวอร์' };
    }

    try {
      const result = await api.verifyLicenseOnline({
        token: String(token || '').trim(),
        shopId: sid,
        installId: refs.installId,
        installRef: refs.installRef,
        softRef: refs.softRef,
        appVersion: APP_VERSION
      });

      if (!result || result.valid !== true) {
        return { valid: false, message: result?.message || 'license ใช้งานไม่ได้' };
      }

      return {
        valid: true,
        message: result.message || 'license ใช้งานได้',
        shopId: normalizeShopId(result.shopId || sid),
        payload: {
          licenseId: String(result.licenseId || ''),
          plan: String(result.plan || 'pro')
        }
      };
    } catch (_) {
      return { valid: false, message: 'ตรวจสอบ license กับเซิร์ฟเวอร์ไม่สำเร็จ' };
    }
  }

  async function activateProKey({ key = '', shopId = '', deviceId = '', db = {} } = {}) {
    ensureDbShape(db);
    const keyShopId = parseShopIdFromGenkey(key);
    const sid = await ensureShopId(db, keyShopId || shopId);
    const refs = await buildBindingRefs(sid, deviceId);

    if (!navigator.onLine) {
      db.licenseActive = false;
      return { valid: false, message: 'การ Activate ต้องออนไลน์เท่านั้น' };
    }

    const api = getLicenseApi();
    if (!api || typeof api.activateOnline !== 'function') {
      db.licenseActive = false;
      return { valid: false, message: 'ยังไม่ได้ตั้งค่า License API ฝั่งเซิร์ฟเวอร์' };
    }

    try {
      const activated = await api.activateOnline({
        key: String(key || '').trim(),
        shopId: sid,
        installId: refs.installId,
        installRef: refs.installRef,
        softRef: refs.softRef,
        appVersion: APP_VERSION
      });

      if (!activated || activated.valid !== true) {
        db.licenseActive = false;
        return { valid: false, message: activated?.message || 'เปิดสิทธิ์ไม่สำเร็จ' };
      }

      const resolvedShopId = normalizeShopId(activated.shopId || sid);
      const token = String(activated.token || key).trim();
      const licenseId = String(activated.licenseId || `LIC-${randomString(10)}`);
      const plan = String(activated.plan || 'pro');

      db.shopId = resolvedShopId;
      db.licenseToken = token;
      db.licenseActive = true;
      db.vault.installRef = refs.installRef;
      db.vault.softRef = refs.softRef;
      db.vault.activatedAt = now();
      db.vault.lastValidatedAt = now();
      db.vault.status = 'active';
      db.vault.note = activated.message || 'Activated online';
      db.vault.licenseId = licenseId;
      db.vault.keyRef = String(activated.keyRef || 'server');
      db.vault.plan = plan;

      localStorage.setItem(LS_LAST_LICENSE, token);
      localStorage.setItem(LS_LAST_SHOP_ID, resolvedShopId);
      setActivationCache({
        shopId: resolvedShopId,
        installRef: refs.installRef,
        softRef: refs.softRef,
        activatedAt: db.vault.activatedAt,
        verifiedAt: db.vault.lastValidatedAt
      });
      setVaultState({
        installId: refs.installId,
        installRef: refs.installRef,
        softRef: refs.softRef,
        shopId: resolvedShopId,
        activatedAt: db.vault.activatedAt,
        lastValidatedAt: db.vault.lastValidatedAt,
        status: 'active',
        note: db.vault.note,
        licenseId,
        keyRef: db.vault.keyRef,
        plan
      });

      return { valid: true, token, shopId: resolvedShopId, licenseId, plan, message: db.vault.note };
    } catch (_) {
      db.licenseActive = false;
      return { valid: false, message: 'เชื่อมต่อเซิร์ฟเวอร์ activate ไม่สำเร็จ' };
    }
  }

  async function isProActive(db = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId(db);
    const refs = await buildBindingRefs(sid);
    const token = String(db.licenseToken || localStorage.getItem(LS_LAST_LICENSE) || '').trim();
    const cache = getActivationCache();

    const matchedCache = Boolean(
      token &&
      cache.shopId === sid &&
      cache.installRef === refs.installRef &&
      cache.softRef === refs.softRef
    );

    if (matchedCache) {
      db.licenseToken = token;
      db.licenseActive = true;
      db.vault.status = 'active';
      db.vault.note = navigator.onLine ? 'Activated (online check optional)' : 'Activated (offline allowed)';
      db.vault.installRef = refs.installRef;
      db.vault.softRef = refs.softRef;
      db.vault.licenseId = db.vault.licenseId || getVaultState().licenseId || '';
      return true;
    }

    db.licenseActive = false;
    db.vault.status = 'invalid';
    db.vault.note = 'ยังไม่ผ่านการ activate ออนไลน์บนอุปกรณ์นี้';
    return false;
  }

  async function clearLicense(db = {}) {
    ensureDbShape(db);
    db.licenseToken = '';
    db.licenseActive = false;
    db.vault = {
      installRef: '',
      softRef: '',
      activatedAt: null,
      lastValidatedAt: null,
      status: 'idle',
      note: '',
      licenseId: '',
      keyRef: '',
      plan: 'basic'
    };

    localStorage.removeItem(LS_LAST_LICENSE);
    localStorage.removeItem(LS_ACTIVATION_CACHE);
    setVaultState({
      shopId: db.shopId || '',
      status: 'idle',
      note: '',
      activatedAt: null,
      lastValidatedAt: null,
      licenseId: '',
      keyRef: '',
      plan: 'basic'
    });

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
      shopId: db.shopId || localStorage.getItem(LS_LAST_SHOP_ID) || '',
      licenseToken: String(db.licenseToken || ''),
      licenseActive: Boolean(db.licenseActive),
      vault: clone(db.vault || {}),
      activationCache: getActivationCache()
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
    if (typeof parsed.licenseToken === 'string') db.licenseToken = parsed.licenseToken;
    if (typeof parsed.licenseActive === 'boolean') db.licenseActive = parsed.licenseActive;
    if (parsed.vault && typeof parsed.vault === 'object') db.vault = { ...db.vault, ...clone(parsed.vault) };

    localStorage.setItem(LS_LAST_SHOP_ID, db.shopId || '');
    localStorage.setItem(LS_LAST_LICENSE, db.licenseToken || '');
    if (parsed.activationCache && typeof parsed.activationCache === 'object') {
      setActivationCache(parsed.activationCache);
    }
    setVaultState({
      shopId: db.shopId,
      status: db.vault.status || (db.licenseActive ? 'active' : 'idle'),
      note: db.vault.note || '',
      licenseId: db.vault.licenseId || '',
      keyRef: db.vault.keyRef || '',
      plan: db.vault.plan || 'basic'
    });

    return { ok: true, message: 'นำเข้าข้อมูล vault สำเร็จ' };
  }

  async function getStatus(db = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId(db);
    return {
      appVersion: APP_VERSION,


      shopId: sid,
      licenseExists: Boolean(String(db.licenseToken || '').trim()),
      licenseActive: Boolean(db.licenseActive),
      vault: clone(db.vault || {}),
      activationCache: getActivationCache()
    };
  }

  window.FakduVault = {
    APP_VERSION,
    normalizeShopId,
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
    getStatus
  };
})();
