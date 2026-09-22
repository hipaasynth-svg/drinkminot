/* DrinkMinot backend shared library — the twin of EatMinot's backend.
   Storage: Vercel-provisioned Upstash Redis via its REST command API.
   No npm dependencies — uses global fetch (Node 18+ on Vercel) and built-in crypto.
   Falls back to an in-process Map for local dev / when no store is attached.

   Data model — per-venue, not one shared blob:
   - drinkminot:r:<id>   profile (name/address/category/claimed/paid/picks/happyHour/
                         password hash/...), read-modify-write. Only one owner/admin
                         touches a given venue's profile at a time, so this is safe
                         without extra locking.
   - drinkminot:v:<id>   a Redis HASH of vote counters (upvotes, ratingSum, ratingCount,
                         totalRatings), mutated only via HINCRBY — an atomic, race-free
                         increment even under many simultaneous ratings.
   - drinkminot:photo:<id> unchanged, already per-venue. */
'use strict';
var crypto = require('crypto');

var PHOTO_KEY = function (id) { return 'drinkminot:photo:' + id; };
var PICK_PHOTO_KEY = function (id, i) { return 'drinkminot:photo:' + id + ':pick' + i; };
var rKey = function (id) { return 'drinkminot:r:' + id; };
var vKey = function (id) { return 'drinkminot:v:' + id; };
var ZERO_VOTES = { upvotes: 0, ratingSum: 0, ratingCount: 0, totalRatings: 0 };

