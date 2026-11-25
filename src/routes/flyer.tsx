// Printable flyers and tape strips (Scott, 11/24): the map with every pin "hovered open" — dense, scattered (no grid), a wild mix
// of items/owners/prices, no headline and no standalone logo (the 👋 Lendo mark rides on every item), one QR that opens Messages.
// Built from live listings so it always shows real stuff. Variations by query string; /flyers lists them. Print from the browser.
//   n=items  s=item size px  mix=1 mixed sizes  qr=each (QR per item → item page)  c=full|green|news|ink|orange
//   walk=1 a few walkers  tape=simple|promo|band  city=iac|nyc  msg=...
import { Hono } from 'hono';
import { raw } from 'hono/html';
import type { Env, Vars } from '../lib/env';
import { CITIES } from '../lib/places';
import { firstPhotos } from '../lib/db';

export const flyer = new Hono<{ Bindings: Env; Variables: Vars }>();

const VARIANTS: [string, string][] = [
  ['100 items · one QR', 'n=100&s=62'],
  ['Small · 160 items', 'n=160&s=46'],
  ['Micro · 300 items (hunt)', 'n=300&s=30'],
  ['Large · 50 items', 'n=50&s=96'],
  ['Mixed sizes', 'n=110&s=54&mix=1'],
  ['QR on every item', 'n=35&s=80&qr=each'],
  ['With walkers', 'n=100&s=60&walk=1'],
  ['Color: one-color green, orange tags', 'n=100&s=62&c=green'],
  ['Color: newsprint black', 'n=100&s=62&c=news'],
  ['Color: dark green', 'n=100&s=62&c=ink'],
  ['Color: orange', 'n=100&s=62&c=orange'],
  ['Tape · ultra simple', 'tape=simple'],
  ['Tape · promo', 'tape=promo'],
  ['Tape · 3.5in with side band', 'tape=band'],
];

flyer.get('/flyers', (c) => c.html(
  <html><head><meta name="robots" content="noindex" /><title>Lendo flyers</title><link rel="stylesheet" href="/app.css" /></head>
    <body style="padding:24px;max-width:560px;margin:auto"><h2 style="margin:0 0 12px">Flyers and tape</h2>
      {['iac', 'nyc'].map(ct => <div style="margin-bottom:18px"><b>{ct === 'iac' ? 'Iowa City' : 'New York'}</b>
        {VARIANTS.map(v => <a class="btn full" style="margin-top:8px" href={`/flyer?city=${ct}&${v[1]}`}>{v[0]}</a>)}</div>)}
    </body></html>));

