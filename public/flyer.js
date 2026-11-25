// Lays out the flyer / tape: items scattered like map pins (jittered, tilted, overlapping a little), never on a grid.
(function () {
  var F = window.F, box = document.getElementById('in'), W = box.clientWidth, H = box.clientHeight;
  var sd = F.seed * 9301 + 49297, rnd = function () { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var fmt = function (c) { var d = c / 100; return '$' + (d % 1 ? d.toFixed(2) : d); };
  var poss = function (n) { return n + (/s$/i.test(n) ? '’' : '’s'); };
  function qr(text, px, ecc) { var q = qrcode(0, ecc || 'M'); q.addData(text); q.make(); var m = q.getModuleCount(), s = Math.max(1, Math.floor(px / (m + 2))), c = document.createElement('canvas'); c.width = c.height = (m + 2) * s; var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#1E3A2B'; for (var y = 0; y < m; y++) for (var x = 0; x < m; x++) if (q.isDark(y, x)) g.fillRect((x + 1) * s, (y + 1) * s, s, s); c.style.width = c.style.height = px + 'px'; return c; }
  // a wild mix everywhere: shuffle, then never let the same owner or first word sit next to itself
  var pool = F.items.slice(); for (var i = pool.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
  var seen = {}, list = []; pool.forEach(function (x) { var k = x.n.toLowerCase(); if (!seen[k]) { seen[k] = 1; list.push(x); } }); pool.forEach(function (x) { if (list.indexOf(x) < 0) list.push(x); });
  var keep = []; // rects items must stay out of (QR blocks, band)
  function qrBlock(x, y, px, label) { var d = document.createElement('div'); d.className = 'qr'; d.style.left = x + 'px'; d.style.top = y + 'px'; d.appendChild(qr(F.sms, px)); if (label) { var s = document.createElement('small'); s.innerHTML = label; d.appendChild(s); } box.appendChild(d); keep.push([x - 6, y - 6, x + px + 28, y + px + (label ? 50 : 28)]); }
  var bandH = 0;
  if (F.tape) {
    var per = F.tape === 'band' ? 0 : 6 * 96; // a QR every 6 inches, so any torn-off length has one
    if (F.tape === 'band') { bandH = 48; var b = document.createElement('div'); b.className = 'band'; var msgs = ['RENT OUT YOUR STUFF', 'SAVE MONEY · MAKE MONEY', 'RENT WHAT’S ON YOUR BLOCK', '$10 FOR LISTING 10 THINGS']; for (var k = 0; k < 14; k++) { b.appendChild(qr(F.sms, 40, 'L')); var sp = document.createElement('span'); sp.textContent = msgs[k % msgs.length]; b.appendChild(sp); } box.appendChild(b); }
    else for (var x0 = 3 * 96 - 70; x0 < W; x0 += per) qrBlock(x0, (H - 190) / 2, 140, F.tape === 'promo' ? ((Math.round(x0 / per) % 2) ? '$10 FOR LISTING<br>10 THINGS' : 'RENT OUT YOUR STUFF<br>OR RENT THEIRS') : '');
  } else if (!F.each) qrBlock(W / 2 - 78, H * 0.56, 150, 'RENT OUT YOUR STUFF TOO');
  // jittered rows: enough cells for n items in the free area, each nudged off its cell and tilted
  var n = F.n, s = F.s, cw = s * (F.each ? 1.6 : 1.22), chh = s * (F.each ? 2.45 : 1.42), usableH = H - bandH;
  var area = W * usableH - keep.reduce(function (a, r) { return a + (r[2] - r[0]) * (r[3] - r[1]); }, 0), sc = Math.sqrt(area / (n * cw * chh)); cw *= sc; chh *= sc; var isz = s * Math.min(1.25, Math.max(.6, sc));
  var k2 = 0, row = 0;
  for (var y = -chh * 0.35; y < usableH + chh * 0.2 && k2 < list.length; y += chh, row++) {
    for (var x = -cw * 0.4 + (row % 2 ? cw * 0.5 : 0); x < W + cw * 0.2 && k2 < list.length; x += cw) {
      var px = x + (rnd() - .5) * cw * 0.75, py = y + (rnd() - .5) * chh * 0.7, m = F.mix ? (rnd() < .1 ? 1.9 : rnd() < .3 ? 1.25 : rnd() < .5 ? .75 : 1) : 1, z = isz * m;
      var hit = keep.some(function (r) { return px + z * 1.1 > r[0] && px < r[2] && py + z * 1.5 > r[1] && py < r[3]; }); if (hit) continue;
      var it = list[k2++], d = document.createElement('div'); d.className = 'it'; d.style.left = px + 'px'; d.style.top = py + 'px'; d.style.width = (z * 1.35) + 'px'; d.style.zIndex = 2 + Math.floor(rnd() * 3); d.style.transform = 'rotate(' + ((rnd() - .5) * 14).toFixed(1) + 'deg)';
      var fs = Math.max(4.2, z * 0.135);
      d.innerHTML = '<img src="' + it.src + '" alt="" style="width:' + z + 'px;height:' + (z * .86) + 'px"><span class="pr" style="font-size:' + (fs * 1.25) + 'px">' + fmt(it.p) + '<small>/day</small></span><span class="nm" style="font-size:' + fs + 'px"><i>👋Lendo</i> ' + esc(poss(it.o)) + ' ' + esc(it.n) + '</span>';
      if (F.each) d.appendChild(qr(F.url + '/i/' + it.i, Math.round(z * .62), 'L'));
      box.appendChild(d);
    }
  }
  if (F.walk) for (var w = 0; w < 9; w++) { var e = document.createElement('span'); e.className = 'wk'; e.textContent = ['🚶', '🚶‍♀️', '🚴', '🧍'][w % 4]; e.style.left = (rnd() * (W - 20)) + 'px'; e.style.top = (rnd() * (usableH - 20)) + 'px'; box.appendChild(e); }
})();
