'use strict';
var L = require('./_lib');

// POST /api/checkout { id, token?, password? } -> { url } (Stripe Checkout, $59/mo subscription)
module.exports = async function (req, res) {
  if (req.method !== 'POST') { L.json(res, 405, { error: 'method' }); return; }
  try {
    if (!L.stripeConfigured()) { L.json(res, 200, { error: 'not_configured' }); return; }
    var b = await L.readBody(req);
    var r = await L.getProfile(b.id);
    if (!r) { L.json(res, 404, { error: 'not_found' }); return; }
    var authed = (b.token && L.verifyToken(b.token) === r.id) || L.verifyPw(b.password, r.password);
    if (!authed) { L.json(res, 401, { error: 'unauthorized' }); return; }

    var base = req.headers.origin || ('https://' + (req.headers.host || 'drinkminot.com'));
    var params = {
      mode: 'subscription',
      success_url: base + '/?upgraded=1&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: base + '/?upgrade=cancelled',
      client_reference_id: String(r.id),
      'metadata[restaurantId]': String(r.id),
      'subscription_data[metadata][restaurantId]': String(r.id),
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': '5900',
      'line_items[0][price_data][recurring][interval]': 'month',
      'line_items[0][price_data][product_data][name]': 'DrinkMinot Claimed — ' + r.name
    };
    if (process.env.STRIPE_PRICE_ID) {
      // If a fixed Price is configured, use it instead of inline price_data.
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