// Columns: [0] name  [1] address  [2] hours  [3] category
//   [4] over21   — bar / alcohol establishment: show the 21+ sticker
//   [5] alsoOnEat — this place is ALSO listed on the twin food site EatMinot.com
// Keep this table in lock-step with store.js's RAW (same order, same ids).
var RAW = [
  ["Broadway Liquor", "Minot, ND", "Verify hours", "Liquor & Bottle Shops", true, false],
  ["Cash Wise Liquor", "Minot, ND", "Verify hours", "Liquor & Bottle Shops", true, false],
  ["MP Wine & Spirits / Marketplace", "Multiple locations, Minot, ND", "Verify hours", "Liquor & Bottle Shops", true, false],
  ["Arrowhead Liquors / Lamplighter", "Minot, ND", "Verify hours", "Liquor & Bottle Shops", true, false],
  ["Landing Bar & Bottleshop", "Minot, ND", "Verify hours", "Liquor & Bottle Shops", true, false],
  ["Walmart Liquor", "Minot, ND", "Verify hours", "Liquor & Bottle Shops", true, false],
  ["Arny's 2.0 / Off the Vine", "15 Main St S, Minot, ND 58701", "Verify hours", "Liquor & Bottle Shops", true, true],
  ["Aces Lounge & Casino", "Minot, ND", "Verify hours", "Casinos & Gaming", true, false],
  ["Blue Rider", "Minot, ND", "Verify hours", "Bars & Lounges", true, false],
  ["Bootlegrz", "Minot, ND", "Mon-Thu 11am-1am, Fri-Sat 11am-2am, Sun 12pm-1am", "Bars & Lounges", true, false],
  ["Capri Bar", "Minot, ND", "Mon-Sat 10am-1:30am, Sun 11am-1:30am", "Bars & Lounges", true, false],
  ["Ebeneezer's Eatery & Irish Pub", "300 E Central Ave, Minot, ND 58701", "Daily 7am-1am (kitchen closes ~10pm)", "Bars & Lounges", true, true],
  ["Lucky Strike Lounge", "Minot, ND", "Verify hours", "Bars & Lounges", true, false],
  ["On the Rocks Lounge", "Minot, ND", "Verify hours", "Bars & Lounges", true, false],
  ["Ranger Lounge", "Minot, ND", "Verify hours", "Bars & Lounges", true, false],
  ["Rockin' Horse Saloon", "Minot, ND", "Verify hours", "Bars & Lounges", true, false],
  ["Sports on Tap", "Minot, ND", "Verify hours", "Bars & Lounges", true, false],
  ["The Pour Farm", "Minot, ND", "Verify hours", "Bars & Lounges", true, false],
  ["The Spot", "Minot, ND", "Verify hours", "Bars & Lounges", true, false],
  ["19th Hole", "Minot, ND", "Verify hours", "Bars & Lounges", true, false],
  ["Ben's Tavern", "Minot, ND", "Verify hours", "Bars & Lounges", true, false],
  ["Barley Pop Bar", "Minot, ND", "Verify hours", "Bars & Lounges", true, false],
  ["Applebee's", "Minot, ND", "Verify hours", "Restaurants", false, false],
  ["Badlands Grill House & Saloon", "1400 31st Ave SW, Minot, ND 58701", "Verify hours", "Restaurants", true, true],
  ["Buffalo Wild Wings", "Minot, ND", "Verify hours", "Restaurants", false, false],
  ["Buffalo Wings & Rings", "Minot, ND", "Verify hours", "Restaurants", false, false],
  ["ND Asia Restaurant & Lounge", "3400 16th St SW, Minot, ND 58701", "Verify hours", "Restaurants", true, true],
  ["Olive Garden", "Minot, ND", "Verify hours", "Restaurants", false, false],
  ["Spicy Pie", "1100 N Broadway #100, Minot, ND 58703", "Verify hours", "Restaurants", false, true],
  ["Taco Feliz", "1535 S Broadway, Minot, ND 58701", "Verify hours", "Restaurants", false, true],
  ["Basecamp Indian Kitchen", "1425 24th Ave SW, Minot, ND 58701", "Mon, Wed-Sun 11am-9pm, Tue Closed", "Restaurants", false, true],
  ["Bones BBQ", "437 N Broadway, Minot, ND 58703", "Daily ~11am-10/11pm", "Restaurants", false, true],
  ["Clarion / Holiday Inn area", "Minot, ND", "Verify hours", "Hotels", false, false],
  ["Comfort Suites", "Minot, ND", "Verify hours", "Hotels", false, false],
  ["Hampton Inn", "Minot, ND", "Verify hours", "Hotels", false, false],
  ["Hyatt House", "Minot, ND", "Verify hours", "Hotels", false, false],
  ["The Grand Hotel", "1505 N Broadway, Minot, ND 58703", "Verify hours", "Hotels", false, false],
  ["Dakota Inn Trappers Lounge", "Minot, ND", "Mon-Thu 4pm-11pm, Fri-Sat 4pm-1am, Sun Closed", "Bars & Lounges", true, false],
  ["Moose Lodge", "Minot, ND", "Verify hours", "Clubs & Lodges", true, false],
  ["VFW", "Minot, ND", "Verify hours", "Clubs & Lodges", true, false],
  ["Vardon Golf Club", "Minot, ND", "Verify hours", "Golf Clubs", false, false],
  ["Trestle Tap House", "Minot, ND", "Verify hours", "Breweries & Taprooms", true, false],
  ["With Room Coffee", "Minot, ND", "Verify hours", "Cafés & Coffee", false, false],
  ["The Station Coffee", "Minot, ND", "Verify hours", "Cafés & Coffee", false, false],
  ["Prairie Sky Breads", "3 1st St SE, Minot, ND 58701", "Morning-afternoon bakery hours", "Bakeries", false, true],
  ["Black Iguana Coffee", "Minot, ND", "Verify hours", "Cafés & Coffee", false, false],
  ["Broadway Bean and Bagel", "Minot, ND", "Verify hours", "Cafés & Coffee", false, true],
  ["The Daily Buzz", "Minot, ND", "Verify hours", "Cafés & Coffee", false, false],
  ["Central Brew", "Minot, ND", "Verify hours", "Cafés & Coffee", false, false],
  ["Cookies For You", "Minot, ND", "Verify hours", "Bakeries", false, false],
  ["Meg-A-Latte", "Minot, ND", "Verify hours", "Cafés & Coffee", false, false],
  ["Charlie's Main Street Café", "113 Main St S, Minot, ND 58701", "Mon-Sat 7am-2pm, Sun 8am-2pm", "Cafés & Coffee", false, true],
  ["Gourmet Chef", "Minot, ND", "Verify hours", "Restaurants", false, false],
  ["Bearscat Bakehouse", "Minot, ND", "Verify hours", "Bakeries", false, false],
  ["Minot's Daily Bread", "1500 S Broadway, Minot, ND 58701", "Verify hours", "Bakeries", false, true],
  ["Caribou Coffee", "Multiple locations, Minot, ND", "Verify hours", "Cafés & Coffee", false, false],
  ["Starbucks", "Multiple locations, Minot, ND", "Verify hours", "Cafés & Coffee", false, false],
  ["Tim Hortons", "Minot, ND", "Verify hours", "Cafés & Coffee", false, false],
  ["7 Brew", "Minot, ND", "Verify hours", "Cafés & Coffee", false, false],
  ["Blissful Bee Juicery", "North & South locations, Minot, ND", "Verify hours", "Juice & Nutrition", false, false],
  ["Superior Nutrition Minot", "Minot, ND", "Verify hours", "Juice & Nutrition", false, false],
  ["Minot Nutrition Addiction", "Minot, ND", "Verify hours", "Juice & Nutrition", false, false],
  ["Down Under Bar", "Minot, ND", "Mon-Thu 10am-10pm, Fri-Sat 10am-12am, Sun 11am-10pm", "Bars & Lounges", true, false],
  ["Grainhopper", "Minot, ND", "Verify hours", "Breweries & Taprooms", true, false],
  ["The Grain Hopper Casino & Lounge", "Minot, ND", "Mon-Sat 10am-1am, Sun 12pm-1am", "Casinos & Gaming", true, false],
  ["Oasis Lounge (Grand Oasis Hotel)", "Minot, ND", "Mon-Thu 4pm-11pm, Fri-Sat 4pm-1am, Sun Closed", "Bars & Lounges", true, false]
];

