'use strict';
/* Verified-presence chain: signed tags -> server-held punches -> single-use coupons.
   Plain Node, no npm dependencies:  node tests/presence.test.js

   These cover the three things that used to be enforced only in the customer's browser,
   which together meant a reward could be minted and re-used by anyone with curl:

     1. that a rating came from someone standing in the venue  (was a ?r= query param)
     2. that it was one rating per device per day               (was localStorage)
     3. that a punch card was really full before a reward       (was localStorage, and
        /api/device stored whatever the client posted)

   A coupon is only worth as much as the punch count behind it, and a punch count is only
   worth as much as the proof of presence behind it — so all three are asserted here. */

process.env.DRINK_TAG_SECRET = 'test-tag-secret-not-a-real-one';

var rate = require('../api/rate.js');
var coupon = require('../api/coupon.js');
var owner = require('../api/owner.js');
var admin = require('../api/admin.js');
var state = require('../api/state.js');
var L = require('../api/_lib.js');

var pass = 0, fail = 0;
function ok(cond, what) {
  if (cond) { pass++; console.log('  ok   ' + what); }
  else { fail++; console.log('  FAIL ' + what); }
}
function call(handler, body, method, headers) {
  return new Promise(function (resolve) {
    var req = { method: method || 'POST', body: body, headers: headers || {} };
    var res = {
      statusCode: 200, setHeader: function () {},
      end: function (p) { resolve({ status: res.statusCode, body: JSON.parse(p) }); }
    };
    handler(req, res);
  });
}
var ADMIN = process.env.DRINK_ADMIN_PASSWORD || 'drink-admin';
var n = 0;
function newDev() { n++; return 'dev_t' + n + Date.now().toString(36); }

