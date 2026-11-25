/* The Lendo hand: plays one gesture at a time (src/lib/hand.ts draws it; gestures live in app.css).
   lendoHand(el, g) → plays gesture g on the hand inside el (or appends a 48px open hand to el first).
   Nothing moves when the device asks for reduced motion. */
(function () {
  var RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var G = ['g31', 'g1', 'g10', 'g15', 'g19'];
  function clear(h) { G.forEach(function (g) { h.classList.remove(g); }); }
  function make(px) {
    var src = document.querySelector('.logo .lh svg'); if (!src) return null;
    var s = src.cloneNode(true), w = Math.round(px * 128 / 150);
    s.setAttribute('width', w); s.setAttribute('height', px); s.removeAttribute('style'); s.style.overflow = 'visible';
    ['th', 'rg', 'pk', 'md'].forEach(function (c) { var g = s.querySelector('.' + c); if (g) g.removeAttribute('transform'); }); /* open palm, not the logo's L */
    var sp = document.createElement('span'); sp.className = 'lh'; sp.setAttribute('aria-hidden', 'true'); sp.appendChild(s); return sp;
  }
  function play(h, g, done) {
    if (!h || !g) return;
    if (RM) { clear(h); if (done) done(); return; }
    [].forEach.call(document.querySelectorAll('.lh'), function (o) { if (o !== h) clear(o); }); /* only one gesture on screen */
    clear(h); void h.offsetWidth; h.classList.add(g);
    var hd = h.querySelector('.hd');
    function end(e) { if (e.target !== hd) return; hd.removeEventListener('animationend', end); if (g !== 'g31') clear(h); if (done) done(); }
    if (hd) hd.addEventListener('animationend', end);
  }
  window.lendoHand = function (el, g, px) {
    if (!el) return null;
    var h = el.classList && el.classList.contains('lh') ? el : el.querySelector('.lh');
    if (!h) { h = make(px || 48); if (!h) return null; el.insertBefore(h, el.firstChild); }
    play(h, g); return h;
  };
  /* Logo: first visit to the homepage waves once (twice, with a pause), then snaps into the L; every other load does the L once */
  var logo = document.querySelector('.logo .lh');
  if (logo && logo.classList.contains('g1')) play(logo, 'g1', function () { play(logo, 'g31'); });
  /* one-shot moments (?hi=1 after a handover, ?saved= after an edit) shouldn't replay on reload */
  try { if (/[?&](hi|saved)=/.test(location.search)) history.replaceState(null, '', location.pathname + location.search.replace(/[?&](hi|saved)=[^&]*/g, '').replace(/^&/, '?') + location.hash); } catch (e) {}
  /* Any hand the server marked to play (data-play) */
  [].forEach.call(document.querySelectorAll('.lh[data-play]'), function (h) { setTimeout(function () { play(h, h.getAttribute('data-play')); }, logo && logo.classList.contains('g1') ? 7000 : 1600); /* after the logo is done */ });
})();
