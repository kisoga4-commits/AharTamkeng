(() => {
  'use strict';

  const APP_VERSION = '10.22-license-signature';
  const LS_INSTALL_ID = 'FAKDU_VAULT_INSTALL_ID';
  const LS_SHOP_ID = 'FAKDU_VAULT_SHOP_ID';
  const LS_LICENSE = 'FAKDU_VAULT_GENKEY';

  // ฝั่งแอปเก็บได้เฉพาะ public key เท่านั้น
  // owner ต้องเก็บ private key แยกและใช้เซ็น GENKEY นอกแอป
  // หมายเหตุ: ค่า default ด้านล่างเป็น placeholder เพื่อกันการฝังคีย์จริงลง client
  const PUBLIC_VERIFY_KEY_B64URL = '__SET_OWNER_PUBLIC_KEY__';

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

  function toBase64Url(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function fromBase64Url(input = '') {
    const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }

  function utf8Bytes(text = '') {
    return new TextEncoder().encode(String(text));
  }

  function utf8String(bytes) {
    return new TextDecoder().decode(bytes);
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

  function parseGenKey(genKey = '') {
    const raw = normalizeLicenseCode(genKey);
    if (!raw) return { ok: false, message: 'ต้องระบุ GENKEY' };

    const parts = raw.split('.');
    if (parts.length !== 3) {
      return { ok: false, message: 'รูปแบบ GENKEY ไม่ถูกต้อง (ต้องเป็น header.payload.signature)' };
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    const header = safeJsonParse(utf8String(fromBase64Url(headerB64)));
    const payload = safeJsonParse(utf8String(fromBase64Url(payloadB64)));
    if (!header || !payload) {
      return { ok: false, message: 'GENKEY ไม่ใช่ JSON ที่ถูกต้อง' };
    }

    return {
      ok: true,
      token: raw,
      header,
      payload,
      signingInput: `${headerB64}.${payloadB64}`,
      signatureBytes: fromBase64Url(signatureB64)
    };
  }

  async function importPublicVerifyKey() {
    if (!window.crypto?.subtle) {
      throw new Error('เบราว์เซอร์ไม่รองรับ WebCrypto');
    }
    if (!PUBLIC_VERIFY_KEY_B64URL || PUBLIC_VERIFY_KEY_B64URL.includes('__SET_OWNER_PUBLIC_KEY__')) {
      throw new Error('ยังไม่ได้ตั้งค่า public verification key');
    }

    return window.crypto.subtle.importKey(
      'raw',
      fromBase64Url(PUBLIC_VERIFY_KEY_B64URL),
      { name: 'Ed25519' },
      false,
      ['verify']
    );
  }

  function validatePayloadShape(payload, expectedShopId) {
    const required = ['type', 'version', 'shopId', 'plan', 'features', 'issuedAt', 'licenseId'];
    for (const key of required) {
      if (!(key in payload)) return { ok: false, message: `payload ขาดฟิลด์ ${key}` };
    }

    if (String(payload.type || '') !== 'fakdu_license') {
      return { ok: false, message: 'payload.type ต้องเป็น fakdu_license' };
    }

    const normalizedPayloadShopId = normalizeShopId(payload.shopId || '');
    if (!normalizedPayloadShopId) {
      return { ok: false, message: 'payload.shopId ไม่ถูกต้อง' };
    }

    if (normalizedPayloadShopId !== normalizeShopId(expectedShopId)) {
      return { ok: false, message: 'GENKEY นี้ไม่ตรงกับ shopId เครื่องนี้' };
    }

    if (!Array.isArray(payload.features)) {
      return { ok: false, message: 'payload.features ต้องเป็น array' };
    }

    const issuedAtMs = Number(payload.issuedAt || 0);
    if (!Number.isFinite(issuedAtMs) || issuedAtMs <= 0) {
      return { ok: false, message: 'payload.issuedAt ไม่ถูกต้อง' };
    }

    return { ok: true };
  }

  async function verifyGenKey(genKey, expectedShopId) {
    const parsed = parseGenKey(genKey);
    if (!parsed.ok) return { valid: false, message: parsed.message };

    const shape = validatePayloadShape(parsed.payload, expectedShopId);
    if (!shape.ok) return { valid: false, message: shape.message };

    if (String(parsed.header?.alg || '') !== 'EdDSA') {
      return { valid: false, message: 'header.alg ต้องเป็น EdDSA' };
    }

    try {
      const key = await importPublicVerifyKey();
      const verified = await window.crypto.subtle.verify(
        { name: 'Ed25519' },
        key,
        parsed.signatureBytes,
        utf8Bytes(parsed.signingInput)
      );

      if (!verified) return { valid: false, message: 'ลายเซ็น GENKEY ไม่ถูกต้อง' };

      return {
        valid: true,
        token: parsed.token,
        payload: parsed.payload,
        message: 'ตรวจสอบ GENKEY ผ่าน'
      };
    } catch (error) {
      return { valid: false, message: error?.message || 'ตรวจสอบ GENKEY ไม่สำเร็จ' };
    }
  }

  async function getActivationRequest({ shopId = '', deviceId = '', db = {} } = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId(db, shopId);
    const installId = await getInstallId(deviceId);
    const request = {
      type: 'fakdu_license',
      version: 1,
      shopId: sid,
      plan: 'pro',
      features: ['all'],
      issuedAt: now(),
      licenseId: `LIC-${randomString(10)}`,
      installId,
      note: 'owner ต้องเซ็น payload นี้ด้วย private key เพื่อสร้าง GENKEY'
    };
    return { ok: true, request, printable: JSON.stringify(request, null, 2) };
  }

  async function createGenKey() {
    return { ok: false, message: 'ปิดการสร้าง GENKEY ในแอป (ต้องทำฝั่ง owner ที่ถือ private key เท่านั้น)' };
  }

  async function createLicenseToken() {
    return { ok: false, message: 'ใช้ GENKEY ที่เซ็นจาก owner เท่านั้น' };
  }

  async function validateProKey({ key = '', shopId = '', deviceId = '', db = {} } = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId(db, shopId);
    const installId = await getInstallId(deviceId);
    const result = await verifyGenKey(key, sid);
    if (!result.valid) return result;

    const payload = result.payload || {};
    db.shopId = sid;
    db.licenseToken = result.token;
    db.licenseActive = true;
    db.vault.installId = installId;
    db.vault.activatedAt = db.vault.activatedAt || now();
    db.vault.lastValidatedAt = now();
    db.vault.status = 'active';
    db.vault.note = result.message || 'GENKEY valid';
    db.vault.licenseId = String(payload.licenseId || '');
    db.vault.plan = String(payload.plan || 'pro');
    db.vault.features = Array.isArray(payload.features) ? clone(payload.features) : [];

    localStorage.setItem(LS_LICENSE, result.token);

    return {
      valid: true,
      token: result.token,
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
    const token = normalizeLicenseCode(db.licenseToken || localStorage.getItem(LS_LICENSE) || '');

    if (!token) {
      db.licenseActive = false;
      db.vault.installId = installId;
      db.vault.status = 'idle';
      db.vault.note = 'ยังไม่มี GENKEY';
      return false;
    }

    const result = await verifyGenKey(token, sid);
    if (!result.valid) {
      db.licenseActive = false;
      db.vault.installId = installId;
      db.vault.lastValidatedAt = now();
      db.vault.status = 'invalid';
      db.vault.note = result.message || 'GENKEY ไม่ผ่านการตรวจสอบ';
      return false;
    }

    const payload = result.payload || {};
    db.licenseToken = token;
    db.licenseActive = true;
    db.vault.installId = installId;
    db.vault.lastValidatedAt = now();
    db.vault.status = 'active';
    db.vault.note = 'GENKEY valid';
    db.vault.licenseId = String(payload.licenseId || db.vault.licenseId || '');
    db.vault.plan = String(payload.plan || db.vault.plan || 'pro');
    db.vault.features = Array.isArray(payload.features) ? clone(payload.features) : [];
    localStorage.setItem(LS_LICENSE, token);
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

  // Helper for owner toolchain only (not used by app flow)
  function buildGenKeyFromParts({ header, payload, signature }) {
    return `${toBase64Url(utf8Bytes(JSON.stringify(header || {})))}.${toBase64Url(utf8Bytes(JSON.stringify(payload || {})))}.${toBase64Url(signature || new Uint8Array(0))}`;
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
    getStatus,
    buildGenKeyFromParts
  };
})();
