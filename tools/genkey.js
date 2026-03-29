#!/usr/bin/env node
'use strict';

/**
 * Owner-side only GENKEY generator.
 *
 * Usage:
 *   node tools/genkey.js --requestCode FKDRQ1.xxxxx --privateKeyFile ./owner_private_key.pem
 *   node tools/genkey.js --shopId SHOP-001 --installRef <24-hex> --softRef <24-hex> --privateKeyFile ./owner_private_key.pem
 *
 * Optional flags:
 *   --privateKey "<PEM text>"  // local input
 *   --app FAKDU
 *   --typ fakdu_license
 */

const crypto = require('crypto');
const fs = require('fs');

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

function parseRequestCode(raw = '') {
  const text = String(raw || '').trim();
  if (!text) return null;
  const [prefix, encoded] = text.split('.');
  if (prefix !== 'FKDRQ1' || !encoded) return null;
  try {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    const payload = JSON.parse(decoded);
    return payload && typeof payload === 'object' ? payload : null;
  } catch (_) {
    return null;
  }
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

(function main() {
  const args = parseArgs(process.argv);
  const privateKeyFromCli = String(args.privateKey || '').trim();
  const privateKeyFile = String(args.privateKeyFile || args.privatekeyfile || '').trim();
  const privateKeyFromEnv = String(process.env.OWNER_PRIVATE_KEY_PEM || '').trim();
  let privateKeyPem = privateKeyFromCli || privateKeyFromEnv;
  if (!privateKeyPem && privateKeyFile) {
    try {
      privateKeyPem = String(fs.readFileSync(privateKeyFile, 'utf8') || '').trim();
    } catch (error) {
      fail(`Cannot read --privateKeyFile: ${error.message}`);
    }
  }
  if (!privateKeyPem) {
    fail('Missing private key. Use --privateKeyFile or --privateKey or OWNER_PRIVATE_KEY_PEM.');
  }

  const requestPayload = parseRequestCode(args.requestCode || args.requestcode || '');
  const shopId = normalizeShopId(args.shopId || args.shopid || requestPayload?.shopId || '');
  if (!shopId) fail('Missing or invalid --shopId.');
  const installRef = String(args.installRef || args.installref || requestPayload?.installRef || '').trim();
  const softRef = String(args.softRef || args.softref || requestPayload?.softRef || '').trim();
  if (!installRef) fail('Missing installRef. Use --requestCode or --installRef.');
  if (!softRef) fail('Missing softRef. Use --requestCode or --softRef.');

  const now = Date.now();
  const payload = {
    typ: String(args.typ || 'fakdu_license'),
    app: String(args.app || 'FAKDU').trim().toUpperCase(),
    shopId,
    installRef,
    softRef,
    pro: true,
    lifetime: true,
    issuedAt: Number(args.issuedAt || now)
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
