/* The Lendo hand lives only in the logo. lendoHand(x) plays there:
   'wave' | 'shrug' | 'nod' | 'five' | 'fist'  → the gesture, 3 times, then back to the L
   1..5                                         → holds up that many fingers for a moment
   A page can also ask with <i hidden data-lh="nod"></i> (played after the logo's own intro).
   One thing at a time; a new call replaces the one playing. Nothing moves under reduce motion. */
(function () {
  var H = document.querySelector('.logo .lh'); if (!H) { window.lendoHand = function () {}; return; }
  var RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var G = { l: { a: 'lhL', d: 900, n: 1 }, wave: { pose: 'open', a: 'lhWave', d: 900, n: 3 }, shrug: { pose: 'open', a: 'lhShrug', d: 2200, n: 3, x: 'o82' },
    nod: { pose: 'open', a: 'lhNod', d: 800, n: 3 }, five: { pose: 'open', a: 'lhFive', d: 1300, n: 3 }, fist: { pose: 'fist', a: 'lhBump', d: 1100, n: 3, front: 1 } };
  var tok = 0, busy = false;
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function reset() { H.className = 'lh'; H.style.removeProperty('--a'); }
  function anim(g) { H.style.setProperty('--a', g.a); H.style.setProperty('--d', g.d + 'ms'); H.style.setProperty('--n', g.n); H.classList.add('an'); if (g.x) H.classList.add(g.x); return wait(g.d * g.n + 60); }
  function play(k) {
    if (RM) return Promise.resolve();
    var me = ++tok; reset(); busy = true;
    function live() { return me === tok; }
    function done() { if (live()) busy = false; }
    return (async function () {
      if (typeof k === 'number') { /* fingers for a number on the page */
        var n = Math.max(1, Math.min(5, Math.round(k)));
        H.classList.add(n === 5 ? 'open' : 'n' + n); await wait(260); if (!live()) return;
        await anim({ a: 'lhNum', d: 1900, n: 1 }); if (!live()) return; reset(); return done();
      }
      var g = G[k]; if (!g) return done();
      if (k === 'l') { H.classList.add('snap', 'open'); void H.offsetWidth; await wait(350); if (!live()) return; H.classList.remove('snap', 'open'); await wait(300); if (!live()) return; }
      if (g.pose) { H.classList.add(g.pose); await wait(260); if (!live()) return; }
      if (g.front) { H.classList.add('tip'); await wait(170); if (!live()) return; H.classList.add('fr'); H.classList.remove('tip'); await wait(120); if (!live()) return; }
      await anim(g); if (!live()) return;
      H.classList.remove('an'); if (g.x) H.classList.remove(g.x);
      if (g.front) { H.classList.add('tip'); await wait(170); if (!live()) return; H.classList.remove('fr', 'tip'); await wait(200); if (!live()) return; }
      reset(); done();
    })();
  }
  window.lendoHand = function (x) { return play(x); };
  /* intro: first visit to the homepage waves, then the L; every other page load does the L once. Then whatever the page asked for */
  var first = false; try { if (location.pathname === '/' && !localStorage.getItem('lh_w')) { localStorage.setItem('lh_w', '1'); first = true; } } catch (e) {}
  var ask = document.querySelector('[data-lh]'), want = ask && ask.getAttribute('data-lh');
  (first ? play('wave').then(function () { return tok === 1 ? play('l') : null; }) : play('l')).then(function () { if (want && !busy) play(/^[1-5]$/.test(want) ? +want : want); });
  /* one-shot moments (?hi=1 after a handover, ?saved= after an edit) shouldn't replay on reload */
  try { if (/[?&](hi|saved)=/.test(location.search)) history.replaceState(null, '', location.pathname + location.search.replace(/[?&](hi|saved)=[^&]*/g, '').replace(/^&/, '?') + location.hash); } catch (e) {}
  /* stars picked on a rating → that many fingers */
  document.addEventListener('change', function (e) { var t = e.target; if (t && (t.name === 'stars' || t.name === 'item_stars') && /^[1-5]$/.test(t.value)) play(+t.value); });
})();
