/* The Lendo hand lives only in the logo. lendoHand(x) plays there:
   'wave' | 'shrug' | 'nod' | 'five' | 'fist'  → the gesture, 3 times, then back to the L
   1..5                                         → holds up that many fingers for a moment
   A page can also ask with <i hidden data-lh="nod"></i> (played after the logo's own intro).
   One thing at a time; a new call replaces the one playing. Nothing moves under reduce motion. */
(function () {
  var H = document.querySelector('.logo .lh'); if (!H) { window.lendoHand = function () {}; return; }
  var RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var G = { l: { a: 'lhL', d: 900, n: 1 }, wave: { pose: 'open', a: 'lhWave', d: 900, n: 3 }, shrug: { pose: 'open', a: 'lhShrug', d: 2200, n: 3, x: 'o82' },
    nod: { pose: 'open', a: 'lhNod', d: 800, n: 3 },
    horns: { pose: 'horns', a: 'lhRock', d: 440, n: 7 }, shaka: { pose: 'shaka', a: 'lhWiggle', d: 480, n: 5 }, jazz: { pose: 'jazz', a: 'lhJazz', d: 200, n: 12 },
    snap: { pose: 'open', a: 'lhNone', d: 800, n: 3, x: 'fx-snap' }, drum: { pose: 'open', a: 'lhNone', d: 560, n: 4, x: 'fx-drum' }, count: { pose: 'fist', a: 'lhNone', d: 2800, n: 1, x: 'fx-count' },
    thumb: { pose: 'thumb', a: 'lhPump', d: 650, n: 3 }, peace: { pose: 'peace', a: 'lhSway', d: 900, n: 3 }, ok: { pose: 'okk', a: 'lhPump', d: 650, n: 3 },
    crossed: { pose: 'crossed', a: 'lhTilt', d: 1300, n: 2 }, soso: { pose: 'open', a: 'lhSoso', d: 700, n: 3 }, five: { pose: 'open', a: 'lhFive', d: 1300, n: 3 }, fist: { pose: 'fist', a: 'lhBump', d: 1100, n: 3, front: 1 } };
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
  /* intro on every page load (first homepage visit always waves): 60% wave, 20% the L, 20% one fun or small gesture. Always ends in the L. Then whatever the page asked for */
  var FUN = ['horns', 'shaka', 'jazz', 'snap', 'drum', 'count', 'thumb', 'peace', 'ok', 'crossed', 'soso', 'nod'];
  var first = false; try { if (location.pathname === '/' && !localStorage.getItem('lh_w')) { localStorage.setItem('lh_w', '1'); first = true; } } catch (e) {}
  var ask = document.querySelector('[data-lh]'), want = ask && ask.getAttribute('data-lh');
  var roll = Math.random(), intro = first || roll < .6 ? 'wave' : roll < .8 ? 'l' : FUN[Math.floor(Math.random() * FUN.length)];
  (intro === 'l' ? play('l') : play(intro).then(function () { return tok === 1 ? play('l') : null; })).then(function () { if (want && !busy) play(/^[1-5]$/.test(want) ? +want : want); });
  /* one-shot moments (?hi=1 after a handover, ?saved= after an edit) shouldn't replay on reload */
  try { if (/[?&](hi|saved)=/.test(location.search)) history.replaceState(null, '', location.pathname + location.search.replace(/[?&](hi|saved)=[^&]*/g, '').replace(/^&/, '?') + location.hash); } catch (e) {}
  /* stars picked on a rating → that many fingers */
  document.addEventListener('change', function (e) { var t = e.target; if (t && (t.name === 'stars' || t.name === 'item_stars') && /^[1-5]$/.test(t.value)) play(+t.value); });
})();
