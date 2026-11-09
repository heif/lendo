// $5-off phone capture (prototype): every form[data-promo] on the page shares one opt-in dialog + one POST /promo.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var forms = document.querySelectorAll('form[data-promo]'); if (!forms.length || !$('optin')) return;
  if (/(^|; )lendo_p=1/.test(document.cookie)) { forms.forEach(function (f) { f.remove(); }); return; }
  forms.forEach(function (f) { f.hidden = false; });
  var active = null, fmtPhone = function (d) { return d.length > 6 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : d.length > 3 ? '(' + d.slice(0, 3) + ') ' + d.slice(3) : d; };
  forms.forEach(function (form) {
    var inp = form.querySelector('input'), btn = form.querySelector('button'), digits = function () { return inp.value.replace(/\D/g, '').slice(0, 10); };
    inp.addEventListener('input', function () { inp.value = fmtPhone(digits()); btn.disabled = digits().length !== 10; });
    form.addEventListener('submit', function (e) { e.preventDefault(); if (digits().length !== 10) return; active = { inp: inp, btn: btn, digits: digits() }; $('optPhone').textContent = inp.value; $('optin').hidden = false; });
  });
  $('optNo').addEventListener('click', function () { $('optin').hidden = true; });
  $('optYes').addEventListener('click', function () {
    if (!active) return; var a = active; $('optin').hidden = true; a.btn.disabled = true; a.btn.textContent = '…';
    var fd = new FormData(); fd.append('phone', a.digits);
    fetch('/promo', { method: 'POST', body: fd }).then(function (r) { return r.json(); }).then(function (j) {
      forms.forEach(function (f) { f.className = 'promo done' + (f.classList.contains('incard') ? ' incard' : ''); f.innerHTML = j.ok ? '✓ $5 off saved · check your texts' : 'Hmm — try again'; });
      if (j.ok) setTimeout(function () { forms.forEach(function (f) { f.remove(); }); }, 6000);
    }).catch(function () { a.btn.disabled = false; a.btn.textContent = '$5 OFF'; });
  });
  // the floating bar steps aside while a map item card is open
  var fl = $('promo'), sheet = $('sheet'); if (fl && sheet) new MutationObserver(function () { fl.style.display = sheet.classList.contains('on') ? 'none' : ''; }).observe(sheet, { attributes: true, attributeFilter: ['class'] });
})();
