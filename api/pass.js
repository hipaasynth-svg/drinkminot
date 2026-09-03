'use strict';
var L = require('./_lib');
var W = require('./_wallet');

// GET  /api/pass            -> { google:bool, apple:bool }  (which wallet buttons to show)
// POST /api/pass { provider:'google', dev, venueId, done, total } -> { ok, saveUrl }
//   provider:'apple' returns not_configured until the Apple certs are set — the client
//   simply hides that button, nothing breaks.
var DEV = /^dev_[a-z0-9]{6,80}$/i;

module.exports = async function (req, res) {
  try {
    if (req.method === 'GET') {
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
    if (b.provider === 'apple') {
      // Apple pass signing is added once the certificate env vars are in place.
      L.json(res, 501, { error: 'not_configured' });
      return;
    }
    L.json(res, 400, { error: 'provider' });
  } catch (e) {
    L.json(res, 500, { error: 'pass_failed' });
  }
};
