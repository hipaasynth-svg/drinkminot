'use strict';
var L = require('./_lib');

// POST /api/device { action:'get', deviceId } -> { ok, perRest }
//
// Read-only. The deviceId is a random client-generated token (dev_...), never tied to a
// phone number, email or account, so a stored record can't be traced to a person. It
// holds only per-venue punch progress.
//
// The 'put' action is deliberately gone. It used to accept punch and coupon state
// straight from the client, which meant progress — and therefore a reward — could be
// written by anyone who could post JSON. The count is now incremented server-side in
// api/rate.js, on a rating that passed the tag-signature and once-per-day checks, and
// coupons are minted as server records (api/coupon.js). The client reads this; it no
// longer authors it.
module.exports = async function (req, res) {
  if (req.method !== 'POST') { L.json(res, 405, { error: 'method' }); return; }
  try {
    var b = await L.readBody(req);
    var d = String(b.deviceId || '');
    if (!L.validDeviceToken(d)) { L.json(res, 400, { error: 'bad_device' }); return; }

    if (b.action === 'get') {
      var dev = await L.getDevice(d);
      L.json(res, 200, { ok: true, perRest: dev.perRest });
      return;
    }

    if (b.action === 'put') {
      // Answered explicitly rather than ignored, so a stale cached client fails loudly
      // in the network tab instead of appearing to save progress that goes nowhere.
      L.json(res, 410, { error: 'server_owned' });
      return;
    }

    L.json(res, 400, { error: 'action' });
  } catch (e) {
    L.json(res, 500, { error: 'device_failed' });
  }
};
