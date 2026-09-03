'use strict';
// Google Wallet (loyalty pass) helper. Server-to-server via the service account —
// no user OAuth. Everything is gated on env: if the vars are absent, googleConfigured()
// is false and callers no-op, so the app runs fine with no wallet configured.
//
//   GOOGLE_WALLET_ISSUER_ID        the ~19-digit issuer id
//   GOOGLE_WALLET_SA_JSON_BASE64   the service-account JSON key, base64-encoded
//
// A card is one loyalty object per (device token, venue). The object carries the punch
// balance and a QR that reopens https://drinkminot.com/?r=<venue>&dev=<token>, so the
// pass itself re-links a wiped phone to its backup. The device token is anonymous.
var crypto = require('crypto');

var SITE = 'https://drinkminot.com';
var CLASS_SUFFIX = 'drinkminot_loyalty_v1';
var WOBASE = 'https://walletobjects.googleapis.com/walletobjects/v1';
var TOKEN_URL = 'https://oauth2.googleapis.com/token';
var SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function loadSA() {
  var b = process.env.GOOGLE_WALLET_SA_JSON_BASE64;
  if (!b) return null;
  try { var sa = JSON.parse(Buffer.from(b, 'base64').toString('utf8')); return (sa.client_email && sa.private_key) ? sa : null; }
  catch (e) { return null; }
}
function issuerId() { return String(process.env.GOOGLE_WALLET_ISSUER_ID || '').trim(); }
function googleConfigured() { return !!(loadSA() && issuerId()); }

function safeTok(t) { return String(t || '').replace(/[^A-Za-z0-9_.-]/g, ''); }
function classId() { return issuerId() + '.' + CLASS_SUFFIX; }
function objectId(token, venueId) { return issuerId() + '.' + safeTok(token) + '_' + (parseInt(venueId, 10) || 0); }

function signJwt(claims, sa) {
  var header = { alg: 'RS256', typ: 'JWT' };
  var now = Math.floor(Date.now() / 1000);
  var body = Object.assign({ iss: sa.client_email, iat: now }, claims);
  var input = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(body));
  var sig = crypto.createSign('RSA-SHA256').update(input).sign(sa.private_key);
  return input + '.' + b64url(sig);
}

async function accessToken(sa) {
  var now = Math.floor(Date.now() / 1000);
  var assertion = signJwt({ scope: SCOPE, aud: TOKEN_URL, exp: now + 3600 }, sa);
  var res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(assertion)
  });
  var j = await res.json();
  if (!j.access_token) throw new Error('wallet_token: ' + (j.error || res.status));
  return j.access_token;
}

function classBody() {
  return {
    id: classId(),
    issuerName: 'DrinkMinot',
    programName: 'DrinkMinot Punch Card',
    reviewStatus: 'UNDER_REVIEW',
    hexBackgroundColor: '#14323b',
    countryCode: 'US'
  };
}
function objectBody(token, venueId, venueName, done, total) {
  return {
    id: objectId(token, venueId),
    classId: classId(),
    state: 'ACTIVE',
    accountId: safeTok(token),
    accountName: venueName || 'DrinkMinot member',
    loyaltyPoints: { label: 'Punches', balance: { string: (done || 0) + ' / ' + (total || 3) } },
    textModulesData: [{ header: venueName || 'DrinkMinot', body: 'Tap in-store to earn punches toward your reward.' }],
    barcode: { type: 'QR_CODE', value: SITE + '/?r=' + (parseInt(venueId, 10) || 0) + '&dev=' + safeTok(token), alternateText: 'Reopen my card' }
  };
}