flyer.get('/flyer', async (c) => {
  const q = c.req.query(), tape = q.tape || '', each = q.qr === 'each';
  const ct = CITIES.find(x => x.id === (q.city || 'iac')) || CITIES[0];
  const n = Math.max(10, Math.min(400, parseInt(q.n || (tape ? '120' : '100'), 10) || 100));
  const bb = (ct as any).bbox as number[] | undefined;
  const rows = (await c.env.DB.prepare(`SELECT l.id, l.name, l.price_cents, l.avatar_key, u.name owner FROM listings l JOIN users u ON u.id = l.owner_id
    WHERE l.status = 'live' ${bb ? 'AND l.lng BETWEEN ? AND ? AND l.lat BETWEEN ? AND ?' : ''} ORDER BY l.id LIMIT 900`).bind(...(bb ? [bb[0], bb[2], bb[1], bb[3]] : [])).all<{ id: string; name: string; price_cents: number; avatar_key: string | null; owner: string | null }>()).results;
  const ph = await firstPhotos(c.env.DB, rows.filter(r => !r.avatar_key).map(r => r.id).slice(0, 600));
  const items = rows.map(r => ({ i: r.id, n: r.name, p: r.price_cents, o: (r.owner || 'Neighbor').split(' ')[0], src: r.avatar_key ? '/p/' + r.avatar_key : ph[r.id] ? '/c/' + ph[r.id] + '?s=200' : '' })).filter(x => x.src);
  const num = (c.env.LENDO_NUMBER || '').replace(/\D/g, '').slice(-10);
  const cfg = { items, n, s: Math.max(18, Math.min(160, parseInt(q.s || '62', 10) || 62)), mix: q.mix === '1', each, walk: q.walk === '1', tape, sms: `SMSTO:+1${num}:${q.msg || 'Hi Lendo'}`, url: c.env.APP_URL, seed: parseInt(q.seed || '7', 10) || 7 };
  const css = `
@page{size:${tape ? '18in ' + (tape === 'band' ? '3.5in' : '4in') : '8.5in 11in'};margin:0}
*{box-sizing:border-box}html,body{margin:0;background:#888;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{position:relative;margin:16px auto;background:var(--bg);width:${tape ? '18in' : '8.5in'};height:${tape ? (tape === 'band' ? '3.5in' : '4in') : '11in'};overflow:hidden}
.in{position:absolute;inset:${tape ? '0' : '.25in'};overflow:hidden} /* items are cut off at the margin line, as if the page keeps going */
.it{position:absolute;display:flex;flex-direction:column;align-items:center;transform-origin:50% 60%}
.it img{object-fit:contain;filter:var(--imgf)}
.it .pr{background:var(--tag);color:var(--tagc);font-weight:900;border:1.5px solid var(--ink);border-radius:5px;padding:0 3px;line-height:1.25;margin-top:-.5em;position:relative;white-space:nowrap}
.it .pr small{font-weight:800;font-size:.72em}
.it .nm{color:var(--ink);font-weight:700;line-height:1.08;text-align:center;margin-top:1px;background:var(--lbl);border-radius:3px;padding:0 2px}
.it .nm i{font-style:normal;font-weight:900}
.it canvas{margin-top:2px}
.qr{position:absolute;background:#fff;border:3px solid var(--ink);border-radius:14px;padding:8px;display:flex;flex-direction:column;align-items:center;gap:4px;z-index:5}
.qr small{font-weight:900;font-size:10px;letter-spacing:.5px;color:#1E3A2B;text-align:center;line-height:1.2}
.wk{position:absolute;font-size:13px;z-index:1;filter:var(--imgf)}
.band{position:absolute;left:0;right:0;bottom:0;height:.5in;background:var(--ink);color:var(--bg);display:flex;align-items:center;gap:.25in;padding:0 .1in;font-weight:900;font-size:.2in;white-space:nowrap;overflow:hidden;z-index:6}
.band canvas{height:.42in;width:.42in;background:#fff;padding:1px;border-radius:2px;flex:none}
.c-full{--bg:#F5F3EE;--ink:#1E3A2B;--tag:#FF4F00;--tagc:#fff;--lbl:transparent;--imgf:none}
.c-green{--bg:#F5F3EE;--ink:#1E3A2B;--tag:#FF4F00;--tagc:#fff;--lbl:transparent;--imgf:grayscale(1) sepia(1) hue-rotate(75deg) saturate(1.6) brightness(.82) contrast(1.15)}
.c-news{--bg:#fff;--ink:#111;--tag:#111;--tagc:#fff;--lbl:transparent;--imgf:grayscale(1) contrast(1.25)}
.c-ink{--bg:#1E3A2B;--ink:#F5F3EE;--tag:#FF4F00;--tagc:#fff;--lbl:transparent;--imgf:drop-shadow(0 0 1px #fff)}
.c-orange{--bg:#FF4F00;--ink:#1E3A2B;--tag:#1E3A2B;--tagc:#fff;--lbl:#fff;--imgf:drop-shadow(0 0 1px #fff)}
.bar{position:fixed;top:8px;left:8px;z-index:9;font:700 12px Helvetica;background:#fff;padding:6px 10px;border-radius:8px}
@media print{html,body{background:none}.sheet{margin:0}.bar{display:none}}`;
  return c.html(
    <html><head><meta name="robots" content="noindex" /><meta name="viewport" content="width=device-width" /><title>Lendo flyer</title><style dangerouslySetInnerHTML={{ __html: css }} /></head>
      <body class={'c-' + (['full', 'green', 'news', 'ink', 'orange'].includes(q.c || '') ? q.c : 'full')}>
        <div class="bar"><a href="/flyers">All versions</a> · <a href="#" onclick="print();return false">Print</a></div>
        <div class="sheet" id="sheet"><div class="in" id="in" /></div>
        <script src="/qrgen.js"></script>
        {raw(`<script>window.F=${JSON.stringify(cfg).replace(/</g, '\\u003c')}</script><script src="/flyer.js"></script>`)}
      </body></html>);
});