function slug(name) { return String(name).toLowerCase().replace(/[^a-z0-9]/g, ''); }

/* ---------- claim codes and generated passwords ----------
   There is deliberately no formula that turns a venue's name into its credential.
   A venue's password used to be slug(name) + '26', which meant every listing on the
   site could be logged into by anyone who could read the venue's name — the formula
   was even published in the README. Both are now random per venue: the claim code is
   generated once, stored on the profile, and only ever shown in the admin console, and
   a password exists only after the real owner sets one.
   The alphabet omits O/0/I/1 so a code can be read aloud or printed on a card without
   being mistyped. */
var CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(len) {
  len = len || 8;
  var bytes = crypto.randomBytes(len), out = '';
  for (var i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}
// Admin "reset password" hands the owner a fresh random password once. It is never
// derivable from the venue, so a reset can't be guessed by the next person who reads
// the listing.
function randomPassword() { return randomCode(5) + '-' + randomCode(5); }
function normalizeCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
// Timing-safe comparison of two strings of possibly different lengths.
function safeEqual(a, b) {
  var ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch (e) { return false; }
}
function verifyClaimCode(profile, code) {
  if (!profile || !profile.claimCode) return false;
  return safeEqual(normalizeCode(profile.claimCode), normalizeCode(code));
}

// Real star average (0 when there are no ratings). The client only *shows* it once a venue
// has MIN_RATINGS verified reviews — see store.js isRated — otherwise it shows "New to DrinkMinot".
function avgRating(v) { var c = v && v.ratingCount ? v.ratingCount : 0; return c ? Math.round((v.ratingSum / c) * 10) / 10 : 0; }
// Owner-settable punches-needed, always clamped to these bounds (mirrors store.js).
var MIN_PUNCHES = 2, MAX_PUNCHES = 5, DEFAULT_PUNCHES = 3;
function clampPunches(n) { n = parseInt(n, 10); return (n >= MIN_PUNCHES && n <= MAX_PUNCHES) ? n : DEFAULT_PUNCHES; }

/* ---------- password hashing (salted SHA-256, no plaintext at rest) ---------- */
function hashPw(pw) {
  var salt = crypto.randomBytes(9).toString('hex');
  return 'sha256$' + salt + '$' + crypto.createHash('sha256').update(salt + ':' + pw).digest('hex');
}
function verifyPw(pw, stored) {
  if (!stored) return false;
  if (stored.indexOf('sha256$') !== 0) return pw === stored; // legacy plaintext, still accepted
  var p = stored.split('$');
  return crypto.createHash('sha256').update(p[1] + ':' + pw).digest('hex') === p[2];
}

/* ---------- signed owner session tokens (HMAC) ----------
   If DRINK_SESSION_SECRET isn't set, sign with a random secret generated once per cold
   start instead of a fixed string — a fixed fallback would be public (it's in this
   source file) and let anyone forge a valid owner session. Random-per-boot means an
   unset secret merely logs owners out on redeploys, never a silent security hole. */
var _fallbackSecret = null;
function sessionSecret() {
  if (process.env.DRINK_SESSION_SECRET) return process.env.DRINK_SESSION_SECRET;
  if (!_fallbackSecret) _fallbackSecret = crypto.randomBytes(32).toString('hex');
  return _fallbackSecret;
}
function b64u(s) { return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function signToken(id, ttlMs) {
  var exp = Date.now() + (ttlMs || 43200000); // 12h
  var payload = id + '.' + exp;
  var sig = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('hex');
  return b64u(payload) + '.' + sig;
}
function verifyToken(tok) {
  if (!tok || tok.indexOf('.') < 0) return null;
  var i = tok.lastIndexOf('.'), payloadB = tok.slice(0, i), sig = tok.slice(i + 1);
  var payload;
  try { payload = Buffer.from(payloadB.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(); } catch (e) { return null; }
  var good = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('hex');
  if (good !== sig) return null;
  var parts = payload.split('.'), id = parseInt(parts[0], 10), exp = parseInt(parts[1], 10);
  if (!id || !exp || Date.now() > exp) return null;
  return id;
}

// Venues pulled from the public list because they have no photo. Their ids are the frozen
// 1-based RAW positions and are NEVER reused or renumbered: every surviving venue keeps its
// original id, so its Redis-stored photo/votes/profile (all keyed by id) stay correct and the
// admin tag URLs (/?r=<id>) stay accurate. Gaps in the id sequence here are intentional.
var REMOVED = { 2: true, 3: true, 6: true, 20: true, 21: true, 22: true, 23: true, 25: true, 26: true, 27: true, 28: true, 29: true, 30: true, 31: true, 34: true, 35: true, 36: true, 37: true, 41: true, 42: true, 43: true, 45: true, 46: true, 47: true, 48: true, 49: true, 50: true, 51: true, 52: true, 53: true, 54: true, 55: true, 56: true, 58: true, 59: true, 61: true, 62: true };
function isRemoved(id) { return !!REMOVED[parseInt(id, 10)]; }
function seedIds() { return RAW.map(function (_, i) { return i + 1; }).filter(function (id) { return !REMOVED[id]; }); }
// Profile only — no vote counters here. Votes live in their own hash (see vKey) and are
// the only thing this file lets move via a real POST /api/rate; nothing seeds fake numbers
// and there is no admin action that writes to a vote counter directly.
function seedProfile(id) {
  var row = RAW[id - 1];
  if (!row) return null;
  var name = row[0], claimed = id === 1; // one demo paid listing so the paid features are visible
  return {
    id: id, name: name, address: row[1], hours: row[2],
    category: row[3], over21: !!row[4], alsoOnEat: !!row[5],
    claimed: claimed, paid: claimed, featured: claimed, hidden: false, rewardsOn: claimed,
    // AI Assistant (beta) — always starts off; only a super admin can turn it on per venue
    // (see api/admin.js setFlag), independent of claimed/paid. Not a Stripe-gated tier yet.
    agentEnabled: false,
    // No password until the real owner sets one through the claim flow (see api/owner.js).
    // A null password cannot be logged into at all — there is nothing to guess.
    password: null,
    // The one secret that lets a listing be claimed. Random, stored, admin-visible only,
    // and stripped from every public response by publicView below.
    claimCode: randomCode(),
    stripeCustomerId: null, stripeSubscriptionId: null,
    hasPhoto: false, hasPickPhoto: [false, false, false],
    picks: claimed ? ['Cold beer cave', 'ND craft & local cans', 'Weekend wine tasting'] : ['', '', ''],
    note: claimed ? 'Locally owned — thanks for drinking local, Minot!' : '',
    website: claimed ? 'broadwayliquor.com' : '',
    reward: 'Free item on your 3rd punch', couponValidDays: 14, punchesNeeded: DEFAULT_PUNCHES,
    offer: claimed ? 'Locals-only deal — show your DrinkMinot screen before you order' : '',
    happyHour: claimed
      ? { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], start: '15:00', end: '18:00', special: '$1 off six-packs' }
      : { enabled: false, days: [1, 2, 3, 4, 5], start: '15:00', end: '18:00', special: '' }
  };
}

/* ---------- storage adapter ----------
   Works with either naming scheme Vercel injects when you attach Redis:
   - Marketplace "Upstash for Redis": UPSTASH_REDIS_REST_URL / _TOKEN
   - Legacy Vercel KV:                KV_REST_API_URL / _TOKEN
   Also tolerates a STORAGE_ prefix. */
var mem = global.__drinkmem || (global.__drinkmem = new Map());
function kvUrl() { return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.STORAGE_REST_API_URL || process.env.REDIS_REST_API_URL || ''; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.STORAGE_REST_API_TOKEN || process.env.REDIS_REST_API_TOKEN || ''; }
function hasKV() { return !!(kvUrl() && kvToken()); }
function persistent() { return hasKV() || process.env.DRINK_DEV_PERSIST === '1'; }

async function kvCmd(cmd) {
  var res = await fetch(kvUrl(), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + kvToken(), 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  if (!res.ok) throw new Error('KV ' + res.status);
  var j = await res.json();
  return j.result;
}
// One HTTP round trip for many commands (Upstash's REST pipeline endpoint) — used to
// fetch all venues' profile+votes in a single request instead of one per venue.
async function kvPipeline(cmds) {
  var res = await fetch(kvUrl() + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + kvToken(), 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds)
  });
  if (!res.ok) throw new Error('KV pipeline ' + res.status);
  var j = await res.json();
  return j.map(function (x) { return x && ('result' in x) ? x.result : null; });
}
async function kvGet(key) { if (hasKV()) return kvCmd(['GET', key]); var v = mem.get(key); return v === undefined ? null : v; }
async function kvSet(key, val) { if (hasKV()) return kvCmd(['SET', key, val]); mem.set(key, val); return 'OK'; }
async function kvDel(key) { if (hasKV()) return kvCmd(['DEL', key]); mem.delete(key); return 1; }

function flatToObj(flat, base) {
  var o = {}; for (var k in base) o[k] = base[k];
  if (Array.isArray(flat)) for (var i = 0; i < flat.length; i += 2) o[flat[i]] = parseInt(flat[i + 1], 10) || 0;
  return o;
}

/* ---------- profile (per-venue, read-modify-write) ---------- */
// Fields added after a venue profile was first written won't exist on records
// already saved — normalize so older data can't crash a read that expects them.
function normalizeProfile(p) {
  if (!Array.isArray(p.hasPickPhoto) || p.hasPickPhoto.length !== 3) p.hasPickPhoto = [false, false, false];
  if (typeof p.featured !== 'boolean') p.featured = false;
  if (typeof p.hidden !== 'boolean') p.hidden = false;
  if (typeof p.offer !== 'string') p.offer = '';
  // rewardsOn is an admin-controlled toggle, independent of claimed/paid — no venue
  // shows a punch card / earns a reward until this is explicitly on. Profiles saved
  // before this field existed default from claimed, so an already-live claimed venue's
  // punch card doesn't silently vanish; a never-claimed venue defaults off, matching
  // the intent (never promise a reward nobody at that venue has agreed to honor).
  if (typeof p.rewardsOn !== 'boolean') p.rewardsOn = !!p.claimed;
  // Profiles saved before this beta existed default OFF regardless of claimed/paid —
  // an admin must explicitly opt each venue in while it's being tested.
  if (typeof p.agentEnabled !== 'boolean') p.agentEnabled = false;
  // Backfill the static list attributes for profiles saved before these fields existed.
  var row = RAW[p.id - 1];
  if (row) {
    if (p.category == null) p.category = row[3];
    if (p.over21 == null) p.over21 = !!row[4];
    if (p.alsoOnEat == null) p.alsoOnEat = !!row[5];
  }
  // Profiles written before claim codes existed get one on first read (getProfile and
  // getAllRestaurants persist it), so an already-live listing becomes claimable with a
  // real code instead of the old name-derived password.
  if (typeof p.claimCode !== 'string' || !p.claimCode) p.claimCode = randomCode();
  // A stored password that predates this change is a hash of the old derivable default
  // for any listing nobody has claimed, so it must not stay usable. login() refuses an
  // unclaimed profile outright; dropping the hash here means it cannot be used even if
  // the listing is later marked claimed by an admin.
  if (!p.claimed) p.password = null;
  return p;
}
async function getProfile(id) {
  id = parseInt(id, 10);
  if (isRemoved(id)) return null; // pulled venue: never resurface via ?r=<id>, owner login, or photo fetch
  var raw = await kvGet(rKey(id));
  if (raw) {
    try {
      var stored = JSON.parse(raw);
      var hadCode = typeof stored.claimCode === 'string' && !!stored.claimCode;
      var prof = normalizeProfile(stored);
      // normalizeProfile mints a claim code for records written before they existed.
      // It has to be written back, or the next read mints a different one and the code
      // the admin console just displayed would already be wrong.
      if (!hadCode) await saveProfile(id, prof);
      return prof;
    } catch (e) { /* fall through to reseed */ }
  }
  var def = seedProfile(id);
  if (!def) return null;
  await kvSet(rKey(id), JSON.stringify(def));
  return def;
}
async function saveProfile(id, profile) { await kvSet(rKey(id), JSON.stringify(profile)); }
async function updateProfile(id, mutator) {
  var profile = await getProfile(id);
  if (!profile) return null;
  mutator(profile);
  await saveProfile(id, profile);
  return profile;
}

/* ---------- votes (per-venue Redis hash, atomic increments) ---------- */
async function getVotes(id) {
  id = parseInt(id, 10);
  if (hasKV()) return flatToObj(await kvCmd(['HGETALL', vKey(id)]), ZERO_VOTES);
  var raw = mem.get(vKey(id));
  return raw ? JSON.parse(raw) : Object.assign({}, ZERO_VOTES);
}
// deltas like {totalRatings:1, ratingCount:1, ratingSum:5, upvotes:1} — each field is
// incremented with its own atomic HINCRBY, so concurrent ratings for the same venue
// can never clobber each other the way a read-modify-write on a shared blob could.
async function incrementVotes(id, deltas) {
  id = parseInt(id, 10);
  if (hasKV()) {
    for (var k in deltas) { if (deltas[k]) await kvCmd(['HINCRBY', vKey(id), k, deltas[k]]); }
    return getVotes(id);
  }
  var cur = await getVotes(id);
  for (var k2 in deltas) cur[k2] = (cur[k2] || 0) + deltas[k2];
  mem.set(vKey(id), JSON.stringify(cur));
  return cur;
}

function mergeProfileVotes(p, v) {
  var r = {}; for (var k in p) r[k] = p[k];
  r.upvotes = v.upvotes; r.ratingSum = v.ratingSum; r.ratingCount = v.ratingCount; r.totalRatings = v.totalRatings;
  return r;
}

async function getRestaurant(id) {
  id = parseInt(id, 10);
  var profile = await getProfile(id);
  if (!profile) return null;
  var votes = await getVotes(id);
  return mergeProfileVotes(profile, votes);
}

// All venues, profile+votes, in one round trip when a real store is attached.
async function getAllRestaurants() {
  var ids = seedIds();
  if (!hasKV()) {
    var out = [];
    for (var i = 0; i < ids.length; i++) { var r = await getRestaurant(ids[i]); if (r) out.push(r); }
    return out;
  }
  var cmds = [];
  ids.forEach(function (id) { cmds.push(['GET', rKey(id)]); cmds.push(['HGETALL', vKey(id)]); });
  var results = await kvPipeline(cmds);
  var out2 = [], toSeed = [];
  for (var j = 0; j < ids.length; j++) {
    var profRaw = results[j * 2], votesFlat = results[j * 2 + 1];
    var profile = null;
    if (profRaw) {
      try {
        var stored2 = JSON.parse(profRaw);
        var hadCode2 = typeof stored2.claimCode === 'string' && !!stored2.claimCode;
        profile = normalizeProfile(stored2);
        if (!hadCode2) toSeed.push(profile); // persist the freshly minted claim code
      } catch (e) {}
    }
    if (!profile) { profile = seedProfile(ids[j]); toSeed.push(profile); }
    out2.push(mergeProfileVotes(profile, flatToObj(votesFlat, ZERO_VOTES)));
  }
  if (toSeed.length) toSeed.forEach(function (p) { saveProfile(p.id, p); }); // fire-and-forget lazy seed
  return out2;
}

async function resetAll() {
  var ids = seedIds();
  for (var i = 0; i < ids.length; i++) {
    await saveProfile(ids[i], seedProfile(ids[i]));
    await kvDel(vKey(ids[i]));
    await kvDel(PHOTO_KEY(ids[i]));
    for (var p = 0; p < 3; p++) await kvDel(PICK_PHOTO_KEY(ids[i], p));
  }
}

// Public view: never leak password hashes.
function publicView(list) {
  return {
    persistent: persistent(),
    restaurants: list.filter(function (r) { return !r.hidden; }).map(function (r) {
      var o = {}; for (var k in r) o[k] = r[k];
      delete o.password;
      delete o.claimCode; // the claim secret: admin-only, never in a public response
      o.rating = avgRating(r);
      return o;
    })
  };
}

/* ---------- request helpers ---------- */
function rawBody(req) {
  return new Promise(function (resolve) {
    if (typeof req.body === 'string') { resolve(req.body); return; }
    if (req.body && typeof req.body === 'object') { resolve(JSON.stringify(req.body)); return; }
    var data = '';
    req.on('data', function (c) { data += c; });
    req.on('end', function () { resolve(data); });
    req.on('error', function () { resolve(''); });
  });
}
function readBody(req) {
  return rawBody(req).then(function (raw) { try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; } });
}