(async function () {
  // ---- set up one venue we control: rewards on, 2 punches, a staff PIN ----
  var VENUE = 1; // seeded claimed + rewardsOn
  var rp = await call(admin, { password: ADMIN, action: 'resetPassword', id: VENUE });
  var login = await call(owner, { action: 'login', id: VENUE, password: rp.body.password });
  var tok = login.body.token;
  await call(owner, { action: 'update', id: VENUE, token: tok, fields: { punchesNeeded: 2, reward: 'Free side of tots', staffPin: '135790' } });
  await call(admin, { password: ADMIN, action: 'setFlag', id: VENUE, rewardsOn: true });
  var prof = await L.getProfile(VENUE);
  ok(prof.punchesNeeded === 2 && !!prof.staffPin && prof.rewardsOn, 'venue set up: 2 punches, staff PIN, rewards on');

  console.log('\n1. signed tags');

  var sig = L.tagSigFor(VENUE);
  ok(!!sig && sig.length === 16, 'a tag signature is issued for a venue');
  ok(L.tagSigFor(VENUE) === sig, 'it is deterministic, so a printed tag never goes stale');
  ok(L.tagSigFor(VENUE + 1) !== sig, 'it differs per venue, so one tag cannot rate another');
  ok(L.verifyTagSig(VENUE, sig), 'the right signature verifies');
  ok(!L.verifyTagSig(VENUE, 'deadbeefdeadbeef'), 'a wrong signature does not');
  ok(!L.verifyTagSig(VENUE, ''), 'a missing signature does not');

  console.log('\n2. the rating endpoint');

  var r = await call(rate, { id: VENUE, t: sig, stars: 5, upvote: true });
  ok(r.status === 400 && r.body.error === 'bad_device', 'a rating without a device token is refused');

  // Enforcement OFF (the default, for tags already in venues): an unsigned rating still
  // counts, but is reported unverified so the migration is visible.
  delete process.env.DRINK_REQUIRE_TAG_SIG;
  ok(!L.tagSigEnforced(), 'enforcement is off by default, so printed tags keep working');
  var d1 = newDev();
  r = await call(rate, { id: VENUE, deviceId: d1, stars: 4, upvote: true });
  ok(r.status === 200 && r.body.tagVerified === false, 'an unsigned rating is accepted but flagged unverified');

  // Enforcement ON: unsigned is refused outright.
  process.env.DRINK_REQUIRE_TAG_SIG = '1';
  ok(L.tagSigEnforced(), 'enforcement turns on with the flag and a secret');
  r = await call(rate, { id: VENUE, deviceId: newDev(), stars: 5 });
  ok(r.status === 403 && r.body.error === 'bad_tag', 'with enforcement on, no signature is refused');
  r = await call(rate, { id: VENUE, t: 'deadbeefdeadbeef', deviceId: newDev(), stars: 5 });
  ok(r.status === 403 && r.body.error === 'bad_tag', 'with enforcement on, a forged signature is refused');

  console.log('\n3. one rating per device per venue per 24h');

  var d2 = newDev();
  r = await call(rate, { id: VENUE, t: sig, deviceId: d2, stars: 5, upvote: true });
  ok(r.status === 200, 'first rating from a device counts');
  var firstTotal = r.body.totalRatings;
  r = await call(rate, { id: VENUE, t: sig, deviceId: d2, stars: 5, upvote: true });
  ok(r.status === 429 && r.body.error === 'rate_limited', 'the same device is refused a second time');
  var votes = await L.getVotes(VENUE);
  ok(votes.totalRatings === firstTotal, 'and the refused attempt moved no counter');
  r = await call(rate, { id: VENUE, t: sig, deviceId: newDev(), stars: 5 });
  ok(r.status === 200 && r.body.totalRatings === firstTotal + 1, 'a different device still counts');

  console.log('\n4. punches accrue server-side, and mint a coupon');

  var d3 = newDev();
  r = await call(rate, { id: VENUE, t: sig, deviceId: d3, stars: 5, upvote: true });
  ok(r.body.punch && r.body.punch.done === 1 && r.body.punch.total === 2, 'first punch: 1/2, from the server');
  ok(!r.body.coupon, 'no coupon yet');

  var srv = await L.getDevice(d3);
  ok(srv.perRest[VENUE].done === 1, 'the count lives in the database, not the browser');

  // A second venue-day. The daily claim is the gate, so clear it the way a day passing
  // would rather than by faking client state.
  await L.clearLimit('drinkminot:rated:' + d3 + ':' + VENUE);
  r = await call(rate, { id: VENUE, t: sig, deviceId: d3, stars: 5, upvote: true });
  ok(!!r.body.coupon, 'second punch fills the card and mints a coupon');
  ok(r.body.punch.done === 0, 'and the card resets to 0');
  var code = r.body.coupon.code;
  ok(/^DRK[A-Z2-9]{10}$/.test(code), 'the code is server-minted and long enough not to be enumerable: ' + code);
  ok(r.body.coupon.reward === 'Free side of tots', 'it carries the reward the owner set');

  console.log('\n5. a coupon can be redeemed once, with the staff PIN');

  var pk = await call(coupon, { action: 'peek', code: code });
  ok(pk.status === 200 && pk.body.venue.name && pk.body.coupon.state === 'valid',
     'peek shows staff the venue and reward with no PIN, and no customer identity');
  ok(pk.body.coupon.device === undefined, 'peek does not leak the device token');

  r = await call(coupon, { action: 'redeem', code: code, pin: '000000' });
  ok(r.status === 401 && r.body.error === 'bad_pin', 'a wrong PIN does not redeem');
  ok(typeof r.body.triesLeft === 'number', 'and staff are told how many tries remain');
  ok(L.couponState(await L.getCoupon(code)) === 'valid', 'the coupon is untouched after a wrong PIN');

  r = await call(coupon, { action: 'redeem', code: code, pin: '135790' });
  ok(r.status === 200 && r.body.ok, 'the right PIN redeems it');
  ok(!!r.body.coupon.redeemedAt, 'and stamps when');

  r = await call(coupon, { action: 'redeem', code: code, pin: '135790' });
  ok(r.status === 409 && r.body.error === 'redeemed', 'the same code cannot be redeemed twice');

  r = await call(coupon, { action: 'redeem', code: 'DRKZZZZZZZZZZ', pin: '135790' });
  ok(r.status === 404 && r.body.error === 'unknown', 'a made-up code is unknown');

  console.log('\n6. the PIN is not brute-forceable');

  // Fill a second card to get a fresh coupon to attack.
  var d4 = newDev();
  await call(rate, { id: VENUE, t: sig, deviceId: d4, stars: 5 });
  await L.clearLimit('drinkminot:rated:' + d4 + ':' + VENUE);
  var r2 = await call(rate, { id: VENUE, t: sig, deviceId: d4, stars: 5 });
  var code2 = r2.body.coupon.code;

  var locked = false, sawLock = null;
  for (var i = 0; i < L.PIN_FAIL_PER_COUPON + 2; i++) {
    var att = await call(coupon, { action: 'redeem', code: code2, pin: '111111' }, 'POST', { 'x-forwarded-for': '10.1.1.9' });
    if (att.status === 429 && att.body.error === 'locked') { locked = true; sawLock = att.body; break; }
  }
  ok(locked, 'the coupon locks out after ' + L.PIN_FAIL_PER_COUPON + ' wrong PINs');
  ok(sawLock && sawLock.scope, 'the lockout says which scope tripped: ' + (sawLock && sawLock.scope));
  // The real PIN is refused while locked — otherwise the lockout would be decorative.
  var during = await call(coupon, { action: 'redeem', code: code2, pin: '135790' }, 'POST', { 'x-forwarded-for': '10.1.1.9' });
  ok(during.status === 429, 'even the correct PIN is refused while locked out');
  ok(L.couponState(await L.getCoupon(code2)) === 'valid', 'and the coupon survives the attack unredeemed');

  console.log('\n7. outstanding coupons are not destroyed by the next card');

  var d5 = newDev();
  var c1 = await L.issueCoupon(VENUE, d5, 'First reward', 14);
  var c2 = await L.issueCoupon(VENUE, d5, 'Second reward', 14);
  var mine = await call(coupon, { action: 'mine', deviceId: d5 });
  ok(mine.body.coupons.length === 2, 'both unredeemed coupons are still there (the old client kept one slot and overwrote it)');
  ok(c1.code !== c2.code, 'each has its own code');

  console.log('\n7b. only the device that earned a reward can add it to Wallet');

  var wl = await call(coupon, { action: 'walletLink', code: c1.code, deviceId: newDev() });
  ok(wl.status === 403 && wl.body.error === 'not_yours',
     'another device holding the code cannot mint a pass for it');
  wl = await call(coupon, { action: 'walletLink', code: c1.code, deviceId: d5 });
  // No wallet configured in tests, so the correct owner gets 501 rather than 403 — the
  // point is that the ownership check passed before configuration was even consulted.
  ok(wl.status === 501 && wl.body.error === 'not_configured',
     'the owning device gets past the ownership check (then stops for lack of wallet config)');

  console.log('\n8. an expired coupon cannot be redeemed');

  var expired = await L.issueCoupon(VENUE, newDev(), 'Too late', 1);
  expired.expiresAt = Date.now() - 1000;
  await L.kvSet('drinkminot:coupon:' + expired.code, JSON.stringify(expired));
  r = await call(coupon, { action: 'redeem', code: expired.code, pin: '135790' });
  ok(r.status === 409 && r.body.error === 'expired', 'an expired coupon is refused');

  console.log('\n9. a venue with no PIN cannot redeem at all');

  await call(owner, { action: 'update', id: VENUE, token: tok, fields: { staffPin: '' } });
  var noPinCoupon = await L.issueCoupon(VENUE, newDev(), 'No pin set', 14);
  r = await call(coupon, { action: 'redeem', code: noPinCoupon.code, pin: '135790' });
  ok(r.status === 409 && r.body.error === 'no_pin', 'redemption is off rather than open when no PIN is set');
  r = await call(owner, { action: 'update', id: VENUE, token: tok, fields: { staffPin: '12' } });
  ok(r.status === 400 && r.body.error === 'bad_pin_format', 'a short PIN is rejected, not silently dropped');

  console.log('\n10. secrets and client-authored state');

  var pub = await call(state, {}, 'GET');
  var leaked = pub.body.restaurants.filter(function (x) { return x.staffPin !== undefined; });
  ok(leaked.length === 0, 'GET /api/state leaks no staff PIN');
  ok(pub.body.restaurants[0].hasStaffPin !== undefined, 'but does say whether one is set');

  // The old /api/device 'put' let a browser declare its own punch count. That endpoint is
  // gone entirely (its one read-only action moved into api/coupon.js), so there is no
  // action anywhere that writes punch state except a real rating. Asserted by trying to
  // smuggle a count through the read: it must be ignored.
  var tamper = newDev();
  r = await call(coupon, { action: 'deviceGet', deviceId: tamper, perRest: { '1': { done: 99, total: 2 } } });
  ok(r.status === 200 && Object.keys(r.body.perRest).length === 0,
     'a client cannot write its own punch count — the read ignores any payload');
  var afterTamper = await L.getDevice(tamper);
  ok(Object.keys(afterTamper.perRest).length === 0, 'and nothing was persisted for it');

  var al = await call(admin, { password: ADMIN, action: 'list' });
  var row = al.body.restaurants.filter(function (x) { return x.id === VENUE; })[0];
  ok(row.staffPin === undefined && row.tagSig === sig, 'admin gets the signed tag URL but never the PIN hash');
  ok(al.body.tagSigEnforced === true, 'admin can see whether tag enforcement is on');

  var cs = await call(admin, { password: ADMIN, action: 'couponStats' });
  ok(cs.status === 200 && cs.body.stats[VENUE].issued >= 1 && cs.body.stats[VENUE].redeemed >= 1,
     'issued vs redeemed is reportable per venue: ' + JSON.stringify(cs.body.stats[VENUE]));

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
