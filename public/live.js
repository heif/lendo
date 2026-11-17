// Live chat: every 10s while the page is in front, ask if anything changed; if so, swap in the fresh chat + status card
(function () {
  var me = document.currentScript, url = me && me.dataset.ver; if (!url) return;
  var v = null, busy = false;
  function nearBottom() { return window.innerHeight + window.scrollY >= document.body.scrollHeight - 160; }
  function interacting() {
    if (document.querySelector('dialog[open]')) return true;
    var card = document.querySelector('.rcard');
    if (card && (card.querySelector('details[open]') || card.contains(document.activeElement))) return true;
    return false;
  }
  function swap(html) {
    var d = new DOMParser().parseFromString(html, 'text/html'), stay = nearBottom();
    ['.rcard', '.msgs', '.chatbar'].forEach(function (s) { var a = document.querySelector(s), b = d.querySelector(s); if (a && b) a.innerHTML = b.innerHTML; });
    var dock = document.querySelector('.rdock'), nd = d.querySelector('.rdock');
    if (dock && nd) { [].slice.call(dock.children).forEach(function (el) { if (!el.classList.contains('compose')) el.remove(); }); var form = dock.querySelector('.compose'); [].slice.call(nd.children).forEach(function (el) { if (!el.classList.contains('compose')) dock.insertBefore(el, form); }); }
    ['.rcard', '.msgs', '.rdock'].forEach(function (sel) { var box = document.querySelector(sel); if (box) [].slice.call(box.querySelectorAll('script')).forEach(function (o) { var n = document.createElement('script'); if (o.src) n.src = o.src; else n.textContent = o.textContent; o.replaceWith(n); }); });
    if (window.lendoTrim) window.lendoTrim();
    if (stay) window.scrollTo(0, document.body.scrollHeight);
  }
  function tick() {
    if (busy || document.visibilityState !== 'visible') return; busy = true;
    fetch(url, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j) return;
      if (v === null) { v = j.v; return; }
      if (j.v === v || interacting()) return;
      return fetch(location.pathname + location.search, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (h) { swap(h); v = j.v; });
    }).catch(function () {}).then(function () { busy = false; });
  }
  tick(); setInterval(tick, 10000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') tick(); });
})();
