'use strict';
var L = require('./_lib');

// POST /api/admin { password, action, ... }
//   action: 'list' | 'photo' {id, dataUrl} | 'removePhoto' {id}
//           | 'setFlag' {id, claimed?, paid?} | 'resetPassword' {id}
//           | 'newClaimCode' {id}
//           | 'reset'
// Admin can manage claimed/paid status, photos, and passwords — the operational
// levers a site needs day to day. It has no action that writes to a vote counter;
// those only move through a real POST /api/rate.
module.exports = async function (req, res) {
  if (req.method !== 'POST') { L.json(res, 405, { error: 'method' }); return; }
  try {
    var b = await L.readBody(req);
    if (!L.checkAdmin(b.password)) { L.json(res, 401, { error: 'bad_admin' }); return; }

    if (b.action === 'list') {
      var list = await L.getAllRestaurants();
      var out = list.map(function (r) {
        var o = {}; for (var k in r) o[k] = r[k];
        delete o.password;
        // Never the hash, and never a derivable password — there is no longer one to show.
        // The admin console gets the venue's claim code (the secret to hand the owner in
        // person) and whether a password has been set yet. claimCode is deliberately kept
        // here and stripped in publicView; this response is admin-authenticated.
        o.hasPassword = !!r.password;
        return o;
      });
      L.json(res, 200, { ok: true, restaurants: out });
      return;
    }
    if (b.action === 'reset') {
      await L.resetAll();
      L.json(res, 200, { ok: true });
      return;
    }

    var profile = await L.getProfile(b.id);
    if (!profile) { L.json(res, 404, { error: 'not_found' }); return; }

    if (b.action === 'photo') {
      if (!/^data:image\//.test(b.dataUrl || '')) { L.json(res, 400, { error: 'not_image' }); return; }
      if (b.pick != null) {
        var pick1 = parseInt(b.pick, 10);
        if (pick1 < 0 || pick1 > 2) { L.json(res, 400, { error: 'pick' }); return; }
        await L.kvSet(L.PICK_PHOTO_KEY(profile.id, pick1), b.dataUrl);
        await L.updateProfile(profile.id, function (r) { r.hasPickPhoto[pick1] = true; });
      } else {
        await L.kvSet(L.PHOTO_KEY(profile.id), b.dataUrl);
        await L.updateProfile(profile.id, function (r) { r.hasPhoto = true; });
      }
      L.json(res, 200, { ok: true });
      return;
    }
    if (b.action === 'removePhoto') {
      if (b.pick != null) {
        var pick2 = parseInt(b.pick, 10);
        if (pick2 < 0 || pick2 > 2) { L.json(res, 400, { error: 'pick' }); return; }
        await L.kvDel(L.PICK_PHOTO_KEY(profile.id, pick2));
        await L.updateProfile(profile.id, function (r) { r.hasPickPhoto[pick2] = false; });
      } else {
        await L.kvDel(L.PHOTO_KEY(profile.id));
        await L.updateProfile(profile.id, function (r) { r.hasPhoto = false; });
      }
      L.json(res, 200, { ok: true });
      return;
    }
    if (b.action === 'setFlag') {
      await L.updateProfile(profile.id, function (r) {
        if (typeof b.claimed === 'boolean') { r.claimed = b.claimed; if (!r.claimed) { r.paid = false; r.featured = false; } }
        if (typeof b.paid === 'boolean') { r.paid = b.paid; if (r.paid) r.claimed = true; }
        if (typeof b.featured === 'boolean') { r.featured = b.featured; if (r.featured) r.claimed = true; }
        if (typeof b.hidden === 'boolean') { r.hidden = b.hidden; }
        // Independent of claimed/paid — an explicit admin call on whether this venue's
        // punch card / reward is actually authorized, so "Tap. Rate. Earn." is never
        // shown as active for a venue nobody has agreed to honor a reward for.
        if (typeof b.rewardsOn === 'boolean') { r.rewardsOn = b.rewardsOn; }
        // AI Assistant (beta) — super-admin on/off switch per venue, independent of
        // claimed/paid. Not tied to Stripe yet; see api/agent.js for the actual gate.
        if (typeof b.agentEnabled === 'boolean') { r.agentEnabled = b.agentEnabled; }
      });
      L.json(res, 200, { ok: true });
      return;
    }
    // Hands the owner a fresh random password, shown once in the response. It is not
    // derivable from the venue, so unlike the old name-based default it can't be guessed
    // by the next person to read the listing.
    if (b.action === 'resetPassword') {
      // An unclaimed listing has no owner yet, and login refuses it regardless — handing
      // out a password for one would be a dead end. Use its claim code instead.
      if (!profile.claimed) { L.json(res, 409, { error: 'not_claimed', claimCode: profile.claimCode }); return; }
      var newPw = L.randomPassword();
      await L.updateProfile(profile.id, function (r) { r.password = L.hashPw(newPw); });
      L.json(res, 200, { ok: true, password: newPw });
      return;
    }
    // Issues a new claim code for a listing that has not been claimed yet — for when a
    // printed card goes astray. Refused once a listing is claimed, since the code is
    // spent at that point and rotating it would imply it still grants something.
    if (b.action === 'newClaimCode') {
      if (profile.claimed) { L.json(res, 409, { error: 'already_claimed' }); return; }
      var code = L.randomCode();
      await L.updateProfile(profile.id, function (r) { r.claimCode = code; });
      L.json(res, 200, { ok: true, claimCode: code });
      return;
    }
    L.json(res, 400, { error: 'action' });
  } catch (e) {
    L.json(res, 500, { error: 'admin_failed' });
  }
};
