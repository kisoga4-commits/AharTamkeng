const SecurityBridge = (() => {
  const CLOUD_TOKEN_ENDPOINT = 'https://us-central1-YOUR_PROJECT.cloudfunctions.net/issuePosToken';
  const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
YOUR_CLOUD_PUBLIC_KEY_HERE
-----END PUBLIC KEY-----`;

  const textEncoder = new TextEncoder();

  const toBase64Url = (bytes) =>
    btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const fromBase64Url = (input) => {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  };

  const pemToArrayBuffer = (pem) => {
    const clean = pem.replace('-----BEGIN PUBLIC KEY-----', '').replace('-----END PUBLIC KEY-----', '').replace(/\s+/g, '');
    const binary = atob(clean);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out.buffer;
  };

  const getBrowserFallbackId = async () => {
    const storageKey = 'pos_machine_uuid_v1';
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;

    const payload = `${navigator.userAgent}|${navigator.language}|${screen.width}x${screen.height}|${Date.now()}`;
    const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(payload));
    const id = `BROWSER-${toBase64Url(new Uint8Array(digest)).slice(0, 16).toUpperCase()}`;
    localStorage.setItem(storageKey, id);
    return id;
  };

  const getMachineId = async () => {
    if (window.Android?.getHardwareUUID) {
      const androidId = window.Android.getHardwareUUID();
      if (androidId) return `ANDROID-${String(androidId).trim().toUpperCase()}`;
    }
    if (window.PosNative?.getHardwareUUID) {
      const nativeId = await window.PosNative.getHardwareUUID();
      if (nativeId) return `PC-${String(nativeId).trim().toUpperCase()}`;
    }
    return getBrowserFallbackId();
  };

  const importPublicKey = async () => {
    if (PUBLIC_KEY_PEM.includes('YOUR_CLOUD_PUBLIC_KEY_HERE')) return null;
    return crypto.subtle.importKey(
      'spki',
      pemToArrayBuffer(PUBLIC_KEY_PEM),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
  };

  const verifySignedToken = async (token, machineId) => {
    if (!token || !token.includes('.')) return { ok: false, reason: 'missing_token' };
    const [payloadPart, signaturePart] = token.split('.');
    if (!payloadPart || !signaturePart) return { ok: false, reason: 'bad_format' };

    let payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadPart)));
    } catch (_) {
      return { ok: false, reason: 'invalid_payload' };
    }

    if (payload.machineId !== machineId) return { ok: false, reason: 'machine_mismatch' };
    if (payload.exp && Date.now() > Number(payload.exp)) return { ok: false, reason: 'token_expired' };

    const publicKey = await importPublicKey();
    if (!publicKey) return { ok: false, reason: 'missing_public_key' };

    const signedData = textEncoder.encode(payloadPart);
    const signature = fromBase64Url(signaturePart);
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, signedData);
    return valid ? { ok: true, claims: payload } : { ok: false, reason: 'invalid_signature' };
  };

  const recoverTokenFromCloud = async (machineId) => {
    const response = await fetch(CLOUD_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ machineId })
    });
    if (!response.ok) throw new Error(`token_recovery_failed_${response.status}`);
    const data = await response.json();
    return data?.token || '';
  };

  return { getMachineId, verifySignedToken, recoverTokenFromCloud };
})();
