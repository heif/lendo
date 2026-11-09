// Snap-flow: ideas → camera → review → done. Minimal copy. Config: window.LENDO_LIST = { minPrice, hood, shareUrl, hasGps }.
(function () {
  var CFG = window.LENDO_LIST || {}, MIN = CFG.minPrice || 8;
  var $ = function (id) { return document.getElementById(id); };
  var IDEAS = [['🪛', 'Drill', 8], ['⛺', 'Tent', 15], ['📽️', 'Projector', 18], ['🥣', 'Stand mixer', 10], ['🔊', 'Party speaker', 14], ['🪜', 'Ladder', 9], ['🧊', 'Cooler', 8], ['🚲', 'Bike', 20], ['📷', 'Camera', 25], ['🎸', 'Guitar', 12], ['👶', 'Stroller', 10], ['🚿', 'Pressure washer', 22],
    ['🛴', 'Scooter', 15], ['🎿', 'Skis', 20], ['🧳', 'Suitcase', 8], ['🛶', 'Kayak', 35], ['🍲', 'Dutch oven', 8], ['☕', 'Espresso machine', 15], ['🧰', 'Tool kit', 10], ['🪚', 'Saw', 12], ['🎤', 'Karaoke mic', 10], ['🏓', 'Pickleball set', 9], ['🧵', 'Sewing machine', 12], ['🔭', 'Telescope', 18]];
  var picked = [], shots = [], step = 'ideas', t0 = null, clockT, stream = null, retakeIdx = null, more = false;
  var fmt = function (n) { return '$' + n; };
  function esc(s) { return String(s).replace(/[<>&"]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]; }); }
  function show(name) { step = name; ['ideas', 'cam', 'review', 'done'].forEach(function (s) { $('st-' + s).hidden = s !== name; }); document.documentElement.classList.toggle('camdark', name === 'cam'); if (name === 'cam') startCam(); else stopCam(); if (name === 'review') renderReview(); }
  function clock() { if (!t0) return '0:00'; var s = Math.round((Date.now() - t0) / 1000); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }

  // ---- ideas
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
  function identify(shot) {
    var fd = new FormData(); fd.append('photo', shot.blob, 'p.jpg'); if (shot.hint) fd.append('hint', shot.hint);
    shot.pending = true;
    fetch('/api/identify', { method: 'POST', body: fd }).then(function (r) { return r.json(); }).then(function (j) {
      shot.pending = false; if (!j || j.error) return; shot.ai = j;
      if (!shot.touched.name) shot.name = j.name || shot.name;
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
  function renderReview() {
    $('rvCount').textContent = shots.length + ' in ' + clock();
    $('rows').innerHTML = shots.map(function (s, i) {
      return '<div class="row-item" data-i="' + i + '">' +
        '<button type="button" class="rt" data-act="retake"><img src="' + s.url + '" alt=""><span>↻ Retake</span></button>' +
        '<div class="mid"><input class="nm" data-act="name" value="' + esc(s.name) + '" placeholder="' + (s.pending ? 'Looking…' : 'What is it?') + '" maxlength="80">' +
        (s.ai ? '<div class="aichip">✦ ' + esc(s.ai.category_label || '') + (s.ai.basis ? ' · ' + esc(s.ai.basis) : '') + '</div>' : s.pending ? '<div class="aichip pend">✦ identifying…</div>' : '') +
        '<div class="pricerow"><span class="wk">$' + (s.week || Math.round(s.price * 7 * 0.7)) + '/wk</span><button type="button" class="pm" data-act="dn" aria-label="Lower">−</button><span class="badge">$' + s.price + '<small>/day</small></span><button type="button" class="pm" data-act="up" aria-label="Raise">+</button></div>' +
        '<textarea class="note" data-act="note" rows="2" placeholder="✎ note · condition · what’s included" maxlength="400">' + esc(s.note) + '</textarea></div>' +
        '<button type="button" class="del" data-act="del" aria-label="Remove">✕</button></div>';
    }).join('') || '<div class="hint" style="padding:20px 0">Nothing yet.</div>';
    $('rows').querySelectorAll('textarea.note').forEach(grow);
    $('listBtn').textContent = 'LIST ' + shots.length + (shots.length === 1 ? ' THING' : ' THINGS');
    var pend = shots.some(function (s) { return s.pending; });
    $('listBtn').disabled = !shots.length || pend || shots.some(function (s) { return !s.name.trim(); });
    if (pend) $('listBtn').textContent = 'IDENTIFYING…';
  }
  $('rows').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return; var row = b.closest('.row-item'), i = +row.dataset.i, act = b.dataset.act;
    if (act === 'retake') { retakeIdx = i; show('cam'); }
    if (act === 'dn') { shots[i].price = Math.max(MIN, shots[i].price - 1); shots[i].week = 0; shots[i].touched.price = true; renderReview(); }
    if (act === 'up') { shots[i].price += 1; shots[i].week = 0; shots[i].touched.price = true; renderReview(); }
    if (act === 'del') { shots.splice(i, 1); renderReview(); }
  });
  $('rows').addEventListener('input', function (e) { var inp = e.target, row = inp.closest('.row-item'); if (!row) return; var i = +row.dataset.i; if (inp.dataset.act === 'name') { shots[i].name = inp.value; shots[i].touched.name = true; $('listBtn').disabled = shots.some(function (s) { return !s.name.trim(); }); } if (inp.dataset.act === 'note') { shots[i].note = inp.value; shots[i].touched.note = true; grow(inp); } });
  function grow(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 160) + 'px'; }
  $('backCam').addEventListener('click', function () { show('cam'); });
  $('listBtn').addEventListener('click', function () {
    var fd = new FormData(); shots.forEach(function (s, i) { fd.append('name_' + i, s.name.trim()); fd.append('price_' + i, s.price); fd.append('week_' + i, s.week || 0); fd.append('note_' + i, s.note); fd.append('photo_' + i, s.blob, 'p' + i + '.jpg'); });
    if (window._gps) { fd.append('lat', window._gps[0]); fd.append('lng', window._gps[1]); }
    $('listBtn').disabled = true; $('listBtn').textContent = 'LISTING…';
    fetch('/api/list', { method: 'POST', body: fd }).then(function (r) { if (r.status === 401) { location.href = '/login?next=/list'; return null; } return r.json(); }).then(function (j) { if (!j) return; renderDone(j); show('done'); }).catch(function () { $('listBtn').disabled = false; $('listBtn').textContent = 'TRY AGAIN'; });
  });

  // ---- done
  function renderDone(j) {
    clearInterval(clockT);
    $('tray').innerHTML = shots.map(function (s) { return '<div><img src="' + s.url + '" alt=""><span>$' + s.price + '</span></div>'; }).join('');
    $('dnHead').textContent = shots.length + (shots.length === 1 ? ' thing. ' : ' things. ') + clock() + '.'; $('dnSub').textContent = shots.length === 1 ? 'It’s listed.' : 'They’re listed.';
    $('shTray').innerHTML = shots.slice(0, 4).map(function (s) { return '<img src="' + s.url + '" alt="">'; }).join('');
    $('shLine').textContent = shots.length + (shots.length === 1 ? ' thing' : ' things') + ' from $' + Math.min.apply(null, shots.map(function (s) { return s.price; })) + '/day' + (CFG.hood ? ' · ' + CFG.hood : '');
    var text = 'Renting out ' + (shots.length === 1 ? 'my ' + shots[0].name.trim() : shots.length + ' things') + ' on my block, from $' + Math.min.apply(null, shots.map(function (s) { return s.price; })) + '/day', url = CFG.shareUrl, full = text + ' ' + url, enc = encodeURIComponent(full);
    var toast = function (t) { $('shToast').textContent = t; $('shToast').classList.add('on'); setTimeout(function () { $('shToast').classList.remove('on'); }, 2000); };
    var copy = function (t) { try { navigator.clipboard.writeText(full); } catch (e) {} toast(t); };
    var B = [['💬', 'Text', function () { location.href = 'sms:?&body=' + enc; }], ['🟢', 'WhatsApp', function () { window.open('https://wa.me/?text=' + enc, '_blank'); }], ['🏢', 'Building chat', function () { copy('Copied'); }], ['🔗', 'Copy', function () { copy('Link copied'); }]];
    $('shBtns').innerHTML = B.map(function (b, i) { return '<button type="button" data-i="' + i + '"><span class="ic">' + b[0] + '</span><span>' + b[1] + '</span></button>'; }).join('');
    $('shBtns').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; if (navigator.share && b.dataset.i === '3') { navigator.share({ text: text, url: url }).catch(function () {}); return; } B[+b.dataset.i][2](); };
  }
  $('again').addEventListener('click', function () { shots = []; picked = []; t0 = Date.now(); renderIdeas(); show('cam'); });

  // gps once (silent)
  if (navigator.geolocation) navigator.geolocation.getCurrentPosition(function (p) { window._gps = [p.coords.latitude, p.coords.longitude]; }, function () {}, { timeout: 6000 });
  clockT = setInterval(function () { if (step === 'review') $('rvCount').textContent = shots.length + ' in ' + clock(); }, 1000);
  renderIdeas(); show('ideas');
})();
