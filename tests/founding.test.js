'use strict';
/* Founding Three regression tests. Plain Node, no npm dependencies:
     node tests/founding.test.js

   DrinkMinot advertised the Founding Three offer in marketing/ for weeks while its
   checkout could not price it: api/checkout.js charged a flat rate with no trial, no
   founding flag and no slot cap, so a bar signing on the one-pager got a different deal
   from the one it was sold. These tests are the guard on the implementation that closed
   that gap, and they mirror EatMinot's suite case for case — the two sites sell the same
   offer at the same price, and a change to one that isn't made to the other should fail
   here rather than in a customer's card statement.

   Stripe is stubbed: L.stripe is replaced so the checkout params can be inspected
   without a network call or a key. */

process.env.STRIPE_SECRET_KEY = 'sk_test_stub_not_a_real_key';

var L = require('../api/_lib.js');
var admin = require('../api/admin.js');
var owner = require('../api/owner.js');

// Capture what checkout would have sent to Stripe.
var lastStripe = null;
L.stripe = async function (path, method, params) {
  lastStripe = { path: path, method: method, params: params };
  return { ok: true, status: 200, data: { url: 'https://checkout.stripe.test/session', id: 'cs_test_1' } };
};
var checkout = require('../api/checkout.js');

var pass = 0, fail = 0;
function ok(cond, what) {
  if (cond) { pass++; console.log('  ok   ' + what); }
  else { fail++; console.log('  FAIL ' + what); }
}
function call(handler, body, headers) {
  return new Promise(function (resolve) {
    var req = { method: 'POST', body: body, headers: headers || {} };
    var res = {
      statusCode: 200, setHeader: function () {},
      end: function (p) { resolve({ status: res.statusCode, body: JSON.parse(p) }); }
    };
    handler(req, res);
  });
}
var ADMIN = process.env.DRINK_ADMIN_PASSWORD || 'drink-admin';

// Claim a venue and return an owner session token for it.
async function claimAndLogin(id) {
  var prof = await L.getProfile(id);
  if (!prof.claimed) {
    var list = await call(admin, { password: ADMIN, action: 'list' });
    var row = list.body.restaurants.filter(function (x) { return x.id === id; })[0];
    await call(owner, { action: 'claim', id: id, password: 'ownerpick', code: row.claimCode });
  } else {
    var rp = await call(admin, { password: ADMIN, action: 'resetPassword', id: id });
    await call(owner, { action: 'login', id: id, password: rp.body.password });
  }
  var lg = await call(owner, { action: 'login', id: id, password: 'ownerpick' });
  if (lg.body.token) return lg.body.token;
  var rp2 = await call(admin, { password: ADMIN, action: 'resetPassword', id: id });
  var lg2 = await call(owner, { action: 'login', id: id, password: rp2.body.password });
  return lg2.body.token;
}

