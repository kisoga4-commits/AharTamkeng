#!/usr/bin/env node
'use strict';

/**
 * Owner-side GENKEY generator (offline).
 *
 * Usage:
 *   GENKEY_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----..." node tools/genkey.js --shopId SHOP-ABC123
 *   node tools/genkey.js --shopId SHOP-ABC123 --private-key-file ./private_key.pem
 *
 * Output format:
 *   <payloadBase64Url>.<signatureBase64Url>
 */

const fs = require('node:fs');
const crypto = require('node:crypto');
const PRIVATE_KEY_PLACEHOLDER = `-----BEGIN PRIVATE KEY-----
REPLACE_WITH_REAL_PRIVATE_KEY
-----END PRIVATE KEY-----`;

function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
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

function b64urlEncodeUtf8(text = '') {
  return Buffer.from(String(text), 'utf8').toString('base64url');
}

function b64urlEncodeBytes(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function loadPrivateKeyPem(args) {
  if (args['use-placeholder']) {
    return PRIVATE_KEY_PLACEHOLDER;
  }
  if (args['private-key-file']) {
    return fs.readFileSync(String(args['private-key-file']), 'utf8').trim();
  }
  return String(process.env.GENKEY_PRIVATE_KEY_PEM || '').trim();
}

function buildLicensePayload({ shopId, issuedAt, app = 'FAKDU' }) {
  return {
    typ: 'fakdu_license',
    app,
    shopId,
    pro: true,
    lifetime: true,
    issuedAt
  };
}

function main() {
  const args = parseArgs();
  const shopId = normalizeShopId(args.shopId || args.shop || '');
  if (!shopId) {
    console.error('Missing --shopId. Example: --shopId SHOP-ABC123');
    process.exit(1);
  }

  const privateKeyPem = loadPrivateKeyPem(args);
  if (!privateKeyPem || privateKeyPem.includes('REPLACE_WITH_REAL_PRIVATE_KEY')) {
    console.error('Missing real private key. Provide --private-key-file or GENKEY_PRIVATE_KEY_PEM env.');
    process.exit(1);
  }

  const payload = buildLicensePayload({
    shopId,
    issuedAt: Number(args.issuedAt || Date.now()),
    app: String(args.app || 'FAKDU').trim() || 'FAKDU'
  });

  const payloadEncoded = b64urlEncodeUtf8(JSON.stringify(payload));
  const signature = crypto.sign('RSA-SHA256', Buffer.from(payloadEncoded, 'utf8'), privateKeyPem);
  const signatureEncoded = b64urlEncodeBytes(signature);
  const genkey = `${payloadEncoded}.${signatureEncoded}`;

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ payload, payloadEncoded, signatureEncoded, genkey }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${genkey}\n`);
}

main();
