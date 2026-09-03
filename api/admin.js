'use strict';
var L = require('./_lib');

// POST /api/admin { password, action, ... }
//   action: 'list' | 'photo' {id, dataUrl} | 'removePhoto' {id}
//           | 'setFlag' {id, claimed?, paid?} | 'resetPassword' {id}
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
        o.defaultPassword = L.defaultPassword(r.name);
        o.passwordChanged = !L.isDefaultPw(r.name, r.password);
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
      });
      L.json(res, 200, { ok: true });
      return;
    }
    if (b.action === 'resetPassword') {
      await L.updateProfile(profile.id, function (r) { r.password = L.hashPw(L.defaultPassword(r.name)); });
      L.json(res, 200, { ok: true, defaultPassword: L.defaultPassword(profile.name) });
      return;
    }
    L.json(res, 400, { error: 'action' });
  } catch (e) {
    L.json(res, 500, { error: 'admin_failed' });
  }
};
