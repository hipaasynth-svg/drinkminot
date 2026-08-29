/* DrinkMinot client store — the twin of EatMinot for Minot's bars, bottle shops,
   lounges, coffee & everywhere else you grab a drink.
   Two modes, chosen at load:
     - "server": a shared database is attached (GET /api/state reports persistent:true).
       Public metrics + owner/admin content live on the server, shared across all devices.
     - "local":  no database attached yet — falls back to this browser's localStorage so the
       site still works. Switches to "server" automatically once storage is provisioned.
   Punch-card progress and coupons are always per-device (anonymous), matching the
   privacy rules ("clearing cache can lose punch progress"). */
(function (global) {
  'use strict';

  var LKEY = 'drinkminot_local_v1';     // local-mode shared-ish data (this browser)
  var DKEY = 'drinkminot_device_v1';    // per-device punches/coupons/ratedAt
  var AKEY = 'drinkminot_admin_v1';     // local-mode admin password
  var RATE_WINDOW_MS = 86400000;
  var TAP_WINDOW_MS = 7200000;          // how long a real tag tap keeps the Rate button reachable (2h)
  var DEFAULT_ADMIN = 'drink-admin';

  // RAW order is FROZEN: each venue's id is its 1-based position here (see seedList),
  // and those ids are printed on the in-store NFC/QR tags (?r=<id>) and used as the key
  // for server-stored votes/profiles. Never reorder or remove rows — only append. Columns:
  //   [0] name  [1] address  [2] hours  [3] category
  //   [4] over21   — bar / alcohol establishment: show the 21+ sticker
  //   [5] alsoOnEat — this place is ALSO listed on the twin site EatMinot.com
  // The site GROUPS and ALPHABETIZES for display by category + name at render time (see
  // decorateList), so ids stay stable regardless.
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
    ["Bootlegrz", "Minot, ND", "Verify hours", "Bars & Lounges", true, false],
    ["Capri Bar", "Minot, ND", "Verify hours", "Bars & Lounges", true, false],
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
    ["Dakota Inn Trappers Lounge", "Minot, ND", "Verify hours", "Bars & Lounges", true, false],
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
    ["Down Under Bar", "Minot, ND", "Mon-Thu 10am-10pm, Fri 10am-12am, Sat verify, Sun 11am-10pm", "Bars & Lounges", true, false],
    ["Grainhopper", "Minot, ND", "Verify hours", "Breweries & Taprooms", true, false]
  ];
  var DEFAULT_CATEGORY = 'Other';
  // Static attributes for a given venue id, read straight from the frozen RAW table so
  // they never depend on the (sorted) display order.
  function categoryOf(id) { var row = RAW[id - 1]; return (row && row[3]) || DEFAULT_CATEGORY; }
  function over21Of(id) { var row = RAW[id - 1]; return !!(row && row[4]); }
  function alsoOnEatOf(id) { var row = RAW[id - 1]; return !!(row && row[5]); }
  // Alphabetization key: ignore a leading "The " so "The Pour Farm" files under P, and compare
  // case-insensitively with numeric awareness ("19th Hole" sorts naturally).
  function sortKey(name) { return String(name == null ? '' : name).replace(/^the\s+/i, ''); }
  // Produce the public display list: attach the category + flags, compute the star average,
  // then GROUP by category (alphabetically) and ALPHABETIZE venues within each group.
  // Returns a fresh array so the caller's source list keeps its id order untouched.
  // Venues pulled from the public list (no photo). Ids are the frozen RAW positions and are
  // never reused, so surviving venues keep their id (and their server-stored photo). Filtered
  // here — the single render choke point — so they vanish even for returning visitors whose
  // localStorage was seeded with the full list before the removal.
  var REMOVED = { 20: true, 21: true, 22: true, 31: true, 34: true, 35: true, 36: true, 37: true };
  function decorateList(list) {
    return list.filter(function (r) { return !REMOVED[r.id]; }).map(function (r) {
      withRating(r);
      r.category = categoryOf(r.id);
      r.over21 = over21Of(r.id);
      r.alsoOnEat = alsoOnEatOf(r.id);
      return r;
    }).sort(function (a, b) {
      var c = String(a.category).localeCompare(String(b.category), undefined, { sensitivity: 'base' });
      if (c) return c;
      return sortKey(a.name).localeCompare(sortKey(b.name), undefined, { numeric: true, sensitivity: 'base' });
    });
  }

  function slug(n) { return String(n).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function defaultPassword(n) { return slug(n) + '26'; }
  function fmtNum(n) {
    n = Math.round(n || 0);
    if (n >= 1000) { var k = n / 1000; return (n >= 10000 ? Math.round(k) : Math.round(k * 10) / 10).toString().replace(/\.0$/, '') + 'k'; }
    return String(n);
  }
  function seedList() {
    return RAW.map(function (row, i) {
      var id = i + 1, name = row[0], claimed = id === 1;
      return {
        id: id, name: name, address: row[1], hours: row[2],
        category: row[3], over21: !!row[4], alsoOnEat: !!row[5],
        claimed: claimed, paid: claimed, password: defaultPassword(name),
        photo: null, hasPhoto: false,
        pickPhotos: [null, null, null], hasPickPhoto: [false, false, false],
        upvotes: 0, ratingSum: 0, ratingCount: 0, totalRatings: 0, rating: 0,
        picks: claimed ? ['Cold beer cave', 'ND craft & local cans', 'Weekend wine tasting'] : ['', '', ''],
        note: claimed ? 'Locally owned — thanks for drinking local, Minot!' : '',
        website: claimed ? 'broadwayliquor.com' : '',
        reward: 'Free item on your 3rd punch', couponValidDays: 14,
        happyHour: claimed
          ? { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], start: '15:00', end: '18:00', special: '$1 off six-packs' }
          : { enabled: false, days: [1, 2, 3, 4, 5], start: '15:00', end: '18:00', special: '' }
      };
    }).filter(function (r) { return !REMOVED[r.id]; });
  }

  /* ---------- time / display helpers ---------- */
  function toMin(t) { if (!t || t.indexOf(':') < 0) return null; var p = t.split(':'), h = +p[0], m = +p[1]; return isNaN(h) || isNaN(m) ? null : h * 60 + m; }
  function isHappyHourNow(r, when) {
    var hh = r && r.happyHour; if (!hh || !hh.enabled) return false;
    var now = when || new Date();
    if (Array.isArray(hh.days) && hh.days.length && hh.days.indexOf(now.getDay()) < 0) return false;
    var cur = now.getHours() * 60 + now.getMinutes(), s = toMin(hh.start), e = toMin(hh.end);
    if (s == null || e == null) return false;
    return e <= s ? (cur >= s || cur < e) : (cur >= s && cur < e);
  }
  function to12h(t) { var m = toMin(t); if (m == null) return t || ''; var h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? 'pm' : 'am', h12 = h % 12 || 12; return h12 + (mm ? ':' + (mm < 10 ? '0' + mm : mm) : '') + ap; }

  function withRating(r) { r.rating = r.ratingCount ? Math.round((r.ratingSum / r.ratingCount) * 10) / 10 : 0; return r; }

  /* ---------- device (per-browser, anonymous) ---------- */
  function loadDevice() {
    var d; try { d = JSON.parse(global.localStorage.getItem(DKEY)); } catch (e) { d = null; }
    if (!d || !d.deviceId) d = { deviceId: 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36), perRest: {} };
    if (!d.perRest) d.perRest = {};
    return d;
  }
  function saveDevice(d) { try { global.localStorage.setItem(DKEY, JSON.stringify(d)); } catch (e) {} }
  function deviceRec(id) { var d = loadDevice(); return d.perRest[id] || { done: 0, total: 3, coupon: null, ratedAt: 0 }; }
  function ratedRecently(id) { var rec = deviceRec(id); return !!(rec.ratedAt && Date.now() - rec.ratedAt < RATE_WINDOW_MS); }
  // Called only when a real tag tap lands (enterTagMode) — never from the Paid preview
  // path — so the resumable "Rate now" pill stays gated on an actual physical visit.
  function recordTap(id) {
    var d = loadDevice(); var rec = d.perRest[id] || { done: 0, total: 3, coupon: null, ratedAt: 0 };
    rec.tapAt = Date.now(); d.perRest[id] = rec; saveDevice(d); deviceBackup();
  }
  // Most recent still-live tap (within TAP_WINDOW_MS) that hasn't already been rated.
  function pendingTap() {
    var d = loadDevice(), best = null;
    for (var id in d.perRest) {
      var rec = d.perRest[id];
      if (!rec.tapAt || Date.now() - rec.tapAt >= TAP_WINDOW_MS) continue;
      if (ratedRecently(id)) continue;
      if (!best || rec.tapAt > best.tapAt) best = { id: parseInt(id, 10), tapAt: rec.tapAt };
    }
    return best;
  }
  // Apply a completed rating to this device's punch card; returns the record.
  function punch(id, couponValidDays, reward) {
    var d = loadDevice(); var rec = d.perRest[id] || { done: 0, total: 3, coupon: null, ratedAt: 0 };
    rec.ratedAt = Date.now();
    var nd = rec.done + 1;
    if (nd >= (rec.total || 3)) {
      rec.done = 0;
      var days = couponValidDays || 14;
      rec.coupon = { code: 'DRK-' + Math.random().toString(36).slice(2, 7).toUpperCase(), issuedAt: Date.now(), expiresAt: Date.now() + days * 86400000, reward: reward || 'Reward earned!' };
    } else { rec.done = nd; }
    d.perRest[id] = rec; saveDevice(d); deviceBackup(); return rec;
  }

  /* ---------- anonymous server backup of punches (keyed by the random deviceId) ----------
     The card lives in localStorage as before; in server mode we also mirror it to the
     backend under the device's random token, so a reload or a wiped localStorage can
     restore it. No identity is ever attached — the token is the only key. */
  function deviceBackup() {
    if (mode !== 'server') return;
    var d = loadDevice();
    api('device', 'POST', { action: 'put', deviceId: d.deviceId, perRest: d.perRest }).catch(function () {});
  }
  // Merge one venue's local + backup record without losing progress or a live coupon.
  function mergeRec(a, b) {
    if (!a) return b; if (!b) return a;
    var newer = (b.ratedAt || 0) >= (a.ratedAt || 0) ? b : a, older = newer === b ? a : b;
    var m = { done: newer.done || 0, total: newer.total || older.total || 3, ratedAt: newer.ratedAt || 0, tapAt: Math.max(a.tapAt || 0, b.tapAt || 0) };
    var coup = newer.coupon || null;
    if ((!coup || (coup.expiresAt || 0) < Date.now()) && older.coupon && (older.coupon.expiresAt || 0) > Date.now()) coup = older.coupon;
    m.coupon = coup;
    return m;
  }
  // On load (server mode): pull the backup, merge it into this device's local state,
  // then push the union back so the server always holds the latest.
  function deviceRestore() {
    if (mode !== 'server') return Promise.resolve();
    var d = loadDevice();
    return api('device', 'POST', { action: 'get', deviceId: d.deviceId }).then(function (res) {
      var serverPer = (res.ok && res.data && res.data.perRest) || null;
      if (!serverPer) return;
      var cur = loadDevice(), changed = false, ids = {};
      Object.keys(cur.perRest || {}).forEach(function (k) { ids[k] = 1; });
      Object.keys(serverPer).forEach(function (k) { ids[k] = 1; });
      Object.keys(ids).forEach(function (id) {
        var merged = mergeRec(cur.perRest[id], serverPer[id]);
        if (JSON.stringify(merged) !== JSON.stringify(cur.perRest[id])) changed = true;
        cur.perRest[id] = merged;
      });
      if (changed) saveDevice(cur);
      deviceBackup();
    }).catch(function () {});
  }

  /* ---------- local-mode persistence ---------- */
  function loadLocal() {
    var data; try { data = JSON.parse(global.localStorage.getItem(LKEY)); } catch (e) { data = null; }
    if (!data || !Array.isArray(data.restaurants) || !data.restaurants.length) { data = { restaurants: seedList() }; saveLocal(data); }
    // Forward-fill fields added after a browser already cached older local data.
    data.restaurants.forEach(function (r) {
      if (!Array.isArray(r.pickPhotos) || r.pickPhotos.length !== 3) r.pickPhotos = [null, null, null];
      if (!Array.isArray(r.hasPickPhoto) || r.hasPickPhoto.length !== 3) r.hasPickPhoto = [false, false, false];
    });
    data.restaurants.forEach(withRating);
    return data;
  }
  function saveLocal(d) { try { global.localStorage.setItem(LKEY, JSON.stringify(d)); return true; } catch (e) { return false; } }
  function localFind(d, id) { id = parseInt(id, 10); return d.restaurants.filter(function (r) { return r.id === id; })[0] || null; }

  /* ---------- image helper ---------- */
  function fileToDataUrl(file, maxW, q) {
    maxW = maxW || 900; q = q || 0.72;
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('not image')); return; }
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var scale = Math.min(1, maxW / img.width), w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url);
        try { resolve(c.toDataURL('image/jpeg', q)); } catch (e) { reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('load failed')); };
      img.src = url;
    });
  }

  /* ---------- network ---------- */
  function api(path, method, body) {
    return fetch('/api/' + path, {
      method: method || 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, data: j }; }); });
  }

  /* ---------- store state ---------- */
  var mode = 'local';         // 'server' | 'local'
  var cache = [];             // venues (public shape)
  var photoCache = {};        // id -> dataURL | null | undefined(unfetched)

  function init() {
    return api('state').then(function (res) {
      if (res.ok && res.data && res.data.persistent) {
        mode = 'server';
        cache = decorateList(res.data.restaurants);
      } else { throw new Error('no server'); }
    }).catch(function () {
      mode = 'local';
      cache = decorateList(loadLocal().restaurants);
    }).then(function () { return deviceRestore().catch(function () {}); })
      .then(function () { return { mode: mode, restaurants: cache }; });
  }

  // Adopt a device token handed back by a durable, wipe-proof store (a Wallet pass,
  // a saved QR, a passkey). Any punches already on this browser are kept and merged
  // into the adopted token's backup, so nothing is lost when the two meet.
  function adoptDevice(token) {
    if (!/^dev_[a-z0-9]{6,80}$/i.test(String(token || ''))) return Promise.resolve(false);
    var d = loadDevice();
    if (d.deviceId === token) return deviceRestore().then(function () { return true; });
    d.deviceId = token; saveDevice(d);           // keep existing perRest, switch the key
    return deviceRestore().then(function () { return true; });
  }

  function refresh() {
    if (mode === 'server') return api('state').then(function (res) { if (res.ok) cache = decorateList(res.data.restaurants); return cache; });
    cache = decorateList(loadLocal().restaurants); return Promise.resolve(cache);
  }

  function list() { return cache; }
  function get(id) { id = parseInt(id, 10); return cache.filter(function (r) { return r.id === id; })[0] || null; }

  function getPhoto(id) {
    if (photoCache[id] !== undefined) return Promise.resolve(photoCache[id]);
    if (mode === 'server') {
      var r = get(id);
      if (r && !r.hasPhoto) { photoCache[id] = null; return Promise.resolve(null); }
      return api('photo?id=' + id).then(function (res) { photoCache[id] = (res.ok && res.data.photo) || null; return photoCache[id]; }).catch(function () { return null; });
    }
    var lr = localFind(loadLocal(), id); photoCache[id] = lr ? (lr.photo || null) : null; return Promise.resolve(photoCache[id]);
  }
  function clearPhoto(id) { delete photoCache[id]; }

  var pickPhotoCache = {}; // "id:i" -> dataURL | null | undefined(unfetched)
  function getPickPhoto(id, i) {
    var k = id + ':' + i;
    if (pickPhotoCache[k] !== undefined) return Promise.resolve(pickPhotoCache[k]);
    if (mode === 'server') {
      var r = get(id);
      if (r && r.hasPickPhoto && !r.hasPickPhoto[i]) { pickPhotoCache[k] = null; return Promise.resolve(null); }
      return api('photo?id=' + id + '&pick=' + i).then(function (res) { pickPhotoCache[k] = (res.ok && res.data.photo) || null; return pickPhotoCache[k]; }).catch(function () { return null; });
    }
    var lr = localFind(loadLocal(), id);
    pickPhotoCache[k] = (lr && lr.pickPhotos && lr.pickPhotos[i]) || null;
    return Promise.resolve(pickPhotoCache[k]);
  }
  function clearPickPhoto(id, i) { delete pickPhotoCache[id + ':' + i]; }

  /* ---------- rating (public, shared) + punch (per-device) ---------- */
  function rate(id, stars, upvote) {
    if (ratedRecently(id)) return Promise.resolve({ ok: false, reason: 'rate_limited' });
    var r = get(id);
    if (mode === 'server') {
      return api('rate', 'POST', { id: id, stars: stars, upvote: upvote }).then(function (res) {
        if (!res.ok) return { ok: false, reason: (res.data && res.data.error) || 'error' };
        var c = get(id); if (c) { c.upvotes = res.data.upvotes; c.totalRatings = res.data.totalRatings; c.rating = res.data.rating; }
        var rec = punch(id, r ? r.couponValidDays : 14, r ? r.reward : '');
        return { ok: true, record: rec };
      });
    }
    // local
    var d = loadLocal(); var lr = localFind(d, id);
    if (!lr) return Promise.resolve({ ok: false, reason: 'not_found' });
    lr.totalRatings += 1; lr.ratingSum += stars; lr.ratingCount += 1; if (upvote) lr.upvotes += 1;
    saveLocal(d); cache = decorateList(d.restaurants);
    var rec2 = punch(id, lr.couponValidDays, lr.reward);
    return Promise.resolve({ ok: true, record: rec2 });
  }

  /* ---------- owner ---------- */
  var ownerTok = {}; // id -> session token
  function ownerLogin(id, pw) {
    if (mode === 'server') return api('owner', 'POST', { action: 'login', id: id, password: pw }).then(function (res) { if (res.ok && res.data.token) ownerTok[id] = res.data.token; return res.ok ? { ok: true, data: res.data } : { ok: false }; });
    var lr = localFind(loadLocal(), id); return Promise.resolve(lr && pw === lr.password ? { ok: true, data: { id: lr.id, name: lr.name, paid: lr.paid } } : { ok: false });
  }
  // First-run claim: open an unclaimed venue once with no password, then set one.
  // Server enforces one-time via the claimed flag; local mirrors it.
  function ownerClaim(id, newPw) {
    id = parseInt(id, 10);
    if (mode === 'server') return api('owner', 'POST', { action: 'claim', id: id, password: newPw }).then(function (res) { if (res.ok && res.data && res.data.token) ownerTok[id] = res.data.token; return { ok: !!res.ok, reason: res.data && res.data.error, data: res.data }; });
    var d = loadLocal(), lr = localFind(d, id);
    if (!lr) return Promise.resolve({ ok: false, reason: 'not_found' });
    if (lr.claimed) return Promise.resolve({ ok: false, reason: 'already_claimed' });
    lr.password = newPw; lr.claimed = true;
    saveLocal(d); cache = decorateList(d.restaurants);
    return Promise.resolve({ ok: true });
  }
  function ownerUpdate(id, pw, fields) {
    if (mode === 'server') return api('owner', 'POST', { action: 'update', id: id, token: ownerTok[id], password: pw, fields: fields }).then(function (res) { return { ok: res.ok }; }).then(function (r) { return refresh().then(function () { return r; }); });
    var d = loadLocal(), lr = localFind(d, id);
    if (!lr || pw !== lr.password) return Promise.resolve({ ok: false });
    if (Array.isArray(fields.picks)) lr.picks = fields.picks.slice(0, 3);
    if (typeof fields.note === 'string') lr.note = fields.note;
    if (typeof fields.website === 'string') lr.website = fields.website;
    if (typeof fields.reward === 'string') lr.reward = fields.reward;
    if (fields.couponValidDays != null) lr.couponValidDays = Math.max(1, parseInt(fields.couponValidDays, 10) || 1);
    if (fields.happyHour) lr.happyHour = fields.happyHour;
    if (typeof fields.password === 'string' && fields.password.trim()) lr.password = fields.password.trim();
    var ok = saveLocal(d); cache = decorateList(d.restaurants);
    return Promise.resolve({ ok: ok });
  }

  function ownerPhoto(id, pw, dataUrl) {
    clearPhoto(id);
    if (mode === 'server') return api('owner', 'POST', { action: 'photo', id: id, token: ownerTok[id], password: pw, dataUrl: dataUrl }).then(function (res) { return refresh().then(function () { return { ok: res.ok }; }); });
    var d = loadLocal(), lr = localFind(d, id);
    if (!lr || pw !== lr.password) return Promise.resolve({ ok: false });
    if (!lr.paid) return Promise.resolve({ ok: false });
    lr.photo = dataUrl; lr.hasPhoto = true; var ok = saveLocal(d); cache = decorateList(d.restaurants);
    return Promise.resolve({ ok: ok });
  }
  function ownerPickPhoto(id, pw, i, dataUrl) {
    clearPickPhoto(id, i);
    if (mode === 'server') return api('owner', 'POST', { action: 'photo', id: id, pick: i, token: ownerTok[id], password: pw, dataUrl: dataUrl }).then(function (res) { return refresh().then(function () { return { ok: res.ok }; }); });
    var d = loadLocal(), lr = localFind(d, id);
    if (!lr || pw !== lr.password) return Promise.resolve({ ok: false });
    if (!lr.paid) return Promise.resolve({ ok: false });
    if (!lr.pickPhotos) lr.pickPhotos = [null, null, null];
    if (!lr.hasPickPhoto) lr.hasPickPhoto = [false, false, false];
    lr.pickPhotos[i] = dataUrl; lr.hasPickPhoto[i] = true;
    var ok2 = saveLocal(d); cache = decorateList(d.restaurants);
    return Promise.resolve({ ok: ok2 });
  }

  /* ---------- billing (Stripe) ---------- */
  function checkout(id, pw) {
    if (mode !== 'server') return Promise.resolve({ error: 'local' });
    return api('checkout', 'POST', { id: id, token: ownerTok[id], password: pw }).then(function (res) { return res.data || { error: 'error' }; });
  }
  function confirmUpgrade(sessionId) {
    if (mode !== 'server') return Promise.resolve({ ok: false });
    return api('upgrade-confirm', 'POST', { sessionId: sessionId }).then(function (res) { return refresh().then(function () { return res.data || { ok: false }; }); });
  }

  /* ---------- admin ---------- */
  function checkAdminLocal(pw) { var s; try { s = global.localStorage.getItem(AKEY); } catch (e) { s = null; } return pw === (s || DEFAULT_ADMIN); }
  function adminList(pw) {
    if (mode === 'server') return api('admin', 'POST', { password: pw, action: 'list' }).then(function (res) { return res.ok ? { ok: true, restaurants: res.data.restaurants } : { ok: false }; });
    if (!checkAdminLocal(pw)) return Promise.resolve({ ok: false });
    return Promise.resolve({ ok: true, restaurants: loadLocal().restaurants });
  }
  function adminPhoto(pw, id, dataUrl) {
    clearPhoto(id);
    if (mode === 'server') return api('admin', 'POST', { password: pw, action: 'photo', id: id, dataUrl: dataUrl }).then(function (res) { return refresh().then(function () { return { ok: res.ok }; }); });
    if (!checkAdminLocal(pw)) return Promise.resolve({ ok: false });
    var d = loadLocal(), lr = localFind(d, id); if (!lr) return Promise.resolve({ ok: false });
    lr.photo = dataUrl; lr.hasPhoto = true; var ok = saveLocal(d); cache = decorateList(d.restaurants);
    return Promise.resolve({ ok: ok });
  }
  function adminRemovePhoto(pw, id) {
    clearPhoto(id);
    if (mode === 'server') return api('admin', 'POST', { password: pw, action: 'removePhoto', id: id }).then(function (res) { return refresh().then(function () { return { ok: res.ok }; }); });
    if (!checkAdminLocal(pw)) return Promise.resolve({ ok: false });
    var d = loadLocal(), lr = localFind(d, id); if (lr) { lr.photo = null; lr.hasPhoto = false; saveLocal(d); cache = decorateList(d.restaurants); }
    return Promise.resolve({ ok: true });
  }
  function adminPickPhoto(pw, id, i, dataUrl) {
    clearPickPhoto(id, i);
    if (mode === 'server') return api('admin', 'POST', { password: pw, action: 'photo', id: id, pick: i, dataUrl: dataUrl }).then(function (res) { return refresh().then(function () { return { ok: res.ok }; }); });
    if (!checkAdminLocal(pw)) return Promise.resolve({ ok: false });
    var d = loadLocal(), lr = localFind(d, id); if (!lr) return Promise.resolve({ ok: false });
    if (!lr.pickPhotos) lr.pickPhotos = [null, null, null];
    if (!lr.hasPickPhoto) lr.hasPickPhoto = [false, false, false];
    lr.pickPhotos[i] = dataUrl; lr.hasPickPhoto[i] = true;
    var ok3 = saveLocal(d); cache = decorateList(d.restaurants);
    return Promise.resolve({ ok: ok3 });
  }
  function adminRemovePickPhoto(pw, id, i) {
    clearPickPhoto(id, i);
    if (mode === 'server') return api('admin', 'POST', { password: pw, action: 'removePhoto', id: id, pick: i }).then(function (res) { return refresh().then(function () { return { ok: res.ok }; }); });
    if (!checkAdminLocal(pw)) return Promise.resolve({ ok: false });
    var d = loadLocal(), lr = localFind(d, id);
    if (lr) { if (!lr.pickPhotos) lr.pickPhotos=[null,null,null]; if(!lr.hasPickPhoto) lr.hasPickPhoto=[false,false,false]; lr.pickPhotos[i]=null; lr.hasPickPhoto[i]=false; saveLocal(d); cache = decorateList(d.restaurants); }
    return Promise.resolve({ ok: true });
  }
  function adminSetFlag(pw, id, flags) {
    if (mode === 'server') return api('admin', 'POST', { password: pw, action: 'setFlag', id: id, claimed: flags.claimed, paid: flags.paid }).then(function (res) { return refresh().then(function () { return { ok: res.ok }; }); });
    if (!checkAdminLocal(pw)) return Promise.resolve({ ok: false });
    var d = loadLocal(), lr = localFind(d, id); if (!lr) return Promise.resolve({ ok: false });
    if (typeof flags.claimed === 'boolean') { lr.claimed = flags.claimed; if (!lr.claimed) lr.paid = false; }
    if (typeof flags.paid === 'boolean') { lr.paid = flags.paid; if (lr.paid) lr.claimed = true; }
    saveLocal(d); cache = decorateList(d.restaurants); return Promise.resolve({ ok: true });
  }
  function adminResetPassword(pw, id) {
    if (mode === 'server') return api('admin', 'POST', { password: pw, action: 'resetPassword', id: id }).then(function (res) { return { ok: res.ok, defaultPassword: res.data && res.data.defaultPassword }; });
    var d = loadLocal(), lr = localFind(d, id); if (!lr) return Promise.resolve({ ok: false });
    lr.password = defaultPassword(lr.name); saveLocal(d);
    return Promise.resolve({ ok: true, defaultPassword: lr.password });
  }
  function adminReset(pw) {
    photoCache = {};
    if (mode === 'server') return api('admin', 'POST', { password: pw, action: 'reset' }).then(function (res) { return refresh().then(function () { return { ok: res.ok }; }); });
    if (!checkAdminLocal(pw)) return Promise.resolve({ ok: false });
    var d = { restaurants: seedList() }; saveLocal(d); cache = decorateList(d.restaurants); return Promise.resolve({ ok: true });
  }
  function setAdminPasswordLocal(pw) { try { global.localStorage.setItem(AKEY, pw); return true; } catch (e) { return false; } }

  global.DrinkStore = {
    RATE_WINDOW_MS: RATE_WINDOW_MS,
    init: init, refresh: refresh, mode: function () { return mode; }, isServer: function () { return mode === 'server'; },
    list: list, get: get, getPhoto: getPhoto, clearPhoto: clearPhoto,
    getPickPhoto: getPickPhoto, clearPickPhoto: clearPickPhoto,
    rate: rate, ratedRecently: ratedRecently, deviceRec: deviceRec, recordTap: recordTap, pendingTap: pendingTap,
    deviceId: function () { return loadDevice().deviceId; }, deviceBackup: deviceBackup, deviceRestore: deviceRestore, adoptDevice: adoptDevice,
    ownerLogin: ownerLogin, ownerClaim: ownerClaim, ownerUpdate: ownerUpdate, ownerPhoto: ownerPhoto, ownerPickPhoto: ownerPickPhoto,
    checkout: checkout, confirmUpgrade: confirmUpgrade,
    adminList: adminList, adminPhoto: adminPhoto, adminRemovePhoto: adminRemovePhoto,
    adminPickPhoto: adminPickPhoto, adminRemovePickPhoto: adminRemovePickPhoto,
    adminSetFlag: adminSetFlag, adminReset: adminReset, adminResetPassword: adminResetPassword, setAdminPasswordLocal: setAdminPasswordLocal,
    slug: slug, defaultPassword: defaultPassword, fmtNum: fmtNum, isHappyHourNow: isHappyHourNow, to12h: to12h, fileToDataUrl: fileToDataUrl
  };
})(window);
