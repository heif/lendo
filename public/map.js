// Lendo map — Mapbox GL JS v3. One map instance per page load (each init is a billed map load).
// Config comes from window.LENDO_MAP = { token, style, center:[lng,lat], zoom, hasHome }.
(function () {
  var CFG = window.LENDO_MAP || {};
  var S = window.LENDO_MAP_STYLE;
  var WALKERS = true;          // §2 animated walkers (toggle)
  var MAX_WALKERS = 20;
  var HOOD_LAYER = false;      // §4 faint neighborhood outlines (enabled when hoods are seeded)

  var $ = function (id) { return document.getElementById(id); };
  var grid = $('grid'), sheet = $('sheet'), q = $('q');
  function fmt(c) { var d = c / 100; return '$' + (Number.isInteger(d) ? d : d.toFixed(2)); }
  function esc(s) { return String(s).replace(/[<>&"]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]; }); }

  function renderGrid(items) {
    grid.innerHTML = items.map(function (it) {
      return '<a class="itemcard" href="/i/' + it.id + '">' + (it.photo ? '<img src="/p/' + it.photo + '" alt="">' : '<div class="ph">no photo</div>') +
        '<div class="b"><div class="pr">' + fmt(it.price_cents) + '<span style="font-size:11px;font-weight:700">/day</span></div><div class="nm">' + esc(it.name) + '</div></div></a>';
    }).join('') || '<div style="padding:24px;grid-column:1/-1" class="hint">Nothing here yet. Be the first — list something.</div>';
  }
  function setKpi(j) { $('kpiN').textContent = j.counts.view; $('kpiL').textContent = (j.counts.view === 1 ? 'thing' : 'things') + ' to rent here · ' + j.counts.global + ' total'; }

  mapboxgl.accessToken = CFG.token;
  var map = new mapboxgl.Map({ container: 'map', style: CFG.style, center: CFG.center, zoom: CFG.zoom || 14.5, attributionControl: true, logoPosition: 'bottom-right', cooperativeGestures: false });
  try { navigator.sendBeacon && navigator.sendBeacon('/api/map-load', ''); } catch (e) {}   // §6 cost guard

  var items = [], sel = null, listMode = false, t, iconCache = {}, loading = {};
  var toGeo = function (arr) {
    return { type: 'FeatureCollection', features: arr.filter(function (it) { return it.lat != null; }).map(function (it) {
      return { type: 'Feature', id: it.id, geometry: { type: 'Point', coordinates: [it.lng, it.lat] },
        properties: { id: it.id, name: it.name, price: fmt(it.price_cents), price_cents: it.price_cents, week_cents: it.week_cents || 0, photo: it.photo || '', avatar: it.avatar_key || '', emoji: it.emoji || '📦', hood: it.hood || '', icon: iconCache[it.id] ? 'l_' + it.id : 'pin-default' } };
    }) };
  };

  // ---- sticker icons: round photo + price tag, drawn on canvas, added on demand per visible listing ----
  var SZ = S.sticker.size, DPR = Math.min(2, window.devicePixelRatio || 1);
  function drawSticker(it, img) {
    var W = SZ + 8, H = SZ + 26; // room for tag below
    var cv = document.createElement('canvas'); cv.width = W * DPR; cv.height = H * DPR;
    var g = cv.getContext('2d'); g.scale(DPR, DPR);
    var cx = W / 2, cy = SZ / 2 + 2, r = SZ / 2;
    // shadow + white ring
    g.save(); g.shadowColor = 'rgba(30,58,43,0.35)'; g.shadowBlur = 6; g.shadowOffsetY = 3;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = '#FFFFFF'; g.fill(); g.restore();
    // image (or emoji) clipped to circle
    g.save(); g.beginPath(); g.arc(cx, cy, r - S.sticker.border, 0, Math.PI * 2); g.clip();
    if (img) {
      var s = Math.max((2 * r) / img.width, (2 * r) / img.height), iw = img.width * s, ih = img.height * s;
      g.drawImage(img, cx - iw / 2, cy - ih / 2, iw, ih);
    } else {
      g.fillStyle = '#F5F3EE'; g.fillRect(0, 0, W, H);
      g.font = (SZ * 0.55) + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(it.emoji || '📦', cx, cy + 2);
    }
    g.restore();
    g.beginPath(); g.arc(cx, cy, r - S.sticker.border / 2, 0, Math.PI * 2); g.lineWidth = 1.5; g.strokeStyle = S.sticker.tagInk; g.stroke();
    // price tag
    var label = fmt(it.price_cents), sub = '/day';
    g.font = '700 12.5px "Helvetica Neue",Helvetica,Arial,sans-serif'; var lw = g.measureText(label).width;
    g.font = '700 8.5px "Helvetica Neue",Helvetica,Arial,sans-serif'; var sw = g.measureText(sub).width;
    var tw = lw + sw + 12, th = 18, tx = cx - tw / 2, ty = SZ - 2;
    g.beginPath(); g.roundRect(tx, ty, tw, th, 5); g.fillStyle = S.sticker.tagBg; g.fill(); g.lineWidth = 1.5; g.strokeStyle = S.sticker.tagInk; g.stroke();
    g.fillStyle = S.sticker.tagText; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.font = '700 12.5px "Helvetica Neue",Helvetica,Arial,sans-serif'; g.fillText(label, tx + 6, ty + th / 2 + 0.5);
    g.font = '700 8.5px "Helvetica Neue",Helvetica,Arial,sans-serif'; g.fillText(sub, tx + 6 + lw, ty + th / 2 + 1);
    return g.getImageData(0, 0, W * DPR, H * DPR);
  }
  function addIcon(id, imgData) { if (!map.hasImage(id)) map.addImage(id, imgData, { pixelRatio: DPR }); }
  function ensureIcon(it) {
    if (iconCache[it.id] || loading[it.id]) return;
    loading[it.id] = true;
    var src = it.avatar_key ? '/p/' + it.avatar_key : it.photo ? '/p/' + it.photo : null;
    var done = function (img) { try { addIcon('l_' + it.id, drawSticker(it, img)); iconCache[it.id] = true; } catch (e) { console.warn('icon', e); } loading[it.id] = false; refreshSource(); };
    if (!src) return done(null);
    var img = new Image(); img.onload = function () { done(img); }; img.onerror = function () { done(null); }; img.src = src;
  }
  function loadVisibleIcons() {
    var b = map.getBounds();
    items.forEach(function (it) { if (it.lat != null && b.contains([it.lng, it.lat])) ensureIcon(it); });
  }
  var rsT; function refreshSource() { clearTimeout(rsT); rsT = setTimeout(function () { var src = map.getSource('listings'); if (src) src.setData(toGeo(items)); }, 60); }

  map.on('load', function () {
    window.applyLendoStyle && window.applyLendoStyle(map);
    addIcon('pin-default', drawSticker({ price_cents: 0, emoji: '📦' }, null));
    map.addSource('listings', { type: 'geojson', data: toGeo([]), cluster: true, clusterRadius: 44, clusterMaxZoom: 16, promoteId: 'id' });
    map.addLayer({ id: 'clusters', type: 'circle', source: 'listings', filter: ['has', 'point_count'],
      paint: { 'circle-color': S.cluster.fill, 'circle-stroke-color': S.cluster.stroke, 'circle-stroke-width': 2.5, 'circle-radius': ['step', ['get', 'point_count'], 18, 10, 24, 50, 30] } });
    map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'listings', filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 14, 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'] }, paint: { 'text-color': S.cluster.text } });
    map.addLayer({ id: 'pins', type: 'symbol', source: 'listings', filter: ['!', ['has', 'point_count']],
      layout: { 'icon-image': ['get', 'icon'], 'icon-size': 1, 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['case', ['boolean', ['feature-state', 'sel'], false], 0, 1] },
      paint: { 'icon-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 1, 0.96] } });
    if (HOOD_LAYER) addHoods();
    load();
    if (WALKERS) startWalkers();
  });

  function load() {
    var b = map.getBounds(), qq = q.value.trim();
    fetch('/api/listings?bbox=' + [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',') + (qq ? '&q=' + encodeURIComponent(qq) : ''))
      .then(function (r) { return r.json(); }).then(function (j) { items = j.listings; refreshSource(); renderGrid(items); setKpi(j); loadVisibleIcons(); });
  }
  var moveT; map.on('moveend', function () { clearTimeout(moveT); moveT = setTimeout(load, 300); });

  // selection + sheet
  map.on('click', 'pins', function (e) {
    var f = e.features[0], p = f.properties; var it = items.filter(function (x) { return x.id === p.id; })[0] || p;
    if (sel) map.setFeatureState({ source: 'listings', id: sel }, { sel: false });
    sel = p.id; map.setFeatureState({ source: 'listings', id: sel }, { sel: true });
    sheet.href = '/i/' + p.id; $('shImg').src = it.photo ? '/p/' + it.photo : ''; $('shPr').textContent = fmt(it.price_cents) + '/day'; $('shNm').textContent = it.name;
    $('shSub').textContent = (it.hood || '') + (it.week_cents ? ' · ' + fmt(it.week_cents) + '/week' : ''); sheet.classList.add('on');
  });
  map.on('click', 'clusters', function (e) {
    var f = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0];
    map.getSource('listings').getClusterExpansionZoom(f.properties.cluster_id, function (err, z) { if (!err) map.easeTo({ center: f.geometry.coordinates, zoom: z + 0.5 }); });
  });
  map.on('click', function (e) { if (map.queryRenderedFeatures(e.point, { layers: ['pins', 'clusters'] }).length) return; if (sel) map.setFeatureState({ source: 'listings', id: sel }, { sel: false }); sel = null; sheet.classList.remove('on'); });
  ['pins', 'clusters'].forEach(function (l) { map.on('mouseenter', l, function () { map.getCanvas().style.cursor = 'pointer'; }); map.on('mouseleave', l, function () { map.getCanvas().style.cursor = ''; }); });

  q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(load, 300); });
  $('toggle').addEventListener('click', function () { listMode = !listMode; grid.style.display = listMode ? 'grid' : 'none'; this.textContent = listMode ? 'Map' : 'List'; });
  $('locate').addEventListener('click', function () { navigator.geolocation && navigator.geolocation.getCurrentPosition(function (p) { map.easeTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 15 }); }); });
  if (!CFG.hasHome) navigator.geolocation && navigator.geolocation.getCurrentPosition(function (p) { map.jumpTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 15 }); }, function () {}, { timeout: 4000 });

  // ---- §4 neighborhoods: faint outlines, dim hoods with zero listings ----
  function addHoods() {
    map.addSource('hoods', { type: 'geojson', data: '/api/hoods.geojson' });
    map.addLayer({ id: 'hoods-fill', type: 'fill', source: 'hoods', minzoom: 10, maxzoom: 15,
      paint: { 'fill-color': ['case', ['==', ['get', 'n'], 0], S.hoods.emptyColor, S.hoods.fill], 'fill-opacity': ['case', ['==', ['get', 'n'], 0], S.hoods.emptyFillOpacity, S.hoods.fillOpacity] } }, 'clusters');
    map.addLayer({ id: 'hoods-line', type: 'line', source: 'hoods', minzoom: 10, paint: { 'line-color': S.hoods.line, 'line-opacity': S.hoods.lineOpacity, 'line-width': 1, 'line-dasharray': [2, 2] } }, 'clusters');
  }

  // ---- §2 walkers: a few DOM markers strolling short random paths near listings; paused while moving the map ----
  function startWalkers() {
    var walkers = [], moving = false, hidden = document.hidden;
    map.on('movestart', function () { moving = true; }); map.on('moveend', function () { moving = false; });
    document.addEventListener('visibilitychange', function () { hidden = document.hidden; });
    function spawn() {
      var pts = items.filter(function (i) { return i.lat != null; }); if (!pts.length) return;
      var base = pts[Math.floor(Math.random() * pts.length)];
      var el = document.createElement('div'); el.className = 'walker'; el.innerHTML = '<span>🚶</span>';
      var ang = Math.random() * Math.PI * 2, dist = 0.0012 + Math.random() * 0.002; // ~150–350 m
      var a = [base.lng + Math.cos(ang) * dist, base.lat + Math.sin(ang) * dist * 0.75], b = [base.lng, base.lat];
      if (Math.random() < 0.5) { var tmp = a; a = b; b = tmp; }
      // street-ish: go along lng first, then lat (an L), each leg at walking pace
      var mid = [b[0], a[1]];
      var w = { el: el, m: new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat(a).addTo(map), legs: [[a, mid], [mid, b]], leg: 0, t: 0, speed: 0.00022 + Math.random() * 0.0001 };
      el.style.transform += ' scaleX(' + (b[0] < a[0] ? -1 : 1) + ')';
      walkers.push(w);
    }
    function tick() {
      if (!hidden && !moving) {
        var z = map.getZoom();
        walkers.forEach(function (w) {
          var L = w.legs[w.leg], d = Math.hypot(L[1][0] - L[0][0], L[1][1] - L[0][1]) || 1e-9;
          w.t += (w.speed / 60) / d * Math.max(0.6, Math.min(1.6, (z - 12) / 2));
          if (w.t >= 1) { w.t = 0; w.leg++; if (w.leg >= w.legs.length) { w.done = true; return; } w.el.querySelector('span').style.transform = 'scaleX(' + (w.legs[w.leg][1][0] < w.legs[w.leg][0][0] ? -1 : 1) + ')'; }
          var P = w.legs[w.leg]; w.m.setLngLat([P[0][0] + (P[1][0] - P[0][0]) * w.t, P[0][1] + (P[1][1] - P[0][1]) * w.t]);
        });
        walkers = walkers.filter(function (w) { if (w.done) w.m.remove(); return !w.done; });
        var want = Math.min(MAX_WALKERS, Math.max(0, Math.round(items.length * 0.6)));
        if (walkers.length < want && Math.random() < 0.08) spawn();
        map.getContainer().classList.toggle('walkers-hidden', z < 13.5);
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
})();
