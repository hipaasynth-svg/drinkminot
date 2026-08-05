'use strict';
var L = require('./_lib');

// GET /api/state -> { persistent, restaurants:[...] } (public, no passwords)
module.exports = async function (req, res) {
  try {
    var list = await L.getAllRestaurants();
    L.json(res, 200, L.publicView(list));
  } catch (e) {
    L.json(res, 500, { error: 'state_failed' });
  }
};
