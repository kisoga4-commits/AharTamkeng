(() => {
  'use strict';

  const APP_VERSION = '10.20-online-activation';
  const LS_INSTALL_ID = 'FAKDU_VAULT_INSTALL_ID';
  const LS_VAULT_STATE = 'FAKDU_VAULT_STATE_V1020';
  const LS_LAST_SHOP_ID = 'FAKDU_VAULT_LAST_SHOP_ID';
  const LS_LAST_LICENSE = 'FAKDU_VAULT_LAST_LICENSE_V1020';
  const LS_ACTIVATION_CACHE = 'FAKDU_VAULT_ACTIVATION_CACHE_V1020';

  // Placeholder/config key only. Real signing secret must stay on owner/server side.
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
        installRef: '',
        softRef: '',
        activatedAt: null,
        lastValidatedAt: null,
        status: 'idle',
        note: '',
        licenseId: '',
        keyRef: '',
        payload: null,
        signature: ''
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

  async function buildVaultSignature({ sid = '', iat = 0, ref = '' } = {}) {
    const secretName = getConfiguredVaultSecretName();
    return sha256Hex(`${sid}|${iat}|${ref}|${secretName}|${APP_VERSION}`);
  }

  async function makeVaultPayload({ sid = '', ref = '' } = {}) {
    const iat = now();
    return {
      sid: normalizeShopId(sid),
      iat,
      ref: String(ref || '')
    };
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

  function validateGenkeyInput({ key = '', expectedShopId = '' } = {}) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return { valid: false, message: 'กรุณากรอก GENKEY ก่อน' };
    if (normalizedKey.length < 24) return { valid: false, message: 'GENKEY สั้นเกินไป (ขั้นต่ำ 24 ตัวอักษร)' };

    const keyShopId = parseShopIdFromGenkey(normalizedKey);
    const sid = normalizeShopId(expectedShopId);
    if (!keyShopId) return { valid: false, message: 'รูปแบบ GENKEY ไม่ถูกต้อง หรืออ่าน SHOP ID ไม่ได้' };
    if (sid && keyShopId !== sid) {
      return { valid: false, message: `GENKEY นี้เป็นของร้าน ${keyShopId} แต่เครื่องนี้ตั้งเป็น ${sid}` };
    }
    return { valid: true, key: normalizedKey, keyShopId };
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
      payload: null,
      signature: ''
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
      sid,
      iat: now(),
      ref: refs.installRef
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
        metadata: clone(result.metadata || {})
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
        payload: { licenseId: String(result.licenseId || '') }
      };
    } catch (_) {
      return { valid: false, message: 'ตรวจสอบ license กับเซิร์ฟเวอร์ไม่สำเร็จ' };
    }
  }

  async function activateProKey({ key = '', shopId = '', deviceId = '', db = {} } = {}) {
    ensureDbShape(db);
    const existingShopId = normalizeShopId(db?.shopId || shopId || localStorage.getItem(LS_LAST_SHOP_ID) || '');
    const keyCheck = validateGenkeyInput({ key, expectedShopId: existingShopId });
    if (!keyCheck.valid) return { valid: false, message: keyCheck.message };

    const sid = await ensureShopId(db, keyCheck.keyShopId || existingShopId);
    const refs = await buildBindingRefs(sid, deviceId);
    const keyValue = keyCheck.key;

    async function applyActivationResult({ token = '', resolvedShopId = sid, licenseId = '', keyRef = '', note = '', metadata = null } = {}) {
      const normalizedShopId = normalizeShopId(resolvedShopId || sid);
      const finalToken = String(token || keyValue).trim();
      const finalLicenseId = String(licenseId || `LIC-${randomString(10)}`);
      const payload = await makeVaultPayload({ sid: normalizedShopId, ref: refs.installRef });
      const signature = await buildVaultSignature(payload);
      const activatedAt = now();

      db.shopId = normalizedShopId;
      db.licenseToken = finalToken;
      db.licenseActive = true;
      db.vault.installRef = refs.installRef;
      db.vault.softRef = refs.softRef;
      db.vault.activatedAt = activatedAt;
      db.vault.lastValidatedAt = activatedAt;
      db.vault.status = 'active';
      db.vault.note = String(note || 'Activated');
      db.vault.licenseId = finalLicenseId;
      db.vault.keyRef = String(keyRef || 'local-fallback');
      db.vault.payload = payload;
      db.vault.signature = signature;

      localStorage.setItem(LS_LAST_LICENSE, finalToken);
      localStorage.setItem(LS_LAST_SHOP_ID, normalizedShopId);
      setActivationCache({
        shopId: normalizedShopId,
        installRef: refs.installRef,
        softRef: refs.softRef,
        activatedAt,
        verifiedAt: activatedAt
      });
      setVaultState({
        installId: refs.installId,
        installRef: refs.installRef,
        softRef: refs.softRef,
        shopId: normalizedShopId,
        activatedAt,
        lastValidatedAt: activatedAt,
        status: 'active',
        note: db.vault.note,
        licenseId: finalLicenseId,
        keyRef: db.vault.keyRef,
        payload,
        signature
      });

      return {
        valid: true,
        token: finalToken,
        shopId: normalizedShopId,
        licenseId: finalLicenseId,
        metadata: { payload, signature, source: db.vault.keyRef, extra: clone(metadata || {}) },
        message: db.vault.note
      };
    }

    const api = getLicenseApi();
    const canActivateOnline = Boolean(navigator.onLine && api && typeof api.activateOnline === 'function');
    if (!canActivateOnline) {
      return applyActivationResult({
        token: keyValue,
        resolvedShopId: sid,
        keyRef: 'local-fallback',
        note: !navigator.onLine ? 'Activated แบบออฟไลน์จาก GENKEY' : 'Activated แบบ local fallback (ยังไม่ตั้งค่า License API)'
      });
    }

    try {
      const activated = await api.activateOnline({
        key: keyValue,
        shopId: sid,
        installId: refs.installId,
        installRef: refs.installRef,
        softRef: refs.softRef,
        appVersion: APP_VERSION
      });

      if (!activated || activated.valid !== true) {
        return { valid: false, message: activated?.message || 'เปิดสิทธิ์ไม่สำเร็จ' };
      }

      return applyActivationResult({
        token: String(activated.token || keyValue).trim(),
        resolvedShopId: normalizeShopId(activated.shopId || sid),
        licenseId: String(activated.licenseId || ''),
        keyRef: String(activated.keyRef || 'server'),
        note: activated.message || 'Activated online',
        metadata: activated.metadata || {}
      });
    } catch (_) {
      return applyActivationResult({
        token: keyValue,
        resolvedShopId: sid,
        keyRef: 'local-fallback',
        note: 'เชื่อมต่อเซิร์ฟเวอร์ activate ไม่สำเร็จ (ใช้ local fallback)'
      });
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

    db.vault.status = 'invalid';
    db.vault.note = 'ยังไม่ผ่านการ activate ออนไลน์บนอุปกรณ์นี้';
    db.licenseActive = false;
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
      payload: null,
      signature: ''
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
      payload: null,
      signature: ''
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
    if (parsed.vault && typeof parsed.vault === 'object') db.vault = { ...db.vault, ...clone(parsed.vault) };

    localStorage.setItem(LS_LAST_SHOP_ID, db.shopId || '');
    localStorage.setItem(LS_LAST_LICENSE, db.licenseToken || '');
    if (parsed.activationCache && typeof parsed.activationCache === 'object') {
      setActivationCache(parsed.activationCache);
    }
    setVaultState({
      shopId: db.shopId,
      status: db.vault.status || (db.licenseToken ? 'active' : 'idle'),
      note: db.vault.note || '',
      licenseId: db.vault.licenseId || '',
      keyRef: db.vault.keyRef || '',
      payload: clone(db.vault.payload || null),
      signature: String(db.vault.signature || '')
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
      licenseActive: Boolean(db.vault?.status === 'active' && String(db.licenseToken || '').trim()),
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