async function ensureClass(tok) {
  var g = await fetch(WOBASE + '/loyaltyClass/' + encodeURIComponent(classId()), { headers: { Authorization: 'Bearer ' + tok } });
  if (g.status === 200) return;
  var r = await fetch(WOBASE + '/loyaltyClass', {
    method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify(classBody())
  });
  if (!r.ok && r.status !== 409) throw new Error('wallet_class: ' + r.status);
}
async function upsertObject(tok, token, venueId, venueName, done, total) {
  var body = objectBody(token, venueId, venueName, done, total);
  var id = objectId(token, venueId);
  var g = await fetch(WOBASE + '/loyaltyObject/' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + tok } });
  if (g.status === 200) {
    await fetch(WOBASE + '/loyaltyObject/' + encodeURIComponent(id), {
      method: 'PATCH', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
  } else {
    var r = await fetch(WOBASE + '/loyaltyObject', {
      method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!r.ok && r.status !== 409) throw new Error('wallet_object: ' + r.status);
  }
}

// The "Add to Google Wallet" link: a JWT referencing the (already-upserted) object by id.
function saveUrl(token, venueId, sa) {
  var claims = {
    aud: 'google', typ: 'savetowallet', origins: [SITE],
    payload: { loyaltyObjects: [{ id: objectId(token, venueId), classId: classId() }] }
  };
  return 'https://pay.google.com/gp/v/save/' + signJwt(claims, sa);
}

// Create/refresh the card and return its Add-to-Google-Wallet link.
async function googleSave(token, venueId, venueName, done, total) {
  var sa = loadSA();
  if (!sa || !issuerId()) return { ok: false, reason: 'not_configured' };
  var tok = await accessToken(sa);
  await ensureClass(tok);
  await upsertObject(tok, token, venueId, venueName, done, total);
  return { ok: true, saveUrl: saveUrl(token, venueId, sa) };
}

// Patch an existing card's balance WITHOUT creating one. Returns false if the customer
// never added this card (nothing to update) — so a punch never mints a pass nobody asked
// for. Used for the auto-update-on-punch path.
async function patchObjectIfExists(tok, token, venueId, venueName, done, total) {
  var id = objectId(token, venueId);
  var g = await fetch(WOBASE + '/loyaltyObject/' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + tok } });
  if (g.status !== 200) return false;
  await fetch(WOBASE + '/loyaltyObject/' + encodeURIComponent(id), {
    method: 'PATCH', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify(objectBody(token, venueId, venueName, done, total))
  });
  return true;
}

// Best-effort balance refresh when punches change. Only touches a card the customer has
// already added; never creates one, never throws.
async function googlePatch(token, venueId, venueName, done, total) {
  try {
    var sa = loadSA(); if (!sa || !issuerId()) return;
    var tok = await accessToken(sa);
    await patchObjectIfExists(tok, token, venueId, venueName, done, total);
  } catch (e) { /* non-fatal */ }
}

/* ============================ Apple Wallet (.pkpass) ============================
   A real, signed store-card pass — env-gated exactly like Google. Required vars:
     APPLE_PASS_TYPE_ID          e.g. pass.com.drinkminot.loyalty
     APPLE_TEAM_ID               your 10-char Apple team id
     APPLE_PASS_CERT_P12_BASE64  the Pass Type ID cert + key as a base64 .p12
     APPLE_PASS_CERT_PASSWORD    the .p12 export password ('' if none)
     APPLE_WWDR_CERT_BASE64      Apple's WWDR intermediate cert (.cer DER or PEM), base64
   The pass carries the punch balance + a QR back to ?r=<venue>&dev=<token>, so it
   re-links a wiped phone to its anonymous backup — same as the Google card. */
var os = require('os'), fs = require('fs'), path = require('path');
var execFileSync = require('child_process').execFileSync;
var APPLE_ASSETS = require('./_apple_assets');
var APPLE_ORG = 'DrinkMinot', APPLE_DESC = 'DrinkMinot punch card', DEFAULT_TOTAL = 3;
var PASS_BG = 'rgb(21,18,38)', PASS_FG = 'rgb(243,239,250)', PASS_LABEL = 'rgb(198,161,91)';

function appleConfigured() {
  return !!(process.env.APPLE_PASS_TYPE_ID && process.env.APPLE_TEAM_ID &&
    process.env.APPLE_PASS_CERT_P12_BASE64 && process.env.APPLE_PASS_CERT_PASSWORD != null && process.env.APPLE_WWDR_CERT_BASE64);
}

