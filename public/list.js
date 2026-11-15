// Snap-flow: ideas → camera (1 photo) → one question at a time (card stack; sign-up after the item questions) → done. Minimal copy. Config: window.LENDO_LIST = { minPrice, hood, shareUrl, hasGps }.
(function () {
  var CFG = window.LENDO_LIST || {}, MIN = CFG.minPrice || 8;
  var $ = function (id) { return document.getElementById(id); };
  // [icon key (same drawn icons as the map's wanted ghosts), name, $/day]
  var IDEAS = [['drill', 'Drill', 8], ['tent', 'Tent', 15], ['projector', 'Projector', 18], ['mixer2', 'Stand mixer', 10], ['speaker', 'Party speaker', 14], ['ladder', 'Ladder', 9], ['bike', 'Bike', 20], ['camera', 'Camera', 25], ['guitar', 'Guitar', 12], ['stroller2', 'Stroller', 10], ['pwasher', 'Pressure washer', 22],
    ['escooter', 'Scooter', 15], ['skis', 'Skis', 20], ['luggage', 'Suitcase', 8], ['kayak', 'Kayak', 35], ['airfryer', 'Air fryer', 8], ['espresso2', 'Espresso machine', 15], ['toolbox', 'Tool kit', 10], ['saw', 'Saw', 12], ['mic', 'Karaoke mic', 10], ['pickle', 'Pickleball set', 9], ['sewing2', 'Sewing machine', 12], ['telescope', 'Telescope', 18]];
  var moreFor = null;
  function shrink(f, cb) { var img = new Image(); img.onload = function () { var s = Math.min(1, 1400 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); c.toBlob(function (b) { if (b) cb(b); }, 'image/jpeg', 0.86); URL.revokeObjectURL(img.src); }; img.src = URL.createObjectURL(f); }
  var picked = [], shots = [], step = 'ideas', t0 = null, clockT, stream = null, retakeIdx = null, more = false;
  var fmt = function (n) { return '$' + n; };
  function esc(s) { return String(s).replace(/[<>&"]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]; }); }
  function show(name) { step = name; ['ideas', 'cam', 'review', 'q', 'done'].forEach(function (s) { $('st-' + s).hidden = s !== name; }); document.documentElement.classList.toggle('camdark', name === 'cam'); if (name === 'cam') startCam(); else stopCam(); if (name === 'review') renderReview(); if (name === 'q') renderQ(); }
  function clock() { if (!t0) return '0:00'; var s = Math.round((Date.now() - t0) / 1000); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }

  // ---- ideas
  var WANT = (function () { try { return new URLSearchParams(location.search).get('want') || ''; } catch (e) { return ''; } })();
  if (WANT && !IDEAS.some(function (i) { return i[1].toLowerCase() === WANT.toLowerCase(); })) IDEAS.unshift(['📦', WANT, 12]);
  if (WANT && picked.indexOf(WANT) < 0) { var wi = IDEAS.filter(function (i) { return i[1].toLowerCase() === WANT.toLowerCase(); })[0]; picked.push(wi ? wi[1] : WANT); }
  function renderIdeas() {
    var list = more ? IDEAS : IDEAS.slice(0, 10);
    $('ideas').innerHTML = list.map(function (i, k) { var on = picked.indexOf(i[1]) > -1; return '<button type="button" class="idea' + (on ? ' on' : '') + '" data-n="' + esc(i[1]) + '" data-p="' + i[2] + '"><span class="mk">' + (on ? '✓' : '') + '</span><span class="em"><img src="/p/wanted/' + i[0] + '.png" alt="" loading="lazy"></span><span class="nm">' + esc(i[1]) + '</span><span class="pr">~$' + i[2] + '/day</span></button>'; }).join('');
    $('moreIdeas').hidden = more;
    $('toCam').textContent = picked.length ? 'SNAP ' + picked.length + (picked.length === 1 ? ' THING' : ' THINGS') : 'OPEN CAMERA';
  }
  $('ideas').addEventListener('click', function (e) { var b = e.target.closest('.idea'); if (!b) return; var n = b.dataset.n, i = picked.indexOf(n); if (i > -1) picked.splice(i, 1); else picked.push(n); renderIdeas(); });
  $('moreIdeas').addEventListener('click', function () { more = true; renderIdeas(); });
  $('toCam').addEventListener('click', function () { if (!t0) t0 = Date.now(); show('cam'); });

  // ---- camera
  var video = $('cam'), canvas = document.createElement('canvas');
  function startCam() {
    updateHint();
    if (stream || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { if (!stream) $('camFallback').hidden = false; return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 } }, audio: false })
      .then(function (s) { stream = s; video.srcObject = s; video.play(); $('camFallback').hidden = true; })
      .catch(function () { $('camFallback').hidden = false; });
  }
  function stopCam() { if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; video.srcObject = null; } }
  function nextName() { if (retakeIdx != null) return shots[retakeIdx].name; var named = shots.map(function (s) { return s.name; }); for (var i = 0; i < picked.length; i++) if (named.indexOf(picked[i]) < 0) return picked[i]; return ''; }
  function updateHint() { var n = nextName(); var big = retakeIdx != null ? 'Retake: ' + n : n; $('hintBig').textContent = big || ''; $('hintBig').hidden = !big; $('hint').textContent = retakeIdx != null ? '' : picked.length ? (picked.length - shots.filter(function (s) { return picked.indexOf(s.name) > -1; }).length) + ' left on your list' : 'One thing per photo'; $('hint').classList.toggle('solo', !big); $('count').textContent = shots.length; $('thumbWrap').hidden = !shots.length; $('doneBtn').hidden = !shots.length; $('doneBtn').textContent = 'Done (' + shots.length + ') →'; $('tapHint').hidden = !!shots.length; if (shots.length) $('thumb').src = shots[shots.length - 1].url; renderMiniList(); }
  function renderMiniList() { var el = $('miniList'); if (!picked.length) { el.hidden = true; return; } el.hidden = false; el.innerHTML = picked.map(function (n) { var done = shots.some(function (s) { return s.name === n || s.hint === n; }); return '<span class="' + (done ? 'done' : '') + '">' + (done ? '✓ ' : '○ ') + esc(n) + '</span>'; }).join(''); }
  function addShot(blob) {
    var url = URL.createObjectURL(blob), name = nextName(), idea = IDEAS.filter(function (i) { return i[1] === name; })[0];
    if (retakeIdx != null) { var rs = shots[retakeIdx]; rs.blob = blob; rs.url = url; rs.cutUrl = null; rs.touched = {}; retakeIdx = null; cutFast(rs); identify(rs); show('q'); return; }
    var shot = { blob: blob, url: url, name: name, price: idea ? idea[2] : MIN, week: 0, note: '', hint: name, ai: null, touched: {} };
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
      shot.pending = false; if (!j || j.error) return; shot.ai = j; shot.askLabel = !!j.ask_label && !shot.labelBlob;
      if (j.cut && !shot.cutUrl) { var ci = new Image(); ci.onload = function () { shot.cutUrl = trimUrl(ci, j.cut); var k = shots.indexOf(shot), im = k < 0 ? null : document.querySelector('.row-item[data-i="' + k + '"] .rt img'); if (im) { im.src = shot.cutUrl; im.classList.add('cut'); } }; ci.src = j.cut; }
      if (!shot.touched.name || shot.labelBlob) shot.name = j.name || shot.name;
      if (!shot.touched.price) { shot.price = Math.max(MIN, Math.round(j.price_cents / 100)); shot.week = Math.round((j.week_cents || 0) / 100); }
      if (!shot.touched.note && j.description) shot.note = j.description;
      if (step === 'review') renderReview(); else if (step === 'q') renderQ(true); else updateHint();
    }).catch(function () { shot.pending = false; });
  }
  function snap() {
    if (!stream) { $('file').click(); return; }
    var w = video.videoWidth, h = video.videoHeight, s = Math.min(1, 1400 / Math.max(w, h));
    canvas.width = Math.round(w * s); canvas.height = Math.round(h * s);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(function (b) { if (b) addShot(b); }, 'image/jpeg', 0.86);
  }
  $('shutter').addEventListener('click', snap);
  $('file').addEventListener('change', function () { var f = this.files[0]; if (!f) return; var img = new Image(); img.onload = function () { var s = Math.min(1, 1400 / Math.max(img.width, img.height)); canvas.width = Math.round(img.width * s); canvas.height = Math.round(img.height * s); canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height); canvas.toBlob(function (b) { if (b) addShot(b); }, 'image/jpeg', 0.86); }; img.src = URL.createObjectURL(f); this.value = ''; });
  $('camFallback').addEventListener('click', function () { $('file').click(); });
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
  $('listBtn').addEventListener('click', function () {
    var fd = new FormData(); shots.forEach(function (s, i) { (s.extra || []).forEach(function (x, k) { fd.append('photo_' + i + '_' + (k + 1), x.blob, 'p' + i + '_' + (k + 1) + '.jpg'); }); fd.append('name_' + i, s.name.trim()); if (s.ai && s.ai.name) fd.append('ai_' + i, s.ai.name); fd.append('price_' + i, s.price); fd.append('week_' + i, s.week || 0); fd.append('note_' + i, s.note); fd.append('grade_' + i, s.grade || 'A'); fd.append('photo_' + i, s.blob, 'p' + i + '.jpg'); });
    if (window._gps) { fd.append('lat', window._gps[0]); fd.append('lng', window._gps[1]); }
    $('listBtn').disabled = true; $('listBtn').textContent = 'LISTING…';
    fetch('/api/list', { method: 'POST', body: fd }).then(function (r) { if (r.status === 401) { location.href = '/login?next=/list'; return null; } return r.json(); }).then(function (j) { if (!j) return; renderDone(j); show('done'); }).catch(function () { $('listBtn').disabled = false; $('listBtn').textContent = 'TRY AGAIN'; });
  });

  // ---- done
  function renderDone(j) {
    clearInterval(clockT);
    var escH = function (x) { return String(x).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); };
    $('tray').innerHTML = shots.map(function (s) { return '<div class="dn-item"><img src="' + (s.cutUrl || s.url) + '" alt=""' + (s.cutUrl ? ' class="cut"' : '') + '><div class="dn-nm">' + escH(s.name.trim()) + '</div><div class="dn-pr">$' + s.price + '/day</div><span class="dn-tick">✓</span></div>'; }).join('');
    $('dnHead').textContent = shots.length === 1 ? 'Posted' : shots.length + ' posted';
    $('dnSub').textContent = shots.length === 1 ? 'Live on the map — neighbors can rent it now' : 'Live on the map — neighbors can rent them now';

    var L = (j && j.listed) || [], one = shots.length === 1 && L[0], minP = Math.min.apply(null, shots.map(function (s) { return s.price; }));
    var text = one ? 'Renting out my ' + shots[0].name.trim().toLowerCase() + ' — $' + shots[0].price + '/day' + (CFG.hood ? ', pickup in ' + CFG.hood : '') : 'Renting out ' + shots.length + ' things' + (CFG.hood ? ' in ' + CFG.hood : '') + ', from $' + minP + '/day', url = one ? (L[0].url || location.origin + '/i/' + L[0].id) : CFG.shareUrl, full = text + ' ' + url, enc = encodeURIComponent(full);
    var toast = function (t) { $('shToast').textContent = t; $('shToast').classList.add('on'); setTimeout(function () { $('shToast').classList.remove('on'); }, 2000); };
    var copy = function (t) { try { navigator.clipboard.writeText(full); } catch (e) {} toast(t); };
    var B = [['💬', 'Text', function () { location.href = 'sms:?&body=' + enc; }], ['🟢', 'WhatsApp', function () { window.open('https://wa.me/?text=' + enc, '_blank'); }], ['🔗', 'Copy', function () { copy('Copied'); }]];
    $('shBtns').innerHTML = B.map(function (b, i) { return '<button type="button" data-i="' + i + '"><span class="ic">' + b[0] + '</span><span>' + b[1] + '</span></button>'; }).join('');
    $('shBtns').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; if (navigator.share && b.dataset.i === '2') { navigator.share({ text: text, url: url }).catch(function () {}); return; } B[+b.dataset.i][2](); };
    drawStory(L, url);
  }
  // ---- story card (1080x1920): real item cut out on cream, name + price, QR to the item
  function drawStory(L, url) {
    var cv = $('story'), g = cv.getContext('2d'), W = 1080, H = 1920, F = '"Helvetica Neue",Helvetica,Arial,sans-serif';
    var one = shots.length === 1, minP = Math.min.apply(null, shots.map(function (s) { return s.price; }));
    function base(imgs) {
      g.fillStyle = '#F5F3EE'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#1E3A2B'; g.font = '900 64px ' + F; g.textBaseline = 'alphabetic'; g.fillText('👋 Lendo', 80, 150);
      g.fillStyle = '#FF4F00'; g.font = '900 46px ' + F; g.fillText('FOR RENT' + (CFG.hood ? ' · ' + CFG.hood.toUpperCase() : ''), 80, 250);
      // item(s)
      var box = { x: 90, y: 300, w: 900, h: 900 };
      var n = imgs.length, cols = n === 1 ? 1 : 2, rows = Math.ceil(Math.min(n, 4) / cols), cw = box.w / cols, ch = box.h / rows;
      imgs.slice(0, 4).forEach(function (im, k) { if (!im) return; var cx = box.x + (k % cols) * cw, cy = box.y + Math.floor(k / cols) * ch, sc = Math.min((cw - 40) / im.width, (ch - 40) / im.height);
        var w = im.width * sc, h = im.height * sc; g.drawImage(im, cx + (cw - w) / 2, cy + (ch - h) / 2, w, h); });
      // name + price
      g.fillStyle = '#1E3A2B'; g.textAlign = 'center'; g.font = '900 104px ' + F;
      var title = one ? shots[0].name.trim() : shots.length + ' things to rent'; while (g.measureText(title).width > 920 && title.length > 4) title = title.slice(0, -2);
      g.fillText(title, W / 2, 1340);
      var tag = (one ? '$' + shots[0].price : 'from $' + minP) + '/day'; g.font = '900 76px ' + F; var tw = g.measureText(tag).width + 70;
      g.fillStyle = '#1E3A2B'; g.fillRect(W / 2 - tw / 2 + 8, 1392, tw, 112); g.fillStyle = '#FF4F00'; g.fillRect(W / 2 - tw / 2, 1384, tw, 112); g.fillStyle = '#fff'; g.fillText(tag, W / 2, 1468);
      // QR
      try { var q = qrcode(0, 'M'); q.addData(url); q.make(); var m = q.getModuleCount(), S = 280, cell = S / m, qx = 80, qy = 1560;
        g.fillStyle = '#fff'; g.fillRect(qx - 16, qy - 16, S + 32, S + 32); g.fillStyle = '#1E3A2B';
        for (var r = 0; r < m; r++) for (var c2 = 0; c2 < m; c2++) if (q.isDark(r, c2)) g.fillRect(qx + c2 * cell, qy + r * cell, Math.ceil(cell), Math.ceil(cell)); } catch (e) {}
      g.textAlign = 'left'; g.fillStyle = '#1E3A2B'; g.font = '900 58px ' + F; g.fillText('Scan to rent', 420, 1660);
      g.font = '700 40px ' + F; g.fillStyle = '#4A463F'; g.fillText(url.replace(/^https?:\/\//, '').slice(0, 30), 420, 1730);
      g.fillText('Neighbors renting to neighbors', 420, 1790);
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
      if (navigator.canShare && navigator.canShare({ files: [f] })) navigator.share({ files: [f] }).catch(function () {}); else dl(b); }); };
    $('stSave').onclick = function () { blob(dl); };
    function dl(b) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'lendo-story.png'; document.body.appendChild(a); a.click(); a.remove(); }
  }
  $('again').addEventListener('click', function () { shots = []; picked = []; QI = 0; t0 = Date.now(); renderIdeas(); show('cam'); });

  // ---- one question at a time (card stack). Item questions first, then sign-up (only if logged out), then list
  var QI = 0, ME = CFG.user, SIGNUP = !CFG.user, NEED = { name: !ME || !ME.name, hood: !ME || !ME.hood }, ITEMQ = { grade: 1, name: 1, price: 1, note: 1 }, PNAME = '', /* question list is fixed once known, so answering doesn't shift it */ AUTH = { phone: '', pretty: '' }, G = { A: 'Great', B: 'Good', C: 'OK', D: 'Poor', E: 'Junk' };
  function cur() { return shots[0]; }
  function qs() {
    /* questions that don't need the photo lookup come first, so the AI name/price/details are ready by the time they're asked */
    var s = cur(), L = [{ k: 'grade', line: function () { return 'Condition ' + (s.grade || 'A') + ' · ' + G[s.grade || 'A']; } }];
    if (NEED.name) L.push({ k: 'fname', line: function () { return (ME && ME.name) || PNAME; } }); /* name before phone */
    if (SIGNUP) L.push({ k: 'phone', line: function () { return AUTH.pretty || AUTH.phone; } }, { k: 'code', line: function () { return 'Phone confirmed'; } });
    if (NEED.hood) L.push({ k: 'hood', line: function () { return (ME && ME.hood) || 'Hood skipped'; } });
    L.push({ k: 'name', line: function () { return s.name || '…'; } }, { k: 'price', line: function () { return '$' + s.price + '/day'; } }, { k: 'note', line: function () { return s.note ? s.note : 'No details'; } });
    return L;
  }
  function renderQ(soft) {
    var s = cur(); if (!s) { show('cam'); return; }
    var L = qs(); if (QI >= L.length) return listIt();
    var im = $('qImg'); im.src = s.cutUrl || s.url; im.className = s.cutUrl ? 'cut' : '';
    $('qDone').innerHTML = L.slice(0, QI).map(function (q, i) { return '<button type="button" class="q-line" data-i="' + i + '"><span>' + esc(q.line()) + '</span><b>' + (ITEMQ[q.k] ? 'change' : '✓') + '</b></button>'; }).join('');
    var q = L[QI], h = '', n = 'Question ' + (QI + 1) + ' of ' + L.length;
    if (soft && (!(q.k === 'name' || q.k === 'price' || q.k === 'note') || s.touched[q.k])) return; /* identify result arrived: only refresh cards that show its guesses */
    if (q.k === 'name') h = card(n, 'What is it?', s.pending ? 'Guessing from your photo<span class="dots"><i>.</i><i>.</i><i>.</i></span>' : 'Guessed from your photo · fix it if it’s off',
      '<input class="q-in" id="qv" value="' + esc(s.name) + '" maxlength="80" placeholder="' + (s.pending ? '' : 'Drill, tent, speaker…') + '">' + (s.askLabel && !s.pending ? '<div class="q-chips"><button type="button" id="qLabel">📷 Snap the brand label</button></div>' : ''), 'Next');
    if (q.k === 'grade') h = card(n, 'What shape is it in?', 'Be honest · customers see it', '<div class="q-grades">' + 'ABCDE'.split('').map(function (g) { return '<button type="button" data-g="' + g + '" class="' + ((s.grade || '') === g ? 'on' : '') + '">' + g + '</button>'; }).join('') + '</div><div class="q-sub" style="margin:8px 0 0">A great · B good · C ok · D poor · E junk</div>', null);
    if (q.k === 'price') h = card(n, 'How much a day?', 'A week is ' + fmt(Math.round(s.price * 7 * 0.7)) + ' automatically (30% off) · 15% fee (will stay low)',
      '<div class="q-price"><button type="button" class="q-pm" data-d="-1" aria-label="Lower">−</button><input class="q-in" id="qv" inputmode="numeric" value="' + s.price + '"><button type="button" class="q-pm" data-d="1" aria-label="Raise">+</button></div>', 'Next');
    if (q.k === 'note') h = card(n, 'Anything a customer should know?', 'Model · what’s included · condition', '<textarea class="q-ta" id="qv" maxlength="400" placeholder="Batteries included, strap, works great">' + esc(s.note || '') + '</textarea>' + (window.lendoDetails ? '<div class="dmeter" id="qMeter">' + window.lendoDetails(s.note || '') + '</div>' : '') + '<div class="q-chips"><button type="button" id="qMore">📷 Add more photos' + ((s.extra || []).length ? ' (' + s.extra.length + ')' : '') + '</button></div>', 'Next', true);
    if (q.k === 'phone') h = card(n, 'Where should requests go?', 'Your cell · requests and payouts come by text', '<input class="q-in" id="qv" type="tel" autocomplete="tel" inputmode="tel" placeholder="(646) 555-0101" value="' + esc(AUTH.phone) + '">', 'Text me a code');
    if (q.k === 'code') h = card(n, 'Code we just texted', 'Sent to ' + esc(AUTH.pretty) + (AUTH.dev ? ' · DEV code ' + AUTH.dev : ''), '<input class="q-in" id="qv" inputmode="numeric" autocomplete="one-time-code" maxlength="6" style="letter-spacing:.3em">', 'Confirm');
    if (q.k === 'fname') h = card(n, 'What should neighbors call you?', 'First name is fine', '<input class="q-in" id="qv" autocomplete="given-name" maxlength="40" value="' + esc((ME && ME.name) || PNAME) + '">', 'Next');
    if (q.k === 'hood') h = card(n, 'Your neighborhood?', 'Shown on your items · not your address', '<input class="q-in" id="qv" maxlength="60" placeholder="West Village" value="' + esc(CFG.hood || '') + '">', 'Next', true);
    $('qCard').innerHTML = h; var v = $('qv'); if (v && !soft) setTimeout(function () { try { v.focus({ preventScroll: true }); } catch (e) {} }, 60);
  }
  function card(k, title, sub, body, next, skip) {
    var last = QI === qs().length - 1;
    return '<div class="q-k">' + k + '</div><div class="q-h">' + title + '</div><div class="q-sub">' + sub + '</div>' + body + '<div class="q-err" id="qErr" hidden></div>' +
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
      return api('/api/auth/verify', { phone: AUTH.norm, code: val }).then(function (j) { if (!j.ok) { b2.disabled = false; return err(j.error || 'Try again'); } ME = j.user; NEED.hood = !ME.hood; if (PNAME && !ME.name) { ME.name = PNAME; api('/api/auth/me', { name: PNAME }); } var L = qs(), k = 0; for (var i = 0; i < L.length; i++) if (L[i].k === 'code') k = i; QI = k + 1; renderQ(); }); }
    if (q.k === 'fname') { if (!val) return err('A first name, so neighbors know who’s lending'); if (!ME) { PNAME = val; return go(); } /* not logged in yet: saved right after the code */ ME.name = val; return api('/api/auth/me', { name: val }).then(go, go); }
    if (q.k === 'hood') { if (!skipped && val) { ME = ME || {}; ME.hood = val; CFG.hood = val; return api('/api/auth/me', { hood: val }).then(go, go); } return go(); }
  }
  $('qCard').addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t) return; var s = cur();
    if (t.id === 'qNext') return submitQ(false);
    if (t.id === 'qSkip') return submitQ(true);
    if (t.dataset.g) { s.grade = t.dataset.g; return go(); }
    if (t.dataset.d) { var pv = $('qv'), nv = Math.max(MIN, (parseInt(pv.value, 10) || MIN) + +t.dataset.d); pv.value = nv; s.touched.price = true; var sub = $('qCard').querySelector('.q-sub'); if (sub) sub.textContent = 'A week is ' + fmt(Math.round(nv * 7 * 0.7)) + ' automatically (30% off) · 15% fee (will stay low)'; return; }
    if (t.dataset.p) { $('qv').value = t.dataset.p; [].forEach.call($('qCard').querySelectorAll('[data-p]'), function (b) { b.classList.toggle('on', b === t); }); return; }
    if (t.id === 'qLabel') { labelFor = s; $('labelFile').value = ''; $('labelFile').click(); }
    if (t.id === 'qMore') { moreFor = 0; $('moreFile').value = ''; $('moreFile').click(); }
  });
  $('qCard').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); submitQ(false); } });
  $('qCard').addEventListener('input', function (e) { var s0 = cur(), q0 = qs()[QI]; if (e.target.id === 'qv' && s0 && q0) s0.touched[q0.k] = true; if (e.target.id === 'qv' && e.target.tagName === 'TEXTAREA' && $('qMeter') && window.lendoDetails) $('qMeter').innerHTML = window.lendoDetails(e.target.value); });
  $('qDone').addEventListener('click', function (e) { var b = e.target.closest('.q-line'); if (!b) return; var i = +b.dataset.i, q = qs()[i]; if (q && ITEMQ[q.k]) { QI = i; renderQ(); } });
  $('qPh').addEventListener('click', function () { retakeIdx = 0; show('cam'); });
  function listIt() {
    var s = cur(); $('qCard').innerHTML = '<div class="q-h" style="margin:8px 0">Listing<span class="dots"><i>.</i><i>.</i><i>.</i></span></div>';
    var fd = new FormData(); (s.extra || []).forEach(function (x, k) { fd.append('photo_0_' + (k + 1), x.blob, 'p0_' + (k + 1) + '.jpg'); });
    fd.append('name_0', s.name.trim()); if (s.ai && s.ai.name) fd.append('ai_0', s.ai.name); fd.append('price_0', s.price); fd.append('week_0', 0); fd.append('note_0', s.note || ''); fd.append('grade_0', s.grade || 'A'); fd.append('photo_0', s.blob, 'p0.jpg');
    if (window._gps) { fd.append('lat', window._gps[0]); fd.append('lng', window._gps[1]); }
    fetch('/api/list', { method: 'POST', body: fd }).then(function (r) { return r.json(); }).then(function (j) { if (!j || j.error) throw 0; renderDone(j); show('done');
      if (ME && !ME.replied && CFG.sms) { var d = document.createElement('a'); d.className = 'btn pri full'; d.href = CFG.sms; d.style.cssText = 'display:grid;place-items:center;margin:12px 0;text-decoration:none'; d.textContent = '💬 Text OK to Lendo so requests reach you'; var tr = $('tray'); tr.parentNode.insertBefore(d, tr.nextSibling); } })
      .catch(function () { $('qCard').innerHTML = '<div class="q-h">Didn’t go through</div><button type="button" class="cta q-next" id="qRetry">TRY AGAIN</button>'; $('qRetry').onclick = listIt; });
  }

  // gps once (silent)
  if (navigator.geolocation) navigator.geolocation.getCurrentPosition(function (p) { window._gps = [p.coords.latitude, p.coords.longitude]; }, function () {}, { timeout: 6000 });
  clockT = setInterval(function () { if (step === 'review') $('rvCount').textContent = shots.length + ' in ' + clock(); }, 1000);
  renderIdeas(); show('ideas');
})();