(async function () {
  console.log('\nconstants are in place');

  ok(L.FOUNDING_LIMIT === 3, 'the cap is 3 slots');
  ok(L.FOUNDING_TRIAL_DAYS === 70, 'the trial is 70 days (10 weeks)');
  ok(L.FOUNDING_PRICE_CENTS === 5900, 'the founding rate is $59/mo');
  ok(L.STANDARD_PRICE_CENTS === 7900, 'the standard rate is $79/mo');
  ok(typeof L.countFoundingSlots === 'function', 'countFoundingSlots is still exported');

  // Derived, never hardcoded: each site has its own REMOVED id-map, so a literal id
  // that exists on one site is a deleted listing on the other.
  var sampleIds = L.seedIds();
  var seed = L.seedProfile(sampleIds[1]);
  ok(seed.foundingOffer === false && seed.founding === false && seed.foundingLockUntil === null,
     'a new profile starts with no founding offer or status');
  // The same object must also carry the security fields — this is the hunk that conflicted.
  ok(seed.password === null, 'and NO seeded password');
  ok(typeof seed.claimCode === 'string' && seed.claimCode.length === 8, 'and a claim code');
  ok(seed.staffPin === null, 'and no staff PIN');

  console.log('\nnormalizeProfile backfills both feature sets');

  var legacyId = sampleIds[2];
  var legacy = L.seedProfile(legacyId);
  delete legacy.foundingOffer; delete legacy.founding; delete legacy.foundingLockUntil;
  delete legacy.claimCode; delete legacy.staffPin;
  // A stored record from before either change.
  await L.saveProfile(legacyId, legacy);
  var back = await L.getProfile(legacyId);
  ok(back.foundingOffer === false && back.founding === false, 'founding fields default off');
  ok(typeof back.claimCode === 'string' && !!back.claimCode, 'a claim code is minted');
  ok(back.staffPin === null, 'staffPin defaults null');

  console.log('\nthe 3-slot cap holds');

  var ids = L.seedIds().slice(0, 6);
  var granted = [];
  for (var i = 0; i < ids.length; i++) {
    var res = await call(admin, { password: ADMIN, action: 'setFlag', id: ids[i], foundingOffer: true });
    if (res.status === 200) granted.push(ids[i]);
    else if (res.status === 409 && res.body.error === 'founding_full') break;
  }
  ok(granted.length === 3, 'exactly 3 venues can hold the offer, then it refuses (' + granted.length + ' granted)');
  var fourth = await call(admin, { password: ADMIN, action: 'setFlag', id: ids[5], foundingOffer: true });
  ok(fourth.status === 409 && fourth.body.error === 'founding_full', 'a 4th grant is refused');
  // Turning one back off must always be allowed, even while full.
  var off = await call(admin, { password: ADMIN, action: 'setFlag', id: granted[0], foundingOffer: false });
  ok(off.status === 200 && (await L.getProfile(granted[0])).foundingOffer === false,
     'an existing offer can still be revoked while the cap is full');

  console.log('\nthe founding rate is a discount, not a premium');

  // This is the bug this suite exists to prevent recurring: for five days the founding
  // tier was priced ABOVE standard, so the "offer" charged its best prospects more while
  // the pamphlets advertised a discount. A founding rate that is not cheaper than standard
  // is never correct, whatever the two numbers are.
  ok(L.FOUNDING_PRICE_CENTS < L.STANDARD_PRICE_CENTS,
     'founding (' + L.FOUNDING_PRICE_CENTS + ') undercuts standard (' + L.STANDARD_PRICE_CENTS + ')');
  ok(L.STANDARD_PRICE_CENTS === 7900 && L.FOUNDING_PRICE_CENTS === 5900,
     'the agreed table: $79 standard, $59 founding (same as EatMinot)');
  ok(L.FOUNDING_TRIAL_DAYS === 70 && L.FOUNDING_LIMIT === 3,
     '10 weeks free, 3 slots');

  console.log('\ncheckout prices the offer correctly');

  var fid = granted[1];
  var ftok = await claimAndLogin(fid);
  await call(admin, { password: ADMIN, action: 'setFlag', id: fid, foundingOffer: true });
  lastStripe = null;
  var co = await call(checkout, { id: fid, token: ftok }, { origin: 'https://drinkminot.com' });
  ok(co.status === 200 && !!co.body.url, 'a founding checkout session is created');
  var p = lastStripe && lastStripe.params;
  ok(!!p, 'Stripe was called');
  ok(p['line_items[0][price_data][unit_amount]'] === String(L.FOUNDING_PRICE_CENTS),
     'at the founding rate (' + L.FOUNDING_PRICE_CENTS + ')');
  ok(p['subscription_data[trial_period_days]'] === '70', 'with the 70-day trial');
  ok(p['metadata[founding]'] === 'true', 'and flagged founding in metadata');

  // A venue with no offer is unaffected.
  var sid = L.seedIds().filter(function (x) { return granted.indexOf(x) < 0; })[0];
  var stok = await claimAndLogin(sid);
  lastStripe = null;
  var co2 = await call(checkout, { id: sid, token: stok }, { origin: 'https://drinkminot.com' });
  ok(co2.status === 200, 'a standard checkout session is created');
  var p2 = lastStripe && lastStripe.params;
  ok(p2['line_items[0][price_data][unit_amount]'] === String(L.STANDARD_PRICE_CENTS),
     'at the standard rate (' + L.STANDARD_PRICE_CENTS + ')');
  ok(p2['subscription_data[trial_period_days]'] === undefined, 'with no trial');
  ok(p2['metadata[founding]'] === 'false', 'and not flagged founding');

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
