// "Where's home?" (Scott, 11/25): ONE box. The person gives an address, cross streets or a ZIP, or taps Use my location.
// Lendo works out the rest and shows it back: public cross streets in one style + the neighborhood. Saved right away (/api/me/where).
// A street address stays private; only "W 22nd St & 9th Ave · Chelsea" is ever shown to others.
(function () {
  [].forEach.call(document.querySelectorAll('.homebox'), function (box) {
    if (box.dataset.on) return; box.dataset.on = 1;
    var D = box.dataset, tok = D.token, esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    box.innerHTML = '<div class="hm-res" hidden></div>'
      + '<div class="hm-in"><input class="hm-q" placeholder="Address, cross streets or ZIP" autocomplete="off" enterkeyhint="done" maxlength="160"><div class="hm-sug" hidden></div></div>'
      + '<button type="button" class="hm-gps">📍 Use my location</button>'
      + '<p class="hm-note">An address stays private · others see only cross streets and neighborhood</p>'
      + '<div class="hm-fix" hidden><input class="hm-x" placeholder="W 22nd St & 9th Ave" maxlength="80" autocomplete="off"><button type="button" class="hm-xgo">OK</button></div>';
    var q = box.querySelector('.hm-q'), sug = box.querySelector('.hm-sug'), res = box.querySelector('.hm-res'), gps = box.querySelector('.hm-gps'), fix = box.querySelector('.hm-fix'), x = box.querySelector('.hm-x'), last = '';
    function show(cross, hood, msg) {
      if (msg) { res.innerHTML = '<span class="hm-err">' + esc(msg) + '</span>'; res.hidden = false; return; }
      if (!cross && !hood) { res.hidden = true; return; }
      res.innerHTML = '<span class="hm-ok">✓</span><span><b>' + esc([cross, hood].filter(Boolean).join(' · ')) + '</b><small>What others see</small></span><button type="button" class="hm-chg">' + (cross ? 'Fix' : 'Add corner') + '</button>';
      res.hidden = false; x.value = cross || '';
    }
    function post(body, busyEl) {
      if (busyEl) busyEl.classList.add('busy');
      return fetch('/api/me/where', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).then(function (r) { return r.json(); })
        .then(function (j) { if (busyEl) busyEl.classList.remove('busy'); if (j && j.ok) { show(j.cross, j.hood); fix.hidden = true; return true; } show('', '', body.cross != null ? 'Two streets, like “W 22nd St & 9th Ave”' : 'Couldn’t find that · try cross streets + neighborhood'); return false; })
        .catch(function () { if (busyEl) busyEl.classList.remove('busy'); show('', '', 'Didn’t save · try again'); return false; });
    }
    function find() { var v = q.value.trim(); sug.hidden = true; if (v.length < 2 || v === last) return; last = v; post({ place: v }, q); }
    /* already known → shown as the starting point; the box is only for changing it */
    if (D.has || D.cross || D.hood) show(D.cross, D.hood);
    if (D.addr) { q.value = D.addr; last = D.addr; }
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); find(); q.blur(); } });
    q.addEventListener('change', find);
    var t, sess = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
    q.addEventListener('input', function () { clearTimeout(t); var v = q.value.trim(); if (!tok || v.length < 3) { sug.hidden = true; return; }
      t = setTimeout(function () { fetch('https://api.mapbox.com/search/searchbox/v1/suggest?q=' + encodeURIComponent(v) + '&access_token=' + tok + '&session_token=' + sess + '&country=US&types=address,street,postcode,neighborhood&limit=5')
        .then(function (r) { return r.json(); }).then(function (j) { var s = j.suggestions || []; if (!s.length || q.value.trim() !== v) { sug.hidden = true; return; }
          sug.innerHTML = s.map(function (y) { var a = y.full_address || [y.name, y.place_formatted].filter(Boolean).join(', '); return '<button type="button" data-a="' + esc(a) + '">' + esc(a) + '</button>'; }).join(''); sug.hidden = false; }).catch(function () {}); }, 220); });
    sug.addEventListener('mousedown', function (e) { e.preventDefault(); });
    sug.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; q.value = b.dataset.a; find(); });
    document.addEventListener('click', function (e) { if (!box.contains(e.target)) sug.hidden = true; });
    gps.addEventListener('click', function () { if (!navigator.geolocation) { show('', '', 'Location isn’t available here · type it instead'); return; }
      gps.classList.add('busy'); navigator.geolocation.getCurrentPosition(function (p) { q.value = ''; last = ''; post({ lat: p.coords.latitude, lng: p.coords.longitude }, gps); },
        function () { gps.classList.remove('busy'); show('', '', 'Location is off · type cross streets or a ZIP'); }, { timeout: 8000, maximumAge: 60000 }); });
    res.addEventListener('click', function (e) { if (e.target.closest('.hm-chg')) { fix.hidden = !fix.hidden; if (!fix.hidden) x.focus(); } });
    function fixGo() { if (x.value.trim()) post({ cross: x.value.trim() }, x); }
    box.querySelector('.hm-xgo').addEventListener('click', fixGo);
    x.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); fixGo(); } });
  });
})();
