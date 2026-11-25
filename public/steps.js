// One question at a time (Scott, 11/24): no long forms. form.qs with .q blocks.
//   data-mode="steps": one after another, Next / Skip, last one submits (welcome)
//   data-mode="menu":  a list of rows (.qrow[data-q]); tap one, change it, Save (profile)
(function () {
  [].forEach.call(document.querySelectorAll('form.qs'), function (f) {
    var qs = [].slice.call(f.querySelectorAll('.q'));
    function focus(q) { var i = q.querySelector('input:not([type=hidden]):not([type=file]),textarea'); if (i) setTimeout(function () { try { i.focus(); } catch (e) {} }, 60); }
    function valid(q) { var ok = true; [].forEach.call(q.querySelectorAll('input,textarea,select'), function (i) { if (ok && !i.checkValidity()) { i.reportValidity(); ok = false; } }); return ok; }
    if (f.dataset.mode === 'steps') {
      var k = 0, next = f.querySelector('.qnext'), skip = f.querySelector('.qskip');
      /* start at the first question that still needs an answer */
      while (k < qs.length - 1 && !qs[k].dataset.skip && [].every.call(qs[k].querySelectorAll('input[required]'), function (i) { return i.value.trim() && i.checkValidity(); })) k++;
      var show = function () { qs.forEach(function (q, i) { q.hidden = i !== k; }); next.textContent = k === qs.length - 1 ? 'Done' : 'Next'; skip.hidden = !qs[k].dataset.skip; focus(qs[k]); };
      var go = function (skipping) { if (!skipping && !valid(qs[k])) return; if (skipping) [].forEach.call(qs[k].querySelectorAll('input:not([type=hidden])'), function (i) { if (i.type !== 'file') i.value = ''; }); if (k === qs.length - 1) { next.disabled = true; f.submit(); return; } k++; show(); };
      next.addEventListener('click', function () { go(false); }); skip.addEventListener('click', function () { go(true); });
      f.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); go(false); } });
      show();
    } else {
      var menu = f.querySelector('.qmenu'), save = f.querySelector('.qsave');
      var open = function (key) { qs.forEach(function (q) { q.hidden = q.dataset.q !== key; }); menu.hidden = !!key; save.hidden = !key; if (key) { focus(f.querySelector('.q[data-q="' + key + '"]')); window.scrollTo(0, 0); } };
      menu.addEventListener('click', function (e) { var b = e.target.closest('.qrow'); if (b) { open(b.dataset.q); history.replaceState(null, '', '#' + b.dataset.q); } });
      f.querySelector('.qback').addEventListener('click', function () { open(''); history.replaceState(null, '', location.pathname + location.search); });
      var h = location.hash.slice(1); if (h === 'handle') h = 'link'; if (h && f.querySelector('.q[data-q="' + h + '"]')) open(h);
    }
  });
})();
