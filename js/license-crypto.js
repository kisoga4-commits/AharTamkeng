const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
REPLACE_WITH_P256_SPKI_PUBLIC_KEY_BASE64
-----END PUBLIC KEY-----`;

const LICENSE_DB_NAME = 'PWA_LICENSE_DB';
const LICENSE_DB_VERSION = 1;
const LICENSE_STORE = 'kv';
const INSTALL_UUID_KEY = 'install_uuid';

const textEncoder = new TextEncoder();

const openLicenseDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(LICENSE_DB_NAME, LICENSE_DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(LICENSE_STORE)) db.createObjectStore(LICENSE_STORE);
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
});

const idbGet = async (key) => {
  const db = await openLicenseDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LICENSE_STORE, 'readonly');
    const store = tx.objectStore(LICENSE_STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('IndexedDB get failed'));
  });
};

const idbSet = async (key, value) => {
  const db = await openLicenseDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LICENSE_STORE, 'readwrite');
    const store = tx.objectStore(LICENSE_STORE);
    const req = store.put(value, key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error || new Error('IndexedDB put failed'));
  });
};

const getOrCreateInstallUuid = async () => {
  const existing = await idbGet(INSTALL_UUID_KEY);
  if (existing) return existing;
  const created = (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`).toString();
  await idbSet(INSTALL_UUID_KEY, created);
  return created;
};

const getCanvasFingerprint = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 280;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 'canvas-unavailable';
  ctx.textBaseline = 'top';
  ctx.font = '16px Arial';
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, 280, 80);
  ctx.fillStyle = '#f7f7f7';
  ctx.fillText('PWA-License-Fingerprint', 8, 10);
  ctx.fillStyle = '#ff8a00';
  ctx.fillText(navigator.userAgent, 8, 34);
  return canvas.toDataURL();
};

const sha256Hex = async (input) => {
  const hashBuffer = await crypto.subtle.digest('SHA-256', textEncoder.encode(input));
  return [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const importLicensePublicKey = async () => {
  const spkiBase64 = LICENSE_PUBLIC_KEY_PEM
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s+/g, '');

  const binary = atob(spkiBase64);
  const keyBytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));

  return crypto.subtle.importKey(
    'spki',
    keyBytes.buffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
};

const decodeBase64ToBytes = (value) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

export const generateMachineId = async () => {
  const installUuid = await getOrCreateInstallUuid();
  const fingerprintSeed = [
    getCanvasFingerprint(),
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    String(new Date().getTimezoneOffset())
  ].join('|');

  const fullHash = await sha256Hex(`${installUuid}|${fingerprintSeed}`);
  return fullHash.slice(0, 24);
};

export const verifyLicense = async (storeId, signedTokenBase64) => {
  const machineId = await generateMachineId();
  const payload = `${String(storeId)}:${machineId}`;
  const publicKey = await importLicensePublicKey();

  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    decodeBase64ToBytes(String(signedTokenBase64)),
    textEncoder.encode(payload)
  );
};