// --- minimal ZIP writer (store method, no compression) — a .pkpass is just a zip ---
var CRC_TABLE = (function () {
  var t = new Array(256);
  for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function zipStore(files) {
  var local = [], central = [], offset = 0;
  files.forEach(function (f) {
    var name = Buffer.from(f.name, 'utf8'), data = f.data, crc = crc32(data);
    var lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    local.push(lh, name, data);
    var ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(0, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + data.length;
  });
  var cd = Buffer.concat(central), body = Buffer.concat(local);
  var end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, cd, end]);
}

// Some Apple .p12 exports use legacy (RC2/3DES) ciphers OpenSSL 3 won't read by default;
// retry once with the legacy provider before giving up.
function openssl(args) {
  // First attempt quiet: a legacy-cipher .p12 fails here and is expected to; only the
  // retry's stderr is surfaced so a genuine failure still shows up in the logs.
  try { execFileSync('openssl', args, { stdio: ['ignore', 'ignore', 'ignore'] }); }
  catch (e) { execFileSync('openssl', args.concat(['-legacy']), { stdio: ['ignore', 'ignore', 'inherit'] }); }
}
function wwdrPemFrom(b64) {
  var raw = Buffer.from(b64, 'base64');
  if (raw.toString('utf8').indexOf('BEGIN CERT') >= 0) return raw.toString('utf8');
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wwdr-'));
  try {
    var der = path.join(dir, 'in.cer'), pem = path.join(dir, 'out.pem');
    fs.writeFileSync(der, raw);
    execFileSync('openssl', ['x509', '-inform', 'DER', '-in', der, '-out', pem], { stdio: ['ignore', 'ignore', 'inherit'] });
    return fs.readFileSync(pem, 'utf8');
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
}
// Detached PKCS#7 signature (DER) of the manifest, signed by the pass cert (WWDR in chain).
function appleSign(manifest) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-'));
  try {
    var p12 = path.join(dir, 'c.p12'); fs.writeFileSync(p12, Buffer.from(process.env.APPLE_PASS_CERT_P12_BASE64, 'base64'));
    var pw = 'pass:' + (process.env.APPLE_PASS_CERT_PASSWORD || '');
    var certPem = path.join(dir, 'cert.pem'), keyPem = path.join(dir, 'key.pem'), wwdr = path.join(dir, 'wwdr.pem');
    openssl(['pkcs12', '-in', p12, '-clcerts', '-nokeys', '-out', certPem, '-passin', pw]);
    openssl(['pkcs12', '-in', p12, '-nocerts', '-nodes', '-out', keyPem, '-passin', pw]);
    fs.writeFileSync(wwdr, wwdrPemFrom(process.env.APPLE_WWDR_CERT_BASE64));
    var man = path.join(dir, 'manifest.json'), sig = path.join(dir, 'sig');
    fs.writeFileSync(man, manifest);
    execFileSync('openssl', ['smime', '-sign', '-binary', '-noattr', '-outform', 'DER',
      '-in', man, '-out', sig, '-signer', certPem, '-inkey', keyPem, '-certfile', wwdr],
      { stdio: ['ignore', 'ignore', 'inherit'] });
    return fs.readFileSync(sig);
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
}
function applePassJson(token, venueId, venueName, done, total) {
  return Buffer.from(JSON.stringify({
    formatVersion: 1,
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID,
    teamIdentifier: process.env.APPLE_TEAM_ID,
    organizationName: APPLE_ORG, description: APPLE_DESC,
    serialNumber: token + '.' + venueId, logoText: APPLE_ORG,
    backgroundColor: PASS_BG, foregroundColor: PASS_FG, labelColor: PASS_LABEL,
    barcodes: [{ format: 'PKBarcodeFormatQR', message: SITE + '/?r=' + venueId + '&dev=' + token, messageEncoding: 'iso-8859-1' }],
    storeCard: {
      primaryFields: [{ key: 'balance', label: 'Punches', value: (done || 0) + ' / ' + (total || DEFAULT_TOTAL) }],
      secondaryFields: [{ key: 'venue', label: 'Where', value: venueName || APPLE_ORG }],
      auxiliaryFields: [{ key: 'how', label: 'How', value: 'Tap our tag in-store to earn punches.' }]
    }
  }), 'utf8');
}
// Build a signed .pkpass Buffer for this device+venue, or null if Apple isn't configured.
// Same serialNumber on re-add, so a fresh add reflects the latest balance.
function applePkpass(token, venueId, venueName, done, total) {
  if (!appleConfigured()) return null;
  var files = [{ name: 'pass.json', data: applePassJson(token, venueId, venueName, done, total) }];
  Object.keys(APPLE_ASSETS).forEach(function (n) { files.push({ name: n, data: Buffer.from(APPLE_ASSETS[n], 'base64') }); });
  var manifest = {};
  files.forEach(function (f) { manifest[f.name] = crypto.createHash('sha1').update(f.data).digest('hex'); });
  var manBuf = Buffer.from(JSON.stringify(manifest), 'utf8');
  var sig = appleSign(manBuf);
  files.push({ name: 'manifest.json', data: manBuf }, { name: 'signature', data: sig });
  return zipStore(files);
}

module.exports = {
  googleConfigured: googleConfigured, appleConfigured: appleConfigured,
  googleSave: googleSave, googlePatch: googlePatch, applePkpass: applePkpass,
  // exported for offline tests
  _signJwt: signJwt, _saveUrl: saveUrl, _classBody: classBody, _objectBody: objectBody,
  _classId: classId, _objectId: objectId, _b64url: b64url, _zipStore: zipStore, _crc32: crc32
};
