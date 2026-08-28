'use strict';
var L = require('./_lib');
var crypto = require('crypto');

// A curated "what's happening in Minot" events feed — the local endpoint that
// doesn't exist anywhere else, so we host it. Additive: touches nothing else.
//
//   GET  /api/events                      -> { ok, events:[...] }  (public, upcoming only)
//   POST /api/events { password, action } -> admin-gated add/update/remove/list
//     action:
//       'add'    { event:{title,date,...} }        -> create (id auto if absent)
//       'update' { event:{id,...fields} }           -> merge into an existing event
//       'remove' { id }                             -> delete by id
//       'list'                                      -> ALL events incl. past (admin view)
//
// Auth reuses the existing admin password (L.checkAdmin), exactly like /api/admin.
// Storage reuses the shared adapter (Redis when attached, in-memory otherwise)
// under one key; only the admin writes, so a read-modify-write on it is safe.

var EVENTS_KEY = 'drinkminot:events';

// Event: { id, title, date:'YYYY-MM-DD', time:'HH:MM', venue, category, url, note, source }
// source distinguishes hand-curated events ('manual') from auto-synced feeds
// (e.g. 'predicthq'); a sync only ever touches its own source (see the 'sync'
// action), so an auto-feed can never clobber events you added by hand.
function sanitize(e) {
  e = e || {};
  return {
    id: String(e.id || crypto.randomBytes(6).toString('hex')),
    title: String(e.title || '').trim().slice(0, 200),
    date: String(e.date || '').trim().slice(0, 10),
    time: String(e.time || '').trim().slice(0, 5),
    venue: String(e.venue || '').trim().slice(0, 200),
    category: String(e.category || '').trim().slice(0, 60),
    url: String(e.url || '').trim().slice(0, 500),
    note: String(e.note || '').trim().slice(0, 500),
    source: String(e.source || '').trim().slice(0, 40)
  };
}

async function loadEvents() {
  var raw = await L.kvGet(EVENTS_KEY);
  if (!raw) return [];
  try { var a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
async function saveEvents(list) { await L.kvSet(EVENTS_KEY, JSON.stringify(list)); }

function todayISO() { return new Date().toISOString().slice(0, 10); }

// Public view: only upcoming events (date >= today), sorted soonest first.
function publicEvents(list) {
  var today = todayISO();
  return list
    .filter(function (e) { return e && e.date && e.date >= today; })
    .sort(function (a, b) {
      return (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''));
    });
}

module.exports = async function (req, res) {
  try {
    if (req.method === 'GET') {
      L.json(res, 200, { ok: true, events: publicEvents(await loadEvents()) });
      return;
    }
    if (req.method !== 'POST') { L.json(res, 405, { error: 'method' }); return; }

    var b = await L.readBody(req);
    if (!L.checkAdmin(b.password)) { L.json(res, 401, { error: 'bad_admin' }); return; }
    var list = await loadEvents();

    if (b.action === 'list') { L.json(res, 200, { ok: true, events: list }); return; }

    if (b.action === 'add') {
      var ev = sanitize(b.event || b);
      if (!ev.source) ev.source = 'manual';
      if (!ev.title || !ev.date) { L.json(res, 400, { error: 'title_and_date_required' }); return; }
      list.push(ev);
      await saveEvents(list);
      L.json(res, 200, { ok: true, event: ev });
      return;
    }
    // Idempotent, source-scoped auto-sync: replace ALL events of one source
    // with the provided set, leaving every other source (manual, etc.) intact.
    // { password, action:'sync', source:'predicthq', events:[...] }
    if (b.action === 'sync') {
      var src = String(b.source || '').trim().slice(0, 40);
      if (!src) { L.json(res, 400, { error: 'source_required' }); return; }
      var incoming = (Array.isArray(b.events) ? b.events : [])
        .map(sanitize)
        .filter(function (e) { return e.title && e.date; });
      incoming.forEach(function (e) { e.source = src; });
      var others = list.filter(function (e) { return (e.source || 'manual') !== src; });
      var next = others.concat(incoming);
      await saveEvents(next);
      L.json(res, 200, { ok: true, source: src, synced: incoming.length, total: next.length });
      return;
    }
    if (b.action === 'update') {
      var uid = String((b.event && b.event.id) || b.id || '');
      var idx = list.findIndex(function (e) { return String(e.id) === uid; });
      if (idx < 0) { L.json(res, 404, { error: 'not_found' }); return; }
      var merged = sanitize(Object.assign({}, list[idx], b.event || b, { id: uid }));
      if (!merged.title || !merged.date) { L.json(res, 400, { error: 'title_and_date_required' }); return; }
      list[idx] = merged;
      await saveEvents(list);
      L.json(res, 200, { ok: true, event: merged });
      return;
    }
    if (b.action === 'remove') {
      var rid = String((b.event && b.event.id) || b.id || '');
      var next = list.filter(function (e) { return String(e.id) !== rid; });
      await saveEvents(next);
      L.json(res, 200, { ok: true, removed: list.length - next.length });
      return;
    }
    L.json(res, 400, { error: 'action' });
  } catch (e) {
    L.json(res, 500, { error: 'events_failed' });
  }
};
