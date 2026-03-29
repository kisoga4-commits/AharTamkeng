(() => {
  'use strict';

  const APP_VERSION = '10.20-offline-genkey';
  const LS_INSTALL_ID = 'FAKDU_VAULT_INSTALL_ID';
  const LS_LAST_SHOP_ID = 'FAKDU_VAULT_LAST_SHOP_ID';
  const LS_VAULT_STATE = 'FAKDU_VAULT_STATE_V1020';
  const LS_STORED_LICENSE = 'FAKDU_VAULT_STORED_LICENSE_V1020';
  const EXPECTED_APP = 'FAKDU';
  const EXPECTED_LICENSE_TYPE = 'fakdu_license';
  const IDB_KEY_SHOP_ID = 'vault_shop_id';
  const IDB_KEY_INSTALL_ID = 'vault_install_id';
  const IDB_KEY_STORED_LICENSE = 'vault_stored_license';

  // Client must contain public key only (SPKI PEM). Replace with your owner public key.
  const PUBLIC_KEY_PEM_PLACEHOLDER = 'REPLACE_WITH_REAL_PUBLIC_KEY_PEM';
  const DEFAULT_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCoQkmRYHzk0L3XWj6DSUaC57z/
3dj0tmVrhZgqV7J5UhTFefe5Qe/t+TDMAY42J1q36kOjJi5L4j3GhxUl9sU1uZOV
gc5p4OxooqzaYadsCa1k6wT6ib3c2LHIwKKN0Gy/e/goU2R6PDE57W3Qh/eNSQoT
1HetSsx7a9kxBampJwIDAQAB
-----END PUBLIC KEY-----`;

  function now() { return Date.now(); }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function safeJsonParse(raw, fallback = null) {
    try { return JSON.parse(raw); } catch (_) { return fallback; }
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
  function toBool(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
    return Boolean(value);
  }
  function b64urlEncodeUtf8(text = '') {
    return btoa(unescape(encodeURIComponent(String(text))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }
  function b64urlDecodeUtf8(text = '') {
    const normalized = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return decodeURIComponent(escape(atob(padded)));
  }
  function b64urlDecodeToBytes(text = '') {
    const normalized = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const raw = atob(padded);
    return Uint8Array.from(raw, (char) => char.charCodeAt(0));
  }

  function ensureDbShape(db) {
    const target = db && typeof db === 'object' ? db : {};
    if (!target.recovery || typeof target.recovery !== 'object') target.recovery = { phone: '', color: '', animal: '' };
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
    const next = { ...getVaultState(), ...clone(patch) };
    localStorage.setItem(LS_VAULT_STATE, JSON.stringify(next));
    if (next.shopId) localStorage.setItem(LS_LAST_SHOP_ID, next.shopId);
    return next;
  }

  async function sha256Hex(message) {
    const bytes = new TextEncoder().encode(String(message || ''));
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hashBuffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  async function shortHash(message, len = 24) { return (await sha256Hex(message)).slice(0, len); }

  async function kvGet(key) {
    try {
      const dbApi = window.FakduDB;
      if (dbApi && typeof dbApi._kvGet === 'function') return await dbApi._kvGet(key);
    } catch (_) {}
    return null;
  }

  async function kvSet(key, value) {
    try {
      const dbApi = window.FakduDB;
      if (dbApi && typeof dbApi._kvSet === 'function') await dbApi._kvSet(key, value);
    } catch (_) {}
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

  async function getOrCreateInstallId(provided = '') {
    const direct = String(provided || '').trim();
    if (direct) {
      localStorage.setItem(LS_INSTALL_ID, direct);
      await kvSet(IDB_KEY_INSTALL_ID, direct);
      return direct;
    }
    let installId = localStorage.getItem(LS_INSTALL_ID) || String(await kvGet(IDB_KEY_INSTALL_ID) || '');
    if (!installId) {
      installId = `FDI-${randomString(8)}-${Date.now().toString(36).toUpperCase()}`;
    }
    localStorage.setItem(LS_INSTALL_ID, installId);
    await kvSet(IDB_KEY_INSTALL_ID, installId);
    return installId;
  }

  async function buildBindingRefs(shopId, installId = '') {
    const sid = normalizeShopId(shopId);
    const iid = await getOrCreateInstallId(installId);
    const softSeed = buildSoftFingerprintSeed();
    return {
      shopId: sid,
      installId: iid,
      installRef: await shortHash(`${sid}|INSTALL|${iid}|${APP_VERSION}`, 24),
      softRef: await shortHash(`${sid}|SOFT|${softSeed}|${APP_VERSION}`, 24)
    };
  }

  async function ensureShopId(db, fallback = '') {
    ensureDbShape(db);
    let sid = normalizeShopId(
      db?.shopId
      || localStorage.getItem(LS_LAST_SHOP_ID)
      || String(await kvGet(IDB_KEY_SHOP_ID) || '')
      || fallback
      || ''
    );
    if (db) db.shopId = sid;
    if (sid) {
      localStorage.setItem(LS_LAST_SHOP_ID, sid);
      await kvSet(IDB_KEY_SHOP_ID, sid);
    }
    return sid;
  }

  async function getCurrentShopId(db = {}, fallback = '') {
    return ensureShopId(db, fallback);
  }

  async function setCurrentShopId(shopId, db = {}) {
    ensureDbShape(db);
    const sid = normalizeShopId(shopId);
    if (!sid) return { ok: false, message: 'shopId ไม่ถูกต้อง' };
    db.shopId = sid;
    localStorage.setItem(LS_LAST_SHOP_ID, sid);
    await kvSet(IDB_KEY_SHOP_ID, sid);
    setVaultState({ shopId: sid });
    return { ok: true, shopId: sid };
  }

  function getConfiguredPublicKeyPem() {
    const configured = String(window.FAKDU_VAULT_PUBLIC_KEY_PEM || '').trim();
    if (configured) return configured;
    return DEFAULT_PUBLIC_KEY_PEM || PUBLIC_KEY_PEM_PLACEHOLDER;
  }

  async function importPublicKey() {
    const pem = getConfiguredPublicKeyPem();
    if (!pem || pem === PUBLIC_KEY_PEM_PLACEHOLDER) return null;
    const base64 = pem.replace(/-----BEGIN PUBLIC KEY-----/g, '')
      .replace(/-----END PUBLIC KEY-----/g, '')
      .replace(/\s+/g, '');
    const keyBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return crypto.subtle.importKey(
      'spki',
      keyBytes.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
  }

  async function verifyGenkeySignature(payloadEncoded, signatureEncoded) {
    const key = await importPublicKey();
    if (!key) return { ok: false, message: 'ยังไม่ได้ตั้งค่า public key สำหรับตรวจ GENKEY' };
    try {
      const valid = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        key,
        b64urlDecodeToBytes(signatureEncoded),
        new TextEncoder().encode(payloadEncoded)
      );
      return valid ? { ok: true } : { ok: false, message: 'ลายเซ็น GENKEY ไม่ถูกต้อง' };
    } catch (_) {
      return { ok: false, message: 'รูปแบบ GENKEY ไม่ถูกต้อง' };
    }
  }

  async function getRequestCode({ shopId = '', deviceId = '', db = {} } = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId(db, shopId);
    const refs = await buildBindingRefs(sid, deviceId);
    const payload = {
      typ: 'fakdu_activation_request',
      app: EXPECTED_APP,
      appVersion: APP_VERSION,
      shopId: sid,
      installId: refs.installId,
      installRef: refs.installRef,
      softRef: refs.softRef,
      requestedAt: now(),
      nonce: randomString(12)
    };
    const payloadEncoded = b64urlEncodeUtf8(JSON.stringify(payload));
    return {
      ok: true,
      request: payload,
      requestCode: `FKDRQ1.${payloadEncoded}`,
      printable: JSON.stringify(payload, null, 2)
    };
  }

  async function loadLicense() {
    const fromIdb = await kvGet(IDB_KEY_STORED_LICENSE);
    if (fromIdb && typeof fromIdb === 'object') {
      localStorage.setItem(LS_STORED_LICENSE, JSON.stringify(fromIdb));
      return fromIdb;
    }
    return safeJsonParse(localStorage.getItem(LS_STORED_LICENSE), null);
  }

  async function saveLicense(license) {
    const cloned = clone(license);
    localStorage.setItem(LS_STORED_LICENSE, JSON.stringify(cloned));
    await kvSet(IDB_KEY_STORED_LICENSE, cloned);
    const statePatch = {
      shopId: cloned?.payload?.shopId || '',
      installRef: cloned?.payload?.installRef || '',
      softRef: cloned?.payload?.softRef || '',
      activatedAt: cloned?.activatedAt || now(),
      lastValidatedAt: cloned?.lastValidatedAt || now(),
      status: 'active',
      note: cloned?.note || 'Activated by offline GENKEY',
      licenseId: cloned?.payload?.licenseId || '',
      keyRef: cloned?.payload?.keyRef || 'offline-signature',
      plan: cloned?.payload?.plan || 'pro'
    };
    setVaultState(statePatch);
    return cloned;
  }

  async function verifyStoredLicense(db = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId(db);
    const license = await loadLicense();
    if (!license || typeof license !== 'object') {
      db.licenseActive = false;
      db.vault.status = 'idle';
      db.vault.note = 'ยังไม่มี license';
      return { valid: false, message: 'ยังไม่มี license' };
    }

    const payload = license.payload;
    if (!payload || typeof payload !== 'object') {
      db.licenseActive = false;
      db.vault.status = 'invalid';
      db.vault.note = 'license เสียรูปแบบ';
      return { valid: false, message: 'license เสียรูปแบบ' };
    }
    if (String(payload.typ || '') !== EXPECTED_LICENSE_TYPE) {
      db.licenseActive = false;
      db.vault.status = 'invalid';
      db.vault.note = 'license ประเภทไม่ถูกต้อง';
      return { valid: false, message: 'license ประเภทไม่ถูกต้อง' };
    }
    if (String(payload.app || '').trim().toUpperCase() !== EXPECTED_APP) {
      db.licenseActive = false;
      db.vault.status = 'invalid';
      db.vault.note = 'license ใช้กับแอปนี้ไม่ได้';
      return { valid: false, message: 'license ใช้กับแอปนี้ไม่ได้' };
    }
    if (!toBool(payload.pro) || !toBool(payload.lifetime)) {
      db.licenseActive = false;
      db.vault.status = 'invalid';
      db.vault.note = 'license สิทธิ์ไม่ครบ (ต้องเป็น Pro Lifetime)';
      return { valid: false, message: 'license สิทธิ์ไม่ครบ (ต้องเป็น Pro Lifetime)' };
    }

    if (normalizeShopId(payload.shopId) !== sid) {
      db.licenseActive = false;
      db.vault.status = 'invalid';
      db.vault.note = 'license ไม่ตรงร้านนี้';
      return { valid: false, message: 'license ไม่ตรงร้านนี้' };
    }
    if (!Number.isFinite(Number(payload.issuedAt)) || Number(payload.issuedAt) <= 0) {
      db.licenseActive = false;
      db.vault.status = 'invalid';
      db.vault.note = 'license ไม่มี issuedAt ที่ถูกต้อง';
      return { valid: false, message: 'license ไม่มี issuedAt ที่ถูกต้อง' };
    }

    const sigCheck = await verifyGenkeySignature(license.payloadEncoded, license.signatureEncoded);
    if (!sigCheck.ok) {
      db.licenseActive = false;
      db.vault.status = 'invalid';
      db.vault.note = sigCheck.message;
      return { valid: false, message: sigCheck.message };
    }

    db.shopId = sid;
    db.licenseToken = String(license.raw || '');
    db.licenseActive = true;
    db.vault.installRef = '';
    db.vault.softRef = '';
    db.vault.activatedAt = license.activatedAt || now();
    db.vault.lastValidatedAt = now();
    db.vault.status = 'active';
    db.vault.note = 'ตรวจ license offline สำเร็จ';
    db.vault.licenseId = String(payload.licenseId || '');
    db.vault.keyRef = String(payload.keyRef || 'offline-signature');
    db.vault.plan = String(payload.plan || 'pro-lifetime');

    await saveLicense({ ...license, lastValidatedAt: db.vault.lastValidatedAt, note: db.vault.note });
    return { valid: true, message: db.vault.note, payload: clone(payload) };
  }

  function parseGenkey(rawValue = '') {
    const raw = String(rawValue || '').trim();
    if (!raw) return { ok: false, message: 'GENKEY ว่างเปล่า' };
    const parts = raw.split('.');
    // Primary format: payload.signature (2 parts)
    if (parts.length === 2) return { ok: true, payloadEncoded: parts[0], signatureEncoded: parts[1], raw };
    // Backward compatibility: FKD1.payload.signature
    if (parts.length === 3 && parts[0] === 'FKD1') {
      return { ok: true, payloadEncoded: parts[1], signatureEncoded: parts[2], raw };
    }
    return { ok: false, message: 'GENKEY ไม่ถูกต้อง' };
  }

  async function activateWithGenkey(genkey, { shopId = '', deviceId = '', db = {} } = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId(db, shopId);
    const parsed = parseGenkey(genkey);
    if (!parsed.ok) return { valid: false, message: parsed.message };
    const { raw, payloadEncoded, signatureEncoded } = parsed;

    let payload;
    try {
      payload = safeJsonParse(b64urlDecodeUtf8(payloadEncoded));
    } catch (_) {
      return { valid: false, message: 'อ่านข้อมูล GENKEY ไม่ได้' };
    }
    if (!payload || payload.typ !== EXPECTED_LICENSE_TYPE) return { valid: false, message: 'GENKEY คนละประเภท' };
    if (String(payload.app || '').trim().toUpperCase() !== EXPECTED_APP) return { valid: false, message: 'GENKEY ใช้กับแอปนี้ไม่ได้' };
    if (!toBool(payload.pro) || !toBool(payload.lifetime)) return { valid: false, message: 'GENKEY สิทธิ์ไม่ครบ (ต้องเป็น Pro Lifetime)' };

    const sigCheck = await verifyGenkeySignature(payloadEncoded, signatureEncoded);
    if (!sigCheck.ok) return { valid: false, message: sigCheck.message };

    if (normalizeShopId(payload.shopId) !== sid) return { valid: false, message: 'GENKEY ไม่ตรงร้านนี้' };
    if (!Number.isFinite(Number(payload.issuedAt)) || Number(payload.issuedAt) <= 0) {
      return { valid: false, message: 'GENKEY ไม่มี issuedAt ที่ถูกต้อง' };
    }

    const activatedAt = now();
    await saveLicense({
      raw,
      payload,
      payloadEncoded,
      signatureEncoded,
      activatedAt,
      lastValidatedAt: activatedAt,
      note: 'Activated by offline GENKEY'
    });

    db.shopId = sid;
    db.licenseToken = raw;
    db.licenseActive = true;
    db.vault.installRef = '';
    db.vault.softRef = '';
    db.vault.activatedAt = activatedAt;
    db.vault.lastValidatedAt = activatedAt;
    db.vault.status = 'active';
    db.vault.note = 'ปลดล็อกสำเร็จ (offline GENKEY)';
    db.vault.licenseId = String(payload.licenseId || '');
    db.vault.keyRef = String(payload.keyRef || 'offline-signature');
    db.vault.plan = String(payload.plan || 'pro-lifetime');

    return { valid: true, token: raw, shopId: sid, licenseId: db.vault.licenseId, plan: db.vault.plan, message: db.vault.note };
  }

  async function clearLicense(db = {}) {
    ensureDbShape(db);
    db.licenseToken = '';
    db.licenseActive = false;
    db.vault = {
      installRef: '', softRef: '', activatedAt: null, lastValidatedAt: null,
      status: 'idle', note: '', licenseId: '', keyRef: '', plan: 'basic'
    };
    localStorage.removeItem(LS_STORED_LICENSE);
    await kvSet(IDB_KEY_STORED_LICENSE, null);
    setVaultState({
      shopId: db.shopId || '', installRef: '', softRef: '', activatedAt: null, lastValidatedAt: null,
      status: 'idle', note: '', licenseId: '', keyRef: '', plan: 'basic'
    });
    return { ok: true };
  }

  async function isProActive(db = {}) {
    const check = await verifyStoredLicense(db);
    return Boolean(check.valid);
  }

  async function hasProAccess(db = {}) {
    const check = await verifyStoredLicense(db);
    return Boolean(
      check.valid
      && db?.licenseActive === true
      && db?.vault?.status === 'active'
      && String(db?.vault?.plan || '').toLowerCase().includes('pro')
    );
  }

  // compatibility wrappers
  async function getActivationRequest(args = {}) { return getRequestCode(args); }
  async function activateProKey({ key = '', shopId = '', deviceId = '', db = {} } = {}) {
    return activateWithGenkey(key, { shopId, deviceId, db });
  }
  async function validateProKey({ key = '', shopId = '', deviceId = '', db = {} } = {}) {
    return activateWithGenkey(key, { shopId, deviceId, db });
  }
  async function validateLicenseToken({ token = '', shopId = '', deviceId = '', db = {} } = {}) {
    if (token) return activateWithGenkey(token, { shopId, deviceId, db });
    return verifyStoredLicense(db);
  }
  async function createGenKey() { return { ok: false, message: 'ปิดการสร้าง GENKEY ในแอป (owner ออกให้ภายนอกเท่านั้น)' }; }
  async function createLicenseToken() { return { ok: false, message: 'ปิดการสร้าง license ในแอป (owner ออกให้ภายนอกเท่านั้น)' }; }

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
      storedLicense: await loadLicense()
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
    db.licenseToken = '';
    db.licenseActive = false;
    if (parsed.vault && typeof parsed.vault === 'object') db.vault = { ...db.vault, ...clone(parsed.vault) };
    if (parsed.storedLicense && typeof parsed.storedLicense === 'object') await saveLicense(parsed.storedLicense);
    localStorage.setItem(LS_LAST_SHOP_ID, db.shopId || '');
    const check = await verifyStoredLicense(db);
    if (!check.valid) await clearLicense(db);
    return { ok: true, message: check.valid ? 'นำเข้าข้อมูล vault สำเร็จ' : 'นำเข้าแล้วแต่ license ไม่ผ่านการตรวจ' };
  }

  async function getStatus(db = {}) {
    ensureDbShape(db);
    const sid = await ensureShopId(db);
    return {
      appVersion: APP_VERSION,
      shopId: sid,
      licenseExists: Boolean(await loadLicense()),
      licenseActive: Boolean(db.licenseActive),
      vault: clone(db.vault || {}),
      hasPublicKey: getConfiguredPublicKeyPem() !== PUBLIC_KEY_PEM_PLACEHOLDER
    };
  }

  window.FakduVault = {
    APP_VERSION,
    normalizeShopId,
    getCurrentShopId,
    setCurrentShopId,
    getOrCreateInstallId,
    getActivationRequest,
    getRequestCode,
    activateWithGenkey,
    saveLicense,
    loadLicense,
    verifyStoredLicense,
    clearLicense,
    createGenKey,
    createLicenseToken,
    validateProKey,
    validateLicenseToken,
    activateProKey,
    isProActive,
    hasProAccess,
    verifyRecoveryAnswers,
    exportVaultBackup,
    importVaultBackup,
    getStatus
  };
})();
