// Lendo flywheel (from the "Lendo flywheel diagram" thread, v16 geometry / v18 motion): solid arrows, an orange coin
// travels each arrow and the step it lands on lights up. 1.2s per beat, 6 beats per loop. Pure SVG + rAF.
(function () {
  var host = document.getElementById('flywheel'); if (!host) return;
  var INK = '#1E3A2B', OR = '#FF4F00', CREAM = '#F5F3EE';
  var STEPS = [
    ['items', 340, 87, 'More items listed', ''],
    ['near', 502, 166, 'More convenient', 'items closer by'],
    ['rent', 440, 319, 'More rentals', ''],
    ['trust', 340, 385, 'More ratings & trust', 'of owners, renters + items'],
    ['money', 230, 321, 'More $$$ saved & earned', 'less stuff + storage + waste'],
    ['try', 178, 166, 'More people try', 'renting + listing']
  ];
  // arrows: [from, to, path]
  var ARR = [
    ['items', 'near', 'M 420.1 102.1 A 170 128 0 0 1 483.1 145.8'],
    ['near', 'rent', 'M 509.4 204.1 A 170 128 0 0 1 468.3 299'],
    ['rent', 'money', 'M 382 339 A 170 128 0 0 1 340.3 343'],
    ['money', 'try', 'M 214.1 301 A 170 128 0 0 1 170.6 204.1'],
    ['try', 'items', 'M 196.9 145.8 A 170 128 0 0 1 259.9 102.1'],
    ['rent', 'trust', 'M 452 333 L 425 371'],
    ['trust', 'try', 'M 254 390 C 50 400, 50 270, 122 200']
  ];
  var NS = 'http://www.w3.org/2000/svg';
  function el(n, a, txt) { var e = document.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); if (txt != null) e.textContent = txt; return e; }
  var svg = el('svg', { viewBox: '0 0 680 425', width: '100%', role: 'img', 'aria-label': 'Lendo flywheel: more items listed, more convenient, more rentals, more ratings and trust, more money saved and earned, more people try — around local connection, community, affordability.' });
  var defs = el('defs'); var mk = el('marker', { id: 'fw-arrow', viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse' });
  mk.appendChild(el('path', { d: 'M2 1L8 5L2 9', fill: 'none', stroke: INK, 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })); defs.appendChild(mk); svg.appendChild(defs);
  // hub
  var hub = el('g', { class: 'fw-hub' });
  hub.appendChild(el('circle', { cx: 340, cy: 215, r: 90, fill: OR, stroke: INK, 'stroke-width': 2 }));
  ['More local', 'connection,', 'community,', 'affordability'].forEach(function (l, i) { hub.appendChild(el('text', { x: 340, y: 176 + 26 * i, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#fff', 'font-size': 21, 'font-weight': 900, 'letter-spacing': '-.4' }, l)); });
  svg.appendChild(hub);
  var paths = ARR.map(function (a) { var p = el('path', { d: a[2], fill: 'none', stroke: INK, 'stroke-width': 2.2, 'stroke-linecap': 'round', 'marker-end': 'url(#fw-arrow)' }); svg.appendChild(p); return { from: a[0], to: a[1], el: p, len: 0 }; });
  var hi = {}, label = {};
  STEPS.forEach(function (s) {
    var g = el('g'); var r = el('rect', { x: s[1], y: s[2] - 12, width: 0, height: 24, rx: 6, fill: OR, opacity: 0 }); g.appendChild(r); hi[s[0]] = r;
    var t = el('text', { x: s[1], y: s[2], 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: INK, 'font-size': 15, 'font-weight': 800 }, s[3]); g.appendChild(t); label[s[0]] = t;
    if (s[4]) g.appendChild(el('text', { x: s[1], y: s[2] + 19, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#6F6A60', 'font-size': 11.5, 'font-weight': 600 }, s[4]));
    svg.appendChild(g);
  });
  var coinA = el('circle', { r: 6, fill: OR, stroke: INK, 'stroke-width': 1.5 }), coinB = el('circle', { r: 6, fill: OR, stroke: INK, 'stroke-width': 1.5, opacity: 0 });
  svg.appendChild(coinA); svg.appendChild(coinB);
  host.appendChild(svg);
  paths.forEach(function (p) { p.len = p.el.getTotalLength(); });
  STEPS.forEach(function (s) { var w = label[s[0]].getBBox().width + 14; hi[s[0]].setAttribute('width', w); hi[s[0]].setAttribute('x', s[1] - w / 2); });
  // beats: coin A rides the ring; at "rent" coin B splits off to trust → try and rejoins
  var BEAT = 1200, seqA = ['items', 'near', 'rent', 'money', 'try'], ringA = [0, 1, 2, 3, 4], sideB = [5, 6];
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function place(coin, p, f) { var pt = p.el.getPointAtLength(Math.min(p.len, Math.max(0, f)) * (f <= 1 ? p.len : 1)); coin.setAttribute('cx', pt.x); coin.setAttribute('cy', pt.y); }
  function at(coin, pi, f) { var p = paths[pi], pt = p.el.getPointAtLength(p.len * Math.min(1, Math.max(0, f))); coin.setAttribute('cx', pt.x); coin.setAttribute('cy', pt.y); }
  var glow = {}; STEPS.forEach(function (s) { glow[s[0]] = 0; });
  function frame(ts) {
    var t = (ts % (BEAT * 5)) / BEAT, b = Math.floor(t), f = t - b, ease = f < .5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
    at(coinA, ringA[b], ease);
    // side loop: starts when A leaves 'rent' (beat 2), takes 2 beats (rent→trust, trust→try), arrives with A at 'try'
    if (b === 2) { coinB.setAttribute('opacity', 1); at(coinB, 5, ease); } else if (b === 3) { at(coinB, 6, ease); } else coinB.setAttribute('opacity', 0);
    // highlight the step just arrived at (start of each beat), fade over the beat
    var arrived = seqA[b]; STEPS.forEach(function (s) { var k = s[0], target = (k === arrived || (b === 3 && k === 'trust')) ? Math.max(0, 1 - f * 1.6) : 0; hi[k].setAttribute('opacity', (target * .9).toFixed(2)); label[k].setAttribute('fill', target > .3 ? '#fff' : INK); });
    if (!reduce) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
