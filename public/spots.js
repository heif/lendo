// Meetup-spot picker: chosen spots as chips, search with address/place completion (Mapbox Search Box),
// and nearby ideas (cafés, libraries, parks) to tap. Writes a JSON array into the hidden input.
(function () {
  window.lendoSpots = function (o) {
    var root = document.getElementById(o.root), hid = document.getElementById(o.input), tok = o.token, near = o.center; // [lng,lat] or null
    var picked = (o.initial || []).slice(0, 1), sess = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)), t;
    root.innerHTML = '<div class="sp-chips"></div><div class="sp-search"><input type="text" placeholder="Search a café or address…" autocomplete="off"><div class="sp-sug" hidden></div></div><div class="sp-ideas"><div class="sp-h">Cafés near you</div><div class="sp-ideas-list"></div></div>';
    var chips = root.querySelector('.sp-chips'), inp = root.querySelector('input'), sug = root.querySelector('.sp-sug'), ideas = root.querySelector('.sp-ideas-list');
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function save() { hid.value = JSON.stringify(picked); chips.innerHTML = picked.length ? picked.map(function (s, i) { return '<span class="sp-chip">📍 ' + esc(s) + '<button type="button" data-i="' + i + '" aria-label="Remove">×</button></span>'; }).join('') : '<span class="hint">No meetup spot yet — pick a café</span>'; renderIdeas(); }
    function add(s) { s = String(s).trim(); if (!s) return; picked = [s]; save(); /* one spot: a new pick replaces it */ }
    chips.addEventListener('click', function (e) { var b = e.target.closest('button[data-i]'); if (b) { picked.splice(+b.dataset.i, 1); save(); } });
    var IDEAS = [];
    function renderIdeas() { var l = IDEAS.filter(function (s) { return picked.indexOf(s) < 0; }).slice(0, 6); ideas.innerHTML = l.map(function (s) { return '<button type="button" class="sp-idea">+ ' + esc(s) + '</button>'; }).join(''); root.querySelector('.sp-ideas').hidden = !l.length; }
    ideas.addEventListener('click', function (e) { var b = e.target.closest('.sp-idea'); if (b) add(b.textContent.replace(/^\+ /, '')); });
    // quick ideas without any lookup
    // nearby public places (Mapbox category search), named with their street
    if (tok && near) ['cafe'].forEach(function (cat) {
      fetch('https://api.mapbox.com/search/searchbox/v1/category/' + cat + '?access_token=' + tok + '&proximity=' + near[0] + ',' + near[1] + '&limit=6&language=en')
        .then(function (r) { return r.json(); }).then(function (j) {
          (j.features || []).forEach(function (f) { var p = f.properties || {}; var nm = p.name + (p.address ? ' · ' + p.address : ''); if (p.name && IDEAS.indexOf(nm) < 0) IDEAS.push(nm); });
          renderIdeas();
        }).catch(function () {});
    });
    inp.addEventListener('input', function () {
      clearTimeout(t); var q = inp.value.trim(); if (q.length < 2 || !tok) { sug.hidden = true; return; }
      t = setTimeout(function () {
        fetch('https://api.mapbox.com/search/searchbox/v1/suggest?q=' + encodeURIComponent(q) + '&access_token=' + tok + '&session_token=' + sess + '&country=US&types=poi,address,street&limit=5' + (near ? '&proximity=' + near[0] + ',' + near[1] : ''))
          .then(function (r) { return r.json(); }).then(function (j) {
            var s = (j.suggestions || []).map(function (x) { var addr = x.address || (x.full_address || '').split(',')[0]; return x.name + (addr && addr !== x.name ? ' · ' + addr : ''); });
            if (s.indexOf(q) < 0) s.push(q);
            sug.innerHTML = s.map(function (x) { return '<button type="button">' + esc(x) + '</button>'; }).join(''); sug.hidden = false;
          }).catch(function () { sug.innerHTML = '<button type="button">' + esc(q) + '</button>'; sug.hidden = false; });
      }, 200);
    });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var f = sug.querySelector('button'); add(f ? f.textContent : inp.value); inp.value = ''; sug.hidden = true; } });
    sug.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { add(b.textContent); inp.value = ''; sug.hidden = true; } });
    document.addEventListener('click', function (e) { if (!root.contains(e.target)) sug.hidden = true; });
    save();
  };
})();
