'use strict';
var L = require('./_lib');

// POST /api/checkout { id, token?, password? } -> { url } (Stripe Checkout)
// Standard tier: $79/mo, no trial, billed immediately.
// Founding Three: exactly 3 venues on this site (admin-granted via foundingOffer, see
// admin.js) get a 10-week free trial, then the founding rate of $59/mo — see api/_lib.js
// STANDARD_PRICE_CENTS and FOUNDING_* constants, which are the only place either amount is
// written. A venue that already redeemed the offer (r.founding) keeps the $59 rate on any
// future checkout (e.g. resubscribing after a cancellation) but does not get a second
// free trial. This mirrors EatMinot's checkout so both sites sell the same offer.
module.exports = async function (req, res) {
  if (req.method !== 'POST') { L.json(res, 405, { error: 'method' }); return; }
  try {
    if (!L.stripeConfigured()) { L.json(res, 200, { error: 'not_configured' }); return; }
    var b = await L.readBody(req);
    var r = await L.getProfile(b.id);
    if (!r) { L.json(res, 404, { error: 'not_found' }); return; }
    var authed = (b.token && L.verifyToken(b.token) === r.id) || L.verifyPw(b.password, r.password);
    if (!authed) { L.json(res, 401, { error: 'unauthorized' }); return; }

    // Re-check the admin grant against the live cap at checkout time (not just when it was
    // granted) so a slot can never be honored twice even if two founding-offer venues both
    // try to check out around the same time.
    var isNewFounding = false;
    if (!r.founding && r.foundingOffer) {
      var all = await L.getAllRestaurants();
      var confirmedFounding = all.filter(function (x) { return x.founding; }).length;
      isNewFounding = confirmedFounding < L.FOUNDING_LIMIT;
    }
    var isFounding = r.founding || isNewFounding;

    var base = req.headers.origin || ('https://' + (req.headers.host || 'drinkminot.com'));
    var params = {
      mode: 'subscription',
      success_url: base + '/?upgraded=1&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: base + '/?upgrade=cancelled',
      client_reference_id: String(r.id),
      'metadata[restaurantId]': String(r.id),
      'metadata[founding]': isFounding ? 'true' : 'false',
      'subscription_data[metadata][restaurantId]': String(r.id),
      'subscription_data[metadata][founding]': isFounding ? 'true' : 'false',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(isFounding ? L.FOUNDING_PRICE_CENTS : L.STANDARD_PRICE_CENTS),
      'line_items[0][price_data][recurring][interval]': 'month',
      'line_items[0][price_data][product_data][name]': (isFounding ? 'DrinkMinot Founding — ' : 'DrinkMinot Claimed — ') + r.name
    };
    if (isNewFounding) {
      // Only the first checkout that actually redeems the offer gets the free trial —
      // a later resubscription (r.founding already true) keeps the $59 rate, no second trial.
      params['subscription_data[trial_period_days]'] = String(L.FOUNDING_TRIAL_DAYS);
    }
    if (process.env.STRIPE_PRICE_ID && !isFounding) {
      // If a fixed Price is configured, use it instead of inline price_data — but only for
      // the standard tier; founding checkouts always need their own dynamic price + trial.
      delete params['line_items[0][price_data][currency]'];
      delete params['line_items[0][price_data][unit_amount]'];
      delete params['line_items[0][price_data][recurring][interval]'];
      delete params['line_items[0][price_data][product_data][name]'];
      params['line_items[0][price]'] = process.env.STRIPE_PRICE_ID;
    }
    var out = await L.stripe('checkout/sessions', 'POST', params);
    if (!out.ok) { L.json(res, 502, { error: 'stripe', detail: out.data && out.data.error && out.data.error.message }); return; }
    L.json(res, 200, { url: out.data.url });
  } catch (e) {
    L.json(res, 500, { error: 'checkout_failed' });
  }
};