/* ---------- Stripe (REST, no SDK) ---------- */
function stripeKey() { return process.env.STRIPE_SECRET_KEY || ''; }
function stripeConfigured() { return !!stripeKey(); }
function form(obj) {
  var parts = [];
  Object.keys(obj).forEach(function (k) { parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])); });
  return parts.join('&');
}
async function stripe(path, method, params) {
  var opts = { method: method || 'GET', headers: { Authorization: 'Bearer ' + stripeKey() } };
  if (params) { opts.headers['Content-Type'] = 'application/x-www-form-urlencoded'; opts.body = form(params).replace(/%7BCHECKOUT_SESSION_ID%7D/g, '{CHECKOUT_SESSION_ID}'); }
  var r = await fetch('https://api.stripe.com/v1/' + path, opts);
  var j = await r.json();
  return { ok: r.ok, status: r.status, data: j };
}
function verifyStripeSig(raw, header, secret) {
  if (!header || !secret) return false;
  var t = null, v1 = null;
  header.split(',').forEach(function (kv) { var p = kv.split('='); if (p[0] === 't') t = p[1]; if (p[0] === 'v1') v1 = p[1]; });
  if (!t || !v1) return false;
  var expected = crypto.createHmac('sha256', secret).update(t + '.' + raw).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1)); } catch (e) { return false; }
}
function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

