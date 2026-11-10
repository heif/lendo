// Snap-flow: ideas → camera → review → done. Minimal copy. Config: window.LENDO_LIST = { minPrice, hood, shareUrl, hasGps }.
(function () {
  var CFG = window.LENDO_LIST || {}, MIN = CFG.minPrice || 8;
  var $ = function (id) { return document.getElementById(id); };
  var IDEAS = [['🪛', 'Drill', 8], ['⛺', 'Tent', 15], ['📽️', 'Projector', 18], ['🥣', 'Stand mixer', 10], ['🔊', 'Party speaker', 14], ['🪜', 'Ladder', 9], ['🧊', 'Cooler', 8], ['🚲', 'Bike', 20], ['📷', 'Camera', 25], ['🎸', 'Guitar', 12], ['👶', 'Stroller', 10], ['🚿', 'Pressure washer', 22],
    ['🛴', 'Scooter', 15], ['🎿', 'Skis', 20], ['🧳', 'Suitcase', 8], ['🛶', 'Kayak', 35], ['🍲', 'Dutch oven', 8], ['☕', 'Espresso machine', 15], ['🧰', 'Tool kit', 10], ['🪚', 'Saw', 12], ['🎤', 'Karaoke mic', 10], ['🏓', 'Pickleball set', 9], ['🧵', 'Sewing machine', 12], ['🔭', 'Telescope', 18]];
  var moreFor = null;
  function shrink(f, cb) { var img = new Image(); img.onload = function () { var s = Math.min(1, 1400 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); c.toBlob(function (b) { if (b) cb(b); }, 'image/jpeg', 0.86); URL.revokeObjectURL(img.src); }; img.src = URL.createObjectURL(f); }
  var picked = [], shots = [], step = 'ideas', t0 = null, clockT, stream = null, retakeIdx = null, more = false;
  var fmt = function (n) { return '$' + n; };
  function esc(s) { return String(s).replace(/[<>&"]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]; }); }
  function show(name) { step = name; ['ideas', 'cam', 'review', 'done'].forEach(function (s) { $('st-' + s).hidden = s !== name; }); document.documentElement.classList.toggle('camdark', name === 'cam'); if (name === 'cam') startCam(); else stopCam(); if (name === 'review') renderReview(); }
  function clock() { if (!t0) return '0:00'; var s = Math.round((Date.now() - t0) / 1000); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }

  // ---- ideas
  var WANT = (function () { try { return new URLSearchParams(location.search).get('want') || ''; } catch (e) { return ''; } })();
  if (WANT && !IDEAS.some(function (i) { return i[1].toLowerCase() === WANT.toLowerCase(); })) IDEAS.unshift(['📦', WANT, 12]);
  if (WANT && picked.indexOf(WANT) < 0) { var wi = IDEAS.filter(function (i) { return i[1].toLowerCase() === WANT.toLowerCase(); })[0]; picked.push(wi ? wi[1] : WANT); }
  function renderIdeas() {
    var list = more ? IDEAS : IDEAS.slice(0, 12);
    $('ideas').innerHTML = list.map(function (i, k) { var on = picked.indexOf(i[1]) > -1; return '<button type="button" class="idea' + (on ? ' on' : '') + '" data-n="' + esc(i[1]) + '" data-p="' + i[2] + '"><span class="mk">' + (on ? '✓' : '') + '</span><span class="em">' + i[0] + '</span><span class="nm">' + esc(i[1]) + '</span><span class="pr">~$' + i[2] + '/day</span></button>'; }).join('');
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
    if (retakeIdx != null) { shots[retakeIdx].blob = blob; shots[retakeIdx].url = url; retakeIdx = null; show('review'); return; }
    var shot = { blob: blob, url: url, name: name, price: idea ? idea[2] : MIN, week: 0, note: '', hint: name, ai: null, touched: {} };
    shots.push(shot); identify(shot);
    $('flash').classList.add('on'); setTimeout(function () { $('flash').classList.remove('on'); }, 220);
    $('toast').classList.add('on'); clearTimeout($('toast')._t); $('toast')._t = setTimeout(function () { $('toast').classList.remove('on'); }, 1100);
    updateHint();
  }
  // crop the transparent padding off a cutout → data URL (falls back to the original URL)
  function trimUrl(im, fallback) { try { var c = document.createElement('canvas'), W = im.naturalWidth, H = im.naturalHeight; c.width = W; c.height = H; var g = c.getContext('2d'); g.drawImage(im, 0, 0);
    var d = g.getImageData(0, 0, W, H).data, x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (var y = 0; y < H; y += 2) for (var x = 0; x < W; x += 2) if (d[(y * W + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 <= x0) return fallback; var pad = 6, o = document.createElement('canvas'); o.width = x1 - x0 + 1 + pad * 2; o.height = y1 - y0 + 1 + pad * 2; o.getContext('2d').drawImage(c, x0, y0, x1 - x0 + 1, y1 - y0 + 1, pad, pad, x1 - x0 + 1, y1 - y0 + 1); return o.toDataURL('image/png'); } catch (e) { return fallback; } }
  function identify(shot) {
    var fd = new FormData(); fd.append('photo', shot.blob, 'p.jpg'); if (shot.labelBlob) fd.append('label', shot.labelBlob, 'label.jpg'); if (shot.hint) fd.append('hint', shot.hint);
    shot.pending = true;
    fetch('/api/identify', { method: 'POST', body: fd }).then(function (r) { return r.json(); }).then(function (j) {
      shot.pending = false; if (!j || j.error) return; shot.ai = j; shot.askLabel = !!j.ask_label && !shot.labelBlob;
      if (j.cut) { var ci = new Image(); ci.onload = function () { shot.cutUrl = trimUrl(ci, j.cut); var k = shots.indexOf(shot), im = k < 0 ? null : document.querySelector('.row-item[data-i="' + k + '"] .rt img'); if (im) { im.src = shot.cutUrl; im.classList.add('cut'); } }; ci.src = j.cut; }
      if (!shot.touched.name || shot.labelBlob) shot.name = j.name || shot.name;
      if (!shot.touched.price) { shot.price = Math.max(MIN, Math.round(j.price_cents / 100)); shot.week = Math.round((j.week_cents || 0) / 100); }
      if (!shot.touched.note && j.description) shot.note = j.description;
      if (step === 'review') renderReview(); else updateHint();
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
  function renderReview() {
    $('rvCount').textContent = shots.length + ' in ' + clock();
    $('rows').innerHTML = shots.map(function (s, i) {
      return '<div class="row-item" data-i="' + i + '">' +
        '<div class="rtcol"><button type="button" class="rt" data-act="retake"><img src="' + (s.cutUrl || s.url) + '" alt=""' + (s.cutUrl ? ' class="cut"' : '') + '><span>↻ Retake</span></button>' +
        '<div class="xtra">' + (s.extra || []).map(function (x, k) { return '<button type="button" class="xt" data-act="xdel" data-k="' + k + '" aria-label="Remove photo"><img src="' + x.url + '" alt=""><b>×</b></button>'; }).join('') + ((s.extra || []).length < 5 ? '<button type="button" class="xadd" data-act="xadd" aria-label="Add photos">+</button>' : '') + '</div></div>' +
        '<div class="mid"><div class="nmwrap"><input class="nm" data-act="name" value="' + esc(s.name) + '" placeholder="' + (s.pending ? 'Identifying…' : 'What is it?') + '" maxlength="80"></div>' +
        (s.askLabel && !s.pending ? '<button type="button" class="asklabel" data-act="label">📷 Brand? Snap the logo or label</button>' : '') + '<div class="pricerow"><button type="button" class="pm" data-act="dn" aria-label="Lower">−</button><span class="badge">$' + s.price + '<small>/day</small></span><button type="button" class="pm" data-act="up" aria-label="Raise">+</button></div>' +
        '<textarea class="note" data-act="note" rows="2" placeholder="✎ note · condition · what’s included" maxlength="400">' + esc(s.note) + '</textarea></div>' +
        '<button type="button" class="del" data-act="del" aria-label="Remove this item"><svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true"><path d="M2 5h14M7 5V3h4v2M4 5l1 13h8l1-13" fill="none" stroke="#9B968C" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>';
    }).join('') || '<div class="hint" style="padding:20px 0">Nothing yet.</div>';
    $('rows').querySelectorAll('textarea.note').forEach(grow);
    $('listBtn').textContent = shots.length === 1 ? 'LIST IT' : 'LIST ALL ' + shots.length;
    var pend = shots.some(function (s) { return s.pending; });
    $('listBtn').disabled = !shots.length || pend || shots.some(function (s) { return !s.name.trim(); });
    if (pend) $('listBtn').textContent = 'IDENTIFYING…';
  }
  $('rows').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return; var row = b.closest('.row-item'), i = +row.dataset.i, act = b.dataset.act;
    if (act === 'retake') { retakeIdx = i; show('cam'); }
    if (act === 'xadd') { moreFor = i; $('moreFile').value = ''; $('moreFile').click(); }
    if (act === 'label') { labelFor = shots[i]; $('labelFile').value = ''; $('labelFile').click(); }
    if (act === 'xdel') { (shots[i].extra || []).splice(+b.dataset.k, 1); renderReview(); }
    if (act === 'dn') { shots[i].price = Math.max(MIN, shots[i].price - 1); shots[i].week = 0; shots[i].touched.price = true; renderReview(); }
    if (act === 'up') { shots[i].price += 1; shots[i].week = 0; shots[i].touched.price = true; renderReview(); }
    if (act === 'del') { var gone = shots.splice(i, 1)[0]; renderReview(); undoToast('Removed ' + (gone.name || 'item'), function () { shots.splice(i, 0, gone); renderReview(); }); }
  });
  var labelFor = null;
  $('labelFile').addEventListener('change', function () { var sh = labelFor, f = this.files[0]; if (!sh || !f) return; shrink(f, function (b) { sh.labelBlob = b; sh.askLabel = false; sh.touched.name = false; identify(sh); renderReview(); }); });
  $('moreFile').addEventListener('change', function () { var i = moreFor; if (i == null || !shots[i]) return; var fs = Array.prototype.slice.call(this.files, 0, 5 - (shots[i].extra || []).length); fs.forEach(function (f) { shrink(f, function (b) { (shots[i].extra = shots[i].extra || []).push({ blob: b, url: URL.createObjectURL(b) }); renderReview(); }); }); });
  $('rows').addEventListener('input', function (e) { var inp = e.target, row = inp.closest('.row-item'); if (!row) return; var i = +row.dataset.i; if (inp.dataset.act === 'name') { shots[i].name = inp.value; shots[i].touched.name = true; $('listBtn').disabled = shots.some(function (s) { return !s.name.trim(); }); } if (inp.dataset.act === 'note') { shots[i].note = inp.value; shots[i].touched.note = true; grow(inp); } });
  function grow(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 160) + 'px'; }
  $('backCam').addEventListener('click', function () { show('cam'); });
  $('listBtn').addEventListener('click', function () {
    var fd = new FormData(); shots.forEach(function (s, i) { (s.extra || []).forEach(function (x, k) { fd.append('photo_' + i + '_' + (k + 1), x.blob, 'p' + i + '_' + (k + 1) + '.jpg'); }); fd.append('name_' + i, s.name.trim()); if (s.ai && s.ai.name) fd.append('ai_' + i, s.ai.name); fd.append('price_' + i, s.price); fd.append('week_' + i, s.week || 0); fd.append('note_' + i, s.note); fd.append('photo_' + i, s.blob, 'p' + i + '.jpg'); });
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
    var text = one ? 'Renting out my ' + shots[0].name.trim().toLowerCase() + ' — $' + shots[0].price + '/day' + (CFG.hood ? ', pickup in ' + CFG.hood : '') : 'Renting out ' + shots.length + ' things' + (CFG.hood ? ' in ' + CFG.hood : '') + ', from $' + minP + '/day', url = one ? location.origin + '/i/' + L[0].id : CFG.shareUrl, full = text + ' ' + url, enc = encodeURIComponent(full);
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
  $('again').addEventListener('click', function () { shots = []; picked = []; t0 = Date.now(); renderIdeas(); show('cam'); });

  // gps once (silent)
  if (navigator.geolocation) navigator.geolocation.getCurrentPosition(function (p) { window._gps = [p.coords.latitude, p.coords.longitude]; }, function () {}, { timeout: 6000 });
  clockT = setInterval(function () { if (step === 'review') $('rvCount').textContent = shots.length + ' in ' + clock(); }, 1000);
  renderIdeas(); show('ideas');
})();
