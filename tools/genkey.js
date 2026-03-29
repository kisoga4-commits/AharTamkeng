#!/usr/bin/env node
'use strict';

/**
 * Owner-side only GENKEY generator.
 *
 * Usage:
 *   OWNER_PRIVATE_KEY_PEM="$(cat private_key.pem)" node tools/genkey.js --shopId SHOP-001
 *
 * Optional flags:
 *   --licenseId LIC-123
 *   --plan pro-lifetime
 *   --keyRef owner-rsa-2026
 *   --exp 0                    // unix ms; 0 = no expiry
 *   --app FAKDU
 *   --typ fakdu_license
 */

const crypto = require('crypto');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    out[key] = value;
  }
  return out;
}

function b64urlEncodeUtf8(text = '') {
  return Buffer.from(String(text), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function b64urlEncodeBuffer(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function normalizeShopId(value = '') {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

(function main() {
  const args = parseArgs(process.argv);
  const privateKeyPem = String(process.env.OWNER_PRIVATE_KEY_PEM || '').trim();
  if (!privateKeyPem) {
    fail('Missing OWNER_PRIVATE_KEY_PEM env var (owner secret key).');
  }

  const shopId = normalizeShopId(args.shopId || args.shopid || '');
  if (!shopId) fail('Missing or invalid --shopId.');

  const now = Date.now();
  const payload = {
    typ: String(args.typ || 'fakdu_license'),
    app: String(args.app || 'FAKDU').trim().toUpperCase(),
    shopId,
    pro: true,
    lifetime: true,
    plan: String(args.plan || 'pro-lifetime'),
    licenseId: String(args.licenseId || `LIC-${shopId}-${now}`),
    keyRef: String(args.keyRef || 'owner-rsa-sha256'),
    iat: Number(args.iat || now),
    exp: Number(args.exp || 0)
  };

  const payloadEncoded = b64urlEncodeUtf8(JSON.stringify(payload));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(payloadEncoded);
  signer.end();

  let signature;
  try {
    signature = signer.sign(privateKeyPem);
  } catch (error) {
    fail(`Cannot sign payload with OWNER_PRIVATE_KEY_PEM: ${error.message}`);
  }

  const signatureEncoded = b64urlEncodeBuffer(signature);
  const genkey = `${payloadEncoded}.${signatureEncoded}`;

  console.log(genkey);
})();
