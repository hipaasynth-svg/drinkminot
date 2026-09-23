'use strict';
var L = require('./_lib');
var W = require('./_wallet');

// POST /api/coupon
//   { action:'peek',   code }              -> what staff are about to honour (no PIN yet)
//   { action:'redeem', code, pin }         -> burns it, once
//   { action:'mine',   deviceId }          -> this device's own coupons (cache-wipe recovery)
//   { action:'deviceGet', deviceId }      -> this device's punch state (read-only)
//
// Redemption is deliberately usable from ANY staff member's own phone with no venue
// login and no shared device: they scan the QR on the customer's coupon, which carries
// only the code, and the venue's 6-digit staff PIN is the part that proves they work
// there. That is why 'peek' is public — staff need to see the reward before honouring
// it — and why nothing in a peek identifies the customer.
//
// Because the endpoint is public, the PIN is the brute-force surface, so failures are
// counted three ways: per coupon, per venue and per IP. A coupon locks out long before
// a million-combination PIN could be walked, and a venue-wide lockout stops someone
// spreading the attempts across many coupons.

module.exports = async function (req, res) {
  if (req.method !== 'POST') { L.json(res, 405, { error: 'method' }); return; }
  try {
    var b = await L.readBody(req);
    var ip = L.clientIp(req);

    // ---- this device's punch state ----
    // Folded in from the former api/device.js. Vercel's Hobby plan caps a deployment at
    // 12 Serverless Functions, and a separate file for one read-only action spent one of
    // them; these two endpoints were the same subject anyway — what this anonymous device
    // has earned. Read-only: nothing here writes punch state, which api/rate.js owns.
    if (b.action === 'deviceGet') {
      var pd = String(b.deviceId || '');
      if (!L.validDeviceToken(pd)) { L.json(res, 400, { error: 'bad_device' }); return; }
      var pdev = await L.getDevice(pd);
      L.json(res, 200, { ok: true, perRest: pdev.perRest });
      return;
    }

    // ---- a device asking for its own coupons back ----
    if (b.action === 'mine') {
      var dev = String(b.deviceId || '');
      if (!L.validDeviceToken(dev)) { L.json(res, 400, { error: 'bad_device' }); return; }
      var codes = await L.getCouponIndex(dev);
      var out = [];
      for (var i = 0; i < codes.length; i++) {
        var c = await L.getCoupon(codes[i]);
        // Only this device's own coupons, and only ones still worth showing.
        if (c && c.device === dev && L.couponState(c) === 'valid') out.push(L.couponPublic(c));
      }
      L.json(res, 200, { ok: true, coupons: out });
      return;
    }

    var code = L.normalizeCode(b.code);
    if (!code) { L.json(res, 400, { error: 'code' }); return; }

    // ---- push this reward into the customer's Google Wallet ----
    // Asked for separately rather than done inside POST /api/rate: creating the pass is
    // several calls to Google, and a rating should not wait on them (or fail because of
    // them). The coupon already exists and works without a wallet — this only adds the
    // pass, whose barcode opens the same redeem page the site links to.
    if (b.action === 'walletLink') {
      var dev2 = String(b.deviceId || '');
      if (!L.validDeviceToken(dev2)) { L.json(res, 400, { error: 'bad_device' }); return; }
      var wc = await L.getCoupon(code);
      if (!wc) { L.json(res, 404, { error: 'unknown' }); return; }
      // Only the device that earned it may add it — otherwise anyone holding a code
      // could mint a pass for someone else's reward.
      if (wc.device !== dev2) { L.json(res, 403, { error: 'not_yours' }); return; }
      if (L.couponState(wc) !== 'valid') { L.json(res, 409, { error: L.couponState(wc) }); return; }
      if (!W.googleConfigured()) { L.json(res, 501, { error: 'not_configured' }); return; }
      var wp = await L.getProfile(wc.venueId);
      var wr = await W.googleSaveOffer(dev2, wc.code, wp ? wp.name : 'DrinkMinot', wc.reward, wc.expiresAt);
      if (!wr.ok) { L.json(res, 502, { error: wr.reason || 'wallet_failed' }); return; }
      L.json(res, 200, { ok: true, saveUrl: wr.saveUrl });
      return;
    }

    // ---- what staff are about to honour ----
    if (b.action === 'peek') {
      // Enumeration guard: a wrong code costs an IP attempt, so the code space can't
      // be walked from one source.
      var peekLim = await L.rateLimit('drinkminot:rl:peek:' + ip, 120, 900);
      if (!peekLim.ok) { L.json(res, 429, { error: 'too_many' }); return; }

      var pc = await L.getCoupon(code);
      if (!pc) { L.json(res, 404, { error: 'unknown' }); return; }
      var pp = await L.getProfile(pc.venueId);
      L.json(res, 200, {
        ok: true,
        coupon: L.couponPublic(pc),
        venue: pp ? { id: pp.id, name: pp.name, hasStaffPin: !!pp.staffPin } : null
      });
      return;
    }

    // ---- burn it ----
    if (b.action === 'redeem') {
      var c = await L.getCoupon(code);
      if (!c) { L.json(res, 404, { error: 'unknown' }); return; }

      var state = L.couponState(c);
      if (state !== 'valid') {
        // Already used or out of date: say which, and when it was used, so staff can
        // tell an honest mistake from someone trying it twice.
        L.json(res, 409, { error: state, coupon: L.couponPublic(c) });
        return;
      }

      var profile = await L.getProfile(c.venueId);
      if (!profile) { L.json(res, 404, { error: 'not_found' }); return; }
      if (!profile.staffPin) { L.json(res, 409, { error: 'no_pin' }); return; }

      // Lockout checks BEFORE comparing, so a locked coupon or venue can't be probed.
      var cKey = 'drinkminot:pinfail:c:' + code;
      var vKey = 'drinkminot:pinfail:v:' + profile.id;
      var iKey = 'drinkminot:pinfail:ip:' + ip;
      var cNow = await L.rateLimit(cKey, L.PIN_FAIL_PER_COUPON, L.PIN_FAIL_COUPON_WINDOW);
      var vNow = await L.rateLimit(vKey, L.PIN_FAIL_PER_VENUE, L.PIN_FAIL_VENUE_WINDOW);
      var iNow = await L.rateLimit(iKey, L.PIN_FAIL_PER_IP, L.PIN_FAIL_IP_WINDOW);
      // Each attempt is counted up front and the counter is cleared on success below,
      // so a genuine staff member who types it right never accumulates a lockout.
      if (!cNow.ok || !vNow.ok || !iNow.ok) {
        L.json(res, 429, {
          error: 'locked',
          scope: !cNow.ok ? 'coupon' : (!vNow.ok ? 'venue' : 'ip'),
          retryAfterMin: Math.ceil(L.PIN_FAIL_COUPON_WINDOW / 60)
        });
        return;
      }

      if (!L.validPinFormat(b.pin) || !L.verifyPw(String(b.pin), profile.staffPin)) {
        L.json(res, 401, {
          error: 'bad_pin',
          triesLeft: Math.max(0, L.PIN_FAIL_PER_COUPON - cNow.count)
        });
        return;
      }

      var r = await L.redeemCoupon(code, 'staff-pin');
      if (!r.ok) { L.json(res, 409, { error: r.reason, coupon: L.couponPublic(r.coupon) }); return; }

      // A correct PIN clears the attempt counters for this coupon and IP — the venue
      // counter is left to expire on its own so a spread-out attack still trips it.
      await L.clearLimit(cKey);
      await L.clearLimit(iKey);

      // Grey the pass out in the customer's own Google Wallet, so the pass itself
      // becomes the receipt. Best-effort: a wallet that isn't configured, or a network
      // failure here, must never undo a redemption the venue has already honoured.
      var walletUpdated = false;
      try {
        if (W.googleConfigured()) {
          walletUpdated = await W.googleCompleteOffer(c.device, c.code);
        }
      } catch (e) { walletUpdated = false; }

      L.json(res, 200, {
        ok: true, coupon: L.couponPublic(r.coupon),
        venue: { id: profile.id, name: profile.name },
        walletUpdated: walletUpdated
      });
      return;
    }

    L.json(res, 400, { error: 'action' });
  } catch (e) {
    L.json(res, 500, { error: 'coupon_failed' });
  }
};
