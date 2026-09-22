'use strict';
/* Owner-auth regression tests. Plain Node, no npm dependencies — run with:
     node tests/auth.test.js
   These run against the in-memory storage fallback (no Redis attached), which is the
   same code path as shared mode for everything being asserted here.

   They exist because of one specific bug: every venue used to be seeded with the
   password slug(name) + '26' and login never checked whether the listing was claimed,
   so any listing on the site could be logged into, edited, and locked away from its
   real owner by anyone who could read its name. The formula was published in the
   README. The first two cases below are that bug; the rest guard the replacement. */

var owner = require('../api/owner.js');
var admin = require('../api/admin.js');
var state = require('../api/state.js');
var L = require('../api/_lib.js');

var pass = 0, fail = 0;
function ok(cond, what) {
  if (cond) { pass++; console.log('  ok   ' + what); }
  else { fail++; console.log('  FAIL ' + what); }
}

// Minimal req/res doubles matching what the handlers actually use.
function call(handler, body, method) {
  return new Promise(function (resolve) {
    var req = { method: method || 'POST', body: body, headers: {} };
    var res = {
      statusCode: 200, _headers: {},
      setHeader: function (k, v) { this._headers[k] = v; },
      end: function (payload) { resolve({ status: res.statusCode, body: JSON.parse(payload) }); }
    };
    handler(req, res);
  });
}

var ADMIN = process.env.DRINK_ADMIN_PASSWORD || 'drink-admin';

(async function () {
  console.log('\nowner auth');

  // The venue this was demonstrated with. Its name yields the old default password.
  var VENUE = 4;   // a live, unclaimed venue (DrinkMinot hides id 6)
  var seeded = L.seedProfile(VENUE);
  var oldStyle = L.slug(seeded.name) + '26';

  var r = await call(owner, { action: 'login', id: VENUE, password: oldStyle });
  ok(r.status === 403, 'the old name-derived password is refused (' + oldStyle + ')');

  r = await call(owner, { action: 'login', id: VENUE, password: 'anything' });
  ok(r.status === 403 && r.body.error === 'not_claimed',
     'an unclaimed listing cannot be logged into at all');

  console.log('\nclaiming');

  r = await call(owner, { action: 'claim', id: VENUE, password: 'ownerpick' });
  ok(r.status === 401 && r.body.error === 'bad_code', 'claim with no setup code is refused');

  r = await call(owner, { action: 'claim', id: VENUE, password: 'ownerpick', code: 'WRONGCOD' });
  ok(r.status === 401 && r.body.error === 'bad_code', 'claim with a wrong setup code is refused');

  // The real code is only reachable through the admin-authenticated list.
  var list = await call(admin, { password: ADMIN, action: 'list' });
  var row = list.body.restaurants.filter(function (x) { return x.id === VENUE; })[0];
  ok(!!row.claimCode, 'admin can see the venue setup code');
  ok(row.password === undefined, 'admin list never returns a password hash');
  ok(row.hasPassword === false, 'an unclaimed listing reports no password set');

  // Stability matters: a code minted on read but not persisted would differ next read,
  // and the code the admin just read aloud would already be dead.
  var list2 = await call(admin, { password: ADMIN, action: 'list' });
  var row2 = list2.body.restaurants.filter(function (x) { return x.id === VENUE; })[0];
  ok(row2.claimCode === row.claimCode, 'the setup code is stable across reads');

  r = await call(owner, { action: 'claim', id: VENUE, password: 'ownerpick', code: row.claimCode.toLowerCase() });
  ok(r.status === 200 && !!r.body.token, 'claim with the right code succeeds (case-insensitive)');

  r = await call(owner, { action: 'claim', id: VENUE, password: 'someoneelse', code: row.claimCode });
  ok(r.status === 409 && r.body.error === 'already_claimed', 'a claimed listing cannot be re-claimed');

  console.log('\nafter claiming');

  r = await call(owner, { action: 'login', id: VENUE, password: 'ownerpick' });
  ok(r.status === 200 && !!r.body.token, 'the owner can log in with the password they chose');

  r = await call(owner, { action: 'login', id: VENUE, password: oldStyle });
  ok(r.status === 401, 'the old derived password still does not work once claimed');

  console.log('\nsecret handling');

  var pub = await call(state, {}, 'GET');
  var leaked = pub.body.restaurants.filter(function (x) { return x.claimCode !== undefined; });
  ok(leaked.length === 0, 'GET /api/state leaks no setup codes (' + pub.body.restaurants.length + ' venues checked)');
  var leakedPw = pub.body.restaurants.filter(function (x) { return x.password !== undefined; });
  ok(leakedPw.length === 0, 'GET /api/state leaks no password hashes');

  r = await call(admin, { password: 'wrong-admin-password', action: 'list' });
  ok(r.status === 401, 'a wrong admin password is refused');

  console.log('\nadmin password reset');

  r = await call(admin, { password: ADMIN, action: 'resetPassword', id: VENUE });
  ok(r.status === 200 && /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(r.body.password || ''),
     'reset returns a random password, not one derived from the venue name');
  var generated = r.body.password;
  r = await call(owner, { action: 'login', id: VENUE, password: generated });
  ok(r.status === 200, 'the generated password works');

  // An unclaimed listing has no owner, so there is no password to hand out for one.
  r = await call(admin, { password: ADMIN, action: 'resetPassword', id: 5 });
  ok(r.status === 409 && r.body.error === 'not_claimed', 'reset is refused for an unclaimed listing');

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
