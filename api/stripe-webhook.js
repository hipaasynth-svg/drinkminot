'use strict';
var L = require('./_lib');

// POST /api/stripe-webhook — keeps Paid status in sync (esp. cancellations).
// Configure this URL in Stripe with events: checkout.session.completed,
// customer.subscription.deleted, customer.subscription.updated.
module.exports = async function (req, res) {
  if (req.method !== 'POST') { L.json(res, 405, { error: 'method' }); return; }
  var raw = await L.rawBody(req);
  var secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (secret && !L.verifyStripeSig(raw, req.headers['stripe-signature'], secret)) {
    L.json(res, 400, { error: 'bad_signature' }); return;
  }
  var event; try { event = JSON.parse(raw); } catch (e) { L.json(res, 400, { error: 'bad_json' }); return; }
  try {
    var obj = event.data && event.data.object || {};

    // Prefer the restaurantId we stamped into subscription metadata at checkout time;
    // fall back to a one-time scan (rare — only for a subscription created outside our
    // own checkout flow, e.g. manually in the Stripe dashboard).
    async function findBySub(subId) {
      var rid = obj.metadata && obj.metadata.restaurantId;
      if (rid) { var byId = await L.getProfile(rid); if (byId) return byId; }
      if (!subId) return null;
      var all = await L.getAllRestaurants();
      return all.filter(function (r) { return r.stripeSubscriptionId === subId; })[0] || null;
    }

    if (event.type === 'checkout.session.completed') {
      var rid1 = (obj.metadata && obj.metadata.restaurantId) || obj.client_reference_id;
      if (rid1) {
        var r1 = await L.getProfile(rid1);
        if (r1) {
          await L.updateProfile(r1.id, function (p) {
            p.paid = true; p.claimed = true;
            p.stripeCustomerId = obj.customer || p.stripeCustomerId;
            p.stripeSubscriptionId = obj.subscription || p.stripeSubscriptionId;
          });
        }
      }
    } else if (event.type === 'customer.subscription.deleted') {
      var r2 = await findBySub(obj.id);
      if (r2) await L.updateProfile(r2.id, function (p) { p.paid = false; });
    } else if (event.type === 'customer.subscription.updated') {
      var dead = ['canceled', 'unpaid', 'incomplete_expired'];
      if (dead.indexOf(obj.status) > -1) {
        var r3 = await findBySub(obj.id);
        if (r3) await L.updateProfile(r3.id, function (p) { p.paid = false; });
      }
    }
    L.json(res, 200, { received: true });
  } catch (e) {
    L.json(res, 200, { received: true }); // ack anyway so Stripe doesn't retry-storm
  }
};
