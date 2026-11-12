// Bouncing numbers: n copies of `text` fly in from all four sides, bounce like pinballs for `ms`, then fly off screen.
// lendoBounce('10', 10, 5000) on a 10+ profile · lendoBounce('1,065', 1, 3500) on the map
window.lendoBounce = function (text, n, ms) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var balls = [], t0 = performance.now(), G = 0.35; ms = ms || 4000; n = Math.max(1, Math.min(n || 1, 40));
  for (var i = 0; i < n; i++) {
    var el = document.createElement('div'); el.className = 'pinball' + (n === 1 ? ' solo' : ''); el.setAttribute('aria-hidden', 'true'); el.textContent = text; document.body.appendChild(el);
    var w = el.offsetWidth, h = el.offsetHeight, W0 = innerWidth, H0 = innerHeight, side = n === 1 ? Math.floor(Math.random() * 4) : i % 4, x, y, vx, vy, sp = 9 + Math.random() * 6;
    if (side === 0) { x = Math.random() * Math.max(1, W0 - w); y = -h - Math.random() * 80; vx = (Math.random() - .5) * 8; vy = sp * 0.6; }
    else if (side === 1) { x = W0 + Math.random() * 80; y = Math.random() * (H0 * 0.6); vx = -sp; vy = -4 - Math.random() * 6; }
    else if (side === 2) { x = Math.random() * Math.max(1, W0 - w); y = H0 + Math.random() * 80; vx = (Math.random() - .5) * 8; vy = -sp * 1.9; }
    else { x = -w - Math.random() * 80; y = Math.random() * (H0 * 0.6); vx = sp; vy = -4 - Math.random() * 6; }
    balls.push({ el: el, w: w, h: h, x: x, y: y, vx: vx, vy: vy, r: (Math.random() - .5) * 40, vr: (Math.random() - .5) * (n === 1 ? 4 : 12), inn: false });
  }
  function f(t) {
    var W = innerWidth, H = innerHeight, walls = t - t0 < ms, live = 0;
    balls.forEach(function (b) {
      if (b.gone) return;
      b.vy += G; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      if (!b.inn && b.x >= 0 && b.x <= W - b.w && b.y >= 0 && b.y <= H - b.h) b.inn = true;
      if (walls && b.inn) {
        if (b.y < 0) { b.y = 0; b.vy = Math.abs(b.vy); }
        if (b.x < 0) { b.x = 0; b.vx = -b.vx * 0.98; }
        if (b.x > W - b.w) { b.x = W - b.w; b.vx = -b.vx * 0.98; }
        if (b.y > H - b.h) { b.y = H - b.h; b.vy = -Math.max(Math.abs(b.vy) * 0.92, 10 + Math.random() * 5); }
      } else if (!walls && (b.x < -b.w - 20 || b.x > W + 20 || b.y > H + 20 || b.y < -b.h - 300)) { b.gone = true; b.el.remove(); return; }
      else if (t - t0 > ms + 6000) { b.gone = true; b.el.remove(); return; }
      b.el.style.transform = 'translate(' + b.x + 'px,' + b.y + 'px) rotate(' + b.r + 'deg)'; live++;
    });
    if (live) requestAnimationFrame(f);
  }
  requestAnimationFrame(f);
};
