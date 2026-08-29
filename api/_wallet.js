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

// Best-effort balance refresh (used when punches change). Never throws.
async function googlePatch(token, venueId, venueName, done, total) {
  try {
    var sa = loadSA(); if (!sa || !issuerId()) return;
    var tok = await accessToken(sa);
    await upsertObject(tok, token, venueId, venueName, done, total);
  } catch (e) { /* non-fatal */ }
}

// Apple is added later; report configured only when all its vars are present.
function appleConfigured() {
  return !!(process.env.APPLE_PASS_TYPE_ID && process.env.APPLE_TEAM_ID &&
    process.env.APPLE_PASS_CERT_P12_BASE64 && process.env.APPLE_PASS_CERT_PASSWORD && process.env.APPLE_WWDR_CERT_BASE64);
}

module.exports = {
  googleConfigured: googleConfigured, appleConfigured: appleConfigured,
  googleSave: googleSave, googlePatch: googlePatch,
  // exported for offline tests
  _signJwt: signJwt, _saveUrl: saveUrl, _classBody: classBody, _objectBody: objectBody,
  _classId: classId, _objectId: objectId, _b64url: b64url
};