var ADMIN_DEFAULT = 'drink-admin';
function checkAdmin(pw) { return safeEqual(pw, process.env.DRINK_ADMIN_PASSWORD || ADMIN_DEFAULT); }

module.exports = {
  PHOTO_KEY: PHOTO_KEY, PICK_PHOTO_KEY: PICK_PHOTO_KEY,
  seedIds: seedIds, seedProfile: seedProfile, slug: slug,
  hashPw: hashPw, verifyPw: verifyPw,
  randomCode: randomCode, randomPassword: randomPassword, verifyClaimCode: verifyClaimCode,
  signToken: signToken, verifyToken: verifyToken,
  persistent: persistent, hasKV: hasKV,
  kvGet: kvGet, kvSet: kvSet, kvDel: kvDel,
  getProfile: getProfile, saveProfile: saveProfile, updateProfile: updateProfile,
  clampPunches: clampPunches, avgRating: avgRating,
  getVotes: getVotes, incrementVotes: incrementVotes,
  getRestaurant: getRestaurant, getAllRestaurants: getAllRestaurants, resetAll: resetAll,
  publicView: publicView,
  readBody: readBody, rawBody: rawBody, json: json, checkAdmin: checkAdmin,
  stripe: stripe, stripeConfigured: stripeConfigured, verifyStripeSig: verifyStripeSig
};
