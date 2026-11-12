// "Details customers look for" checklist under an item description (ROYS review + listing edit).
// Checks fill in as the owner writes. window.lendoDetails(text) → html; window.lendoDetailsBind(textarea, box)
(function () {
  var C = [
    ['Model / size', /\d|model|size|inch|"|\bcm\b|\bmm\b|\blbs?\b|\boz\b|\bgb\b|watt|volt|\bxl\b|\bft\b|feet|person|queen|king|twin/i],
    ['What’s included', /comes with|includ|\bwith\b|\+|case|charger|cable|bag|batter|remote|stand|cover|strap|lid|bits|accessor|manual/i],
    ['Condition (any wear?)', /condition|like new|brand new|\bnew\b|used|wear|scratch|clean|works|working|great shape|good shape|excellent|dent|mint|stain|tear|tested|perfect/i],
    ['Good for (what to use it for)', /good for|great for|perfect for|ideal|use (it )?for|for (a |the |your )?(party|parties|camping|movie|kids|travel|moving|trip|beach|hike|guests|event|wedding|project|garden|picnic|work|school|presentation)/i]
  ];
  function html(t) {
    t = t || ''; var n = 0, rows = C.map(function (c) { var ok = c[1].test(t); if (ok) n++; return '<div class="dk' + (ok ? ' ok' : '') + '">' + (ok ? '✓' : '○') + ' ' + c[0] + '</div>'; }).join('');
    return '<b>Details customers look for · ' + n + ' of 4</b><div class="dbar"><i style="width:' + n * 25 + '%"></i></div>' + rows;
  }
  window.lendoDetails = html;
  window.lendoDetailsBind = function (ta, box) { var up = function () { box.innerHTML = html(ta.value); }; ta.addEventListener('input', up); up(); };
})();
