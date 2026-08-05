'use strict';
var L = require('./_lib');

// POST /api/rate { id, stars(1-5), upvote(bool) } -> updated public aggregates.
// Vote counters move only via atomic HINCRBY (see _lib.incrementVotes) — never a
// read-modify-write on shared state — so many simultaneous ratings for the same
// venue can't clobber each other or lose a vote.
module.exports = async function (req, res) {
  if (req.method !== 'POST') { L.json(res, 405, { error: 'method' }); return; }
  try {
    var b = await L.readBody(req);
    var stars = Math.max(1, Math.min(5, parseInt(b.stars, 10) || 0));
    if (!stars) { L.json(res, 400, { error: 'stars' }); return; }
    var upvote = !!b.upvote;
    var profile = await L.getProfile(b.id);
    if (!profile) { L.json(res, 404, { error: 'not_found' }); return; }
    var votes = await L.incrementVotes(profile.id, {
      totalRatings: 1, ratingCount: 1, ratingSum: stars, upvotes: upvote ? 1 : 0
    });
    L.json(res, 200, {
      id: profile.id, upvotes: votes.upvotes, totalRatings: votes.totalRatings,
      rating: votes.ratingCount ? Math.round((votes.ratingSum / votes.ratingCount) * 10) / 10 : 0
    });
  } catch (e) {
    L.json(res, 500, { error: 'rate_failed' });
  }
};
