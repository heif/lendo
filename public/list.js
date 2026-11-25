// Snap-flow: ideas → camera (1 photo) → one question at a time (card stack; sign-up after the item questions) → done. Minimal copy. Config: window.LENDO_LIST = { minPrice, hood, shareUrl, hasGps }.
(function () {
  var CFG = window.LENDO_LIST || {}, MIN = CFG.minPrice || 1;
  /* Where are the things kept? (Scott, 11/24) Someone listing from the office must not get their stuff pinned at the office.
     Home saved and you're there (or no GPS) → nothing to ask. Otherwise one chunky question before posting: Home / Here / Somewhere else */
  function needWhere(go) {
    if (!CFG.user || CFG.whereOk) { go(); return; }
    var g = window._gps, h = CFG.home, far = g && h && Math.hypot(g[0] - h.lat, (g[1] - h.lng) * 0.76) > 0.006;
    if (h && !far) { CFG.whereOk = true; go(); return; }
    var esc = function (x) { return String(x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var o = document.createElement('div'); o.className = 'where-sh';
    o.innerHTML = '<div class="where-in"><b>Where are these kept?</b><p>Only the area shows on the map</p>'
      + '<div class="where-opts">' + (h ? '<button type="button" class="where-opt" data-w="home"><i>🏠</i><span>Home<small>' + esc(h.label || 'your saved spot') + '</small></span></button>' : '')
      + (g ? '<button type="button" class="where-opt" data-w="here"><i>📍</i><span>Right here<small>where you are now</small></span></button>' : '')
      + (g || h ? '<button type="button" class="where-opt" data-w="else"><i>✎</i><span>Somewhere else<small>type cross streets or ZIP</small></span></button>' : '') + '</div>'
      + '<form' + (g || h ? ' hidden' : '') + '><input name="p" placeholder="e.g. W 29th & 9th Ave" autocomplete="street-address" enterkeyhint="done" required minlength="2"><button class="cta" type="submit">PUT IT ON THE MAP</button></form>'
      + (g || h ? '' : '<button type="button" class="lnk where-gps">📍 Use my location</button>') + '<small class="where-err" hidden>Couldn’t find that · try cross streets + neighborhood</small></div>';
    document.body.appendChild(o); var inp = o.querySelector('input'), fm = o.querySelector('form'); if (!fm.hidden) setTimeout(function () { inp.focus(); }, 50);
    function done() { CFG.whereOk = true; o.remove(); go(); }
    o.querySelector('.where-opts').addEventListener('click', function (e) { var b = e.target.closest('.where-opt'); if (!b) return;
      if (b.dataset.w === 'home') { window._gps = null; done(); } else if (b.dataset.w === 'here') done();
      else { o.querySelector('.where-opts').hidden = true; fm.hidden = false; inp.focus(); } });
    fm.addEventListener('submit', function (e) { e.preventDefault(); var bt = o.querySelector('.cta'); bt.disabled = true; bt.textContent = 'FINDING…';
      fetch('/api/me/where', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ place: inp.value }) }).then(function (r) { return r.json(); }).then(function (j) { if (j && j.ok) { window._gps = null; CFG.home = { lat: j.lat, lng: j.lng, label: inp.value }; done(); } else throw 0; })
        .catch(function () { bt.disabled = false; bt.textContent = 'PUT IT ON THE MAP'; o.querySelector('.where-err').hidden = false; }); });
    var gb = o.querySelector('.where-gps'); if (gb) gb.addEventListener('click', function () { if (!navigator.geolocation) return; navigator.geolocation.getCurrentPosition(function (p) { window._gps = [p.coords.latitude, p.coords.longitude]; done(); }, function () { var er = o.querySelector('.where-err'); er.hidden = false; er.textContent = 'Location is off · type cross streets or a ZIP'; }); });
    o.addEventListener('click', function (e) { if (e.target === o) o.remove(); });
  }
  var $ = function (id) { return document.getElementById(id); };
  // [icon key (same drawn icons as the map's wanted ghosts), name, $/day]
  var IDEAS = [['drill', 'Drill', 8], ['tent', 'Tent', 15], ['projector', 'Projector', 18], ['mixer2', 'Stand mixer', 10], ['speaker', 'Party speaker', 14], ['ladder', 'Ladder', 9], ['bike', 'Bike', 20], ['camera', 'Camera', 25], ['guitar', 'Guitar', 12], ['stroller2', 'Stroller', 10], ['pwasher', 'Pressure washer', 22],
    ['escooter', 'Scooter', 15], ['skis', 'Skis', 20], ['luggage', 'Suitcase', 8], ['kayak', 'Kayak', 35], ['airfryer', 'Air fryer', 8], ['espresso2', 'Espresso machine', 15], ['toolbox', 'Tool kit', 10], ['saw', 'Saw', 12], ['mic', 'Karaoke mic', 10], ['pickle', 'Pickleball set', 9], ['sewing2', 'Sewing machine', 12], ['telescope', 'Telescope', 18]];
  /* winter (Nov–Feb): mix in cold-weather + holiday things, 1 in 4 */
  (function () { var m = new Date().getMonth(); if (!(m === 10 || m === 11 || m <= 1)) return;
    var W = [['skis', 'Skis', 20], ['sled', 'Sled', 6], ['heater', 'Space heater', 8], ['snowboots', 'Snow boots', 8], ['snowblower', 'Snow blower', 30], ['parka', 'Winter parka', 10], ['lights', 'Holiday lights', 6], ['roaster', 'Roasting pan', 6], ['skates', 'Ice skates', 8], ['foldtable', 'Folding table', 8], ['humidifier', 'Humidifier', 6], ['snowboard', 'Snowboard', 20]];
    /* 1 in 4 is a winter thing, the rest are year-round favorites */
    var base = IDEAS.filter(function (i) { return !W.some(function (w) { return w[1] === i[1]; }); }), out = [], wi = 0;
    base.forEach(function (b) { if (out.length % 4 === 3 && wi < W.length) out.push(W[wi++]); out.push(b); });
    IDEAS = out.concat(W.slice(wi)); })();
  var moreFor = null, BASE = IDEAS.map(function (i) { return i[1]; });
  function shrink(f, cb) { var img = new Image(); img.onload = function () { var s = Math.min(1, 1400 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); c.toBlob(function (b) { if (b) cb(b); }, 'image/jpeg', 0.86); URL.revokeObjectURL(img.src); }; img.src = URL.createObjectURL(f); }
  var picked = [], shots = [], step = 'ideas', t0 = null, clockT, stream = null, retakeIdx = null, more = false;
  var fmt = function (n) { return '$' + n; };
  var HOVERDEV = !!(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches); /* computers */
  function esc(s) { return String(s).replace(/[<>&"]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]; }); }
  function show(name) { step = name; ['ideas', 'ai', 'stk', 'cam', 'review', 'q', 'done'].forEach(function (s) { $('st-' + s).hidden = s !== name; }); document.documentElement.classList.toggle('camdark', name === 'cam'); if (name === 'cam') startCam(); else stopCam(); if (name === 'review') renderReview(); if (name === 'q') renderQ(); }
  function clock() { if (!t0) return '0:00'; var s = Math.round((Date.now() - t0) / 1000); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }

  // ---- ideas
  var WANT = (function () { try { return new URLSearchParams(location.search).get('want') || ''; } catch (e) { return ''; } })();
  if (WANT && !IDEAS.some(function (i) { return i[1].toLowerCase() === WANT.toLowerCase(); })) IDEAS.unshift(['📦', WANT, 12]);
  if (WANT && picked.indexOf(WANT) < 0) { var wi = IDEAS.filter(function (i) { return i[1].toLowerCase() === WANT.toLowerCase(); })[0]; picked.push(wi ? wi[1] : WANT); }
  function renderIdeas() {
    /* 8 fit on a phone screen with the More link showing; anything picked always shows */
    var list = more ? IDEAS : IDEAS.filter(function (i, k) { return k < 8 || picked.indexOf(i[1]) > -1; });
    $('ideas').innerHTML = list.map(function (i, k) { var on = picked.indexOf(i[1]) > -1; return '<button type="button" class="idea' + (on ? ' on' : '') + '" data-n="' + esc(i[1]) + '" data-p="' + i[2] + '"><span class="mk">' + (on ? '✓' : '') + '</span><span class="em"><img src="/p/wanted/' + i[0] + '.png" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'"></span><span class="nm">' + esc(i[1]) + '</span></button>'; }).join('');
    $('moreIdeas').hidden = more;
    /* never let "More ideas" sit under the NEXT bar: drop unpicked rows until it shows (phones of any height) */
    if (!more) requestAnimationFrame(function () { try {
      var foot = document.querySelector('#st-ideas .lf-foot'), m = $('moreIdeas'); if (!foot || !m || !m.offsetParent) return;
      var rows = [].slice.call($('ideas').querySelectorAll('.idea:not(.on)'));
      while (rows.length > 4 && m.getBoundingClientRect().bottom > foot.getBoundingClientRect().top - 4) rows.pop().remove();
    } catch (e) {} });
    /* stock photos on: picking → NEXT (no camera), camera is the link under it */
    var stk0 = CFG.stock; /* Snap | Find it always, even before picking (Find it with nothing picked = type what it is) */
    /* stock photos on: one button → the item screens (camera lives there as "Snap yours"); off: the camera as before */
    $('toCam').textContent = stk0 ? 'NEXT' : !picked.length ? 'OPEN CAMERA' : 'SNAP ' + picked.length + (picked.length === 1 ? ' THING' : ' THINGS');
    $('pick2').hidden = true; $('toCam').hidden = false;
    nextOk();
  }
  $('ideas').addEventListener('click', function (e) { var b = e.target.closest('.idea'); if (!b) return; var n = b.dataset.n, i = picked.indexOf(n); if (i > -1) picked.splice(i, 1); else picked.push(n); renderIdeas(); });
  $('moreIdeas').addEventListener('click', function () { more = true; renderIdeas(); });
  /* the always-there blank row: type anything → autocomplete → it joins the list, checked */
  function acPool() { var out = []; if (window.LENDO_AC) for (var k in window.LENDO_AC) out = out.concat(window.LENDO_AC[k]); return out; }
  function ideaOf(t) { if (window.LENDO_AC) for (var k in window.LENDO_AC) if (window.LENDO_AC[k].indexOf(t) > -1) return k; return ''; }
  function ideaAcShow() {
    var v = $('ideaType').value.trim().toLowerCase(); if (v.length < 2) { $('ideaAc').hidden = true; return; }
    var ws = v.split(/\s+/), hits = acPool().filter(function (t) { var tw = t.toLowerCase().split(/[\s\-+\/()]+/); return ws.every(function (w) { return tw.some(function (z) { return z.indexOf(w) === 0; }); }); });
    /* idea names first ("tent" → Tent), then models */
    IDEAS.forEach(function (i) { if (i[1].toLowerCase().indexOf(v) === 0 && hits.indexOf(i[1]) < 0) hits.unshift(i[1]); });
    hits = hits.slice(0, 7);
    $('ideaAc').innerHTML = hits.map(function (t) { return '<button type="button" data-t="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '<button type="button" class="ac-own" data-t="' + esc($('ideaType').value.trim()) + '">+ Add “' + esc($('ideaType').value.trim()) + '”</button>';
    $('ideaAc').hidden = false;
  }
  function ideaAdd(t) {
    t = (t || '').trim(); if (t.length < 2) return;
    var ex = IDEAS.filter(function (i) { return i[1].toLowerCase() === t.toLowerCase(); })[0];
    if (ex) { if (picked.indexOf(ex[1]) < 0) picked.push(ex[1]); }
    else { var k = ideaOf(t), base = k ? IDEAS.filter(function (i) { return i[1] === k; })[0] : null;
      var name = k && t.toLowerCase().indexOf(k.toLowerCase()) < 0 ? t + ' ' + k.toLowerCase() : t;
      if (!IDEAS.some(function (i) { return i[1] === name; })) IDEAS.unshift([base ? base[0] : '📦', name, base ? base[2] : 12]);
      if (picked.indexOf(name) < 0) picked.push(name); }
    $('ideaType').value = ''; $('ideaAc').hidden = true; renderIdeas();
    /* phones: drop the keyboard so NEXT is back in view */
    try { $('ideaType').blur(); } catch (e) {}
    var firstOn = document.querySelector('#ideas .on'); if (firstOn && firstOn.scrollIntoView) firstOn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  /* NEXT is grayed out until something is checked or typed */
  function nextOk() { if (!CFG.stock) return; $('toCam').disabled = !picked.length && $('ideaType').value.trim().length < 2; }
  $('ideaType').addEventListener('input', function () { ideaAcShow(); nextOk(); });
  /* phones: the keyboard's Done/Go submits the form, and leaving the box with text in it adds it too (a tapped suggestion clears the box first) */
  $('ideaType').addEventListener('blur', function () { setTimeout(function () { $('ideaAc').hidden = true; if ($('ideaType').value.trim().length > 1) ideaAdd($('ideaType').value); }, 220); });
  $('ideaType').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ideaAdd(this.value); } });
  $('ideaForm').addEventListener('submit', function (e) { e.preventDefault(); ideaAdd($('ideaType').value); $('ideaType').blur(); });
  $('ideaCam').addEventListener('click', function () { if (!t0) t0 = Date.now(); if ($('ideaType').value.trim().length > 1) ideaAdd($('ideaType').value); show('cam'); });
  $('ideaAc').addEventListener('mousedown', function (e) { e.preventDefault(); });
  $('ideaAc').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) ideaAdd(b.dataset.t); });
  $('toCam').addEventListener('click', function () { if (!t0) t0 = Date.now(); if (CFG.stock) { if (!picked.length && $('ideaType').value.trim().length > 1) ideaAdd($('ideaType').value); return stkStart(); } show('cam'); });
  $('toSnap').addEventListener('click', function () { if (!t0) t0 = Date.now(); show('cam'); });
  $('toType').addEventListener('click', function () { if (!t0) t0 = Date.now(); stkStart(); });

  // ---- no-photo path: one item at a time (brand → stock photo → ✓), then prices → post. Snapped ones go to the camera after posting.
  /* what "Details" should prompt for, per item */
  var DET_EG = { 'Drill': '2 batteries + charger, bit set', 'Tent': 'sleeps 4, rainfly + stakes', 'Projector': '1080p, HDMI cable, screen', 'Stand mixer': 'dough hook + whisk + paddle', 'Party speaker': 'mic included, 12 hr battery', 'Ladder': '6 ft, fiberglass', 'Bike': 'medium frame, lock + helmet', 'Camera': '24-70mm lens, 2 batteries, 64GB card', 'Guitar': 'case + strap, amp not included', 'Stroller': 'rain cover, cup holder', 'Pressure washer': '2000 PSI, 3 nozzles', 'Scooter': '20 mi range, charger', 'Skis': '170 cm, bindings set for size 10 boot', 'Suitcase': '22 in carry-on, spinner wheels', 'Kayak': 'paddle + life jacket', 'Air fryer': '6 qt, 2 baskets', 'Espresso machine': 'built-in grinder, milk pitcher', 'Tool kit': '120 pieces, hard case', 'Saw': '7 1/4 in blade, battery + charger', 'Karaoke mic': '2 mics, Bluetooth', 'Pickleball set': '4 paddles + 6 balls', 'Sewing machine': 'foot pedal, extra bobbins', 'Telescope': '130mm, tripod + 2 eyepieces', 'Snow boots': "women's 8, waterproof", 'Sled': 'fits 2 kids', 'Space heater': '1500W, tip-over shutoff', 'Snow blower': '24 in, electric start', 'Winter parka': "men's M, rated to -20°F", 'Holiday lights': '300 ft, warm white, timer', 'Roasting pan': 'fits a 20 lb turkey, rack', 'Ice skates': "size 9, guards included", 'Folding table': '6 ft, seats 6', 'Humidifier': '1 gal tank, quiet', 'Snowboard': '156 cm, bindings, boots size 10' };
  var stk = [], si = 0, stkQ = [], stkBusy = false;
  function stkLabel(x) { var b = (x.brand || '').trim(); if (x.custom) return x.idea && x.idea !== 'Home' && b.toLowerCase().indexOf(x.idea.toLowerCase()) < 0 ? b + ' ' + x.idea.toLowerCase() : b; if (!b) return x.name; return b.toLowerCase().indexOf(x.name.toLowerCase()) > -1 ? b : b + ' ' + x.name.toLowerCase(); }
  function stkStart() {
    if (!CFG.user) { location.href = '/login?next=' + encodeURIComponent('/list?stk=' + picked.join('|')); return; }
    if (!picked.length) { stk = [{ name: '', custom: true, price: MIN, brand: '', det: '', grade: 'A', imgs: [], k: 0 }]; si = 0; stkQ = []; show('stk'); stkOne(); setTimeout(function () { $('stkBrand').focus(); }, 50); return; }
    stk = picked.map(function (n) { var idea = IDEAS.filter(function (i) { return i[1] === n; })[0];
      if (BASE.indexOf(n) < 0) return { name: n, custom: true, idea: ideaOf(n.replace(/\s+\S+$/, '')) || '', price: idea ? Math.max(MIN, idea[2]) : MIN, ideaPrice: idea && idea[0] !== '📦' ? idea[2] : 0, brand: n, det: '', grade: 'A', imgs: null, k: 0 };
      return { name: n, price: idea ? Math.max(MIN, idea[2]) : MIN, basePrice: idea ? idea[2] : 0, brand: '', det: '', grade: 'A', imgs: null, k: 0 }; });
    si = 0; stkQ = stk.slice(); show('stk'); stkOne(); stkPump();
  }
  /* Brave allows ~1 search/sec: one at a time, the current item first */
  function stkPump() {
    if (stkBusy) return; var x = stk[si] && !stk[si].imgs && stkQ.indexOf(stk[si]) > -1 ? stk[si] : stkQ.filter(function (y) { return !y.imgs; })[0];
    if (!x) return; stkQ.splice(stkQ.indexOf(x), 1); stkBusy = true; var q = stkLabel(x), tries = 0;
    (function go() {
      fetch('/api/stock?q=' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (j) {
        if (j.retry && tries++ < 5) return setTimeout(go, 1500 + tries * 500);
        if (stkLabel(x) === q) { x.imgs = j.imgs || []; x.k = 0; } else stkQ.unshift(x); /* brand changed meanwhile → search again */
        done();
      }).catch(function () { x.imgs = []; done(); });
    })();
    function done() { stkBusy = false; if (step === 'stk') { $('stkAll').hidden ? stkOne() : stkAll(); } setTimeout(stkPump, 1100); }
  }
  function stkOne() {
    var x = stk[si]; $('stkOne').hidden = false; $('stkAll').hidden = true;
    $('stkN').textContent = '';
    $('stkDots').innerHTML = stk.map(function (y, k) { return '<i class="' + (k === si ? 'on' : y.yes ? 'ok' : y.snap ? 'sn' : '') + '"></i>'; }).join('');
    /* no headline: a big, clear "1 of 3 · Drill" (nothing for a single typed-in thing) */
    var one = stk.length === 1 && x.custom; $('stkH').hidden = one; $('stkDots').hidden = one || stk.length === 1;
    $('stkH').innerHTML = '<b>' + (si + 1) + ' of ' + stk.length + '</b>' + (x.custom ? '' : '<span>' + esc(x.name) + '</span>');
    $('stkDet').placeholder = 'e.g. ' + (DET_EG[x.custom ? x.idea || '' : x.name] || 'what\'s included, size, color');
    var eg = (window.LENDO_AC && window.LENDO_AC[x.name] || []).filter(function (t) { return /[A-Z]/.test(t.charAt(0)) && /\s/.test(t); })[0];
    $('stkBrand').placeholder = x.custom ? 'Brand / model' : 'Brand / model' + (eg ? ' · e.g. ' + eg : '');
    if (document.activeElement !== $('stkBrand')) $('stkBrand').value = x.brand;
    if (document.activeElement !== $('stkDet')) $('stkDet').value = x.det || '';
    [].forEach.call($('stkGr').children, function (b) { b.classList.toggle('on', b.dataset.g === x.grade); });
    var im = x.imgs && x.imgs[x.k];
    $('stkPic').innerHTML = x.custom && !x.brand ? '<span class="stk1-wait">Type what it is · a photo shows up</span>' : !x.imgs ? '<span class="stk1-wait">Finding a photo…</span>' : im ? '<img src="' + esc(im.thumb) + '" alt="">' : '<span class="stk1-none">No photo found</span><button type="button" class="stk1-snapt" id="stkSnapT"><i>📷</i>Snap yours</button>';
    /* the photo choices end with a dashed "📷 Mine" tile: snap your own instead */
    $('stkTbs').innerHTML = x.imgs && x.imgs.length ? x.imgs.slice(0, 4).map(function (y, k) { return '<button type="button" data-k="' + k + '" class="' + (k === x.k ? 'on' : '') + '"><img src="' + esc(y.thumb) + '" alt=""></button>'; }).join('') + '<button type="button" class="stk1-mine" data-cam="1"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h1.5a2 2 0 0 0 1.8-1.1l.4-.8A2 2 0 0 1 10.5 4h3a2 2 0 0 1 1.8 1.1l.4.8A2 2 0 0 0 17.5 7H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/><circle cx="12" cy="13" r="3.4"/></svg>Mine</button>' : '';
    $('stkNote').hidden = false;
    /* refine: tap-to-add chips (brands/models for this thing) + a "Not it?" search right under the photos */
    var cur = (x.brand || '').toLowerCase(), pool = chipPool(x);
    var chips = chipList(pool, cur);
    $('stkChips').innerHTML = chips.map(function (c) { return '<button type="button" data-t="' + esc(c.q) + '" data-add="' + (c.add ? 1 : '') + '">+ ' + esc(c.l) + '</button>'; }).join('');
    $('stkChips').hidden = !chips.length || (x.custom && !x.brand);
    $('stkRef').hidden = x.custom && !x.brand;
    $('stkRefIn').placeholder = 'Add brand / model';
    /* two steps per thing: find it (photo + price) → about yours (condition + details) */
    $('stkFind').hidden = !!x.about; $('stkAbout').hidden = !x.about;
    if (x.about) { $('stkAbT').innerHTML = im ? '<img src="' + esc(im.thumb) + '" alt="">' : ''; $('stkAbN').textContent = stkLabel(x) + ' · $' + x.price + '/day'; }
    $('stkNote').hidden = !(x.imgs && x.imgs.length); $('stkNote').textContent = x.imgs && x.imgs.length > 1 ? 'Tap the closest one · or snap yours' : 'Or snap yours';
    /* the owner sets the price right here: big tag with − / +, plus a typical range for this kind of thing */
    $('stkPv').textContent = '$' + x.price; var base = x.custom ? (x.ideaPrice || 0) : (x.basePrice || x.price);
    $('stkRange').textContent = 'Your price' + (base ? ' · typical $' + Math.max(MIN, Math.round(base * 0.7)) + '–' + Math.round(base * 1.4) : '');
    $('stkGo').hidden = false; $('stkGo').textContent = x.about ? (stk.slice(si + 1).some(function (y) { return !y.yes && !y.snap && !y.skip; }) ? 'NEXT THING →' : 'DONE →') : '✓ LOOKS LIKE MINE'; $('stkGo').disabled = !im; $('stkSnap').hidden = !!x.about || !!x.imgs; /* photos → "📷 Mine" tile; no photo → Snap yours tile */ $('stkSkip').hidden = false;
  }
  function stkNext() { si++; while (si < stk.length && (stk[si].yes || stk[si].snap || stk[si].skip)) si++; if (si < stk.length) { stkOne(); stkPump(); return; }
    /* only snaps left, nothing to post → straight to the camera (no in-between screen) */
    var sn = stk.filter(function (y) { return y.snap; }); if (!stkOk().length && sn.length) { stkToCam(sn.map(function (y) { return y.custom ? stkLabel(y) || 'Thing' : y.name; })); return; }
    stkAll(); }
  function stkOk() { return stk.filter(function (x) { return x.yes && x.imgs && x.imgs[x.k]; }); }
  function stkAll() {
    var ok = stkOk(), sn = stk.filter(function (x) { return x.snap; });
    $('stkOne').hidden = true; $('stkAll').hidden = false; $('stkSnap').hidden = true; $('stkSkip').hidden = true; $('stkN').textContent = '';
    $('stkRows').innerHTML = stk.map(function (x, i) { if (!x.yes) return ''; var im = x.imgs[x.k];
      return '<div class="stkr"><img src="' + esc(im.thumb) + '" alt=""><div class="stkr-t"><b>' + esc(stkLabel(x)) + ' <span class="stkr-g g' + x.grade + '">' + x.grade + '</span></b>' + (x.det ? '<small>' + esc(x.det) + '</small>' : '') + '<div class="stkr-p"><button type="button" class="aipm" data-i="' + i + '" data-d="-1" aria-label="Lower">−</button><span>$' + x.price + '/day</span><button type="button" class="aipm" data-i="' + i + '" data-d="1" aria-label="Raise">+</button></div></div></div>'; }).join('') +
      (sn.length ? '<p class="hint" style="margin-top:10px">📷 Next: snap ' + esc(sn.map(function (x) { return x.name.toLowerCase(); }).join(', ')) + '</p>' : '') +
      /* never a dead end: nothing confirmed → ways forward; otherwise add one more */
      (!ok.length && !sn.length ? '<p class="stk-empty">Nothing to post yet</p>' : '') +
      '<div class="stk-more"><button type="button" class="stk-mb" data-m="type">🔎 Find another item</button><button type="button" class="stk-mb" data-m="snap">📷 Snap another item</button>' + (!ok.length && !sn.length ? '<button type="button" class="stk-mb" data-m="ideas">← Back to ideas</button>' : '') + '</div>';
    $('stkGo').hidden = !ok.length && !sn.length;
    $('stkGo').disabled = false;
    $('stkGo').textContent = ok.length ? 'POST ' + ok.length + (ok.length === 1 ? ' THING' : ' THINGS') : 'SNAP ' + sn.length + (sn.length === 1 ? ' THING' : ' THINGS');
  }
  /* chip suggestions: this idea's list, or for a typed-in thing, the idea whose name shares a word ("flycaster rod" → Fishing rod) */
  /* hand tools come in types, not brands: chips offer the types (ac.js) */
  var TYPE_KEYS = ['Screwdriver', 'Wrench', 'Hammer', 'Pliers', 'Level', 'Clamp', 'Tape measure', 'Utility knife'];
  function chipPool(x) {
    var L = window.LENDO_AC || {};
    if (!x.custom && L[x.name]) return acList(x.name).filter(function (t) { return /[A-Z0-9]/.test(t.charAt(0)); });
    /* a typed thing that is itself a list name ("screwdriver") → that list (types for hand tools) */
    var nm = ' ' + (x.brand || x.name || '').trim().toLowerCase().replace(/[^a-z ]+/g, ' ') + ' ';
    for (var ti = 0; ti < TYPE_KEYS.length; ti++) { var tk = TYPE_KEYS[ti].toLowerCase(); if (nm.indexOf(' ' + tk + ' ') > -1 || nm.indexOf(' ' + tk + 's ') > -1) { var tl = acList(TYPE_KEYS[ti]).slice(); tl.typeList = true; return tl; } }
    /* typed-in thing: terms from any list that share a real word with it ("monitor 27 in" → monitors, never the whole 'Home' grab-bag) */
    var STOP = /^(home|the|and|for|with|set|kit|in|ft|my|a|an|of|new|old|big|small|large|mini|pro|max|plus)$/i;
    var ws = (x.brand || '').toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2 && !STOP.test(w) && !/^\d+$/.test(w); }).map(function (w) { return w.replace(/s$/, ''); });
    if (!ws.length) return [];
    var hit = [], seen = {};
    for (var k in L) { var kw = k.toLowerCase().split(/\s+/).map(function (w) { return w.replace(/s$/, ''); }), keyHit = k !== 'Home' && ws.some(function (w) { return kw.indexOf(w) > -1; });
      L[k].forEach(function (t) { var tw = t.toLowerCase().split(/[^a-z0-9]+/).map(function (w) { return w.replace(/s$/, ''); });
        var n = ws.filter(function (w) { return tw.indexOf(w) > -1; }).length + (keyHit ? 0.5 : 0);
        if (n > 0 && !seen[t.toLowerCase()]) { seen[t.toLowerCase()] = 1; hit.push([n, t]); } }); }
    return hit.sort(function (a, b) { return b[0] - a[0]; }).map(function (h) { return h[1]; }).filter(function (t) { return /[A-Z0-9]/.test(t.charAt(0)); });
  }

  /* "Not it?" chips: brands first (+ Orvis adds the brand to the search), then a few exact models / sizes */
  var GENERIC = /^(fly|spinning|baitcasting|surf|telescopic|ice|kids?|golf|tennis|inflatable|paddle|rolling|portable|electric|cordless|folding|camping|hiking|baby|car|record|tv|generator|kayak|soft|hard|mini|large|small|outdoor|indoor|wooden|metal|plastic|adult|youth|ultrawide|gaming)$/i;
  function chipList(pool, cur) {
    if (pool.typeList) return pool.filter(function (t) { return cur.indexOf(t.toLowerCase()) < 0; }).slice(0, 8).map(function (t) { return { l: t, q: t }; });
    var br = [], seen = {}, specs = [];
    pool.forEach(function (t) { var w = t.split(' '), b = /^(st\.|g\.|ugly|abu|the|big|red|camp|solo|scotty)$/i.test(w[0]) ? w[0] + ' ' + w[1] : w[0];
      if (GENERIC.test(w[0]) || /\d/.test(b) || cur.indexOf(w[0].toLowerCase()) > -1) { if (specs.length < 3 && cur.indexOf(t.toLowerCase()) < 0) specs.push({ l: t.length > 22 ? t.slice(0, 21) + '…' : t, q: t }); return; }
      var k = b.toLowerCase(); if (seen[k] || cur.indexOf(k) > -1) return; seen[k] = 1; br.push({ l: b, q: b, add: true }); });
    return br.slice(0, 7).concat(specs);
  }
  function stkToCam(names) { picked = names; renderIdeas(); show('cam'); }
  var stkT;
  function stkSet(x, v) { clearTimeout(stkT); if (x.brand === v) return; x.brand = v; x.imgs = null; x.yes = false; if (stkQ.indexOf(x) < 0) stkQ.unshift(x); stkOne(); stkPump(); }
  /* instant autocomplete: built-in list (public/ac.js) + what other owners posted (/api/ac); matches word starts anywhere ("m18" → Milwaukee M18 drill) */
  var acLearned = {}, acAll = null;
  function acList(name) {
    var base = (window.LENDO_AC && window.LENDO_AC[name]) || [];
    if (!acLearned[name]) { acLearned[name] = []; fetch('/api/ac?idea=' + encodeURIComponent(name)).then(function (r) { return r.json(); }).then(function (j) { acLearned[name] = j.terms || []; }).catch(function () {}); }
    var seen = {}, out = []; base.concat(acLearned[name]).forEach(function (t) { var k = t.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(t); } }); return out;
  }
  function acShow() {
    var x = stk[si]; if (!x) return; var v = $('stkBrand').value.trim().toLowerCase(), all = acList(x.name), hits;
    if (!v) hits = all.slice(0, 8);
    else {
      var ws = v.split(/\s+/), m = function (t) { var tw = t.toLowerCase().split(/[\s\-+\/()]+/); return ws.every(function (w) { return tw.some(function (z) { return z.indexOf(w) === 0; }); }); };
      hits = all.filter(m);
      /* fewer than 8 for this item → look across every item's list too (a brand typed under the "wrong" idea still completes) */
      if (hits.length < 8 && window.LENDO_AC) { if (!acAll) { acAll = []; for (var k in window.LENDO_AC) acAll = acAll.concat(window.LENDO_AC[k]); } acAll.forEach(function (t) { if (hits.length < 8 && hits.indexOf(t) < 0 && m(t)) hits.push(t); }); }
      hits = hits.slice(0, 8);
    }
    if (hits.length === 1 && hits[0].toLowerCase() === v) hits = [];
    $('stkAc').innerHTML = hits.map(function (t) { return '<button type="button" data-t="' + esc(t) + '">' + esc(t) + '</button>'; }).join('');
    $('stkAc').hidden = !hits.length;
  }
  /* the photo search runs only for exactly what's in the box: on a picked suggestion, Enter, or leaving the box — never on half-typed text */
  $('stkBrand').addEventListener('input', acShow);
  $('stkBrand').addEventListener('focus', acShow);
  $('stkBrand').addEventListener('blur', function () { var el = this; setTimeout(function () { $('stkAc').hidden = true; var x = stk[si]; if (x && step === 'stk' && $('stkAll').hidden) stkSet(x, el.value.trim()); }, 150); });
  $('stkDet').addEventListener('input', function () { if (stk[si]) stk[si].det = this.value; });
  $('stkDet').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); this.blur(); } });
  $('stkPr').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b || !stk[si]) return; var x = stk[si]; x.price = Math.max(MIN, x.price + (+b.dataset.d)); $('stkPv').textContent = '$' + x.price; });
  $('stkGr').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b || !stk[si]) return; stk[si].grade = b.dataset.g; stkOne(); });
  $('stkAc').addEventListener('mousedown', function (e) { e.preventDefault(); }); /* keep focus so the tap lands */
  $('stkAc').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; var t = b.dataset.t; $('stkBrand').value = t; $('stkAc').hidden = true; var cx = stk[si]; if (cx && cx.custom && window.LENDO_AC) { cx.idea = ''; for (var kk in window.LENDO_AC) if (window.LENDO_AC[kk].indexOf(t) > -1) { cx.idea = kk; var iw = IDEAS.filter(function (i) { return i[1] === kk; })[0]; if (iw) { cx.price = Math.max(MIN, iw[2]); cx.ideaPrice = iw[2]; } break; } } stkSet(cx, t); $('stkBrand').blur(); });
  $('stkBrand').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var f = $('stkAc').querySelector('button'); if (f && !$('stkAc').hidden && this.value.trim().length >= 2) { this.value = f.dataset.t; } $('stkAc').hidden = true; this.blur(); stkSet(stk[si], this.value); } });
  $('stkChips').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; var t = b.dataset.t, x = stk[si], cur = (x.brand || '').trim();
    if (b.dataset.add && cur) t = t + ' ' + cur; $('stkBrand').value = t; stkSet(x, t); });
  $('stkPic').addEventListener('click', function (e) { if (e.target.closest('#stkSnapT')) $('stkSnap').click(); });
  $('stkRef').addEventListener('submit', function (e) { e.preventDefault(); var v = $('stkRefIn').value.trim(); if (v.length < 2) return; var x = stk[si], b = (x.brand || '').trim();
    /* adds to what's there unless it already names the thing ("Orvis" + "flycaster rod" → "Orvis flycaster rod") */
    var q = b && v.toLowerCase().indexOf(b.toLowerCase()) < 0 ? v + ' ' + b : v; $('stkRefIn').value = ''; $('stkRefIn').blur(); $('stkBrand').value = q; stkSet(x, q); });
  $('stkTbs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; if (b.dataset.cam) { $('stkSnap').click(); return; } stk[si].k = +b.dataset.k; stkOne(); });
  $('stkPic').addEventListener('click', function () { var x = stk[si]; if (x.imgs && x.imgs.length > 1) { x.k = (x.k + 1) % Math.min(4, x.imgs.length); stkOne(); } });
  $('stkSnap').addEventListener('click', function () { var x = stk[si]; x.snap = true; x.yes = false;
    /* confirm it's saved for the camera, then move on */
    if (window.toast) window.toast('📷 ' + (x.custom ? stkLabel(x) || 'This one' : x.name) + ' · you’ll snap it next'); stkNext(); });
  $('stkSkip').addEventListener('click', function () { stk[si].about = false; stk[si].skip = true; stk[si].yes = false; stkNext(); });
  $('stkRows').addEventListener('click', function (e) {
    var mb = e.target.closest('.stk-mb');
    if (mb) { var m = mb.dataset.m;
      if (m === 'type') { stk.push({ name: '', custom: true, price: MIN, brand: '', det: '', grade: 'A', imgs: [], k: 0 }); si = stk.length - 1; stkOne(); setTimeout(function () { $('stkBrand').focus(); }, 50); }
      else if (m === 'snap') { picked = []; renderIdeas(); show('cam'); }
      else { show('ideas'); }
      return; } var pm = e.target.closest('.aipm'); if (!pm) return; var x = stk[+pm.dataset.i]; x.price = Math.max(MIN, x.price + (+pm.dataset.d)); stkAll(); });
  $('stkBack').addEventListener('click', function () {
    if ($('stkAll').hidden && stk[si] && stk[si].about) { stk[si].about = false; stkOne(); return; }
    if (!$('stkAll').hidden) { si = stk.length - 1; stk[si].yes = stk[si].snap = stk[si].skip = false; stkOne(); return; }
    if (si === 0) { show('ideas'); return; } si--; stk[si].yes = stk[si].snap = stk[si].skip = false; stkOne();
  });
  $('stkGo').addEventListener('click', function () {
    var go = this;
    if ($('stkAll').hidden) { var x = stk[si]; if (!(x.imgs && x.imgs[x.k])) return; if (!x.about) { x.about = true; stkOne(); $('st-stk').querySelector('.lf-scroll').scrollTop = 0; return; } x.yes = true; x.about = false; stkNext(); return; }
    var ok = stkOk(), sn = stk.filter(function (x) { return x.snap; }).map(function (x) { return x.name; });
    if (!ok.length) { if (sn.length) stkToCam(sn); return; }
    if (!go.dataset.where) { go.dataset.where = '1'; needWhere(function () { go.click(); }); return; } delete go.dataset.where;
    var items = ok.map(function (x) { var im = x.imgs[x.k]; return { name: stkLabel(x), price: x.price, img: im.src, thumb: im.thumb, idea: x.custom ? (x.idea || '') : x.name, brand: (x.brand || '').trim(), details: (x.det || '').trim(), grade: x.grade }; });
    go.disabled = true; go.textContent = 'POSTING…';
    fetch('/api/list-stock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: items, lat: window._gps ? window._gps[0] : undefined, lng: window._gps ? window._gps[1] : undefined }) })
      .then(function (r) { if (r.status === 401) { location.href = '/login?next=' + encodeURIComponent('/list?stk=' + stk.map(function (x) { return x.name; }).join('|')); return null; } return r.json(); })
      .then(function (j) { if (!j) return; var L = (j.listed || []).slice().sort(function (a, b) { return a.i - b.i; });
        if (!L.length) { go.textContent = 'TRY AGAIN'; go.disabled = false; return; }
        if (sn.length) { if (window.toast) window.toast(L.length + ' posted · now snap the rest'); stkToCam(sn); return; }
        shots = L.map(function (r) { return { name: r.name, price: r.price, url: r.photo || items[r.i].thumb, cutUrl: r.cut }; }); j.listed = L; renderDone(j); show('done'); })
      .catch(function () { go.textContent = 'TRY AGAIN'; go.disabled = false; });
  });
  /* back from login with picks → straight into the no-photo path */
  (function () { try { var q = new URLSearchParams(location.search).get('stk'); if (!q || !CFG.stock || !CFG.user) return; q.split('|').forEach(function (n) { n = n.trim(); if (!n) return; if (!IDEAS.some(function (i) { return i[1] === n; })) IDEAS.unshift(['📦', n, 12]); if (picked.indexOf(n) < 0) picked.push(n); }); renderIdeas(); if (picked.length) setTimeout(stkStart, 0); } catch (e) {} })();
  // ---- ask your AI (their AI reads their email receipts; Lendo only gets the pasted list)
  var aiFound = null;
  function aiCopy() { var t = $('aiPrompt').textContent; try { navigator.clipboard.writeText(t); } catch (e) {} return t; }
  $('aiOpen').addEventListener('click', function () { aiFound = null; stockMode = false; $('aiC').hidden = true; $('aiGo').disabled = false; $('aiA').hidden = false; $('aiB').hidden = true; $('aiGo').textContent = 'FIND MY STUFF'; show('ai'); });
  document.querySelectorAll('.aiapp').forEach(function (b) { b.addEventListener('click', function () {
    var t = aiCopy(), u = b.dataset.u; b.textContent = 'Copied ✓';
    if (u) window.open(/q=$/.test(u) ? u + encodeURIComponent(t) : u, '_blank');
  }); });
  function aiRender() {
    var on = aiFound.filter(function (x) { return x.on; }).length;
    $('aiN').textContent = aiFound.length + (aiFound.length === 1 ? ' thing found' : ' things found');
    /* price is a starting suggestion: − / + right on the row, never below the minimum */
    $('aiList').innerHTML = aiFound.map(function (x, i) { return '<div class="airow' + (x.on ? ' on' : '') + '" data-i="' + i + '"><button type="button" class="airt" data-i="' + i + '"><span class="mk">' + (x.on ? '✓' : '') + '</span><span class="nm">' + esc(x.name) + (x.detail ? '<small>' + esc(x.detail) + '</small>' : '') + '</span></button>' + (x.on ? '<span class="aipr"><button type="button" class="aipm" data-i="' + i + '" data-d="-1" aria-label="Lower">−</button><b>$' + x.price + '<small>/day</small></b><button type="button" class="aipm" data-i="' + i + '" data-d="1" aria-label="Raise">+</button></span>' : '') + '</div>'; }).join('') || '<p class="hint">Nothing rentable in there. Try the ideas instead</p>';
    /* standard photos are the main path; the camera is the fallback */
    $('aiGo').textContent = !on ? 'BACK' : CFG.stock ? 'NEXT: ' + on + (on === 1 ? ' THING' : ' THINGS') : 'SNAP ' + on + (on === 1 ? ' THING' : ' THINGS');
    $('aiStock').hidden = !(CFG.stock && on); $('aiStock').textContent = 'Take my own photos instead →';
  }
  /* no-photo path: a standard product photo per item; the owner confirms theirs looks like it */
  var stockMode = false;
  function stockRender() {
    var ok = aiFound.filter(function (x) { return x.on && x.yes && x.imgs && x.imgs.length; }).length;
    $('aiStockList').innerHTML = aiFound.map(function (x, i) { if (!x.on) return ''; var im = x.imgs && x.imgs[x.k || 0];
      return '<div class="stk' + (x.yes ? ' on' : '') + '"><button type="button" class="stk-img" data-i="' + i + '" aria-label="Another photo">' + (x.imgs ? (im ? '<img src="' + esc(im.thumb) + '" alt="">' + (x.imgs.length > 1 ? '<span>↻</span>' : '') : '<small>no photo found</small>') : '<small>…</small>') + '</button><div class="stk-t"><b>' + esc(x.name) + '</b>' + (im ? '<button type="button" class="stk-yes" data-i="' + i + '">' + (x.yes ? '✓ Mine looks like this' : 'Mine looks like this') + '</button>' : '') + '</div></div>'; }).join('');
    $('aiGo').textContent = ok ? 'POST ' + ok + (ok === 1 ? ' THING' : ' THINGS') : 'CONFIRM EACH ONE';
    $('aiGo').disabled = !ok;
  }
  /* photo searches one at a time (~1/sec, the search API's limit), retrying a rate-limited one twice */
  function stockFetch(list, tries) {
    var x = list.shift(); if (!x) return;
    fetch('/api/stock?q=' + encodeURIComponent(x.name + (x.detail ? ' ' + x.detail.split(' · ')[0] : ''))).then(function (r) { return r.json(); }).then(function (j) {
      if (j.retry && (tries || 0) < 5) { list.unshift(x); return setTimeout(function () { stockFetch(list, (tries || 0) + 1); }, 1500); }
      x.imgs = j.imgs || []; x.k = 0; stockRender(); setTimeout(function () { stockFetch(list, 0); }, 1100);
    }).catch(function () { x.imgs = []; stockRender(); setTimeout(function () { stockFetch(list, 0); }, 1100); });
  }
  /* picked → become ideas + picked, then the camera */
  function toCamera() {
    var on = aiFound.filter(function (x) { return x.on; });
    on.slice().reverse().forEach(function (x) { if (!IDEAS.some(function (i) { return i[1] === x.name; })) IDEAS.unshift(['📦', x.name, x.price]); if (picked.indexOf(x.name) < 0) picked.push(x.name); });
    renderIdeas(); if (!on.length) { show('ideas'); return; } if (!t0) t0 = Date.now(); show('cam');
  }
  function toStock() { stockMode = true; $('aiB').hidden = true; $('aiC').hidden = false; stockRender(); stockFetch(aiFound.filter(function (x) { return x.on && !x.imgs; }), 0); }
  $('aiStock').addEventListener('click', function () { stockMode = false; toCamera(); });
  $('aiStockList').addEventListener('click', function (e) {
    var b = e.target.closest('.stk-yes'), m = e.target.closest('.stk-img');
    if (b) { var x = aiFound[+b.dataset.i]; x.yes = !x.yes; stockRender(); }
    else if (m) { var y = aiFound[+m.dataset.i]; if (y.imgs && y.imgs.length > 1) { y.k = ((y.k || 0) + 1) % y.imgs.length; y.yes = false; stockRender(); } }
  });
  $('aiList').addEventListener('click', function (e) {
    var pm = e.target.closest('.aipm'); if (pm) { var y = aiFound[+pm.dataset.i]; y.price = Math.max(MIN, y.price + (+pm.dataset.d)); aiRender(); return; }
    var b = e.target.closest('.airt'); if (!b) return; var x = aiFound[+b.dataset.i]; x.on = !x.on; aiRender(); });
  $('aiGo').addEventListener('click', function () {
    var go = this;
    if (stockMode) {
      var items = aiFound.filter(function (x) { return x.on && x.yes && x.imgs && x.imgs.length; }).map(function (x) { var im = x.imgs[x.k || 0]; return { name: x.name, price: x.price, img: im.src, thumb: im.thumb }; });
      if (!items.length) return; go.disabled = true; go.textContent = 'POSTING…';
      fetch('/api/list-stock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: items, lat: window._gps ? window._gps[0] : undefined, lng: window._gps ? window._gps[1] : undefined }) }).then(function (r) { if (r.status === 401) { location.href = '/login?next=/list'; return null; } return r.json(); }).then(function (j) { if (!j) return; var L = (j.listed || []).slice().sort(function (a, b) { return a.i - b.i; }); shots = L.map(function (r) { return { name: r.name, price: r.price, url: r.photo || items[r.i].thumb, cutUrl: r.cut }; }); j.listed = L;
        if (!L.length) { go.textContent = 'TRY AGAIN'; go.disabled = false; return; } renderDone(j); show('done'); }).catch(function () { go.textContent = 'TRY AGAIN'; go.disabled = false; });
      return;
    }
    if (aiFound) { if (CFG.stock && aiFound.some(function (x) { return x.on; })) toStock(); else toCamera(); return; }
    var txt = $('aiPaste').value.trim(); if (txt.length < 4) { $('aiPaste').focus(); return; }
    go.disabled = true; go.textContent = 'READING…';
    fetch('/api/ai-ideas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: txt.slice(0, 12000) }) }).then(function (r) { return r.json(); }).then(function (j) {
      aiFound = (j.items || []).map(function (x) { return { name: x.name, detail: [x.model, x.year].filter(Boolean).join(' · '), price: Math.max(MIN, x.price || 10), on: true }; });
      $('aiA').hidden = true; $('aiB').hidden = false; aiRender();
    }).catch(function () { go.textContent = 'TRY AGAIN'; }).then(function () { go.disabled = false; });
  });

  // ---- camera
  var video = $('cam'), canvas = document.createElement('canvas');
  var wantCam = false;
  function startCam() {
    updateHint();
    $('st-cam').classList.toggle('upmode', HOVERDEV && !stream && !wantCam);
    if (HOVERDEV && !wantCam && !stream) { $('camFallback').hidden = true; return; } /* computers: upload panel, no webcam pointed at you */
    if (stream || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { if (!stream) $('camFallback').hidden = false; return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 } }, audio: false })
      .then(function (s) { stream = s; video.srcObject = s; video.play(); $('camFallback').hidden = true; $('st-cam').classList.remove('upmode'); })
      .catch(function () { $('camFallback').hidden = false; });
  }
  function stopCam() { if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; video.srcObject = null; } }
  function nextName() { if (retakeIdx != null) return shots[retakeIdx].name; var named = shots.map(function (s) { return s.name; }); for (var i = 0; i < picked.length; i++) if (named.indexOf(picked[i]) < 0) return picked[i]; return ''; }
  function updateHint() { var n = nextName(); var big = retakeIdx != null ? 'Retake: ' + n : n; $('hintBig').textContent = big || ''; $('hintBig').hidden = !big; $('hint').textContent = retakeIdx != null ? '' : picked.length ? (picked.length - shots.filter(function (s) { return picked.indexOf(s.name) > -1; }).length) + ' left on your list' : 'One thing per photo'; $('hint').classList.toggle('solo', !big); $('count').textContent = shots.length; $('thumbWrap').hidden = !shots.length; $('doneBtn').hidden = !shots.length; $('doneBtn').textContent = 'Done (' + shots.length + ') →'; $('tapHint').hidden = !!shots.length; if (shots.length) $('thumb').src = shots[shots.length - 1].url; renderMiniList(); }
  function renderMiniList() { var el = $('miniList'); if (!picked.length) { el.hidden = true; return; } el.hidden = false; el.innerHTML = picked.map(function (n) { var done = shots.some(function (s) { return s.name === n || s.hint === n; }); return '<span class="' + (done ? 'done' : '') + '">' + (done ? '✓ ' : '○ ') + esc(n) + '</span>'; }).join(''); }
  function addShot(blob) {
    var url = URL.createObjectURL(blob), name = nextName(), idea = IDEAS.filter(function (i) { return i[1] === name; })[0];
    if (retakeIdx != null) { var rs = shots[retakeIdx]; rs.blob = blob; rs.url = url; rs.cutUrl = null; rs.touched = {}; retakeIdx = null; cutFast(rs); identify(rs); show('q'); return; }
    var shot = { blob: blob, url: url, name: name, price: idea ? Math.max(MIN, idea[2]) : MIN, week: 0, note: '', hint: name, ai: null, touched: {} };
    shots = [shot]; cutFast(shot); identify(shot); QI = 0; setTimeout(function () { show('q'); }, 250); /* one thing at a time: no Done, straight to the questions */
    $('flash').classList.add('on'); setTimeout(function () { $('flash').classList.remove('on'); }, 220);
    $('toast').classList.add('on'); clearTimeout($('toast')._t); $('toast')._t = setTimeout(function () { $('toast').classList.remove('on'); }, 1100);
    updateHint();
  }
  // crop the transparent padding off a cutout → data URL (falls back to the original URL)
  function trimUrl(im, fallback) { try { var c = document.createElement('canvas'), W = im.naturalWidth, H = im.naturalHeight; c.width = W; c.height = H; var g = c.getContext('2d'); g.drawImage(im, 0, 0);
    var d = g.getImageData(0, 0, W, H).data, x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (var y = 0; y < H; y += 2) for (var x = 0; x < W; x += 2) if (d[(y * W + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 <= x0) return fallback; var pad = 6, o = document.createElement('canvas'); o.width = x1 - x0 + 1 + pad * 2; o.height = y1 - y0 + 1 + pad * 2; o.getContext('2d').drawImage(c, x0, y0, x1 - x0 + 1, y1 - y0 + 1, pad, pad, x1 - x0 + 1, y1 - y0 + 1); return o.toDataURL('image/png'); } catch (e) { return fallback; } }
  /* cut-out starts right at the snap (doesn't wait for identify); shows up in the photo at the top as soon as it lands */
  function cutFast(shot) {
    var fd = new FormData(); fd.append('photo', shot.blob, 'p.jpg');
    fetch('/api/cut', { method: 'POST', body: fd }).then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) {
      if (!b || shots[0] !== shot) return; var ci = new Image(); ci.onload = function () { shot.cutUrl = trimUrl(ci, ci.src); var im = $('qImg'); if (im && step === 'q') { im.src = shot.cutUrl; im.className = 'cut'; } }; ci.src = URL.createObjectURL(b);
    }).catch(function () {});
  }
  function identify(shot) {
    var fd = new FormData(); fd.append('photo', shot.blob, 'p.jpg'); if (shot.labelBlob) fd.append('label', shot.labelBlob, 'label.jpg'); if (shot.hint) fd.append('hint', shot.hint);
    shot.pending = true;
    fetch('/api/identify', { method: 'POST', body: fd }).then(function (r) { return r.json(); }).then(function (j) {
      shot.pending = false; if ($('qId')) $('qId').hidden = true; if (!j || j.error) return; shot.ai = j; shot.askLabel = !!j.ask_label && !shot.labelBlob;
      if (j.cut && !shot.cutUrl) { var ci = new Image(); ci.onload = function () { shot.cutUrl = trimUrl(ci, j.cut); var k = shots.indexOf(shot), im = k < 0 ? null : document.querySelector('.row-item[data-i="' + k + '"] .rt img'); if (im) { im.src = shot.cutUrl; im.classList.add('cut'); } }; ci.src = j.cut; }
      if (!shot.touched.name || shot.labelBlob) shot.name = j.name || shot.name;
      if (!shot.touched.price) { shot.price = Math.max(MIN, Math.round(j.price_cents / 100)); shot.week = Math.round((j.week_cents || 0) / 100); }
      if (!shot.touched.note && j.description) shot.note = j.description;
      if (step === 'review') renderReview(); else if (step === 'q') renderQ(true); else updateHint();
    }).catch(function () { shot.pending = false; if ($('qId')) $('qId').hidden = true; });
  }
  function snap() {
    if (!stream) { $('file').click(); return; }
    var w = video.videoWidth, h = video.videoHeight, s = Math.min(1, 1400 / Math.max(w, h));
    canvas.width = Math.round(w * s); canvas.height = Math.round(h * s);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(function (b) { if (b) addShot(b); }, 'image/jpeg', 0.86);
  }
  $('shutter').addEventListener('click', snap);
  /* one way in for any picked or dropped picture: shrink → same path as a snapped photo */
  function useFile(f) {
    if (!f || !(/^image\//.test(f.type || '') || /\.(heic|heif|jpe?g|png|webp|gif|avif)$/i.test(f.name || ''))) return;
    var busy = $('upBusy'); busy.hidden = false;
    var draw = function (src, done) { var img = new Image(); img.onload = function () { var s = Math.min(1, 1400 / Math.max(img.width, img.height)); canvas.width = Math.round(img.width * s); canvas.height = Math.round(img.height * s); canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height); canvas.toBlob(function (b) { busy.hidden = true; if (b) addShot(b); }, 'image/jpeg', 0.86); }; img.onerror = done; img.src = src; };
    /* HEIC (iPhone photos) and other formats this browser can't open: convert on the server first */
    var convert = function () { var fd = new FormData(); fd.append('photo', f, f.name || 'photo'); fetch('/api/to-jpeg', { method: 'POST', body: fd }).then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) { if (!b) throw 0; draw(URL.createObjectURL(b), function () { busy.hidden = true; }); }).catch(function () { busy.hidden = true; if (window.toast) window.toast('Couldn’t open that photo · try a JPG or PNG'); }); };
    if (/heic|heif/i.test(f.type || '') || /\.hei[cf]$/i.test(f.name || '')) { var u = URL.createObjectURL(f); draw(u, convert); return; } /* Safari opens HEIC itself; others convert */
    draw(URL.createObjectURL(f), convert);
  }
  $('file').addEventListener('change', function () { useFile(this.files[0]); this.value = ''; });
  /* photo library (phones) / choose a file (computers): standard bottom-left spot of a camera screen */
  $('pickFile').addEventListener('change', function () { useFile(this.files[0]); this.value = ''; });
  $('libBtn').addEventListener('click', function () { $('pickFile').click(); });
  /* computers: drop a photo anywhere on the camera screen */
  (function () { var cam = $('st-cam'), n = 0;
    function has(e) { return e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], 'Files') > -1; }
    cam.addEventListener('dragenter', function (e) { if (!has(e)) return; e.preventDefault(); n++; cam.classList.add('dropping'); });
    cam.addEventListener('dragover', function (e) { if (has(e)) e.preventDefault(); });
    cam.addEventListener('dragleave', function () { if (--n <= 0) { n = 0; cam.classList.remove('dropping'); } });
    cam.addEventListener('drop', function (e) { e.preventDefault(); n = 0; cam.classList.remove('dropping'); var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) useFile(f); });
    /* a photo dropped anywhere else on the page doesn't open in the browser tab */
    window.addEventListener('dragover', function (e) { if (has(e)) e.preventDefault(); }); window.addEventListener('drop', function (e) { if (has(e)) e.preventDefault(); });
  })();
  $('camFallback').addEventListener('click', function () { (HOVERDEV ? $('pickFile') : $('file')).click(); });
  $('useCam').addEventListener('click', function () { wantCam = true; startCam(); });
  $('upPick').addEventListener('click', function () { $('pickFile').click(); });
  $('doneBtn').addEventListener('click', function () { show('review'); });
  $('thumbWrap').addEventListener('click', function () { show('review'); });
  $('camClose').addEventListener('click', function () { if (shots.length) show('review'); else show('ideas'); });

  // ---- review
  function undoToast(msg, undo) {
    var t = $('undoT'); if (!t) { t = document.createElement('div'); t.id = 'undoT'; t.className = 'undo-t'; document.body.appendChild(t); }
    t.innerHTML = '<span></span><button type="button">Undo</button>'; t.firstChild.textContent = msg; t.hidden = false;
    clearTimeout(t._h); t._h = setTimeout(function () { t.hidden = true; }, 5000);
    t.lastChild.onclick = function () { t.hidden = true; undo(); };
  }
  var GW = { A: 'Great', B: 'Good', C: 'OK', D: 'Poor', E: 'Junk' };
  function renderReview() {
    $('rvCount').textContent = shots.length + ' in ' + clock();
    $('rows').innerHTML = shots.map(function (s, i) {
      return '<div class="row-item" data-i="' + i + '">' +
        '<div class="rtcol"><button type="button" class="rt" data-act="retake"><img src="' + (s.cutUrl || s.url) + '" alt=""' + (s.cutUrl ? ' class="cut"' : '') + '><span>↻ Retake</span></button>' +
        '<div class="xtra">' + (s.extra || []).map(function (x, k) { return '<button type="button" class="xt" data-act="xdel" data-k="' + k + '" aria-label="Remove photo"><img src="' + x.url + '" alt=""><b>×</b></button>'; }).join('') + ((s.extra || []).length < 5 ? '<button type="button" class="xadd" data-act="xadd" aria-label="Add photos">+</button>' : '') + '</div></div>' +
        '<div class="mid"><div class="nmwrap"><input class="nm" data-act="name" value="' + esc(s.name) + '" placeholder="' + (s.pending ? '' : 'What is it?') + '" maxlength="80">' + (s.pending && !s.name ? '<span class="idwait">Identifying<span class="dots"><i>.</i><i>.</i><i>.</i></span></span>' : '') + '</div>' +
        (s.askLabel && !s.pending ? '<button type="button" class="asklabel" data-act="label">📷 Brand? Snap the logo or label</button>' : '') + '<div class="pricerow"><button type="button" class="pm" data-act="dn" aria-label="Lower">−</button><span class="badge">$' + s.price + '<small>/day</small></span><button type="button" class="pm" data-act="up" aria-label="Raise">+</button></div>' + '<div class="grdrow"><button type="button" class="grdbtn" data-act="grade" aria-label="Condition, tap to change"><span class="grd g' + (s.grade || 'A') + '"><b>' + (s.grade || 'A') + '</b><small>CONDITION</small><i>▾</i></span></button><span class="grdw">' + GW[s.grade || 'A'] + '</span></div>' +
        '<textarea class="note" data-act="note" rows="2" placeholder="✎ model · what’s included · condition · good for" maxlength="400">' + esc(s.note) + '</textarea>' + (window.lendoDetails && !s.pending ? '<div class="dmeter">' + window.lendoDetails(s.note) + '</div>' : '') + '</div>' +
        '<button type="button" class="del" data-act="del" aria-label="Remove this item"><svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true"><path d="M2 5h14M7 5V3h4v2M4 5l1 13h8l1-13" fill="none" stroke="#9B968C" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>';
    }).join('') || '<div class="hint" style="padding:20px 0">Nothing yet.</div>';
    $('rows').querySelectorAll('textarea.note').forEach(grow);
    $('listBtn').textContent = shots.length === 1 ? 'LIST IT' : 'LIST ALL ' + shots.length;
    var pend = shots.some(function (s) { return s.pending; });
    $('listBtn').disabled = !shots.length || pend || shots.some(function (s) { return !s.name.trim(); });
    if (pend) $('listBtn').innerHTML = 'IDENTIFYING<span class="dots"><i>.</i><i>.</i><i>.</i></span>';
  }
  $('rows').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return; var row = b.closest('.row-item'), i = +row.dataset.i, act = b.dataset.act;
    if (act === 'retake') { retakeIdx = i; show('cam'); }
    if (act === 'xadd') { moreFor = i; $('moreFile').value = ''; $('moreFile').click(); }
    if (act === 'label') { labelFor = shots[i]; $('labelFile').value = ''; $('labelFile').click(); }
    if (act === 'xdel') { (shots[i].extra || []).splice(+b.dataset.k, 1); renderReview(); }
    if (act === 'dn') { shots[i].price = Math.max(MIN, shots[i].price - 1); shots[i].week = 0; shots[i].touched.price = true; renderReview(); }
    if (act === 'up') { shots[i].price += 1; shots[i].week = 0; shots[i].touched.price = true; renderReview(); }
    if (act === 'grade') { var G = 'ABCDE', g = shots[i].grade || 'A'; shots[i].grade = G[(G.indexOf(g) + 1) % 5]; renderReview(); }
    if (act === 'del') { var gone = shots.splice(i, 1)[0]; renderReview(); undoToast('Removed ' + (gone.name || 'item'), function () { shots.splice(i, 0, gone); renderReview(); }); }
  });
  var labelFor = null;
  $('labelFile').addEventListener('change', function () { var sh = labelFor, f = this.files[0]; if (!sh || !f) return; shrink(f, function (b) { sh.labelBlob = b; sh.askLabel = false; sh.touched.name = false; identify(sh); if (step === 'q') renderQ(); else renderReview(); }); });
  $('moreFile').addEventListener('change', function () { var i = moreFor; if (i == null || !shots[i]) return; var fs = Array.prototype.slice.call(this.files, 0, 5 - (shots[i].extra || []).length); fs.forEach(function (f) { shrink(f, function (b) { (shots[i].extra = shots[i].extra || []).push({ blob: b, url: URL.createObjectURL(b) }); if (step === 'q') renderQ(); else renderReview(); }); }); });
  $('rows').addEventListener('input', function (e) { var inp = e.target, row = inp.closest('.row-item'); if (!row) return; var i = +row.dataset.i; if (inp.dataset.act === 'name') { shots[i].name = inp.value; shots[i].touched.name = true; $('listBtn').disabled = shots.some(function (s) { return !s.name.trim(); }); } if (inp.dataset.act === 'note') { shots[i].note = inp.value; shots[i].touched.note = true; grow(inp); var dm = row.querySelector('.dmeter'); if (dm && window.lendoDetails) dm.innerHTML = window.lendoDetails(inp.value); } });
  function grow(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 160) + 'px'; }
  $('backCam').addEventListener('click', function () { show('cam'); });
  $('listBtn').addEventListener('click', function () { needWhere(postShots); });
  function postShots() {
    var fd = new FormData(); shots.forEach(function (s, i) { (s.extra || []).forEach(function (x, k) { fd.append('photo_' + i + '_' + (k + 1), x.blob, 'p' + i + '_' + (k + 1) + '.jpg'); }); fd.append('name_' + i, s.name.trim()); if (s.ai && s.ai.name) fd.append('ai_' + i, s.ai.name); fd.append('price_' + i, s.price); fd.append('week_' + i, s.week || 0); fd.append('note_' + i, s.note); fd.append('grade_' + i, s.grade || 'A'); fd.append('photo_' + i, s.blob, 'p' + i + '.jpg'); });
    if (window._gps) { fd.append('lat', window._gps[0]); fd.append('lng', window._gps[1]); }
    $('listBtn').disabled = true; $('listBtn').textContent = 'LISTING…';
    fetch('/api/list', { method: 'POST', body: fd }).then(function (r) { if (r.status === 401) { location.href = '/login?next=/list'; return null; } return r.json(); }).then(function (j) { if (!j) return; renderDone(j); show('done'); }).catch(function () { $('listBtn').disabled = false; $('listBtn').textContent = 'TRY AGAIN'; });
 }

  // ---- done
  function renderDone(j) {
    clearInterval(clockT);
    var escH = function (x) { return String(x).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); };
    var Lc = (j && j.listed) || [];
    $('tray').innerHTML = shots.map(function (s, k) { var cu = s.cutUrl || (Lc[k] && Lc[k].cut); return '<img src="' + (cu || s.url) + '" alt="" class="dn2-img' + (cu ? ' cut' : '') + '" onerror="if(this.src!==\'' + s.url + '\'){this.src=\'' + s.url + '\';this.className=\'dn2-img\'}"><div class="dn2-pr">$' + s.price + '<small>/day</small></div><div class="dn2-nm">' + escH(s.name.trim()) + '</div>'; }).join('');
    /* tap the picture or name → the item page */
    var L0 = Lc[0]; if (L0) { var tr = $('tray'), a = document.createElement('a'); a.href = L0.url || '/i/' + L0.id; a.className = 'dn2-tray'; a.id = 'tray'; a.innerHTML = tr.innerHTML; tr.parentNode.replaceChild(a, tr); }
    $('dnHead').textContent = shots.length === 1 ? 'Posted' : shots.length + ' posted';
    $('again').lastChild.textContent = 'List more stuff';
    $('dnSub').textContent = shots.length === 1 ? 'Live on the map — neighbors can rent it now' : 'Live on the map — neighbors can rent them now';

    var L = (j && j.listed) || [], one = shots.length === 1 && L[0], minP = Math.min.apply(null, shots.map(function (s) { return s.price; }));
    var text = one ? 'Renting out my ' + shots[0].name.trim().toLowerCase() + ' — $' + shots[0].price + '/day' + (CFG.hood ? ', pickup in ' + CFG.hood : '') : 'Renting out ' + shots.length + ' things' + (CFG.hood ? ' in ' + CFG.hood : '') + ', from $' + minP + '/day', url = one ? (L[0].url || location.origin + '/i/' + L[0].id) : CFG.shareUrl, full = text + ' ' + url, enc = encodeURIComponent(full);
    var toast = function (t) { $('shToast').textContent = t; $('shToast').classList.add('on'); setTimeout(function () { $('shToast').classList.remove('on'); }, 2000); };
    var copy = function (t) { try { navigator.clipboard.writeText(full); } catch (e) {} toast(t); };
    var B = [['💬', 'Text', function () { location.href = 'sms:?&body=' + enc; }], ['🟢', 'WhatsApp', function () { window.open('https://wa.me/?text=' + enc, '_blank'); }], ['🔗', 'Copy link', function () { copy('Copied'); }], ['⬇', 'Story image', function () { $('stSave').click(); }]];
    $('shBtns').innerHTML = B.map(function (b, i) { return '<button type="button" data-i="' + i + '" aria-label="' + b[1] + '"><span class="ic">' + b[0] + '</span><span>' + b[1] + '</span></button>'; }).join('');
    $('shBtns').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; B[+b.dataset.i][2](); };
    SHARE = { text: text, url: url }; drawStory(L, url);
  }
  // ---- story card (1080x1920): real item cut out on cream, name + price, QR to the item
  var SHARE = { text: '', url: location.origin };
  function drawStory(L, url) {
    var cv = $('story'), g = cv.getContext('2d'), W = 1080, H = 1920, F = '"Helvetica Neue",Helvetica,Arial,sans-serif';
    var one = shots.length === 1, minP = Math.min.apply(null, shots.map(function (s) { return s.price; }));
    function base(imgs) {
      /* 1080×1920 for Stories, but everything that matters sits in the middle 4:5 band (y 285–1635):
         Instagram's composer opens shared images cropped to 4:5 */
      g.fillStyle = '#F5F3EE'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#1E3A2B'; g.fillRect(0, 0, W, 285); g.fillRect(0, 1635, W, H - 1635);
      g.textBaseline = 'alphabetic'; g.textAlign = 'center'; g.fillStyle = '#F5F3EE'; g.font = '700 34px ui-monospace,Menlo,monospace'; g.fillText('MAKE MONEY · SAVE SPACE · BUY LESS', W / 2, 160);
      g.fillStyle = '#FF4F00'; g.font = '900 40px ' + F; g.fillText('NEIGHBORS RENTING TO NEIGHBORS', W / 2, 1790);
      g.textAlign = 'left'; g.fillStyle = '#1E3A2B'; g.font = '900 48px ' + F; g.fillText('👋 Lendo', 70, 360);
      g.textAlign = 'right'; g.fillStyle = '#FF4F00'; g.font = '900 38px ' + F; g.fillText('FOR RENT' + (CFG.hood ? ' · ' + CFG.hood.toUpperCase().slice(0, 22) : ''), W - 70, 358);
      // item(s)
      var box = { x: 110, y: 400, w: 860, h: 600 };
      var n = imgs.length, cols = n === 1 ? 1 : 2, rows = Math.ceil(Math.min(n, 4) / cols), cw = box.w / cols, ch = box.h / rows;
      imgs.slice(0, 4).forEach(function (im, k) { if (!im) return; var cx = box.x + (k % cols) * cw, cy = box.y + Math.floor(k / cols) * ch, sc = Math.min((cw - 30) / im.width, (ch - 30) / im.height);
        var w = im.width * sc, h = im.height * sc; g.drawImage(im, cx + (cw - w) / 2, cy + (ch - h) / 2, w, h); });
      // name + price
      g.fillStyle = '#1E3A2B'; g.textAlign = 'center'; g.font = '900 88px ' + F;
      var title = one ? shots[0].name.trim() : shots.length + ' things to rent'; if (g.measureText(title).width > 940) { while (g.measureText(title + '…').width > 940 && title.length > 4) title = title.slice(0, -1); title += '…'; }
      g.fillText(title, W / 2, 1105);
      var tag = (one ? '$' + shots[0].price : 'from $' + minP) + '/day'; g.font = '900 68px ' + F; var tw = g.measureText(tag).width + 64;
      g.fillStyle = '#1E3A2B'; g.fillRect(W / 2 - tw / 2 + 8, 1146, tw, 100); g.fillStyle = '#FF4F00'; g.fillRect(W / 2 - tw / 2, 1138, tw, 100); g.fillStyle = '#fff'; g.fillText(tag, W / 2, 1212);
      // QR + scan line
      try { var q = qrcode(0, 'M'); q.addData(url); q.make(); var m = q.getModuleCount(), S = 230, cell = S / m, qx = 110, qy = 1300;
        g.fillStyle = '#fff'; g.fillRect(qx - 14, qy - 14, S + 28, S + 28); g.fillStyle = '#1E3A2B';
        for (var r = 0; r < m; r++) for (var c2 = 0; c2 < m; c2++) if (q.isDark(r, c2)) g.fillRect(qx + c2 * cell, qy + r * cell, Math.ceil(cell), Math.ceil(cell)); } catch (e) {}
      g.textAlign = 'left'; g.fillStyle = '#1E3A2B'; g.font = '900 56px ' + F; g.fillText('Scan to rent', 390, 1395);
      g.font = '700 34px ' + F; g.fillStyle = '#4A463F'; var u2 = url.replace(/^https?:\/\//, ''); while (g.measureText(u2).width > 620 && u2.length > 10) u2 = u2.slice(0, -1); g.fillText(u2, 390, 1458);
    }
    // cutouts load async; draw with photos first, swap to cutouts as they arrive
    var imgs = shots.slice(0, 4).map(function () { return null; });
    function redraw() { base(imgs); }
    shots.slice(0, 4).forEach(function (s, k) {
      var ph = new Image(); ph.onload = function () { if (!imgs[k] || !imgs[k]._cut) { imgs[k] = ph; redraw(); } }; ph.src = s.url;
      if (s.cutUrl) { var c0 = new Image(); c0.onload = function () { imgs[k] = trimAlpha(c0); redraw(); }; c0.src = s.cutUrl; }
      else if (L[k]) { var tries = 0, get = function () { var im = new Image(); im._cut = true; im.onload = function () { imgs[k] = trimAlpha(im); redraw(); }; im.onerror = function () { if (++tries < 6) setTimeout(get, 3000); }; im.src = '/api/cut/' + L[k].id + '?t=' + tries; }; setTimeout(get, 600); }
    });
    redraw();
    // crop transparent padding so the item fills its box
    function trimAlpha(im) { try { var c = document.createElement('canvas'); c.width = im.width; c.height = im.height; var x = c.getContext('2d'); x.drawImage(im, 0, 0);
      var d = x.getImageData(0, 0, c.width, c.height).data, x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
      for (var y = 0; y < c.height; y += 2) for (var xx = 0; xx < c.width; xx += 2) if (d[(y * c.width + xx) * 4 + 3] > 20) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 <= x0) return im; var o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1; o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height); o._cut = true; return o; } catch (e) { return im; } }
    function blob(cb) { cv.toBlob(function (b) { cb(b); }, 'image/png'); }
    $('stShare').onclick = function () { blob(function (b) { var f = new File([b], 'lendo-story.png', { type: 'image/png' });
      /* phone: share sheet with the story image + link; no file sharing: just the link; desktop: copy the link */
      if (navigator.canShare && navigator.canShare({ files: [f] })) navigator.share({ files: [f], text: SHARE.text, url: SHARE.url }).catch(function () {});
      else if (navigator.share) navigator.share({ text: SHARE.text, url: SHARE.url }).catch(function () {});
      else { try { navigator.clipboard.writeText(SHARE.text + ' ' + SHARE.url); } catch (e) {} $('shToast').style.display = ''; $('shToast').textContent = 'Link copied'; $('shToast').classList.add('on'); setTimeout(function () { $('shToast').classList.remove('on'); }, 2000); } }); };
    $('stSend').onclick = function () { /* text + link only (iMessage etc.); desktop: copy */
      if (navigator.share) navigator.share({ text: SHARE.text, url: SHARE.url }).catch(function () {});
      else { try { navigator.clipboard.writeText(SHARE.text + ' ' + SHARE.url); } catch (e) {} $('shToast').style.display = ''; $('shToast').textContent = 'Link copied'; $('shToast').classList.add('on'); setTimeout(function () { $('shToast').classList.remove('on'); }, 2000); } };
    $('stSave').onclick = function () { blob(dl); };
    function dl(b) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'lendo-story.png'; document.body.appendChild(a); a.click(); a.remove(); }
  }
  $('again').addEventListener('click', function () { shots = []; picked = []; QI = 0; t0 = Date.now(); renderIdeas(); show('cam'); });

  // ---- one question at a time (card stack). Item questions first, then sign-up (only if logged out), then list
  var QI = 0, HAVE = false, ME = CFG.user, SIGNUP = !CFG.user, NEED = { name: !ME || !ME.name, hood: !ME || !ME.hood }, ITEMQ = { grade: 1, name: 1, price: 1, note: 1 }, PNAME = '', /* question list is fixed once known, so answering doesn't shift it */ AUTH = { phone: '', pretty: '' }, G = { A: 'Great', B: 'Good', C: 'OK', D: 'Poor', E: 'Junk' };
  function cur() { return shots[0]; }
  function qs() {
    /* questions that don't need the photo lookup come first, so the AI name/price/details are ready by the time they're asked */
    var s = cur(), L = [{ k: 'grade', line: function () { return 'Condition ' + (s.grade || 'A') + ' · ' + G[s.grade || 'A']; } }];
    var FN = { k: 'fname', line: function () { return (ME && ME.name) || PNAME; } };
    if (NEED.name && !HAVE) L.push(FN); /* name before phone — unless they said they're already on Lendo */
    if (SIGNUP) L.push({ k: 'phone', line: function () { return AUTH.pretty || AUTH.phone; } }, { k: 'code', line: function () { return 'Phone confirmed'; } });
    if (NEED.name && HAVE) L.push(FN); /* returning person whose account has no name yet */
    if (!(ME && ME.email) || NEED.email) { NEED.email = true; L.push({ k: 'email', line: function () { return (ME && ME.email) || ''; } }); } /* required: receipts + anything a text misses */
    if (NEED.hood) L.push({ k: 'hood', line: function () { return (ME && ME.hood) || ''; } });
    L.push({ k: 'name', line: function () { return s.name || '…'; } }, { k: 'price', line: function () { return '$' + s.price + '/day'; } }, { k: 'note', line: function () { return s.note ? s.note : 'No details'; } });
    return L;
  }
  function renderQ(soft) {
    var s = cur(); if (!s) { show('cam'); return; }
    var L = qs(); if (QI >= L.length) return listIt();
    var im = $('qImg'); im.src = s.cutUrl || s.url; im.className = s.cutUrl ? 'cut' : ''; $('qId').hidden = !s.pending; /* animated dots on the photo while it's being identified */
    $('qDone').innerHTML = L.slice(0, QI).map(function (q, i) { var t = q.line(); if (q.k === 'code' || !t) return ''; return '<button type="button" class="q-line" data-i="' + i + '"><span>' + esc(t) + '</span>' + (ITEMQ[q.k] ? '<b>✎</b>' : '') + '</button>'; }).join('');
    var q = L[QI], h = '', n = 'Question ' + (QI + 1) + ' of ' + L.length;
    if (soft && (!(q.k === 'name' || q.k === 'price' || q.k === 'note') || s.touched[q.k])) return; /* identify result arrived: only refresh cards that show its guesses */
    if (q.k === 'name') h = card(n, 'What is it?', s.pending ? '<span class="dots"><i>.</i><i>.</i><i>.</i></span>' : '',
      '<input class="q-in" id="qv" value="' + esc(s.name) + '" maxlength="80" placeholder="' + (s.pending ? '' : 'Drill, tent, speaker…') + '">' + (s.askLabel && !s.pending ? '<div class="q-chips"><button type="button" id="qLabel">📷 Snap the brand label</button></div>' : ''), 'Next');
    if (q.k === 'grade') h = card(n, 'What shape is it in?', '', '<div class="q-grades">' + 'ABCDE'.split('').map(function (g) { return '<button type="button" data-g="' + g + '" class="' + ((s.grade || '') === g ? 'on' : '') + '">' + g + '<small>' + G[g].toLowerCase() + '</small></button>'; }).join('') + '</div>', null);
    if (q.k === 'price') h = card(n, 'How much a day?', '',
      '<div class="q-price"><button type="button" class="q-pm" data-d="-1" aria-label="Lower">−</button><label class="q-pbox">$<input class="q-in" id="qv" inputmode="numeric" value="' + s.price + '"><small>/day</small></label><button type="button" class="q-pm" data-d="1" aria-label="Raise">+</button></div>', 'Next');
    if (q.k === 'note') h = card(n, 'Anything else?', '', '<textarea class="q-ta" id="qv" maxlength="400" placeholder="Model, what’s included…">' + esc(s.note || '') + '</textarea>' + (window.lendoDetails ? '<div class="dmeter" id="qMeter">' + window.lendoDetails(s.note || '') + '</div>' : '') + '<div class="q-chips"><button type="button" id="qMore">📷 Add more photos' + ((s.extra || []).length ? ' (' + s.extra.length + ')' : '') + '</button></div>', 'Next');
    if (q.k === 'phone') h = card(n, 'Your cell #', '', '<input class="q-in" id="qv" type="tel" autocomplete="tel" inputmode="tel" placeholder="(646) 555-0101" value="' + esc(AUTH.phone) + '">', 'Text me a code');
    if (q.k === 'code') h = card(n, 'Code we texted', AUTH.dev ? 'DEV code ' + AUTH.dev : '', '<input class="q-in" id="qv" inputmode="numeric" autocomplete="one-time-code" maxlength="6" style="letter-spacing:.3em">', 'Confirm');
    if (q.k === 'fname') h = card(n, 'Your first name', '', '<input class="q-in" id="qv" autocomplete="given-name" maxlength="40" value="' + esc((ME && ME.name) || PNAME) + '">' + (!ME ? '<button type="button" class="q-have" id="qHave">Already on Lendo? Use your phone #</button>' : ''), 'Next');
    if (q.k === 'email') h = card(n, 'Your email', 'Only for receipts and anything a text misses', '<input class="q-in" id="qv" type="email" inputmode="email" autocomplete="email" maxlength="120" placeholder="you@email.com" value="' + esc((ME && ME.email) || '') + '">', 'Next', false);
    if (q.k === 'hood') h = card(n, 'Your neighborhood', '', '<input class="q-in" id="qv" maxlength="60" placeholder="West Village" value="' + esc(CFG.hood || '') + '">', 'Next', true);
    $('qCard').innerHTML = h; var v = $('qv'); if (v && !soft) setTimeout(function () { try { v.focus({ preventScroll: true }); } catch (e) {} }, 60);
  }
  function card(k, title, sub, body, next, skip) {
    var last = QI === qs().length - 1;
    var L = qs().length; return '<div class="q-prog"><i style="width:' + Math.round((QI + 1) / L * 100) + '%"></i></div><div class="q-h">' + title + '</div>' + (sub ? '<div class="q-sub">' + sub + '</div>' : '<div style="height:12px"></div>') + body + '<div class="q-err" id="qErr" hidden></div>' +
      (next ? '<button type="button" class="cta q-next" id="qNext">' + (last ? 'LIST IT' : next) + '</button>' : '') + (skip ? '<button type="button" class="q-skip" id="qSkip">Skip</button>' : '');
  }
  function err(t) { var e = $('qErr'); if (e) { e.textContent = t; e.hidden = !t; } }
  function go() { QI++; renderQ(); window.scrollTo(0, 0); }
  function api(url, body) { return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }); }
  function submitQ(skipped) {
    var s = cur(), q = qs()[QI], v = $('qv'), val = v ? v.value.trim() : '';
    if (q.k === 'name') { if (!val) return err('What is it?'); s.name = val; s.touched.name = true; return go(); }
    if (q.k === 'price') { var n = parseInt(val, 10); if (!(n >= MIN)) return err('At least $' + MIN + '/day'); s.price = n; s.week = 0; s.touched.price = true; return go(); }
    if (q.k === 'note') { if (!skipped) { s.note = val; s.touched.note = true; } return go(); }
    if (q.k === 'phone') { var b = $('qNext'); b.disabled = true; b.textContent = 'TEXTING…';
      return api('/api/auth/start', { phone: val }).then(function (j) { if (!j.ok) { b.disabled = false; b.textContent = 'Text me a code'; return err(j.error || 'Try again'); } AUTH = { phone: val, norm: j.phone, pretty: j.pretty, dev: j.dev }; go(); }).catch(function () { b.disabled = false; err('Try again'); }); }
    if (q.k === 'code') { var b2 = $('qNext'); b2.disabled = true;
      return api('/api/auth/verify', { phone: AUTH.norm, code: val }).then(function (j) { if (!j.ok) { b2.disabled = false; return err(j.error || 'Try again'); } ME = j.user; NEED.hood = !ME.hood; if (HAVE) NEED.name = !ME.name; if (PNAME && !ME.name) { ME.name = PNAME; api('/api/auth/me', { name: PNAME }); } var L = qs(), k = 0; for (var i = 0; i < L.length; i++) if (L[i].k === 'code') k = i; QI = k + 1; renderQ(); }); }
    if (q.k === 'fname') { if (!val) return err('A first name, so neighbors know who’s lending'); if (!ME) { PNAME = val; return go(); } /* not logged in yet: saved right after the code */ ME.name = val; return api('/api/auth/me', { name: val }).then(go, go); }
    if (q.k === 'email') { if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(val)) return err('An email, for receipts and anything a text misses'); ME = ME || {}; ME.email = val; return api('/api/auth/me', { email: val }).then(function (j) { if (j && j.ok === false) return err(j.error || 'Try again'); go(); }, go); }
    if (q.k === 'hood') { if (!skipped && val) { ME = ME || {}; ME.hood = val; CFG.hood = val; return api('/api/auth/me', { hood: val }).then(go, go); } return go(); }
  }
  $('qCard').addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t) return; var s = cur();
    if (t.id === 'qNext') return submitQ(false);
    if (t.id === 'qSkip') return submitQ(true);
    if (t.dataset.g) { s.grade = t.dataset.g; return go(); }
    if (t.dataset.d) { var pv = $('qv'), nv = Math.max(MIN, (parseInt(pv.value, 10) || MIN) + +t.dataset.d); pv.value = nv; s.touched.price = true; return; }
    if (t.dataset.p) { $('qv').value = t.dataset.p; [].forEach.call($('qCard').querySelectorAll('[data-p]'), function (b) { b.classList.toggle('on', b === t); }); return; }
    if (t.id === 'qLabel') { labelFor = s; $('labelFile').value = ''; $('labelFile').click(); }
    if (t.id === 'qMore') { moreFor = 0; $('moreFile').value = ''; $('moreFile').click(); }
  });
  $('qCard').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); submitQ(false); } });
  $('qCard').addEventListener('click', function (e) { if (e.target.id !== 'qHave') return; HAVE = true; NEED.name = false; renderQ(); }); /* fname drops out; phone takes its slot */
  $('qCard').addEventListener('input', function (e) { var s0 = cur(), q0 = qs()[QI]; if (e.target.id === 'qv' && s0 && q0) s0.touched[q0.k] = true; if (e.target.id === 'qv' && e.target.tagName === 'TEXTAREA' && $('qMeter') && window.lendoDetails) $('qMeter').innerHTML = window.lendoDetails(e.target.value); });
  $('qDone').addEventListener('click', function (e) { var b = e.target.closest('.q-line'); if (!b) return; var i = +b.dataset.i, q = qs()[i]; if (q && ITEMQ[q.k]) { QI = i; renderQ(); } });
  $('qPh').addEventListener('click', function () { retakeIdx = 0; show('cam'); });
  function listIt() { needWhere(listIt0); }
  function listIt0() {
    var s = cur(); $('qCard').innerHTML = '<div class="q-h" style="margin:8px 0">Listing<span class="dots"><i>.</i><i>.</i><i>.</i></span></div>';
    var fd = new FormData(); (s.extra || []).forEach(function (x, k) { fd.append('photo_0_' + (k + 1), x.blob, 'p0_' + (k + 1) + '.jpg'); });
    fd.append('name_0', s.name.trim()); if (s.ai && s.ai.name) fd.append('ai_0', s.ai.name); fd.append('price_0', s.price); fd.append('week_0', 0); fd.append('note_0', s.note || ''); fd.append('grade_0', s.grade || 'A'); fd.append('photo_0', s.blob, 'p0.jpg');
    if (window._gps) { fd.append('lat', window._gps[0]); fd.append('lng', window._gps[1]); }
    fetch('/api/list', { method: 'POST', body: fd }).then(function (r) { return r.json(); }).then(function (j) { if (!j || j.error) throw 0; renderDone(j); show('done');
      if (ME && !ME.replied && CFG.sms && !document.documentElement.classList.contains('android')) { var d = document.createElement('a'); d.className = 'dn2-ok-text'; d.href = CFG.sms; d.textContent = '💬 Text OK to Lendo so requests reach you'; var tr = $('tray'); tr.parentNode.insertBefore(d, tr.nextSibling); } })
      .catch(function () { $('qCard').innerHTML = '<div class="q-h">Didn’t go through</div><button type="button" class="cta q-next" id="qRetry">TRY AGAIN</button>'; $('qRetry').onclick = listIt; });
  }

  // gps once (silent)
  if (navigator.geolocation) navigator.geolocation.getCurrentPosition(function (p) { window._gps = [p.coords.latitude, p.coords.longitude]; }, function () {}, { timeout: 6000 });
  clockT = setInterval(function () { if (step === 'review') $('rvCount').textContent = shots.length + ' in ' + clock(); }, 1000);
  renderIdeas(); show('ideas');
  if (/^\/list\/ai\/?$/.test(location.pathname)) $('aiOpen').click();
})();
