'use strict';
var L = require('./_lib');

// POST /api/owner { action:'login'|'update'|'photo', id, password?, token?, fields?, dataUrl? }
// Auth: 'login' checks the password and returns a signed session token.
//       'update'/'photo' accept that token (preferred) or the password.
module.exports = async function (req, res) {
  if (req.method !== 'POST') { L.json(res, 405, { error: 'method' }); return; }
  try {
    var b = await L.readBody(req);
    var profile = await L.getProfile(b.id);
    if (!profile) { L.json(res, 404, { error: 'not_found' }); return; }

    if (b.action === 'login') {
      // A listing nobody has claimed has no owner to log in as. This is the gate that
      // closes the old hole: every venue used to be seeded with a password derived from
      // its own name, so any stranger could log in as any venue. An unclaimed profile is
      // now refused before its stored password is even considered, which also neutralises
      // records already saved with that old derivable hash.
      if (!profile.claimed) { L.json(res, 403, { error: 'not_claimed' }); return; }
      if (!profile.password) { L.json(res, 403, { error: 'no_password' }); return; }
      if (!L.verifyPw(b.password, profile.password)) { L.json(res, 401, { error: 'bad_password' }); return; }
      L.json(res, 200, { ok: true, id: profile.id, name: profile.name, paid: profile.paid, token: L.signToken(profile.id) });
      return;
    }

    // First-run claim: an unclaimed venue can be opened once with no password (the
    // owner's ?owner=<id> QR). Setting a password claims it; after that this path is
    // closed and the owner must log in. One-time by construction — the claimed flag.
    if (b.action === 'claim') {
      if (profile.claimed) { L.json(res, 409, { error: 'already_claimed' }); return; }
      // The claim code is a random per-venue secret shown only in the admin console and
      // handed over in person with the tags (?owner=<id>&c=<code>). Venue ids are
      // sequential and printed on every tag, so the id alone proves nothing; without the
      // code, anyone could have seized any listing they hadn't claimed yet.
      if (!L.verifyClaimCode(profile, b.code)) { L.json(res, 401, { error: 'bad_code' }); return; }
      var np = String(b.password || '').trim();
      if (np.length < 4) { L.json(res, 400, { error: 'weak_password' }); return; }
      await L.updateProfile(profile.id, function (p) { p.password = L.hashPw(np); p.claimed = true; });
      L.json(res, 200, { ok: true, id: profile.id, name: profile.name, paid: false, token: L.signToken(profile.id) });
      return;
    }

    var authed = (b.token && L.verifyToken(b.token) === profile.id) || L.verifyPw(b.password, profile.password);
    if (!authed) { L.json(res, 401, { error: 'unauthorized' }); return; }

    if (b.action === 'photo') {
      if (!profile.paid) { L.json(res, 403, { error: 'not_paid' }); return; }
      if (!/^data:image\//.test(b.dataUrl || '')) { L.json(res, 400, { error: 'not_image' }); return; }
      if (b.pick != null) {
        var pick = parseInt(b.pick, 10);
        if (pick < 0 || pick > 2) { L.json(res, 400, { error: 'pick' }); return; }
        await L.kvSet(L.PICK_PHOTO_KEY(profile.id, pick), b.dataUrl);
        await L.updateProfile(profile.id, function (p) { p.hasPickPhoto[pick] = true; });
      } else {
        await L.kvSet(L.PHOTO_KEY(profile.id), b.dataUrl);
        await L.updateProfile(profile.id, function (p) { p.hasPhoto = true; });
      }
      L.json(res, 200, { ok: true });
      return;
    }

    if (b.action === 'update') {
      var f = b.fields || {};
      // Rejected up front rather than dropped inside the mutator, so an owner who
      // mistypes their staff PIN is told, instead of being shown a saved dashboard
      // with the old PIN still live.
      if (typeof f.staffPin === 'string' && f.staffPin.trim() && !L.validPinFormat(f.staffPin.trim())) {
        L.json(res, 400, { error: 'bad_pin_format' });
        return;
      }
      await L.updateProfile(profile.id, function (r) {
        if (Array.isArray(f.picks)) r.picks = f.picks.slice(0, 3).map(function (x) { return String(x || ''); });
        if (typeof f.note === 'string') r.note = f.note;
        if (typeof f.website === 'string') r.website = f.website;
        if (typeof f.reward === 'string') r.reward = f.reward;
        if (typeof f.offer === 'string') r.offer = f.offer.slice(0, 90);
        if (f.punchesNeeded != null) r.punchesNeeded = L.clampPunches(f.punchesNeeded);
        if (f.couponValidDays != null) r.couponValidDays = Math.max(1, parseInt(f.couponValidDays, 10) || 1);
        if (f.happyHour && typeof f.happyHour === 'object') {
          var hh = f.happyHour;
          r.happyHour = {
            enabled: !!hh.enabled,
            days: Array.isArray(hh.days) ? hh.days.map(function (d) { return parseInt(d, 10); }).filter(function (d) { return d >= 0 && d <= 6; }) : [],
            start: /^\d{1,2}:\d{2}$/.test(hh.start) ? hh.start : '15:00',
            end: /^\d{1,2}:\d{2}$/.test(hh.end) ? hh.end : '18:00',
            special: String(hh.special || '').slice(0, 60)
          };
        }
        if (typeof f.password === 'string' && f.password.trim()) r.password = L.hashPw(f.password.trim());
        // The 6-digit staff PIN that authorises a reward redemption from any staff
        // member's own phone. Hashed like the password — never readable back, so an
        // owner who forgets it sets a new one. '' clears it, which switches redemption
        // off for this venue rather than leaving a guessable default.
        if (typeof f.staffPin === 'string') {
          var sp = f.staffPin.trim();
          if (!sp) r.staffPin = null;
          else if (L.validPinFormat(sp)) r.staffPin = L.hashPw(sp);
        }
      });
      L.json(res, 200, { ok: true });
      return;
    }
    L.json(res, 400, { error: 'action' });
  } catch (e) {
    L.json(res, 500, { error: 'owner_failed' });
  }
};
