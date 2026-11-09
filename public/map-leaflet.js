// Fallback map (no Mapbox token): Leaflet + OSM tiles. Used in local dev so no keys are needed.
(function () {
  var CFG = window.LENDO_MAP || {};
  var $ = function (id) { return document.getElementById(id); };
  function fmt(c) { var d = c / 100; return '$' + (Number.isInteger(d) ? d : d.toFixed(2)); }
  function esc(s) { return String(s).replace(/[<>&"]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]; }); }
  var grid = $('grid'), sheet = $('sheet');
  function renderGrid(items) { grid.innerHTML = items.map(function (it) { return '<a class="itemcard" href="/i/' + it.id + '">' + (it.photo ? '<img src="/p/' + it.photo + '" alt="">' : '<div class="ph">no photo</div>') + '<div class="b"><div class="pr">' + fmt(it.price_cents) + '<span style="font-size:11px;font-weight:700">/day</span></div><div class="nm">' + esc(it.name) + '</div></div></a>'; }).join('') || '<div style="padding:24px;grid-column:1/-1" class="hint">Nothing here yet. Be the first — list something.</div>'; }
  if (typeof L === 'undefined') { grid.style.display = 'grid'; $('toggle').style.display = 'none'; fetch('/api/listings').then(function (r) { return r.json(); }).then(function (j) { renderGrid(j.listings); }); return; }
  var map = L.map('map', { zoomControl: false }).setView([CFG.center[1], CFG.center[0]], CFG.zoom || 15);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  var layer = L.layerGroup().addTo(map), items = [], sel = null, listMode = false, t;
  function render() {
    layer.clearLayers();
    items.forEach(function (it) { if (it.lat == null) return;
      var ic = L.divIcon({ className: '', html: '<div class="epin' + (sel === it.id ? ' sel' : '') + '"><span class="glow"></span>' + (it.avatar_key ? '<img class="emo av" src="/p/' + it.avatar_key + '" alt="">' : '<span class="emo">' + (it.emoji || '📦') + '</span>') + '<span class="tag">' + fmt(it.price_cents) + '<small>/day</small></span></div>', iconSize: [0, 0] });
      L.marker([it.lat, it.lng], { icon: ic }).addTo(layer).on('click', function () { sel = it.id; render(); $('shLink').href = '/i/' + it.id; $('shImg').src = it.avatar_key ? '/p/' + it.avatar_key : it.photo ? '/p/' + it.photo : ''; $('shImg').className = it.avatar_key ? 'cut' : 'photo'; $('shPr').innerHTML = fmt(it.price_cents) + '<small>/day</small>'; $('shNm').textContent = it.name; $('shOwner').textContent = (it.owner_name || 'Neighbor').split(' ')[0]; $('shWhere').textContent = (it.hood || ''); sheet.classList.add('on'); });
    });
    renderGrid(items);
  }
  function load() { var b = map.getBounds(), q = $('q').value.trim(); fetch('/api/listings?bbox=' + [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',') + (q ? '&q=' + encodeURIComponent(q) : '')).then(function (r) { return r.json(); }).then(function (j) { items = j.listings; render(); $('kpiN').textContent = j.counts.view; $('kpiL').textContent = (j.counts.view === 1 ? 'thing' : 'things') + ' to rent here · ' + j.counts.global + ' total'; }); }
  map.on('moveend', load); map.on('click', function () { sel = null; sheet.classList.remove('on'); render(); });
  $('shClose').addEventListener('click', function () { sel = null; sheet.classList.remove('on'); render(); });
  $('q').addEventListener('input', function () { clearTimeout(t); t = setTimeout(load, 300); });
  $('toggle').addEventListener('click', function () { listMode = !listMode; grid.style.display = listMode ? 'grid' : 'none'; this.textContent = listMode ? 'Map' : 'List'; });
  $('locate').addEventListener('click', function () { navigator.geolocation && navigator.geolocation.getCurrentPosition(function (p) { map.setView([p.coords.latitude, p.coords.longitude], 15); }); });
  if (!CFG.hasHome) navigator.geolocation && navigator.geolocation.getCurrentPosition(function (p) { map.setView([p.coords.latitude, p.coords.longitude], 15); }, function () {}, { timeout: 4000 });
  load();
})();
