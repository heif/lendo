// $5-off phone capture (prototype): every form[data-promo] on the page shares one opt-in dialog + one POST /promo.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var forms = document.querySelectorAll('form[data-promo]'); if (!forms.length || !$('optin')) return;
  if (/(^|; )lendo_p=1/.test(document.cookie)) { forms.forEach(function (f) { f.remove(); }); return; }
  forms.forEach(function (f) { f.hidden = false; });
  /* A/B test (exp 'gift5'): A = "Free $5 off rental", B = "Free $5 gift card" — 50/50, sticky per browser */
  var V = (document.cookie.match(/(?:^|; )lendo_ab_gift=(a|b)/) || [])[1];
  if (!V) { V = Math.random() < 0.5 ? 'a' : 'b'; document.cookie = 'lendo_ab_gift=' + V + ';path=/;max-age=34560000;samesite=lax'; }
  var BODY = V === 'a' ? 'Free $5 off rental please' : 'Free $5 gift card please', PHONE = matchMedia('(pointer:coarse)').matches;
  document.querySelectorAll('.giftbtn').forEach(function (g) {
    var t = g.querySelector('.gb-tx'); if (t) t.innerHTML = '<b>$5 OFF</b><small>$15+/day item</small>'; /* one label now (Scott, 11/25); the texted words still differ by variant */
    g.href = g.href.replace(/body=[^&]*/, 'body=' + encodeURIComponent(BODY));
    g.addEventListener('click', function () { ab('click'); });
  });
  var qd = $('gpQr'); if (qd) qd.dataset.sms = qd.dataset.sms.replace(/:[^:]*$/, ':' + BODY);
  function ab(ev) { try { var b = JSON.stringify({ exp: 'gift5', var: V, ev: ev, phone: PHONE }); if (navigator.sendBeacon) navigator.sendBeacon('/api/ab', b); else fetch('/api/ab', { method: 'POST', body: b, keepalive: true }); } catch (e) {} }
  try { if (!sessionStorage.getItem('ab_gift_seen')) { sessionStorage.setItem('ab_gift_seen', '1'); ab('view'); } } catch (e) { ab('view'); }
  var active = null, fmtPhone = function (d) { return d.length > 6 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : d.length > 3 ? '(' + d.slice(0, 3) + ') ' + d.slice(3) : d; };
  forms.forEach(function (form) {
    var inp = form.querySelector('input'), btn = form.querySelector('button'), digits = function () { return inp.value.replace(/\D/g, '').slice(0, 10); };
    inp.addEventListener('input', function () { inp.value = fmtPhone(digits()); btn.disabled = digits().length !== 10; });
    form.addEventListener('submit', function (e) { e.preventDefault(); if (digits().length !== 10) return; active = { inp: inp, btn: btn, digits: digits() }; $('optPhone').textContent = inp.value; $('optin').hidden = false; });
  });
  // computers: the gift button toggles the QR / phone panel instead of following the sms: link
  var gp = $('promo'), gb = gp && gp.querySelector('.giftbtn');
  var AND = document.documentElement.classList.contains('android');
  if (gb && (AND || !matchMedia('(pointer:coarse)').matches)) gb.addEventListener('click', function (e) {
    e.preventDefault(); gp.classList.toggle('open'); var q = $('gpQr');
    if (gp.classList.contains('open') && q && !q.firstChild) {
      var draw = function () { try { var qr = qrcode(0, 'M'); qr.addData(q.dataset.sms); qr.make(); var m = qr.getModuleCount(), s = 4, pad = 2, c = document.createElement('canvas'); c.width = c.height = (m + pad * 2) * s; var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#1E3A2B'; for (var r = 0; r < m; r++) for (var k = 0; k < m; k++) if (qr.isDark(r, k)) g.fillRect((k + pad) * s, (r + pad) * s, s, s); q.appendChild(c); } catch (err) {} };
      if (window.qrcode) draw(); else { var sc = document.createElement('script'); sc.src = '/qrgen.js'; sc.onload = draw; document.head.appendChild(sc); }
      var inp = gp.querySelector('input'); if (inp) setTimeout(function () { inp.focus(); }, 50);
    }
  });
  $('optNo').addEventListener('click', function () { $('optin').hidden = true; });
  $('optYes').addEventListener('click', function () {
    if (!active) return; var a = active; $('optin').hidden = true; a.btn.disabled = true; a.btn.dataset.t = a.btn.textContent; a.btn.textContent = '…';
    var fd = new FormData(); fd.append('phone', a.digits); fd.append('var', V);
    fetch('/promo', { method: 'POST', body: fd }).then(function (r) { return r.json(); }).then(function (j) {
      forms.forEach(function (f) { f.className = 'promo done' + (f.classList.contains('incard') ? ' incard' : ''); f.innerHTML = j.ok ? '✓ $5 off saved · check your texts' : 'Hmm — try again'; });
      if (j.ok) setTimeout(function () { forms.forEach(function (f) { f.remove(); }); }, 6000);
    }).catch(function () { a.btn.disabled = false; a.btn.textContent = a.btn.dataset.t || '$5 OFF'; });
  });
  // the floating bar steps aside while a map item card is open
  var fl = $('promo'), sheet = $('sheet'); if (fl && sheet) new MutationObserver(function () { fl.style.display = sheet.classList.contains('on') ? 'none' : ''; }).observe(sheet, { attributes: true, attributeFilter: ['class'] });
})();
