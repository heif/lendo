// Crop transparent margins off photo cut-outs so every item fills its box the same (<img data-trim>)
(function () {
  function trim(img) {
    if (img.dataset.trimmed) return; img.dataset.trimmed = '1';
    try {
      var w = img.naturalWidth, h = img.naturalHeight; if (!w || !h) return;
      var c = document.createElement('canvas'); c.width = w; c.height = h; var x = c.getContext('2d'); x.drawImage(img, 0, 0);
      var d = x.getImageData(0, 0, w, h).data, x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (var y = 0; y < h; y += 2) for (var i = 0; i < w; i += 2) if (d[(y * w + i) * 4 + 3] > 24) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0 || (x1 - x0 > w * 0.94 && y1 - y0 > h * 0.94)) return;
      x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(w - 1, x1 + 2); y1 = Math.min(h - 1, y1 + 2);
      var o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1; o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
      img.src = o.toDataURL('image/png');
    } catch (e) { /* leave as is */ }
  }
  function run() { document.querySelectorAll('img[data-trim]').forEach(function (img) { if (img.complete) trim(img); else img.addEventListener('load', function () { trim(img); }, { once: true }); }); }
  window.lendoTrim = run;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
