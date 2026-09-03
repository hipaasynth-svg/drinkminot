'use strict';
var L = require('./_lib');
var W = require('./_wallet');

// GET  /api/pass            -> { google:bool, apple:bool }  (which wallet buttons to show)
// GET  /api/pass?provider=apple&dev=&venueId=&done=&total=  -> the signed .pkpass file
//   (Safari/iOS opens it straight into Apple Wallet; the balance is baked in at add time)
// POST /api/pass { provider:'google', dev, venueId, done, total } -> { ok, saveUrl }
//   action:'patch' refreshes the balance on a Google card the customer already added.
var DEV = /^dev_[a-z0-9]{6,80}$/i;

module.exports = async function (req, res) {
  try {
    if (req.method === 'GET') {
      var q = {};
      try { new URL(req.url, 'http://x').searchParams.forEach(function (v, k) { q[k] = v; }); } catch (e) {}
      if (q.provider === 'apple') { await serveApple(q, res); return; }
      L.json(res, 200, { google: W.googleConfigured(), apple: W.appleConfigured() });
      return;
    }
    if (req.method !== 'POST') { L.json(res, 405, { error: 'method' }); return; }

    var b = await L.readBody(req);
    var dev = String(b.dev || '');
    if (!DEV.test(dev)) { L.json(res, 400, { error: 'bad_device' }); return; }
    var venueId = parseInt(b.venueId, 10);
    var profile = venueId ? await L.getProfile(venueId) : null;
    if (!profile) { L.json(res, 404, { error: 'not_found' }); return; }
    var done = Math.max(0, Math.min(1000, parseInt(b.done, 10) || 0));
    var total = Math.max(1, Math.min(1000, parseInt(b.total, 10) || 3));

    if (b.provider === 'google') {
      if (!W.googleConfigured()) { L.json(res, 501, { error: 'not_configured' }); return; }
      // action:'patch' just refreshes the balance on a card the customer already added
      // (used after each punch) — it never creates a pass. Everything else returns the
      // Add-to-Wallet save link.
      if (b.action === 'patch') {
        await W.googlePatch(dev, venueId, profile.name, done, total);
        L.json(res, 200, { ok: true });
        return;
      }
      var r = await W.googleSave(dev, venueId, profile.name, done, total);
      if (!r.ok) { L.json(res, 502, { error: r.reason || 'wallet_failed' }); return; }
      L.json(res, 200, { ok: true, saveUrl: r.saveUrl });
      return;
    }
    L.json(res, 400, { error: 'provider' });
  } catch (e) {
    L.json(res, 500, { error: 'pass_failed' });
  }
};

// Stream a signed .pkpass for the Apple Wallet button. Reads the same dev/venue/balance
// params off the query string; 501 when Apple isn't configured so the button no-ops.
async function serveApple(q, res) {
  if (!W.appleConfigured()) { L.json(res, 501, { error: 'not_configured' }); return; }
  var dev = String(q.dev || '');
  if (!DEV.test(dev)) { L.json(res, 400, { error: 'bad_device' }); return; }
  var venueId = parseInt(q.venueId, 10);
  var profile = venueId ? await L.getProfile(venueId) : null;
  if (!profile) { L.json(res, 404, { error: 'not_found' }); return; }
  var done = Math.max(0, Math.min(1000, parseInt(q.done, 10) || 0));
  var total = Math.max(1, Math.min(1000, parseInt(q.total, 10) || 3));
  var buf = W.applePkpass(dev, venueId, profile.name, done, total);
  if (!buf) { L.json(res, 502, { error: 'wallet_failed' }); return; }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
  res.setHeader('Content-Disposition', 'attachment; filename="drinkminot.pkpass"');
  res.setHeader('Cache-Control', 'no-store');
  res.end(buf);
}
