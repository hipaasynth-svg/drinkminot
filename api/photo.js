'use strict';
var L = require('./_lib');

// GET /api/photo?id=NN[&pick=0|1|2] -> { photo: dataUrl|null }
module.exports = async function (req, res) {
  try {
    var url = require('url').parse(req.url, true);
    var id = parseInt((url.query && url.query.id) || '0', 10);
    if (!id) { L.json(res, 400, { error: 'id' }); return; }
    var pickRaw = url.query && url.query.pick;
    var key;
    if (pickRaw !== undefined && pickRaw !== '') {
      var pick = parseInt(pickRaw, 10);
      if (pick < 0 || pick > 2) { L.json(res, 400, { error: 'pick' }); return; }
      key = L.PICK_PHOTO_KEY(id, pick);
    } else {
      key = L.PHOTO_KEY(id);
    }
    var data = await L.kvGet(key);
    L.json(res, 200, { photo: data || null });
  } catch (e) {
    L.json(res, 500, { error: 'photo_failed' });
  }
};
