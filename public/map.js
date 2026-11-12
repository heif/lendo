// Lendo map — Mapbox GL JS v3. One map instance per page load (each init is a billed map load).
// Config comes from window.LENDO_MAP = { token, style, center:[lng,lat], zoom, hasHome }.
(function () {
  var CFG = window.LENDO_MAP || {};
  var S = window.LENDO_MAP_STYLE;
  var WALKERS = true;          // §2 animated walkers (toggle)
  var MAX_WALKERS = 20;
  var HOOD_LAYER = true;       // §4 faint neighborhood outlines (empty collection until hoods are seeded)

  var $ = function (id) { return document.getElementById(id); };
  var grid = $('grid'), sheet = $('sheet'), q = $('q');
  function fmt(c) { var d = c / 100; return '$' + (Number.isInteger(d) ? d : d.toFixed(2)); }
  function esc(s) { return String(s).replace(/[<>&"]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]; }); }

  // List view (prototype "aisles"): category sections, big heading + count, horizontal row of item stickers
  var AISLES = [
    ['Tech & cameras', /projector|laptop|macbook|monitor|printer|camera|camcorder|drone|\btv\b|console|controller|vr |headset|ipad|tablet|power station|battery|gopro/],
    ['Music & sound', /guitar|keyboard|piano|violin|drum|sax|trumpet|banjo|accordion|speaker|micro|\bmic\b|dj |boombox|disco|amp\b/],
    ['Wheels', /bike|bicycle|scooter|skateboard|roller|moped|\bcar\b|\bvan\b|truck|wheelchair|crutch|stroller|wagon/],
    ['Outdoors', /tent|kayak|sail|surf|umbrella|telescope|microscope|fishing|archery|\bbow\b|kite|snorkel|paraglid|backpack|hammock|cooler|binocular|camping/],
    ['Snow', /\bski|snowboard|ice skate|\bsled|ski jacket/],
    ['Sports & games', /pickleball|racket|tennis|hockey|lacrosse|cricket|boxing|soccer|goal|golf|game/],
    ['Tools', /ladder|saw|axe|toolbox|hammer|drill|pressure washer|leaf blower|mower|trimmer|sander|shop vac|nail gun|sprayer|generator|hand truck|wheelbarrow|laser level|tool/],
    ['Home & kitchen', /mixer|espresso|air fryer|dinner|picnic|sewing|steamer|carpet cleaner|vacuum|chair|suitcase|luggage|grill|table|crib|stroller|car seat|record player|pottery/],
    ['Parties & photo', /balloon|backdrop|ring light|disco|projector|speaker|craft|cutting machine/],
    ['Wellness', /yoga|exercise bike|massage|paddleboard/],
    ['Dress up', /gown|heels|boots|top hat|\btux|dress|costume|handbag|hair styler|film kit|clapper|jacket/]
  ];
  var openAisle = null;
  function aisleOf(it) { var n = (it.name + ' ' + (it.description || '')).toLowerCase(); for (var k = 0; k < AISLES.length; k++) if (AISLES[k][1].test(n)) return AISLES[k][0]; return 'Everything else'; }
  function tile(it) {
    var img = it.avatar_key ? '/p/' + it.avatar_key : it.photo ? '/p/' + it.photo : '';
    return '<div class="ai-t"><a href="/i/' + it.id + '"><div class="ai-im">' + '<span class="ai-sh"></span>' +
      (img ? '<img loading="lazy" decoding="async" src="' + img + '" alt="' + esc(it.name) + '"' + (it.avatar_key ? '' : ' class="ph"') + '>' : '<span class="ai-em">' + (it.emoji || '📦') + '</span>') +
      '<span class="ai-pr">' + fmt(it.price_cents) + '<small>/day</small></span></div><div class="ai-nm">' + esc(it.name) + '</div></a>' +
      '<button type="button" class="ai-wh" data-go="' + it.id + '"><svg width="9" height="11" viewBox="0 0 24 28" aria-hidden="true"><path d="M12 27C12 27 3 17 3 10.5A9 9 0 0 1 21 10.5C21 17 12 27 12 27Z" fill="#1E3A2B"/><circle cx="12" cy="10.5" r="3.2" fill="#fff"/></svg>' + esc(it.hood || 'nearby') + '</button></div>';
  }
  function renderGrid(items) {
    var c = map.getCenter(), groups = {};
    var sorted = items.slice().sort(function (a, b) { return Math.hypot(a.lat - c.lat, (a.lng - c.lng) * .76) - Math.hypot(b.lat - c.lat, (b.lng - c.lng) * .76); });
    sorted.forEach(function (it) { var a = aisleOf(it); (groups[a] = groups[a] || []).push(it); });
    var names = Object.keys(groups).sort(function (a, b) { return a === 'Everything else' ? 1 : b === 'Everything else' ? -1 : groups[b].length - groups[a].length; });
    if (openAisle && !groups[openAisle]) openAisle = null;
    // searching: one flat result grid, no category headers (the header would read as a different word than the search)
    if (q.value.trim() && sorted.length) { grid.innerHTML = '<div class="ai-res">' + sorted.length + ' to rent</div><section class="aisle focus"><div class="ai-row">' + sorted.map(tile).join('') + '</div></section>'; return; }
    if (!names.length) { grid.innerHTML = '<div class="hint" style="padding:24px 16px">Nothing here yet. Be the first — <a href="/list">list something</a>.</div>'; return; }
    grid.innerHTML = (openAisle ? '<button type="button" class="ai-back" data-aisle="">‹ All categories</button>' : '') + (openAisle ? [openAisle] : names).map(function (n) {
      var list = groups[n], focus = n === openAisle;
      return '<section class="aisle' + (focus ? ' focus' : '') + '"><button type="button" class="ai-h" data-aisle="' + (focus ? '' : esc(n)) + '"><h2>' + esc(n) + '</h2><span class="ai-n">' + list.length + '</span>' + (focus ? '' : '<span class="ai-all">All ›</span>') + '</button>' +
        '<div class="ai-row">' + (focus ? list : list.slice(0, 24)).map(tile).join('') + '</div></section>';
    }).join('');
  }
  grid.addEventListener('click', function (e) {
    var h = e.target.closest('[data-aisle]'); if (h) { openAisle = h.dataset.aisle || null; renderGrid(cityItems || items); grid.scrollTop = 0; return; }
    var g = e.target.closest('[data-go]'); if (g) { var it = known[g.dataset.go]; if (!it) return; setList(false); map.easeTo({ center: [it.lng, it.lat], zoom: Math.max(map.getZoom(), 15.5) }); }
  });
  function setKpi(j) { if (!PL) $('scCityC').textContent = j.counts.view.toLocaleString(); } // city count comes from /api/places once loaded
  var hoodT, lastHood = '';
  function syncCrumb(hasHood) { var c = $('scCity').querySelector('b').textContent; $('scCityS').textContent = hasHood && c ? c : ''; }
  function updateHood() {
    var cc = map.getCenter();
    fetch('/api/hood?lat=' + cc.lat.toFixed(4) + '&lng=' + cc.lng.toFixed(4)).then(function (r) { return r.json(); }).then(function (j) {
      var name = j.hood || (j.city ? j.city : 'Near you'); $('scHoodN').textContent = j.hood_short || name; $('scHoodN').title = name; $('scHoodC').textContent = (j.hood ? j.hood_n : items.length).toLocaleString(); if (j.city) { $('scCity').querySelector('b').textContent = j.city_short || j.city; $('scCity').title = j.city; $('scCityC').textContent = j.city_n.toLocaleString(); }
      syncCrumb(!!j.hood); if (name !== lastHood) { lastHood = name; $('scHoodN').animate([{ opacity: 0.3 }, { opacity: 1 }], 300); }
    }).catch(function () {});
  }

  mapboxgl.accessToken = CFG.token;
  // come back to the same view (item page → back) instead of jumping home; ?c= in the URL still wins
  var RESTORED = null;
  try { if (!/[?&]c=/.test(location.search) && !CFG.pinned) { var sv = JSON.parse(sessionStorage.getItem('lendo_view') || 'null'); if (sv && sv.c && Date.now() - sv.t < 6 * 3600e3) RESTORED = sv; } } catch (e) {}
  var map = new mapboxgl.Map({ container: 'map', style: CFG.style, center: RESTORED ? RESTORED.c : CFG.center, zoom: RESTORED ? RESTORED.z : (CFG.zoom || 14.5), attributionControl: true, logoPosition: 'bottom-right', cooperativeGestures: false });
  try { navigator.sendBeacon && navigator.sendBeacon('/api/map-load', ''); } catch (e) {}   // §6 cost guard

  var items = [], sel = null, listMode = false, t, iconCache = {}, loading = {};
  // ================= Map drawing: ONE pass, one source of positions =================
  //   items → POS (co-located items fan out, ≤250 m) → SHOW / HIDE (declutter) → 'pins' + 'more' sources → ghosts, walkers
  // Recomputed only when the item set or the zoom band changes; panning changes nothing, so pins never jump or flicker.
  var GMARKS = {};                       // ghost markers by cell key (shared with walkers)
  var POS = {}, SHOW = [], HIDE = [], itemsRev = 0, layoutKey = '', OBST = [];
  var PIN_W = 76, PIN_H = 76, MAX_SHOWN = 140;
  function hid(s) { var h = 0; for (var k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) | 0; return Math.abs(h); }
  function worldPx(lng, lat, z) { var sc = 512 * Math.pow(2, z), sy = Math.sin(lat * Math.PI / 180); return [(lng + 180) / 360 * sc, (0.5 - Math.log((1 + sy) / (1 - sy)) / (4 * Math.PI)) * sc]; }
  // Small knots of nearby items (≤ 8 within a pin's width of each other, e.g. one owner's things) fan out in a ring
  // around their middle so each shows; bigger crowds stay put and the declutter picks which show.
  function computePos(z) {
    POS = {}; var cosLat = Math.cos(map.getCenter().lat * Math.PI / 180), mpp = 78271.5 * cosLat / Math.pow(2, z);
    var arr = items.filter(function (it) { return it.lat != null; }).sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    var LINK = PIN_W * 1.5, px = arr.map(function (it) { return worldPx(it.lng, it.lat, z); }), par = arr.map(function (_, i) { return i; }), grid = {};
    function find(i) { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; }
    px.forEach(function (p, i) {
      var gx = Math.floor(p[0] / LINK), gy = Math.floor(p[1] / LINK);
      for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) { var c = grid[(gx + dx) + ',' + (gy + dy)]; if (c) c.forEach(function (j) { if (Math.abs(px[j][0] - p[0]) < LINK && Math.abs(px[j][1] - p[1]) < LINK) par[find(i)] = find(j); }); }
      (grid[gx + ',' + gy] = grid[gx + ',' + gy] || []).push(i);
    });
    var groups = {}; arr.forEach(function (_, i) { var r = find(i); (groups[r] = groups[r] || []).push(i); });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k], n = g.length;
      if (n === 1 || n > 8) { g.forEach(function (i) { POS[arr[i].id] = [arr[i].lng, arr[i].lat]; }); return; }
      var clat = 0, clng = 0; g.forEach(function (i) { clat += arr[i].lat / n; clng += arr[i].lng / n; });
      var rpx = n === 2 ? 46 : Math.min(130, 48 / Math.sin(Math.PI / n)), rm = Math.min(rpx * mpp, 250), a0 = (hid(arr[g[0]].id) % 628) / 100;
      g.forEach(function (i, t) { var a = a0 + 6.2832 * t / n; POS[arr[i].id] = [clng + rm * Math.sin(a) / (111320 * cosLat), clat + rm * Math.cos(a) / 111320]; });
    });
  }
  // Which pins show when they'd overlap: variety first (one per category in turn), most-rented categories and items
  // lead; pins already showing keep their place so nothing swaps while you look at it.
  function pickShown(z, sticky) {
    var cats = {}, order = [];
    items.forEach(function (it) { if (!POS[it.id]) return; var c = aisleOf(it); if (!cats[c]) { cats[c] = { n: 0, list: [] }; order.push(c); } cats[c].n += it.rentals || 0; cats[c].list.push(it); });
    order.sort(function (a, b) { return cats[b].n - cats[a].n || (a < b ? -1 : 1); });
    order.forEach(function (c) { cats[c].list.sort(function (a, b) { return (b.rentals || 0) - (a.rentals || 0) || hid(a.id) - hid(b.id); }); });
    var queue = [], byId = {}; items.forEach(function (it) { byId[it.id] = it; });
    if (sel && byId[sel] && POS[sel]) queue.push(byId[sel]);
    sticky.forEach(function (id) { if (byId[id] && POS[id]) queue.push(byId[id]); });
    for (var r = 0, more = true; more; r++) { more = false; order.forEach(function (c) { var it = cats[c].list[r]; if (it) { queue.push(it); more = true; } }); }
    // pass 1 skips an item if the same kind of thing already shows nearby (variety of items, not just categories);
    // pass 2 fills whatever room is left
    var cell = {}, kinds = {}, seen = {}, later = [], NEAR = PIN_W * 4; SHOW = []; HIDE = [];
    function fits(p) {
      var gx = Math.floor(p[0] / PIN_W), gy = Math.floor(p[1] / PIN_H);
      for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) { var c2 = cell[(gx + dx) + ',' + (gy + dy)]; if (c2) for (var i = 0; i < c2.length; i++) if (Math.abs(c2[i][0] - p[0]) < PIN_W && Math.abs(c2[i][1] - p[1]) < PIN_H) return false; }
      return true;
    }
    function sameKindNear(it, p) { var k = kinds[it.name.toLowerCase()]; if (k) for (var i = 0; i < k.length; i++) if (Math.abs(k[i][0] - p[0]) < NEAR && Math.abs(k[i][1] - p[1]) < NEAR) return true; return false; }
    function take(it, p) { SHOW.push(it); var gx = Math.floor(p[0] / PIN_W), gy = Math.floor(p[1] / PIN_H); (cell[gx + ',' + gy] = cell[gx + ',' + gy] || []).push(p); var n = it.name.toLowerCase(); (kinds[n] = kinds[n] || []).push(p); }
    queue.forEach(function (it, qi) {
      if (seen[it.id]) return; seen[it.id] = 1;
      var p = worldPx(POS[it.id][0], POS[it.id][1], z), keep = it.id === sel || qi <= sticky.length;   // selected + already-showing pins skip the variety test
      if (SHOW.length >= MAX_SHOWN || !fits(p)) HIDE.push(it);
      else if (!keep && sameKindNear(it, p)) later.push([it, p]);
      else take(it, p);
    });
    later.forEach(function (x) { if (SHOW.length < MAX_SHOWN && fits(x[1])) take(x[0], x[1]); else HIDE.push(x[0]); });
  }
  function pinsGeo() {
    return { type: 'FeatureCollection', features: SHOW.map(function (it) {
      return { type: 'Feature', id: it.id, geometry: { type: 'Point', coordinates: POS[it.id] },
        properties: { id: it.id, sel: sel === it.id, rot: wiggleRot(it.id), name: it.name, price: fmt(it.price_cents), price_cents: it.price_cents, week_cents: it.week_cents || 0, photo: it.photo || '', avatar: it.avatar_key || '', emoji: it.emoji || '📦', hood: it.hood || '', icon: iconCache[it.id] ? 'l_' + it.id : 'pin-default' } };
    }) };
  }
  function moreGeo() { return { type: 'FeatureCollection', features: HIDE.map(function (it) { return { type: 'Feature', geometry: { type: 'Point', coordinates: POS[it.id] }, properties: {} }; }) }; }
  function drawPins() { var src = map.getSource('pins'); if (src) src.setData(pinsGeo()); }
  // screen points of everything walkers must stay off (pins + ghosts); rebuilt after each layout / map move
  function buildObst() {
    OBST = SHOW.map(function (it) { var q = map.project(POS[it.id]); return [q.x, q.y - 40, 52, 50]; });
    Object.keys(GMARKS).forEach(function (k) { var q = map.project(GMARKS[k].getLngLat()); OBST.push([q.x, q.y, 40, 36]); });
  }
  function refresh(force) {
    if (!map.getSource('pins')) return;
    var z = Math.round(map.getZoom() * 2) / 2, key = z + '|' + itemsRev + '|' + (sel || '');
    if (force || key !== layoutKey) {
      var sameBand = layoutKey.split('|')[0] === String(z), sticky = sameBand ? SHOW.map(function (it) { return it.id; }) : [];
      if (!sameBand || layoutKey.split('|')[1] !== String(itemsRev)) computePos(z);
      pickShown(z, sticky); layoutKey = key;
      var m = map.getSource('more'); if (m) m.setData(moreGeo());
      SHOW.forEach(ensureIcon);
    }
    drawPins(); if (window.__placeWanted) window.__placeWanted(); buildObst();
  }

  function wholeStars(avg) { var up = (avg - 1) / 4; return up >= .9 ? 5 : up >= .75 ? 4 : up >= .55 ? 3 : up >= .35 ? 2 : 1; }
  function fillCard(it) {
    $('shLink').href = '/i/' + it.id;
    var im = $('shImg'); im.src = it.avatar_key ? '/p/' + it.avatar_key : it.photo ? '/p/' + it.photo : ''; im.className = it.avatar_key ? 'cut' : 'photo';
    $('shPr').innerHTML = fmt(it.price_cents) + '<small>/day</small>';
    var own = (it.owner_name || 'Neighbor').split(' ')[0];
    $('shNm').innerHTML = ''; var o1 = document.createElement('span'); o1.style.fontWeight = '500'; o1.textContent = own + (/s$/i.test(own) ? '’ ' : '’s '); $('shNm').appendChild(o1); $('shNm').appendChild(document.createTextNode(it.name.charAt(0).toUpperCase() + it.name.slice(1))); // "Scott’s Projector": item names keep their capital
    $('shOwner').innerHTML = '<span class="av">' + esc(own.charAt(0)) + '</span>' + esc(own) + (it.owner_rating ? ' <span class="pill stars">' + '★★★★★'.slice(0, wholeStars(it.owner_rating)) + '</span>' : ' <span class="pill new">new</span>') + (it.rentals ? ' <span class="n">' + it.rentals + ' rental' + (it.rentals === 1 ? '' : 's') + '</span>' : '');
    $('shWhere').textContent = (it.hood || 'near you') + (it.owner_xs ? ' · ' + it.owner_xs : '');
  }
  $('shClose').addEventListener('click', function () { sel = null; refresh(); sheet.classList.remove('on'); });

  // ---- sticker icons: round photo + price tag, drawn on canvas, added on demand per visible listing ----
  var SZ = S.sticker.size, DPR = Math.min(2, window.devicePixelRatio || 1);
  // Prototype pin: the item icon (transparent sticker) with a white outline + soft glow, orange price tag below.
  // Listings without a transparent icon get the round photo sticker.
  // crop a cut-out to its visible pixels so every item fills the same box (cut-outs often carry big transparent margins)
  function trimAlpha(img) {
    try {
      var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, c = document.createElement('canvas'); c.width = w; c.height = h;
      var x = c.getContext('2d'); x.drawImage(img, 0, 0); var d = x.getImageData(0, 0, w, h).data, x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (var y = 0; y < h; y += 2) for (var i = 0; i < w; i += 2) if (d[(y * w + i) * 4 + 3] > 24) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0 || (x1 - x0 > w * 0.96 && y1 - y0 > h * 0.96)) return img;
      x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(w - 1, x1 + 2); y1 = Math.min(h - 1, y1 + 2);
      var o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1; o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height); return o;
    } catch (e) { return img; }
  }
  function drawSticker(it, img, transparent) {
    if (img && transparent) img = trimAlpha(img);
    var W = 104, H = SZ + 30, iconH = SZ + 6;
    var cv = document.createElement('canvas'); cv.width = W * DPR; cv.height = H * DPR;
    var g = cv.getContext('2d'); g.scale(DPR, DPR);
    var cx = W / 2, cy = iconH / 2 + 2;
    // glow
    var rg = g.createRadialGradient(cx, cy + 4, 4, cx, cy + 4, 36); rg.addColorStop(0, 'rgba(255,255,255,0.95)'); rg.addColorStop(0.55, 'rgba(255,255,255,0.55)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, W, iconH + 10);
    if (img && transparent) {
      var s0 = Math.min(iconH / img.width, iconH / img.height), iw = img.width * s0, ih = img.height * s0, ix = cx - iw / 2, iy = cy - ih / 2;
      // white outline: draw the icon offset in 8 directions, then the real one
      g.save(); g.globalCompositeOperation = 'source-over';
      var tmp = document.createElement('canvas'); tmp.width = Math.ceil(iw) + 8; tmp.height = Math.ceil(ih) + 8; var tg = tmp.getContext('2d');
      tg.drawImage(img, 4, 4, iw, ih); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = '#FFFFFF'; tg.fillRect(0, 0, tmp.width, tmp.height);
      [[2, 0], [-2, 0], [0, 2], [0, -2], [1.5, 1.5], [-1.5, 1.5], [1.5, -1.5], [-1.5, -1.5]].forEach(function (d) { g.drawImage(tmp, ix - 4 + d[0], iy - 4 + d[1]); });
      g.shadowColor = 'rgba(30,58,43,0.35)'; g.shadowBlur = 3; g.shadowOffsetY = 3; g.drawImage(tmp, ix - 4, iy - 4); g.shadowColor = 'transparent';
      g.drawImage(img, ix, iy, iw, ih); g.restore();
    } else {
      var r = SZ / 2;
      g.save(); g.shadowColor = 'rgba(30,58,43,0.35)'; g.shadowBlur = 6; g.shadowOffsetY = 3;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = '#FFFFFF'; g.fill(); g.restore();
      g.save(); g.beginPath(); g.arc(cx, cy, r - S.sticker.border, 0, Math.PI * 2); g.clip();
      if (img) { var s1 = Math.max((2 * r) / img.width, (2 * r) / img.height), w1 = img.width * s1, h1 = img.height * s1; g.drawImage(img, cx - w1 / 2, cy - h1 / 2, w1, h1); }
      else { g.fillStyle = '#F5F3EE'; g.fillRect(0, 0, W, H); g.font = (SZ * 0.55) + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(it.emoji || '📦', cx, cy + 2); }
      g.restore();
      g.beginPath(); g.arc(cx, cy, r - S.sticker.border / 2, 0, Math.PI * 2); g.lineWidth = 1.5; g.strokeStyle = S.sticker.tagInk; g.stroke();
    }
    // price tag
    var label = fmt(it.price_cents), sub = '/day';
    g.font = '800 17px "Helvetica Neue",Helvetica,Arial,sans-serif'; var lw = g.measureText(label).width;
    g.font = '700 10px "Helvetica Neue",Helvetica,Arial,sans-serif'; var sw = g.measureText(sub).width;
    var tw = lw + sw + 14, th = 24, tx = cx - tw / 2, ty = iconH - 14; // tag overlaps the bottom of the item
    g.save(); g.shadowColor = 'rgba(30,58,43,0.25)'; g.shadowBlur = 3; g.shadowOffsetY = 1;
    g.beginPath(); g.roundRect(tx, ty, tw, th, 6); g.fillStyle = S.sticker.tagBg; g.fill(); g.restore();
    g.beginPath(); g.roundRect(tx, ty, tw, th, 6); g.lineWidth = 1.5; g.strokeStyle = S.sticker.tagInk; g.stroke();
    g.fillStyle = S.sticker.tagText; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.font = '800 17px "Helvetica Neue",Helvetica,Arial,sans-serif'; g.fillText(label, tx + 7, ty + th / 2 + 0.5);
    g.font = '700 10px "Helvetica Neue",Helvetica,Arial,sans-serif'; g.fillText(sub, tx + 7 + lw, ty + th / 2 + 1.5);
    return g.getImageData(0, 0, W * DPR, H * DPR);
  }
  function addIcon(id, imgData) { if (!map.hasImage(id)) map.addImage(id, imgData, { pixelRatio: DPR }); }
  function ensureIcon(it) {
    if (iconCache[it.id] || loading[it.id]) return;
    loading[it.id] = true;
    var src = it.avatar_key ? '/p/' + it.avatar_key : it.photo ? '/p/' + it.photo : null;
    var done = function (img) { try { addIcon('l_' + it.id, drawSticker(it, img, !!it.avatar_key)); iconCache[it.id] = true; } catch (e) { console.warn('icon', e); } loading[it.id] = false; clearTimeout(iconT); iconT = setTimeout(drawPins, 80); };
    if (!src) return done(null);
    var img = new Image(); img.onload = function () { done(img); }; img.onerror = function () { done(null); }; img.src = src;
  }
  var iconT;

  map.on('load', function () {
    window.applyLendoStyle && window.applyLendoStyle(map);
    addIcon('pin-default', drawSticker({ price_cents: 0, emoji: '📦' }, null, false));
    map.addSource('more', { type: 'geojson', data: moreGeo() });
    map.addSource('pins', { type: 'geojson', data: pinsGeo(), promoteId: 'id' });
    // items that don't fit as a pin right now: small orange dots (tap to zoom in)
    map.addLayer({ id: 'more', type: 'circle', source: 'more', paint: { 'circle-color': S.cluster.fill, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 4.5], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.2, 'circle-opacity': 0.9 } });
    map.addLayer({ id: 'pins', type: 'symbol', source: 'pins',
      layout: { 'icon-image': ['get', 'icon'], 'icon-rotate': ['get', 'rot'], 'icon-size': ['case', ['get', 'sel'], 1.15, 1], 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['case', ['get', 'sel'], 1, 0] } });
    if (HOOD_LAYER) addHoods();
    load(); updateHood();
    if (WALKERS) startWalkers();
    startWiggle();
  });

  var known = {}, lastQ = '', loadSeq = 0;
  function load() {
    var b = map.getBounds(), qq = q.value.trim();
    var cc = map.getCenter(), seq = ++loadSeq;
    fetch('/api/listings?limit=300&near=' + cc.lng.toFixed(5) + ',' + cc.lat.toFixed(5) + '&bbox=' + [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',') + (qq ? '&q=' + encodeURIComponent(qq) : ''))
      .then(function (r) { return r.json(); }).then(function (j) { if (seq !== loadSeq) return;
        // keep what's already on screen: merge into a session cache, then show everything cached near the view
        if (qq !== lastQ) { known = {}; lastQ = qq; }
        j.listings.forEach(function (it) { known[it.id] = it; });
        var pb = map.getBounds(), w = pb.getEast() - pb.getWest(), h = pb.getNorth() - pb.getSouth();
        items = Object.keys(known).map(function (k) { return known[k]; }).filter(function (it) { return it.lng > pb.getWest() - w * .5 && it.lng < pb.getEast() + w * .5 && it.lat > pb.getSouth() - h * .5 && it.lat < pb.getNorth() + h * .5; })
          .sort(function (a, b2) { return Math.hypot(a.lat - cc.lat, (a.lng - cc.lng) * .76) - Math.hypot(b2.lat - cc.lat, (b2.lng - cc.lng) * .76); }).slice(0, 600);
        $('toggle').hidden = !items.length && !listMode && !qq; if (!items.length && listMode && !qq) setList(false); itemsRev++; refresh(); if (!listMode) renderGrid(items); setKpi(j); if (!items.length && !centered && !qq) goNearest(); if (qq) searchFeedback(qq, items.length); centered = true; });
  }
  // search with nothing in view: jump to the nearest match (once per search), else say so plainly
  var widened = '';
  function searchFeedback(qq, n) {
    if (n || widened === qq) return; widened = qq; var c = map.getCenter();
    fetch('/api/listings?limit=1&near=' + c.lng + ',' + c.lat + '&q=' + encodeURIComponent(qq)).then(function (r) { return r.json(); }).then(function (j) {
      if (q.value.trim() !== qq) return; var it = j.listings && j.listings[0];
      var km = it && it.lat != null ? Math.hypot(it.lat - c.lat, (it.lng - c.lng) * Math.cos(c.lat * Math.PI / 180)) * 111 : 1e9;
      if (km < 40) { map.easeTo({ center: [it.lng, it.lat], zoom: Math.max(Math.min(map.getZoom(), 15), 13.5), duration: 900 }); toast('Nearest ' + qq.toLowerCase() + ' · ' + (km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1) + ' km') + ' away'); }
      else { qNote = 'No ' + esc(qq.toLowerCase()) + ' for rent nearby yet'; alertChip(true); }
    }).catch(function () {});
  }
  // empty first view → center on the closest live item so the map never opens blank
  var centered = !!RESTORED;
  map.on('moveend', function () { try { var c = map.getCenter(); sessionStorage.setItem('lendo_view', JSON.stringify({ c: [c.lng, c.lat], z: map.getZoom(), t: Date.now() })); } catch (e) {} });
  function goNearest() {
    var c = map.getCenter();
    fetch('/api/listings?near=' + c.lng + ',' + c.lat + '&limit=1').then(function (r) { return r.json(); }).then(function (j) { var it = j.listings && j.listings[0]; if (it && it.lat != null) map.easeTo({ center: [it.lng, it.lat], zoom: Math.max(map.getZoom(), 14.5), duration: 900 }); }).catch(function () {});
  }
  map.on('zoomend', function () { refresh(); });
  var moveT; map.on('moveend', function () { clearTimeout(moveT); moveT = setTimeout(function () { load(); updateHood(); }, 300); });
  // scope pills: hood ▾ → places picker; city → that city's view; globe → everywhere
  var PL = null, plCity = 'nyc', curCity = null;
  function loadPlaces(cb) { if (PL) return cb(PL); fetch('/api/places').then(function (r) { return r.json(); }).then(function (j) { PL = j; cb(j); }).catch(function () {}); }
  function cityOf(lng, lat) { if (!PL) return null; for (var i = 0; i < PL.cities.length; i++) { var ct = PL.cities[i]; if (Math.abs(lng - ct.lng) < 0.45 && Math.abs(lat - ct.lat) < 0.3) return ct; } return null; }
  var plSort = 'az', plOwners = {};
  function renderPlaces() {
    var cs = $('plCities'), hs = $('plHoods'); cs.innerHTML = ''; hs.innerHTML = '';
    PL.cities.forEach(function (ct) {
      var b = document.createElement('button'); b.type = 'button'; b.className = (ct.id === plCity ? 'on ' : '') + (ct.live ? '' : 'soon');
      b.innerHTML = ct.name + ' <small>' + (ct.live ? ct.n.toLocaleString() : 'soon') + '</small>';
      b.addEventListener('click', function () { if (ct.id === plCity) { renderPlaces(); return; } plCity = ct.id; clearSearch(false); closePlaces(); var top = (ct.hoods || []).reduce(function (m, h) { return h.n > (m ? m.n : 0) ? h : m; }, null); /* land where the most things are, not the bare center */ map.easeTo({ center: top && top.n >= 3 ? [top.lng, top.lat] : [ct.lng, ct.lat], zoom: ct.live ? (top && top.n >= 3 ? 14.3 : 13.6) : ct.zoom, duration: 900 }); }); cs.appendChild(b);
    });
    var ct = PL.cities.filter(function (c) { return c.id === plCity; })[0]; if (!ct) return;
    $('plTitle').textContent = ct.name + (plSort === 'own' ? ' leaderboard · top owners' : plSort === 'rank' ? ' leaderboard · most things to rent' : ' neighborhoods');
    $('plSeg').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.s === plSort); });
    if (!ct.live) { var m = document.createElement('div'); m.className = 'soonmsg'; m.textContent = ct.name + ' isn’t open yet. List something there to start it.'; hs.appendChild(m); }
    if (plSort === 'own') {
      if (!plOwners[ct.id]) { var w = document.createElement('div'); w.className = 'soonmsg'; w.textContent = 'Loading…'; hs.appendChild(w); fetch('/api/places/owners?city=' + ct.id).then(function (r) { return r.json(); }).then(function (j) { plOwners[ct.id] = j.owners || []; if (plSort === 'own' && plCity === ct.id) renderPlaces(); }); return; }
      plOwners[ct.id].forEach(function (o, i) { var a = document.createElement('a'); a.className = 'own'; a.href = '/u/' + o.id; a.innerHTML = '<span class="av">' + (o.name || 'N').charAt(0) + '</span><span><b>' + (o.name || 'Neighbor') + '</b><small>' + (o.hood || '') + (o.rentals ? ' · ' + o.rentals + ' rentals' : '') + '</small></span><span class="n">' + o.n + ' things</span>'; hs.appendChild(a); });
      return;
    }
    var hoods = ct.hoods.slice();
    if (plSort === 'rank') hoods.sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); }); else hoods.sort(function (a, b) { return a.name.localeCompare(b.name); });
    var letter = '';
    hoods.forEach(function (h, i) {
      if (plSort === 'az') { var L = h.name.charAt(0).toUpperCase(); if (L !== letter) { letter = L; var d = document.createElement('div'); d.className = 'ltr'; d.textContent = L; hs.appendChild(d); } }
      var b = document.createElement('button'); b.type = 'button'; b.className = (h.n ? '' : 'zero') + (h.name === lastHood ? ' on' : '');
      b.innerHTML = '<span class="l">' + (plSort === 'rank' ? '<b class="rk' + (i < 3 ? ' top' : '') + '">' + (i + 1) + '</b>' : '') + '<b class="nm">' + h.name + '</b></span>' + (h.n ? '<small>' + h.n.toLocaleString() + '</small>' : '');
      b.addEventListener('click', function () { clearSearch(false); closePlaces(); if (ct.live && h.lat !== ct.lat) map.easeTo({ center: [h.lng, h.lat], zoom: 14.5 }); else map.easeTo({ center: [ct.lng, ct.lat], zoom: ct.zoom }); });
      hs.appendChild(b);
    });
  }
  $('plSeg').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; plSort = b.dataset.s; renderPlaces(); });
  $('plDim').addEventListener('click', function () { closePlaces(); });
  function openPlaces() { loadPlaces(function () { var c = map.getCenter(), ct = cityOf(c.lng, c.lat); if (ct) plCity = ct.id; renderPlaces(); $('places').hidden = false; $('plDim').hidden = false; }); }
  function closePlaces() { $('places').hidden = true; $('plDim').hidden = true; }
  $('scHood').addEventListener('click', openPlaces); $('plClose').addEventListener('click', closePlaces);
  $('scCity').addEventListener('click', function () { var ct = curCity || (PL && PL.cities[0]); if (ct) map.easeTo({ center: [ct.lng, ct.lat], zoom: ct.zoom }); else map.easeTo({ center: [-73.95, 40.73], zoom: 10.6 }); });
  loadPlaces(function () { updateCityPill(); }); map.on('moveend', updateCityPill);
  function updateCityPill() { if (!PL) return; var c = map.getCenter(), ct = cityOf(c.lng, c.lat); if (ct) { curCity = ct; $('scCity').querySelector('b').textContent = ct.short || ct.name; $('scCityC').textContent = ct.n.toLocaleString(); } }
  startWanted();
  $('wsClose').addEventListener('click', function () { $('wsheet').hidden = true; }); map.on('click', function () { $('wsheet').hidden = true; });

  $('scGlobe').addEventListener('click', function () { openPlaces(); });

  // selection + sheet
  map.on('click', 'pins', function (e) {
    var p = e.features[0].properties; var it = items.filter(function (x) { return x.id === p.id; })[0] || p;
    sel = p.id; refresh();
    fillCard(it); sheet.classList.add('on');
  });
  map.on('click', 'more', function (e) { map.easeTo({ center: e.lngLat, zoom: Math.min(17, map.getZoom() + 1.5), duration: 600 }); });
  map.on('click', function (e) { if (map.queryRenderedFeatures(e.point, { layers: ['pins', 'more'] }).length) return; if (sel) { sel = null; refresh(); } sheet.classList.remove('on'); });
  ['pins', 'more'].forEach(function (l) { map.on('mouseenter', l, function () { map.getCanvas().style.cursor = 'pointer'; }); map.on('mouseleave', l, function () { map.getCanvas().style.cursor = ''; }); });

  q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(load, 300); });
  // saved-search alert: on automatically after a search settles; visible Turn off
  var alertT, alertQ = '', alertId = null, qNote = '';
  // Search alert card under the search box: optional "No ladder for rent nearby yet" headline + a green pill
  // "🔔 Text alert when one's listed [switch]". On automatically (logged in); the whole pill toggles it.
  function alertCard(on, cb) {
    var chip = $('alertChip');
    chip.innerHTML = (qNote ? '<div class="ac-h">' + qNote + '</div>' : '') +
      '<button type="button" class="ac-pill' + (on ? ' on' : '') + '" role="switch" aria-checked="' + on + '"><span>🔔 Text alert when ' + (qNote ? 'one’s' : 'a new one’s') + ' listed</span><i class="ac-sw"><b></b></i></button>';
    chip.hidden = false; chip.querySelector('.ac-pill').onclick = cb;
  }
  function alertChip(now) {
    var qq = q.value.trim(), chip = $('alertChip'); clearTimeout(alertT); if (now !== true) qNote = '';
    if (qq.length < 3) { chip.hidden = true; return; }
    alertT = setTimeout(function () {
      if (qq === alertQ && !chip.hidden && now !== true) return; alertQ = qq;
      var cc = map.getCenter(), hood = ($('scHoodN') || {}).title || '';
      if (!CFG.user) { alertCard(false, function () { location.href = '/login?next=' + encodeURIComponent('/?q=' + qq); }); return; }
      function save() {
        return fetch('/api/alerts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: qq, lat: cc.lat, lng: cc.lng, hood: hood }) })
          .then(function (r) { return r.json(); }).then(function (j) { if (j.id) alertId = j.id; return !!j.id; }).catch(function () { return false; });
      }
      var on = true;
      function toggle() { on = !on; alertCard(on, toggle); if (on) save(); else if (alertId) fetch('/api/alerts/' + alertId + '/off', { method: 'POST' }); }
      // show it on right away; if saving fails, flip it off (tap retries)
      alertCard(true, toggle);
      save().then(function (ok) { if (!ok && q.value.trim() === qq) { on = false; alertCard(false, toggle); } });
    }, now === true ? 0 : 1500);
  }
  q.addEventListener('input', alertChip);
  // always-visible clear (iOS only shows its own while focused): clears the text and the results
  function syncClr() { $('qClr').hidden = !q.value; }
  q.addEventListener('input', syncClr);
  function clearSearch(reload) { var had = !!q.value; q.value = ''; syncClr(); $('toggle').hidden = false; $('alertChip').hidden = true; alertQ = ''; qNote = ''; clearTimeout(alertT); if (had && reload !== false) { load(); if (listMode) loadCityList(); } }
  $('qClr').addEventListener('click', function () { clearSearch(); q.blur(); });
  // switching city/hood or coming back to the page starts a fresh search
  window.addEventListener('pageshow', function (e) { if (e.persisted && q.value && !new URLSearchParams(location.search).get('q')) clearSearch(); });
  try { var q0 = new URLSearchParams(location.search).get('q') || CFG.q; if (!q0 && q.value) { q.value = ''; syncClr(); } if (q0) { q.value = q0.slice(0, 40); syncClr(); setTimeout(function () { load(); alertChip(); }, 400); } } catch (e) {}
  var LIST_IC = '<svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true"><path d="M1 1.5h1M4 1.5h9M1 6h1M4 6h9M1 10.5h1M4 10.5h9" stroke="#1E3A2B" stroke-width="2" stroke-linecap="round"/></svg> List',
      MAP_IC = '<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6L9 4L15 6L21 4V18L15 20L9 18L3 20Z M9 4V18 M15 6V20" fill="none" stroke="#1E3A2B" stroke-width="2.2" stroke-linejoin="round"/></svg> Map';
  // List view covers the whole city you're in (not just the map viewport)
  var cityItems = null;
  function loadCityList() {
    var cc = map.getCenter(), ct = PL && PL.cities.filter(function (c) { return Math.abs(cc.lng - c.lng) < 0.45 && Math.abs(cc.lat - c.lat) < 0.3; })[0];
    if (!ct) { renderGrid(items); return; }
    grid.innerHTML = '<div class="hint" style="padding:24px 16px">Loading ' + ct.name + '…</div>';
    var d = 0.35, qq = q.value.trim();
    fetch('/api/listings?limit=1500&near=' + ct.lng + ',' + ct.lat + '&bbox=' + [ct.lng - d * 1.3, ct.lat - d, ct.lng + d * 1.3, ct.lat + d].join(',') + (qq ? '&q=' + encodeURIComponent(qq) : ''))
      .then(function (r) { return r.json(); }).then(function (j) { cityItems = j.listings; j.listings.forEach(function (it) { known[it.id] = it; }); if (listMode) renderGrid(cityItems); })
      .catch(function () { renderGrid(items); });
  }
  function closeCards() { if (sel) { sel = null; refresh(); } sheet.classList.remove('on'); var ws = $('wsheet'); if (ws) ws.hidden = true; }
  // leaving the map (list view, another page, back/forward cache) never keeps a card open
  window.addEventListener('pagehide', closeCards); window.addEventListener('pageshow', function (e) { if (e.persisted) closeCards(); });
  function setList(on) { closeCards(); listMode = on; grid.style.display = on ? 'block' : 'none'; $('toggle').innerHTML = on ? MAP_IC : LIST_IC; document.querySelector('.mapwrap').classList.toggle('listing', on); if (on) loadCityList(); }
  $('toggle').addEventListener('click', function () { setList(!listMode); });
  // standard "my location": blue dot + accuracy halo, recenters on tap
  var meMk = null;
  function toast(msg) { var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.querySelector('.mapwrap').appendChild(t); setTimeout(function () { t.remove(); }, 6500); t.addEventListener('click', function () { t.remove(); }); }
  $('locate').addEventListener('click', function () {
    var btn = this; if (!navigator.geolocation) return; btn.classList.add('busy');
    navigator.geolocation.getCurrentPosition(function (p) {
      btn.classList.remove('busy'); btn.classList.add('on');
      var ll = [p.coords.longitude, p.coords.latitude];
      if (!meMk) { var el = document.createElement('div'); el.className = 'medot'; meMk = new mapboxgl.Marker({ element: el }).setLngLat(ll).addTo(map); } else meMk.setLngLat(ll);
      map.easeTo({ center: ll, zoom: Math.max(map.getZoom(), 15), duration: 800 });
    }, function (err) {
      btn.classList.remove('busy');
      // fall back to network location, and say why the precise one failed
      if (CFG.ipLoc) map.easeTo({ center: CFG.ipLoc, zoom: Math.max(map.getZoom(), 13), duration: 800 });
      toast(err && err.code === 1 ? 'Location is off for lendo.co. On iPhone: Settings › Privacy › Location Services › Safari Websites → While Using. Then tap again.' : 'Couldn’t get a GPS fix — showing roughly where you are.');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  });
  map.on('dragstart', function () { $('locate').classList.remove('on'); });
  // No home base: use device location only if it's inside a live city; otherwise stay in NYC and nudge the city switcher
  function inLiveCity(lng, lat) { return !PL || PL.cities.some(function (ct) { return ct.live && Math.abs(lng - ct.lng) < 0.45 && Math.abs(lat - ct.lat) < 0.3; }); }
  function nudgeCity() {
    var h = $('scHood'); h.classList.add('nudge');
    var tip = document.createElement('div'); tip.className = 'citytip'; tip.innerHTML = (CFG.visitorCity ? 'Not in ' + CFG.visitorCity + ' yet. ' : '') + 'You’re seeing <b>NYC</b> — tap to switch city'; document.querySelector('.mapwrap').appendChild(tip);
    var off = function () { h.classList.remove('nudge'); tip.remove(); h.removeEventListener('click', off); }; h.addEventListener('click', off); setTimeout(off, 9000);
  }
  if (CFG.away && !RESTORED) loadPlaces(nudgeCity);
  if (!RESTORED && !CFG.hasHome && !CFG.away) navigator.geolocation && navigator.geolocation.getCurrentPosition(function (p) { loadPlaces(function () { if (inLiveCity(p.coords.longitude, p.coords.latitude)) map.jumpTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 15 }); else nudgeCity(); }); }, function () {}, { timeout: 4000 });

  // ---- §4 neighborhoods: faint outlines, dim hoods with zero listings ----
  function addHoods() {
    map.addSource('hoods', { type: 'geojson', data: '/api/hoods.geojson' });
    map.addLayer({ id: 'hoods-fill', type: 'fill', source: 'hoods', minzoom: 10, maxzoom: 15,
      paint: { 'fill-color': ['case', ['==', ['get', 'n'], 0], S.hoods.emptyColor, S.hoods.fill], 'fill-opacity': ['case', ['==', ['get', 'n'], 0], S.hoods.emptyFillOpacity, S.hoods.fillOpacity] } }, 'more');
    map.addLayer({ id: 'hoods-line', type: 'line', source: 'hoods', minzoom: 10, paint: { 'line-color': S.hoods.line, 'line-opacity': S.hoods.lineOpacity, 'line-width': 1, 'line-dasharray': [2, 2] } }, 'more');
  }

  // ---- idle wiggle (prototype 'sway'): each item rocks ±1.6° on its own phase; paused while the map moves or the tab is hidden
  var wigT0 = performance.now(), wigPhase = {};
  function wiggleRot(id) { if (!(id in wigPhase)) wigPhase[id] = [Math.random() * 6.283, 2.2 + Math.floor(Math.random() * 4) * 0.45]; var w = wigPhase[id], t = (performance.now() - wigT0) / 1000; return Math.sin(t * 6.283 / w[1] + w[0]) * 3.5; }
  function startWiggle() {
    var busy = false; map.on('movestart', function () { busy = true; }); map.on('moveend', function () { busy = false; });
    setInterval(function () { if (busy || document.hidden || !SHOW.length) return; drawPins(); }, 90);
  }

  // desktop: poster sits beside the tapped marker (right side, or left if no room), clamped to the map; phones keep bottom-center
  function placePoster(ws, el) {
    ws.style.left = ws.style.top = ws.style.bottom = ws.style.marginLeft = '';
    if (window.innerWidth < 760) return;
    var box = ws.offsetParent ? ws.offsetParent.getBoundingClientRect() : document.body.getBoundingClientRect(), m = el.getBoundingClientRect();
    var w = ws.offsetWidth, h = ws.offsetHeight, gap = 18;
    var x = m.right - box.left + gap; if (x + w > box.width - 12) x = m.left - box.left - gap - w;
    var y = m.top - box.top + m.height / 2 - h / 2;
    x = Math.max(12, Math.min(box.width - w - 12, x)); y = Math.max(70, Math.min(box.height - h - 12, y));
    ws.style.left = x + 'px'; ws.style.top = y + 'px'; ws.style.bottom = 'auto'; ws.style.marginLeft = '0';
  }
  map.on('movestart', function (e) { if (e.originalEvent && window.innerWidth >= 760) $('wsheet').hidden = true; });
  // ---- WANTED posters (prototype ghosts): deterministic per grid cell so they stay put while panning; never on a pin
  // Ghost sizing rubric: crop to the object, scale to equal visible ink area (34px²-equivalent), nudge by class,
  // clamp the long side (38–62px; long thin gear up to 74px). Computed once per icon, cached for the session.
  var FIT = {}, DOWN = /^(truck|car|van|moped|sailboat|guitar|violin|banjo|sax|trumpet|accordion)$/, UP = /^(skis|snowboard|hockey|lacrosse|fishing|crutch|bow|ladder|cricket)$/;
  function fitIcon(w, img) {
    var done = function (f) { img.src = f.url; img.style.width = f.w + 'px'; img.style.height = f.h + 'px'; };
    if (FIT[w.key] && FIT[w.key].url) return done(FIT[w.key]);
    (FIT[w.key] = FIT[w.key] || { q: [] }).q.push(done); if (FIT[w.key].q.length > 1) return;
    var im = new Image(); im.onload = function () {
      var f; try {
        var c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; var g = c.getContext('2d'); g.drawImage(im, 0, 0);
        var d = g.getImageData(0, 0, c.width, c.height).data, x0 = c.width, y0 = c.height, x1 = -1, y1 = -1, ink = 0;
        for (var y = 0; y < c.height; y++) for (var x = 0; x < c.width; x++) { var a = d[(y * c.width + x) * 4 + 3]; if (a > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } if (a > 20) ink++; }
        var bw = x1 - x0 + 1, bh = y1 - y0 + 1, o = document.createElement('canvas'); o.width = bw; o.height = bh; o.getContext('2d').drawImage(c, x0, y0, bw, bh, 0, 0, bw, bh);
        var s = Math.sqrt(25 * 25 / Math.max(ink, 1)) * (DOWN.test(w.key) ? 0.9 : UP.test(w.key) ? 1.12 : 1), hi = UP.test(w.key) ? 54 : 46, L = Math.max(bw, bh) * s;
        if (L > hi) s *= hi / L; if (Math.max(bw, bh) * s < 28) s = 28 / Math.max(bw, bh);
        f = { url: o.toDataURL(), w: Math.round(bw * s), h: Math.round(bh * s) };
      } catch (e) { f = { url: w.icon, w: 44, h: 44 }; }
      var q = FIT[w.key].q; FIT[w.key] = f; q.forEach(function (cb) { cb(f); });
    };
    im.onerror = function () { var q = FIT[w.key].q; FIT[w.key] = { url: w.icon, w: 44, h: 44 }; q.forEach(function (cb) { cb(FIT[w.key]); }); };
    im.src = w.icon;
  }
  function ghostScale() { var z = map.getZoom(); map.getContainer().style.setProperty('--gs', z < 12.5 ? 0.65 : z < 13.5 ? 0.81 : z < 14.5 ? 0.96 : 1.12); } // +12%
  map.on('zoom', ghostScale); map.on('load', ghostScale);
  function startWanted() {
    var marks = GMARKS, PROMO = !!CFG.wantedPromo, MOD = PROMO ? 5 : 1, MAX = PROMO ? 9 : 120;
    // cell size scales with zoom (≈ 80px on screen) so density looks the same at any zoom; quantized per zoom band so
    // ghosts hold still while panning
    function cellDeg() { var zb = Math.round(map.getZoom()); return (PROMO ? 0.0045 : 0.0030) * Math.pow(2, 14.5 - zb); }
    function h32(a, b) { var h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; }
    var ipts = [];   // screen points of every real item, projected once per placement
    function near(lng, lat, px) { var p = map.project([lng, lat]); for (var i = 0; i < ipts.length; i++) if (Math.abs(ipts[i].x - p.x) < px && Math.abs(ipts[i].y - 30 - p.y) < px) return true; return false; }
    var waterLayers = null;
    function onWater(lng, lat) {
      if (waterLayers === null) waterLayers = (map.getStyle().layers || []).map(function (l) { return l.id; }).filter(function (id) { return /^water(-|$)|^waterway/.test(id); });
      if (!waterLayers.length) return false;
      try { var p = map.project([lng, lat]); return map.queryRenderedFeatures([[p.x - 14, p.y - 14], [p.x + 14, p.y + 14]], { layers: waterLayers }).length > 0; } catch (e) { return false; }
    }
    function place() {
      var z = map.getZoom(), want = ((PL && PL.wanted) || []).filter(function (w) { return w.icon; }); // only drawn, vision-checked icons — no emoji stand-ins
      ipts = items.filter(function (it) { return POS[it.id]; }).map(function (it) { return map.project(POS[it.id]); });
      var keep = {}, chosen = {}, CELL = cellDeg(), zb = Math.round(z);
      Object.keys(marks).forEach(function (k) { if (k.indexOf(zb + ':') === 0) chosen[k.slice(k.indexOf(':') + 1)] = marks[k]._wkey; });
      if (z >= (PROMO ? 13.2 : 11.5) && want.length) {
        var b = map.getBounds(), x0 = Math.floor(b.getWest() / CELL), x1 = Math.ceil(b.getEast() / CELL), y0 = Math.floor(b.getSouth() / CELL), y1 = Math.ceil(b.getNorth() / CELL), n = 0;
        for (var x = x0; x <= x1 && n < MAX; x++) for (var y = y0; y <= y1 && n < MAX; y++) {
          var h = h32(x, y); if (h % MOD !== 0) continue;
          var lng = (x + 0.15 + (h >>> 8 & 255) / 365) * CELL, lat = (y + 0.15 + (h >>> 16 & 255) / 365) * CELL;
          if (near(lng, lat, 100)) continue; // ghosts may sit ~100px from real items
          if (onWater(lng, lat)) continue;
          var k = zb + ':' + x + ',' + y; keep[k] = 1; n++;
          if (marks[k]) { chosen[x + ',' + y] = marks[k]._wkey; continue; }
          // pick a kind no neighbor (within 2 cells) already shows, so the same item doesn't repeat in one area
          var wi = h % want.length, w = null;
          for (var tries = 0; tries < want.length; tries++) { var cand = want[(wi + tries) % want.length], clash = false;
            for (var dx = -2; dx <= 2 && !clash; dx++) for (var dy = -2; dy <= 2; dy++) { if (chosen[(x + dx) + ',' + (y + dy)] === cand.key) { clash = true; break; } }
            if (!clash) { w = cand; break; } }
          if (!w) w = want[wi]; chosen[x + ',' + y] = w.key;
          var el = document.createElement('a'); el.href = '/list?want=' + encodeURIComponent(w.label);
          (function (w, el) { el.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); if (w.icon) { $('wsEm').innerHTML = '<img alt="" class="wsimg">'; var pim = $('wsEm').firstChild; fitIcon(w, pim); var fit = function () { var r = Math.min(120 / (parseFloat(pim.style.width) || 1), 104 / (parseFloat(pim.style.height) || 1)); pim.style.width = Math.round(parseFloat(pim.style.width) * r) + 'px'; pim.style.height = Math.round(parseFloat(pim.style.height) * r) + 'px'; }; if (pim.style.width) fit(); else pim.addEventListener('load', fit, { once: true }); } else $('wsEm').textContent = w.emoji; $('wsName').textContent = w.label; $('wsGo').href = el.href; var ws = $('wsheet'); ws.hidden = false; placePoster(ws, el); }); })(w, el);
          if (PROMO) { el.className = 'wanted'; el.setAttribute('aria-label', 'Wanted: ' + w.label + '. Reward for listing.'); el.innerHTML = '<b>WANTED</b><i>' + w.emoji + '</i><em>' + w.label + '</em><strong>REWARD</strong><small>for listing</small>'; }
          else { el.className = 'ghost' + (w.icon ? ' img' : ''); el.title = 'Wanted: ' + w.label; el.setAttribute('aria-label', 'Wanted: ' + w.label); if (w.icon) { el.innerHTML = '<img alt="" draggable="false">'; fitIcon(w, el.firstChild); } else el.textContent = w.emoji; el.style.setProperty('--r', ((h >>> 4) % 17 - 8) + 'deg'); el.style.fontSize = '44px'; }
          marks[k] = new mapboxgl.Marker({ element: el, anchor: 'center', className: 'wanted-m', rotationAlignment: 'viewport' }).setLngLat([lng, lat]).addTo(map); marks[k]._wkey = w.key;
        }
      }
      Object.keys(marks).forEach(function (k) { if (!keep[k]) { marks[k].remove(); delete marks[k]; } });
    }
    window.__placeWanted = place; map.on('moveend', function () { place(); buildObst(); }); loadPlaces(function () { if (map.getSource('pins')) { place(); buildObst(); } });
  }

  // ---- §2 walkers (prototype details): tiny 12×19 figures, singles/pairs/trios walking out along a short straight
  // path and back (facing flips at the turn), each with its own bob/leg phase; palette from the prototype.
  function startWalkers() {
    var SHIRT = ['#E8745A', '#4F8BDA', '#4FB384', '#EC6FA2', '#F2C14E', '#7A6FD6'], SKIN = ['#F1CBA8', '#D9A77E', '#E8B894', '#B98460', '#8D5524'], HAIR = ['#3A2A1E', '#1E1A17', '#7A4B2A', '#9C9791', '#C8A24A'], LEG = ['#3E4A5C', '#5B4A3E', '#2F3A33'];
    var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };
    function person(dx, dur, delay) {
      var d = dur.toFixed(2) + 's', dl = delay.toFixed(2) + 's', leg = pick(LEG);
      return '<g transform="translate(' + dx + ' 0)"><g style="animation:wbob ' + d + ' ease-in-out ' + dl + ' infinite">' +
        '<line x1="5" y1="12" x2="5" y2="17" stroke="' + leg + '" stroke-width="1.7" stroke-linecap="round" style="transform-origin:5px 12px;animation:legA ' + d + ' ease-in-out ' + dl + ' infinite"/>' +
        '<line x1="7" y1="12" x2="7" y2="17" stroke="' + leg + '" stroke-width="1.7" stroke-linecap="round" style="transform-origin:7px 12px;animation:legB ' + d + ' ease-in-out ' + dl + ' infinite"/>' +
        '<rect x="3.5" y="6.5" width="5" height="6" rx="2.2" fill="' + pick(SHIRT) + '" stroke="#4A463F" stroke-width="0.6"/>' +
        '<circle cx="6" cy="3.8" r="2.6" fill="' + pick(SKIN) + '" stroke="#4A463F" stroke-width="0.6"/>' +
        '<path d="M3.4 3.4Q3.8 0.9 6 1Q8.2 0.9 8.6 3.4Q7.4 2.3 6 2.4Q4.6 2.3 3.4 3.4Z" fill="' + pick(HAIR) + '"/>' +
        '<circle cx="7.3" cy="4" r="0.45" fill="#1E3A2B"/></g></g>';
    }
    function nearPin(lng, lat, pad) {
      var p = map.project([lng, lat]);
      for (var i = 0; i < OBST.length; i++) { var o = OBST[i]; if (Math.abs(o[0] - p.x) < o[2] + pad && Math.abs(o[1] - p.y) < o[3] + pad) return true; }
      return false;
    }
    // never on water (rivers, harbor, pools): check the rendered map at that spot
    function onWater(lng, lat) {
      try { var q = map.project([lng, lat]); return map.queryRenderedFeatures([q.x, q.y]).some(function (f) { var sl = f.sourceLayer || '', id = (f.layer && f.layer.id) || ''; return sl === 'water' || sl === 'waterway' || /water/.test(id); }); } catch (e) { return false; }
    }
    var walkers = [], moving = false, hidden = document.hidden;
    map.on('movestart', function () { moving = true; }); map.on('moveend', function () { moving = false; });
    document.addEventListener('visibilitychange', function () { hidden = document.hidden; });
    function spawn() {
      // anywhere in the visible map (not tied to items), away from pins
      var b = map.getBounds(), w = b.getEast() - b.getWest(), h = b.getNorth() - b.getSouth();
      var base = { lng: b.getWest() + w * (0.05 + Math.random() * 0.9), lat: b.getSouth() + h * (0.05 + Math.random() * 0.9) };
      if (nearPin(base.lng, base.lat, 30)) return;
      var n = Math.random() < 0.55 ? 1 : Math.random() < 0.75 ? 2 : 3, wpx = 12 + (n - 1) * 9;
      var el = document.createElement('div'); el.className = 'walker'; el.style.width = wpx + 'px';
      var inner = '';
      for (var k = 0; k < n; k++) inner += person(k * 9, 0.7 + Math.random() * 0.2, -Math.random());
      el.innerHTML = '<div class="wf"><svg width="' + wpx + '" height="19" viewBox="0 0 ' + wpx + ' 19" style="overflow:visible">' + inner + '</svg></div>';
      // straight path, mostly along the street grid (Manhattan ≈ 29° off north)
      var ang = (Math.random() < 0.5 ? 29 : 119) * Math.PI / 180 + (Math.random() - 0.5) * 0.2, len = 0.0008 + Math.random() * 0.0012;
      var a = [base.lng, base.lat], bb = [a[0] + Math.sin(ang) * len, a[1] + Math.cos(ang) * len * 0.76];
      var b2 = bb; a = a; var bnd = b2;
      if (onWater(a[0], a[1]) || onWater(bnd[0], bnd[1]) || onWater((a[0] + bnd[0]) / 2, (a[1] + bnd[1]) / 2)) return;
      var wlk = { el: el, face: el.firstChild, a: a, b: bnd, t: Math.random(), dir: 1, speed: 0.000045 + Math.random() * 0.00002, m: new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat(a).addTo(map), born: Date.now(), life: 40000 + Math.random() * 50000 };
      wlk.face.style.transform = 'scaleX(' + (bnd[0] >= a[0] ? 1 : -1) + ')';
      walkers.push(wlk);
    }
    var last = performance.now();
    function tick(now) {
      var dt = Math.min(50, now - last); last = now;
      if (!hidden && !moving) {
        var z = map.getZoom(), hide = z < 13.5;
        map.getContainer().classList.toggle('walkers-hidden', hide);
        if (!hide) walkers.forEach(function (w) {
          var L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1e-9;
          w.t += w.dir * (w.speed * dt / 1000) / L;
          if (w.t >= 1) { w.t = 1; w.dir = -1; w.face.style.transform = 'scaleX(' + (w.b[0] >= w.a[0] ? -1 : 1) + ')'; }
          if (w.t <= 0) { w.t = 0; w.dir = 1; w.face.style.transform = 'scaleX(' + (w.b[0] >= w.a[0] ? 1 : -1) + ')'; }
          var cur = [w.a[0] + (w.b[0] - w.a[0]) * w.t, w.a[1] + (w.b[1] - w.a[1]) * w.t];
          w.m.setLngLat(cur);
          w.el.style.opacity = nearPin(cur[0], cur[1], 0) ? '0' : '';
          if (Date.now() - w.born > w.life) w.done = true;
        });
        walkers = walkers.filter(function (w) { if (w.done) w.m.remove(); return !w.done; });
        var want = Math.min(MAX_WALKERS, 6 + Math.round(SHOW.length * 0.5));
        if (walkers.length < want && Math.random() < 0.1) spawn();
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
})();
