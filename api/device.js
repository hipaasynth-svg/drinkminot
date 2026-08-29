'use strict';
var L = require('./_lib');

// POST /api/device
//   { action:'get', deviceId }           -> { ok, perRest }
//   { action:'put', deviceId, perRest }  -> { ok }
//
// Anonymous punch-card backup. The deviceId is a random client-generated token
// (dev_...), never tied to a phone number, email, or account — so a stored record
// can't be traced to a person. We keep only the per-venue punch/coupon state, so a
// customer's card survives a reload or a wiped localStorage as long as the same
// token is presented. Ratings still live as venue aggregates (see rate.js); nothing
// here links a rating to a device.
var KEY = function (d) { return 'drinkminot:dev:' + d; };
var VALID = /^dev_[a-z0-9]{6,80}$/i;
var MAX_VENUES = 400;
var MAX_BYTES = 24000;

// Only known-shaped numeric/coupon fields are stored — never arbitrary client JSON.
function sanitize(perRest) {
  var out = {};
  if (!perRest || typeof perRest !== 'object') return out;
  Object.keys(perRest).slice(0, MAX_VENUES).forEach(function (id) {
    if (!/^\d{1,6}$/.test(id)) return;
    var r = perRest[id];
    if (!r || typeof r !== 'object') return;
    var rec = {
      done: Math.max(0, Math.min(1000, parseInt(r.done, 10) || 0)),
      total: Math.max(1, Math.min(1000, parseInt(r.total, 10) || 3)),
      ratedAt: Math.max(0, parseInt(r.ratedAt, 10) || 0),
      tapAt: Math.max(0, parseInt(r.tapAt, 10) || 0),
      coupon: null
    };
    var c = r.coupon;
    if (c && typeof c === 'object' && typeof c.code === 'string') {
      rec.coupon = {
        code: String(c.code).slice(0, 32),
        issuedAt: Math.max(0, parseInt(c.issuedAt, 10) || 0),
        expiresAt: Math.max(0, parseInt(c.expiresAt, 10) || 0),
        reward: String(c.reward || '').slice(0, 120)
      };
    }
    out[id] = rec;
  });
  return out;
}

module.exports = async function (req, res) {
  if (req.method !== 'POST') { L.json(res, 405, { error: 'method' }); return; }
  try {
    var b = await L.readBody(req);
    var d = String(b.deviceId || '');
    if (!VALID.test(d)) { L.json(res, 400, { error: 'bad_device' }); return; }

    if (b.action === 'get') {
      var raw = await L.kvGet(KEY(d));
      var perRest = {};
      if (raw) { try { perRest = JSON.parse(raw).perRest || {}; } catch (e) { /* corrupt: treat as empty */ } }
      L.json(res, 200, { ok: true, perRest: perRest });
      return;
    }

    if (b.action === 'put') {
      var payload = JSON.stringify({ perRest: sanitize(b.perRest), updatedAt: Date.now() });
      if (payload.length > MAX_BYTES) { L.json(res, 413, { error: 'too_big' }); return; }
      await L.kvSet(KEY(d), payload);
      L.json(res, 200, { ok: true });
      return;
    }

    L.json(res, 400, { error: 'action' });
  } catch (e) {
    L.json(res, 500, { error: 'device_failed' });
  }
};
