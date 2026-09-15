'use strict';
var L = require('./_lib');

// POST /api/agent { id, token|password, op:'list'|'run', templateId?, question?, ownData?, ownDataFormat? }
//
// Proxies to the self-hosted minot-agent service (a separate repo: NOOA agent
// framework + kernel-sandboxed Python execution). The browser never talks to
// that service directly and it never sees an owner or admin password — only
// this route's own MINOT_AGENT_SERVICE_KEY.
//
// Two gates before anything is forwarded:
//   1. The owner's own session (same token/password check as api/owner.js).
//   2. profile.agentEnabled — a super-admin on/off switch (api/admin.js
//      setFlag), independent of claimed/paid. Beta: not tied to Stripe yet.
//
// An agent run can take 15-30s — vercel.json sets this route's maxDuration to
// 60s, which needs a Vercel plan that allows it for Node functions (Hobby
// caps lower). Check your plan's function-duration limit before relying on it.
var AGENT_URL = (process.env.MINOT_AGENT_URL || '').replace(/\/+$/, '');
var AGENT_KEY = process.env.MINOT_AGENT_SERVICE_KEY || '';
var SITE = 'drink';

function agentFetch(path, opts) {
  var headers = Object.assign({ 'X-Agent-Service-Key': AGENT_KEY }, (opts && opts.headers) || {});
  return fetch(AGENT_URL + path, Object.assign({}, opts, { headers: headers }));
}

module.exports = async function (req, res) {
  if (req.method !== 'POST') { L.json(res, 405, { error: 'method' }); return; }
  if (!AGENT_URL || !AGENT_KEY) { L.json(res, 501, { error: 'agent_not_configured' }); return; }
  try {
    var b = await L.readBody(req);
    var profile = await L.getProfile(b.id);
    if (!profile) { L.json(res, 404, { error: 'not_found' }); return; }
    if (!profile.agentEnabled) { L.json(res, 403, { error: 'agent_disabled' }); return; }

    var authed = (b.token && L.verifyToken(b.token) === profile.id) || L.verifyPw(b.password, profile.password);
    if (!authed) { L.json(res, 401, { error: 'unauthorized' }); return; }

    if (b.op === 'list') {
      var listRes = await agentFetch('/experiments', { method: 'GET' });
      var listJson = await listRes.json();
      L.json(res, listRes.status, listJson);
      return;
    }

    if (b.op === 'run') {
      var templateId = String(b.templateId || '');
      if (!templateId) { L.json(res, 400, { error: 'templateId_required' }); return; }
      var payload = {
        site: SITE,
        venue_id: profile.id,
        question: String(b.question || '').slice(0, 2000),
        own_data: String(b.ownData || '').slice(0, 500000),
        own_data_format: b.ownDataFormat === 'csv' ? 'csv' : 'text'
      };
      var runRes = await agentFetch('/experiments/' + encodeURIComponent(templateId) + '/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var runJson = await runRes.json();
      L.json(res, runRes.status, runJson);
      return;
    }

    L.json(res, 400, { error: 'op' });
  } catch (e) {
    L.json(res, 502, { error: 'agent_unreachable' });
  }
};
