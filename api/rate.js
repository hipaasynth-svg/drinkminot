'use strict';
var L = require('./_lib');

// POST /api/rate { id, t, deviceId, stars(1-5), upvote(bool) }
//   -> { id, upvotes, totalRatings, rating, punch:{done,total}, coupon? }
//
// This endpoint used to accept { id, stars, upvote } from anyone, with no proof of
// presence and no limit, while the "physical tag only" and "once per device per day"
// rules lived in the customer's browser. A loop of curl could move any venue's score.
// Three things are checked here now:
//
//   1. The tag signature (?t=), an HMAC of the venue id under DRINK_TAG_SECRET. Tags
//      already in venues carry no signature, so this is only REFUSED when
//      DRINK_REQUIRE_TAG_SIG=1 — reprint or reprogram from the admin console, then set
//      the flag. Until then an unsigned rating is accepted but flagged unverified, so
//      the migration is visible rather than silently incomplete.
//   2. One rating per device per venue per 24h, as a Redis SET NX EX claim rather than
//      a localStorage timestamp, so clearing site data no longer resets it.
//   3. A coarse per-IP ceiling, to blunt scripted abuse from a single source.
//
// The punch is also awarded HERE, server-side, and only on a rating that passed the
// checks above — the count lives under the device's anonymous token, not in the
// browser, so progress can't be edited and a coupon can't be conjured by claiming a
// full card. When the card fills, the coupon is minted as a server record (see
// _lib.issueCoupon) with a single-use redemption.
module.exports = async function (req, res) {
  if (req.method !== 'POST') { L.json(res, 405, { error: 'method' }); return; }
  try {
    var b = await L.readBody(req);

    var stars = Math.max(1, Math.min(5, parseInt(b.stars, 10) || 0));
    if (!stars) { L.json(res, 400, { error: 'stars' }); return; }
    var upvote = !!b.upvote;

    var profile = await L.getProfile(b.id);
    if (!profile || profile.hidden) { L.json(res, 404, { error: 'not_found' }); return; }

    // (1) proof of presence
    var sigOk = L.verifyTagSig(profile.id, b.t);
    if (!sigOk && L.tagSigEnforced()) { L.json(res, 403, { error: 'bad_tag' }); return; }

    // A device token is required so the daily limit has something to key on. The
    // client mints it (dev_…) and it carries no identity; it is the same token the
    // punch card and wallet pass already use.
    var dev = String(b.deviceId || '');
    if (!L.validDeviceToken(dev)) { L.json(res, 400, { error: 'bad_device' }); return; }

    // (3) coarse per-IP ceiling first — cheapest rejection, and it should not consume
    // the once-per-day claim below.
    var ip = L.clientIp(req);
    var ipLim = await L.rateLimit('drinkminot:rl:ip:' + ip, L.RATE_IP_MAX, L.RATE_IP_WINDOW);
    if (!ipLim.ok) { L.json(res, 429, { error: 'too_many' }); return; }

    // (2) one per device per venue per 24h. Claiming this is what makes the rating
    // count, so it must happen before the counters move and must not be re-runnable.
    var won = await L.claimOnce('drinkminot:rated:' + dev + ':' + profile.id, L.RATE_ONCE_TTL);
    if (!won) { L.json(res, 429, { error: 'rate_limited' }); return; }

    var votes = await L.incrementVotes(profile.id, {
      totalRatings: 1, ratingCount: 1, ratingSum: stars, upvotes: upvote ? 1 : 0
    });

    // ---- punch, server-side ----
    // rewardsOn is the admin's explicit statement that this venue has agreed to honour
    // a reward. With it off, the rating still counts and nothing accrues.
    var out = {
      id: profile.id, upvotes: votes.upvotes, totalRatings: votes.totalRatings,
      rating: L.avgRating(votes), tagVerified: sigOk
    };

    if (profile.rewardsOn) {
      var total = L.clampPunches(profile.punchesNeeded);
      var device = await L.getDevice(dev);
      var rec = device.perRest[profile.id] || { done: 0, total: total };
      rec.total = total;
      rec.done = (parseInt(rec.done, 10) || 0) + 1;
      rec.ratedAt = Date.now();

      if (rec.done >= total) {
        rec.done = 0;
        var coupon = await L.issueCoupon(profile.id, dev, profile.reward, profile.couponValidDays);
        out.coupon = L.couponPublic(coupon);
      }
      device.perRest[profile.id] = rec;
      await L.saveDevice(dev, device);
      out.punch = { done: rec.done, total: rec.total };
    }

    L.json(res, 200, out);
  } catch (e) {
    L.json(res, 500, { error: 'rate_failed' });
  }
};
