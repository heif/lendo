import { getCookie } from 'hono/cookie';
import { bonusOpen, nycLeft, NYC_CAP } from '../lib/db';
import { hereOf } from '../lib/places';
import { DEPOSIT_CENTS } from '../lib/stripe';
import { Hono } from 'hono';
import { cutoutUrl } from '../lib/cutout';
import { smsHref } from '../lib/blooio';
import { logErr, logEvent } from '../lib/log';
import { localToday } from '../lib/util';
import { checkListingPhoto } from '../lib/photo-check';
import { Grade, GRADES, GRADE_WORD, isGrade, shownGrade } from '../lib/grade';
import { assignHandle, assignSlug, itemLink } from '../lib/urls';
import { recordCorrection } from '../lib/identify';
import { makeCutout } from '../lib/avatar';
import { raw } from 'hono/html';
import type { Env, Listing, Vars } from '../lib/env';
import { Layout } from '../pages/layout';
import { requireUser } from '../lib/auth';
import { avatarUrl } from '../lib/cutout';
import { firstPhotos, listingById, photosFor, busyDays } from '../lib/db';
import { id, money, now, fuzz, weekDefault, dayStr, addDays, fmtDay } from '../lib/util';
import { hoodFor, geocodePlace } from '../lib/geo';
import { emojiFor } from '../lib/emoji';
import { buildAvatars, autoIcon } from '../lib/avatar';
import { createListing } from '../lib/create-listing';
import { assignHood } from '../lib/hoods';

export const listings = new Hono<{ Bindings: Env; Variables: Vars }>();

// ---------- List fast ----------
listings.get('/list', async (c) => {
  const u = c.get('user'); /* guests can snap + answer; phone/code come after the item questions */
  const cfg = JSON.stringify({ stock: !!c.env.BRAVE_API_KEY, minPrice: parseInt(c.env.MIN_PRICE_CENTS, 10) / 100, hood: u?.hood || '', user: u ? { name: u.name || '', hood: u.hood || '', replied: !!u.replied } : null, sms: smsHref(c.env, 'OK'), shareUrl: u ? c.env.APP_URL + ((u as any).handle ? '/' + (u as any).handle : '/u/' + u.id) : c.env.APP_URL });
  return c.html(
    <Layout title="Rent out your stuff" user={u} promo={false} htmlClass="mappage" head={<link rel="stylesheet" href="/list.css" />}>
      {await bonusOpen(c.env.DB, u, hereOf(c, u)) ? await (async () => { const left = await nycLeft(c.env.DB), f = left / NYC_CAP, C = 2 * Math.PI * 9;
        return <details class="lbonus"><summary><span class="lb-t">$10 FOR 10 ITEMS<small>first 10K items NYC</small></span>
          <span class="lb-ring" title={`${left.toLocaleString('en-US')} of 10,000 left`}><svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="3.5" /><circle cx="12" cy="12" r="9" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-dasharray={`${(C * f).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 12 12)" /></svg><b>{left >= 1000 ? (Math.floor(left / 100) / 10).toFixed(1).replace(/\.0$/, '') + 'K' : left}</b><small>left</small></span><i aria-label="How it works">i</i></summary>
          <ol><li>List 10 things you own</li><li>Quick 2-min video check</li><li>$10 to you — plus a $10 rental gift card</li></ol></details>; })() : null}
      {/* ideas */}
      <section id="st-ideas" class="lf">
        <div class="lf-scroll">
          <div class="lf-h" style="display:flex;align-items:center">What have you got?<button type="button" class="aiico" id="aiOpen" aria-label="Ask your AI what you could list" title="Ask your AI what you could list">✨</button></div>
          <div id="ideas" class="ideas"></div>
          <button type="button" class="btn full" id="moreIdeas" style="margin-top:8px">14 more ideas →</button>
        </div>
        <div class="lf-foot"><button type="button" class="cta" id="toCam">OPEN CAMERA</button></div>
      </section>
      {/* ask your AI: copy a prompt → their own AI searches their email → paste the answer back */}
      <section id="st-ai" class="lf" hidden>
        <div class="lf-scroll">
          <div class="lf-h">Ask your AI</div>
          <div id="aiA">
            <div class="aistep"><i>1</i><b>Ask your AI this</b><small>Tap one · it copies the ask and opens it (paste if it's not filled in) · use one that can see your email</small></div>
            <div class="aiprompt" id="aiPrompt">Search my email for receipts of things I bought in the last 5 years that neighbors might rent — tools, cameras, camping, party/audio, sports, baby gear, kitchen appliances, luggage, outdoor gear. Skip food, clothes, gifts, subscriptions and consumables. One per line: item · brand/model · year · price</div>
            <div class="aiapps">{[['ChatGPT', 'https://chatgpt.com/?q='], ['Claude', 'https://claude.ai/new?q='], ['Gemini', 'https://gemini.google.com/app'], ['Muse', ''], ['Instinct', ''], ['Other', '']].map(([n, u]) => <button type="button" class="aiapp" data-u={u}>{n}</button>)}</div>
            <div class="aistep"><i>2</i><b>Paste its answer here</b></div>
            <textarea id="aiPaste" class="aipaste" rows={7} placeholder="DeWalt drill · DCD771 · 2022 · $99&#10;REI tent · 2021 · $229&#10;…"></textarea>
            <p class="hint" style="margin-top:6px">Lendo never sees your email · nothing is saved until you pick</p>
          </div>
          <div id="aiB" hidden><div class="lf-h" id="aiN" style="font-size:19px"></div><div id="aiList" class="ailist"></div>
            <button type="button" class="btn full" id="aiStock" hidden style="margin-top:12px">No photos? Post with standard photos →</button></div>
          <div id="aiC" hidden><div class="lf-h" style="font-size:19px">Does yours look like this?</div><p class="hint" style="margin:-4px 0 10px">Standard photo from the web · customers see it's a standard photo · take a real one anytime</p><div id="aiStockList" class="ailist"></div></div>
        </div>
        <div class="lf-foot"><button type="button" class="cta" id="aiGo">FIND MY STUFF</button></div>
      </section>
      {/* camera */}
      <section id="st-cam" class="cam" hidden>
        <video id="cam" playsinline muted autoplay></video>
        <input type="file" id="file" accept="image/*" capture="environment" hidden /><input type="file" id="moreFile" accept="image/*" multiple hidden /><input type="file" id="labelFile" accept="image/*" capture="environment" hidden />
        <div class="cam-top">
          <button type="button" class="cam-x" id="camClose" aria-label="Close"><svg width="14" height="14" viewBox="0 0 12 12"><path d="M2 2L10 10M10 2L2 10" stroke="#fff" stroke-width="2" stroke-linecap="round" /></svg></button>
          <div class="cam-hints"><span class="hint-big" id="hintBig"></span><span class="hint-sm" id="hint"></span></div>
        </div>
        <div class="cam-br"><i></i><i></i><i></i><i></i></div>
        <div class="tap" id="tapHint">Tap to take a picture <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 4V19M6 13L12 19L18 13" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" /></svg></div>
        <button type="button" class="cam-fallback" id="camFallback" hidden>Open camera</button>
        <div class="flash" id="flash"></div>
        <div class="toast-ok" id="toast"><span>✓</span>Got it</div>
        <div class="minilist" id="miniList" hidden></div>
        <div class="cam-bar">
          <button type="button" class="thumbwrap" id="thumbWrap" hidden><img id="thumb" alt="" /><span id="count">0</span></button>
          <button type="button" class="shutter" id="shutter" aria-label="Take photo"><span></span></button>
          <button type="button" class="donebtn" id="doneBtn" hidden>Done →</button>
        </div>
      </section>
      {/* review */}
      <section id="st-review" class="lf" hidden>
        <div class="lf-scroll">
          <div class="rv-top"><button type="button" class="lnk" id="backCam">← snap more</button><span class="m rv-count" id="rvCount"></span></div>
          <div class="lf-h">Check names and prices</div>
          <div class="lf-tip"><b>✦ Guessed from your photo</b> — fix anything off</div>
          <div id="rows"></div>
        </div>
        <div class="lf-foot"><button type="button" class="cta" id="listBtn">LIST</button></div>
      </section>
      {/* one question at a time (card stack): small photo always on top, answered questions shrink to lines, current one is a card */}
      <section id="st-q" class="lf" hidden>
        <div class="lf-scroll">
          <div class="q-top"><button type="button" class="q-ph" id="qPh" aria-label="Retake photo"><img id="qImg" alt="" /><i class="q-id" id="qId" hidden aria-label="Identifying"><span class="dots"><i>.</i><i>.</i><i>.</i></span></i><span>↻</span></button><div class="q-done" id="qDone"></div></div>
          <div class="q-card" id="qCard"></div>
        </div>
      </section>
      {/* done */}
      <section id="st-done" class="lf" hidden>
        {/* posted: the item big on cream, one Share button, three small ways to send, then list another */}
        <div class="lf-scroll dn2">
          <div class="dn2-ok"><span class="dn2-tick" aria-hidden="true">✓</span><span id="dnHead">Posted</span><span id="dnSub" hidden></span></div>
          <div id="tray" class="dn2-tray"></div>
          {/* three big choices */}
          <div class="dn3">
            <button type="button" class="dn3-b hot" id="stShare"><svg class="ic" width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h1a2 2 0 0 0 2-2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2" /><circle cx="12" cy="13" r="3" /></svg>Post</button>
            <button type="button" class="dn3-b hot" id="stSend"><svg class="ic" width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20l1.3-3.9C1.976 12.66 2.874 8.202 6.4 5.7c3.526-2.501 8.59-2.296 11.845.48c3.255 2.777 3.695 7.266 1.029 10.501C16.608 19.917 11.659 20.989 7.7 19z" /></svg>Send</button>
            <button type="button" class="dn3-b" id="again"><svg class="ic" width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14" /></svg>List another</button>
          </div>
          <a class="dn3-map" href="/">See it on the map</a>
          <div id="shBtns" hidden></div>
          <canvas class="story" id="story" width="1080" height="1920" hidden></canvas><button type="button" id="stSave" hidden></button>
        </div>
        <div class="toast" id="shToast" style="display:none"></div>
      </section>
      {raw(`<script>window.LENDO_LIST=${cfg};</script>`)}
      <script src="/qrgen.js"></script>
      <script src="/details.js"></script>
      <script src="/list.js"></script>
    </Layout>
  );
});

listings.post('/list', async (c) => {
  const u = c.get('user');
  if (!u) return c.redirect('/login?next=/list');
  const f = await c.req.parseBody({ all: true });
  const name = String(f.name || '').trim().slice(0, 80);
  const minP = parseInt(c.env.MIN_PRICE_CENTS, 10);
  const price = Math.round(parseFloat(String(f.price || '0')) * 100);
  if (!name || isNaN(price) || price < minP) return c.text(`Price must be at least ${money(minP)}/day and the item needs a name.`, 400);
  const weekIn = parseFloat(String(f.week || ''));
  const lat = parseFloat(String(f.lat || '')), lng = parseFloat(String(f.lng || ''));
  const files = ([] as unknown[]).concat(f.photo || []).filter((p): p is File => p instanceof File);
  const photos = await Promise.all(files.slice(0, 6).map(async p => ({ bytes: await p.arrayBuffer(), type: p.type })));
  const lid = await createListing(c.env, c.executionCtx, u, { name, priceCents: price, weekCents: !isNaN(weekIn) && weekIn > 0 ? Math.round(weekIn * 100) : null, description: String(f.description || ''), lat: isNaN(lat) ? null : lat, lng: isNaN(lng) ? null : lng, photos });
  return c.redirect('/listings?just=' + lid);
});

// Batch create from the snap-flow: multipart with items[i][name|price|week|note] + photo_i
// real photo of the item on a transparent background (for the share story card); cached in R2
listings.get('/api/cut/:id', async (c) => {
  const lid = c.req.param('id'), key = `${lid}/cut.png`;
  let o = await c.env.PHOTOS.get(key);
  if (!o) {
    const ph = await c.env.DB.prepare('SELECT r2_key FROM photos WHERE listing_id = ? ORDER BY pos LIMIT 1').bind(lid).first<{ r2_key: string }>();
    if (!ph) return c.json({ error: 'none' }, 404);
    try { const cut = await makeCutout(c.env, ph.r2_key, 900); if (!cut) return c.json({ error: 'cut' }, 502); await c.env.PHOTOS.put(key, cut, { httpMetadata: { contentType: 'image/png' } }); return c.body(cut, 200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' }); }
    catch { return c.json({ error: 'cut' }, 502); }
  }
  return c.body(o.body, 200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
});

/* fast cut-out for the snap flow: starts the moment the photo is taken, in parallel with identify (which used to come first) */
listings.post('/api/cut', async (c) => {
  if (!c.get('user')) { /* guests: capped per IP, like identify */
    const ip = c.req.header('cf-connecting-ip') || 'x';
    const n = await c.env.DB.prepare(`SELECT COUNT(*) n FROM events WHERE kind = 'cut.guest' AND at > ? AND data = ?`).bind(Date.now() - 3600000, ip).first<{ n: number }>().catch(() => null);
    if ((n?.n || 0) >= 30) return c.json({ error: 'slow down' }, 429);
    await logEvent(c.env.DB, 'cut.guest', { data: ip });
  }
  const f = await c.req.parseBody(); const p = f.photo;
  if (!(p instanceof File)) return c.json({ error: 'photo required' }, 400);
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16), base = `tmp/${id}`;
  await c.env.PHOTOS.put(`${base}.jpg`, await p.arrayBuffer(), { httpMetadata: { contentType: p.type || 'image/jpeg' } });
  try {
    const cut = await makeCutout(c.env, `${base}.jpg`, 600); if (!cut) return c.json({ error: 'cut' }, 502);
    c.executionCtx.waitUntil(c.env.PHOTOS.put(`${base}-cut.png`, cut, { httpMetadata: { contentType: 'image/png' } }).then(() => {}));
    return c.body(cut, 200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
  } catch (e) { await logErr(c.env.DB, 'api/cut', e); return c.json({ error: 'cut', why: String(e).slice(0, 200) }, 502); }
});
listings.get('/api/cuttmp/:id{[a-f0-9]{16}}', async (c) => {
  const base = `tmp/${c.req.param('id')}`, key = `${base}-cut.png`;
  const o = await c.env.PHOTOS.get(key);
  if (o) return c.body(o.body, 200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
  if (!(await c.env.PHOTOS.head(`${base}.jpg`))) return c.json({ error: 'none' }, 404);
  try { const cut = await makeCutout(c.env, `${base}.jpg`, 900); if (!cut) return c.json({ error: 'cut' }, 502); await c.env.PHOTOS.put(key, cut, { httpMetadata: { contentType: 'image/png' } }); return c.body(cut, 200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' }); }
  catch { return c.json({ error: 'cut' }, 502); }
});

/* standard product photo for an item (Brave image search); the owner confirms theirs looks like it */
listings.get('/api/stock', async (c) => {
  if (!c.get('user') || !c.env.BRAVE_API_KEY) return c.json({ imgs: [] });
  const q = String(c.req.query('q') || '').trim().slice(0, 100); if (!q) return c.json({ imgs: [] });
  try {
    const r = await fetch('https://api.search.brave.com/res/v1/images/search?safesearch=strict&count=8&q=' + encodeURIComponent(q + ' product photo white background'), { headers: { accept: 'application/json', 'X-Subscription-Token': c.env.BRAVE_API_KEY } });
    if (!r.ok) { await logErr(c.env.DB, 'stock search', new Error('brave ' + r.status)); return c.json({ imgs: [] }); }
    const j: any = await r.json();
    const imgs = (j.results || []).map((x: any) => ({ src: x.properties?.url, thumb: x.thumbnail?.src })).filter((x: any) => /^https:\/\//.test(x.src || '') && x.thumb).slice(0, 4);
    return c.json({ imgs });
  } catch (e) { await logErr(c.env.DB, 'stock search', e); return c.json({ imgs: [] }); }
});
/* post items with the standard photo the owner confirmed (no camera); the photo is copied into R2 like any other */
listings.post('/api/list-stock', async (c) => {
  const u = c.get('user'); if (!u) return c.json({ error: 'login' }, 401);
  const b = await c.req.json<{ items?: { name?: string; price?: number; img?: string; thumb?: string }[]; lat?: number; lng?: number }>().catch(() => ({} as any));
  const minP = parseInt(c.env.MIN_PRICE_CENTS, 10), out: any[] = [];
  for (const it of (b.items || []).slice(0, 30)) {
    const name = String(it.name || '').trim().slice(0, 80), price = Math.round(Number(it.price || 0) * 100);
    if (!name || !(price >= minP)) continue;
    let bytes: ArrayBuffer | null = null, type = 'image/jpeg';
    for (const u0 of [it.img, it.thumb]) {
      if (bytes || !/^https:\/\//.test(String(u0 || ''))) continue;
      try { const r = await fetch(String(u0), { headers: { 'user-agent': 'Lendo/1.0' }, cf: { cacheTtl: 0 } } as any); const ct = r.headers.get('content-type') || ''; if (r.ok && /^image\/(jpeg|png|webp)/.test(ct)) { const a = await r.arrayBuffer(); if (a.byteLength > 2000 && a.byteLength < 8e6) { bytes = a; type = ct.split(';')[0]; } } } catch {}
    }
    if (!bytes) continue;
    const lid = await createListing(c.env, c.executionCtx, u, { name, priceCents: price, lat: typeof b.lat === 'number' ? b.lat : null, lng: typeof b.lng === 'number' ? b.lng : null, photos: [{ bytes, type }] });
    await c.env.DB.prepare('UPDATE listings SET stock_photo = 1 WHERE id = ?').bind(lid).run();
    await logEvent(c.env.DB, 'listing.stock_photo', { user: u.id, listing: lid, data: { src: String(it.img || '').slice(0, 300) } });
    const ph0 = await c.env.DB.prepare('SELECT r2_key FROM photos WHERE listing_id = ? ORDER BY pos LIMIT 1').bind(lid).first<{ r2_key: string }>().catch(() => null);
    out.push({ id: lid, name, url: await itemLink(c.env, lid), cut: ph0 ? cutoutUrl(c.env, ph0.r2_key, 600, 600) : null });
  }
  return c.json({ listed: out, count: out.length });
});
listings.post('/api/list', async (c) => {
  const u = c.get('user');
  if (!u) return c.json({ error: 'login' }, 401);
  const f = await c.req.parseBody({ all: true });
  const lat = parseFloat(String(f.lat || '')), lng = parseFloat(String(f.lng || ''));
  const minP = parseInt(c.env.MIN_PRICE_CENTS, 10);
  const out: { id: string; name: string; url?: string; cut?: string | null }[] = [];
  for (let i = 0; i < 30; i++) {
    const name = String(f[`name_${i}`] || '').trim(); if (!name) continue;
    const aiName = String(f[`ai_${i}`] || '').trim(); if (aiName) c.executionCtx.waitUntil(recordCorrection(c.env, aiName, name).catch(() => {}));
    const price = Math.round(parseFloat(String(f[`price_${i}`] || '0')) * 100); if (isNaN(price) || price < minP) continue;
    const files = [f[`photo_${i}`], ...Array.from({ length: 5 }, (_, j) => f[`photo_${i}_${j + 1}`])].filter((x): x is File => x instanceof File);
    const photos = await Promise.all(files.slice(0, 6).map(async p => ({ bytes: await p.arrayBuffer(), type: p.type })));
    const wk = Math.round(parseFloat(String(f[`week_${i}`] || '0')) * 100);
    const lid = await createListing(c.env, c.executionCtx, u, { name, priceCents: price, weekCents: wk > 0 ? wk : null, description: String(f[`note_${i}`] || ''), lat: isNaN(lat) ? null : lat, lng: isNaN(lng) ? null : lng, photos, grade: String(f[`grade_${i}`] || 'A') });
    if (f[`hold_${i}`] === '1') await c.env.DB.prepare('UPDATE listings SET deposit_cents = ? WHERE id = ?').bind(DEPOSIT_CENTS, lid).run(); /* worth over $150 now → $150 hold at pickup */
    await assignHandle(c.env, u.id, u.name).catch(() => null); await assignSlug(c.env, lid, u.id, name).catch(() => null);
    const ph0 = await c.env.DB.prepare('SELECT r2_key FROM photos WHERE listing_id = ? ORDER BY pos LIMIT 1').bind(lid).first<{ r2_key: string }>().catch(() => null);
    out.push({ id: lid, name, url: await itemLink(c.env, lid), cut: ph0 ? cutoutUrl(c.env, ph0.r2_key, 600, 600) : null } as any); /* posted screen shows the cut-out even if the in-flow one didn't land */
  }
  /* A/B list10: first item listed, and reaching 10, per variant (cookie set on the page) */
  const abv = getCookie(c, 'lendo_ab_l10');
  if (out.length && abv && /^[abc]$/.test(abv)) {
    const n = (await c.env.DB.prepare(`SELECT COUNT(*) n FROM listings WHERE owner_id = ? AND demo = 0`).bind(u.id).first<{ n: number }>())?.n ?? 0;
    if (n - out.length === 0) await logEvent(c.env.DB, 'ab.list10', { user: u.id, data: { ev: 'listed', var: abv } });
    if (n >= 10 && n - out.length < 10) await logEvent(c.env.DB, 'ab.list10', { user: u.id, data: { ev: 'ten', var: abv } });
  }
  return c.json({ listed: out, count: out.length });
});
listings.get('/listings', requireUser, async (c) => {
  // listings live on your profile now (one page to manage your stuff)
  const u = c.get('user')!; const just = c.req.query('just');
  const h = (u as any).handle;
  return c.redirect((h ? '/' + h : '/u/' + u.id) + (just ? '?just=' + encodeURIComponent(just) : ''));
});

listings.post('/listings/:id/price', requireUser, async (c) => {
  const u = c.get('user')!;
  const d = parseInt(String((await c.req.parseBody()).delta || '0'), 10) || 0;
  const minP = parseInt(c.env.MIN_PRICE_CENTS, 10);
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  const np = Math.max(minP, it.price_cents + d);
  const week = weekDefault(np); /* weekly is always automatic */
  await c.env.DB.prepare('UPDATE listings SET price_cents = ?, week_cents = ? WHERE id = ?').bind(np, week, it.id).run();
  await logEvent(c.env.DB, 'listing.price', { user: u.id, listing: it.id, cents: np, data: { was: it.price_cents } });
  return c.redirect('/listings');
});

listings.post('/listings/:id/toggle', requireUser, async (c) => {
  const u = c.get('user')!;
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  if (it.status === 'review') return c.redirect('/listings');
  await c.env.DB.prepare('UPDATE listings SET status = ? WHERE id = ?').bind(it.status === 'live' ? 'paused' : 'live', it.id).run();
  await logEvent(c.env.DB, it.status === 'live' ? 'listing.paused' : 'listing.unpaused', { user: u.id, listing: it.id });
  return c.redirect('/listings');
});

listings.post('/listings/:id/remove', requireUser, async (c) => {
  const u = c.get('user')!;
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  await c.env.DB.prepare(`UPDATE listings SET status = 'removed' WHERE id = ?`).bind(it.id).run();
  await logEvent(c.env.DB, 'listing.removed', { user: u.id, listing: it.id, data: { name: it.name } });
  return c.redirect('/listings');
});

listings.get('/listings/:id/edit', requireUser, async (c) => {
  const u = c.get('user')!;
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  const photos = await photosFor(c.env.DB, it.id);
  const today = localToday(it.lng);
  const busy = await busyDays(c.env.DB, it.id, today, addDays(today, 13));
  const blocked = new Set((await c.env.DB.prepare('SELECT day FROM blocked_days WHERE listing_id = ? AND day >= ?').bind(it.id, today).all<{ day: string }>()).results.map(r => r.day));
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const gr = await shownGrade(c.env, it.id, (it as any).grade);
  return c.html(
    <Layout title="Edit listing" user={u} back="/listings">
      <form method="post" action={'/listings/' + it.id + '/edit'} style="padding:12px 16px 40px">
        <div class="phm">
          {photos.map((p, i) => <div class="phm-it">
            {/* cover shows the cut-out, like the item page and map */}
            <img src={cutoutUrl(c.env, p.r2_key, 400, 400)} alt="" style="object-fit:contain;background:#fff" />
            {i === 0 ? <span class="phm-cover">cover</span> : <button type="submit" formaction={`/listings/${it.id}/photos/${p.id}/cover`} formnovalidate class="phm-mk">make cover</button>}
            <button type="submit" formaction={`/listings/${it.id}/photos/${p.id}/delete`} formnovalidate class="phm-x" aria-label="Remove photo">×</button>
          </div>)}
          {photos.length < 6 ? <label class="phm-add">+<small>photo</small><input type="file" accept="image/*" multiple hidden onchange="this.form.action=this.dataset.u;this.form.enctype='multipart/form-data';this.form.submit()" data-u={`/listings/${it.id}/photos`} name="photos" /></label> : null}
        </div>
        <div style="display:flex;gap:10px;align-items:flex-end">
          <label class="field" style="flex:1"><span>Name</span><input name="name" value={it.name} required maxlength={80} /></label>
        </div>
        <div style="display:flex;gap:10px">
          <label class="field" style="flex:1"><span>$ per day</span><input name="price" type="number" step="1" min={parseInt(c.env.MIN_PRICE_CENTS, 10) / 100} value={it.price_cents / 100} required /></label>
        </div>
        <div class="field"><span>Condition</span>
          {gr.customers ? <div class="row" style="gap:10px;margin-top:4px"><Grade g={gr.letter} /><span class="hint">{GRADE_WORD[gr.letter]} · set by customers now (average of yours + {gr.customers} customer grade{gr.customers === 1 ? '' : 's'})</span></div>
            : <div class="grdpick" style="margin-top:4px">{GRADES.map(g => <label><input type="radio" name="grade" value={g} checked={g === gr.letter} /><Grade g={g} /></label>)}</div>}
        </div>
        <input type="hidden" name="hold_set" value="1" />
        <label class={'q-hold edit-hold' + ((it.deposit_cents || 0) > 0 ? ' on' : '')} style="margin:4px 0 14px"><span>Worth over $150 now?<small>On: customers get a $150 hold (not a charge) at pickup, released at return</small></span><input type="checkbox" name="hold" value="1" checked={(it.deposit_cents || 0) > 0} onchange="this.parentNode.classList.toggle('on',this.checked)" /><i></i></label>
        <label class="field"><span>Description</span><textarea name="description" id="desc" maxlength={600} placeholder="Model · what’s included · condition · good for">{it.description || ''}</textarea></label>
        <div class="dmeter" id="dmeter"></div>
        <script src="/details.js"></script>
        <script dangerouslySetInnerHTML={{ __html: `lendoDetailsBind(document.getElementById('desc'), document.getElementById('dmeter'))` }} />
        <div class="m" style="font-size:11px;color:var(--mute);margin-top:8px">tap a day to block it</div>
        <div class="days">
          {days.map(d => {
            const rented = busy.has(d) && !blocked.has(d);
            const dt = new Date(d + 'T12:00:00Z');
            return <label><input type="checkbox" name="block" value={d} checked={blocked.has(d)} disabled={rented} style="display:none" /><button type="button" class={rented ? 'busy' : blocked.has(d) ? 'on' : ''} disabled={rented} onclick="var i=this.previousElementSibling;i.checked=!i.checked;this.classList.toggle('on',i.checked)" aria-label={fmtDay(d) + (rented ? ' rented' : '')} style="width:100%">{dt.toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' })} {dt.getUTCDate()}</button></label>;
          })}
        </div>
        
        <button class="btn pri full" type="submit" style="margin-top:16px">Save</button>
        <div class="row" style="gap:8px;margin-top:12px">
          {it.status === 'review' ? <span class="pill">Posted · checking the photo</span> : <button class="btn sm" type="submit" formaction={'/listings/' + it.id + '/toggle'} formnovalidate>{it.status === 'live' ? 'Pause it' : 'Make it live'}</button>}
          <button class="btn sm" type="submit" formaction={'/listings/' + it.id + '/remove'} formnovalidate style="color:var(--red)" onclick="return confirm('Remove this listing?')">Remove</button>
        </div>
      </form>
    </Layout>
  );
});

// photos: add (up to 6), remove, make cover — owner only
async function ownListing(c: any) { const u = c.get('user')!; const it = await listingById(c.env.DB, c.req.param('id')); return it && it.owner_id === u.id ? it : null; }
async function renumber(env: any, lid: string) { const rows = (await env.DB.prepare('SELECT id FROM photos WHERE listing_id = ? ORDER BY pos, id').bind(lid).all()).results as { id: string }[]; for (let i = 0; i < rows.length; i++) await env.DB.prepare('UPDATE photos SET pos = ? WHERE id = ?').bind(i, rows[i].id).run(); }
// cover photo changed → redo the map icon from the new cover
async function recoverIcon(c: any, lid: string, before: string | null) {
  const ph = await photosFor(c.env.DB, lid); const k = ph[0]?.r2_key || null;
  if (k && k !== before) c.executionCtx.waitUntil(autoIcon(c.env, lid, k));
}
listings.post('/listings/:id/photos', requireUser, async (c) => {
  const it = await ownListing(c); if (!it) return c.notFound();
  const f = await c.req.parseBody({ all: true });
  const files = (Array.isArray(f.photos) ? f.photos : [f.photos]).filter((x): x is File => x instanceof File && x.size > 0);
  const have = (await photosFor(c.env.DB, it.id)).length;
  let pos = have;
  for (const p of files.slice(0, Math.max(0, 6 - have))) {
    const key = `${it.id}/${id('ph')}.${(p.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`;
    await c.env.PHOTOS.put(key, await p.arrayBuffer(), { httpMetadata: { contentType: p.type || 'image/jpeg' } });
    await c.env.DB.prepare('INSERT INTO photos (id, listing_id, r2_key, pos) VALUES (?,?,?,?)').bind(id('ph'), it.id, key, pos++).run();
  }
  if (!have) await recoverIcon(c, it.id, null);
  /* first real photo replaces the standard one: it becomes the cover and the map icon */
  if (it.stock_photo && pos > have) {
    const ph = await photosFor(c.env.DB, it.id), real = ph.slice(have);
    for (const p of ph.slice(0, have)) await c.env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(p.id).run();
    for (let i = 0; i < real.length; i++) await c.env.DB.prepare('UPDATE photos SET pos = ? WHERE id = ?').bind(i, real[i].id).run();
    await c.env.DB.prepare('UPDATE listings SET stock_photo = 0, avatar_key = NULL WHERE id = ?').bind(it.id).run();
    await logEvent(c.env.DB, 'listing.real_photo', { user: it.owner_id, listing: it.id });
    await recoverIcon(c, it.id, null);
  }
  // new photos get the same safety check as at listing time
  const added = (await photosFor(c.env.DB, it.id)).slice(have).map(p => p.r2_key);
  if (added.length && it.status === 'live') c.executionCtx.waitUntil((async () => { for (const k of added) if (!(await checkListingPhoto(c.env, it.id, k))) break; })().catch(() => {}));
  return c.redirect(`/listings/${it.id}/edit`);
});
listings.post('/listings/:id/photos/:pid/delete', requireUser, async (c) => {
  const it = await ownListing(c); if (!it) return c.notFound();
  const cover0 = (await photosFor(c.env.DB, it.id))[0]?.r2_key || null;
  const ph = await c.env.DB.prepare('SELECT r2_key FROM photos WHERE id = ? AND listing_id = ?').bind(c.req.param('pid'), it.id).first<{ r2_key: string }>();
  if (ph) { await logEvent(c.env.DB, 'listing.photo_deleted', { user: it.owner_id, listing: it.id, data: { key: ph.r2_key } }); await c.env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(c.req.param('pid')).run(); await c.env.PHOTOS.delete(ph.r2_key); await renumber(c.env, it.id); await recoverIcon(c, it.id, cover0); }
  return c.redirect(`/listings/${it.id}/edit`);
});
listings.post('/listings/:id/photos/:pid/cover', requireUser, async (c) => {
  const it = await ownListing(c); if (!it) return c.notFound();
  const cover0 = (await photosFor(c.env.DB, it.id))[0]?.r2_key || null;
  await c.env.DB.prepare('UPDATE photos SET pos = -1 WHERE id = ? AND listing_id = ?').bind(c.req.param('pid'), it.id).run();
  await renumber(c.env, it.id); await recoverIcon(c, it.id, cover0);
  return c.redirect(`/listings/${it.id}/edit`);
});

listings.post('/listings/:id/edit', requireUser, async (c) => {
  const u = c.get('user')!;
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  const f = await c.req.parseBody({ all: true });
  const minP = parseInt(c.env.MIN_PRICE_CENTS, 10);
  const price = Math.max(minP, Math.round(parseFloat(String(f.price || '0')) * 100) || minP);
  const week = weekDefault(price); /* weekly is always automatic */
  const nm = String(f.name || it.name).trim().slice(0, 80), ds = String(f.description || '').trim().slice(0, 600) || null;
  const em = nm === it.name && it.emoji ? it.emoji : emojiFor(nm, ds); // map icon is automatic, not owner-edited
  await c.env.DB.prepare('UPDATE listings SET name = ?, description = ?, price_cents = ?, week_cents = ?, emoji = ? WHERE id = ?')
    .bind(nm, ds, price, week, em, it.id).run();
  await logEvent(c.env.DB, 'listing.edited', { user: u.id, listing: it.id, cents: price, data: { was: { name: it.name, price: it.price_cents, desc: it.description }, now: { name: nm, price, desc: ds } } });
  if (f.hold_set) { const dep = f.hold === '1' ? DEPOSIT_CENTS : 0; if (dep !== (it.deposit_cents || 0)) { await c.env.DB.prepare('UPDATE listings SET deposit_cents = ? WHERE id = ?').bind(dep, it.id).run(); await logEvent(c.env.DB, 'listing.hold', { user: u.id, listing: it.id, cents: dep }); } }
  if (isGrade(f.grade)) { const gr = await shownGrade(c.env, it.id, (it as any).grade); if (!gr.customers) await c.env.DB.prepare('UPDATE listings SET grade = ? WHERE id = ?').bind(f.grade, it.id).run().catch(() => {}); }
  const today = localToday(it.lng);
  await c.env.DB.prepare('DELETE FROM blocked_days WHERE listing_id = ? AND day >= ?').bind(it.id, today).run();
  const blocks = ([] as unknown[]).concat(f.block || []).map(String).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
  for (const d of blocks) await c.env.DB.prepare('INSERT OR IGNORE INTO blocked_days (listing_id, day) VALUES (?,?)').bind(it.id, d).run();
  return c.redirect('/listings');
});

// ---------- Avatar lab (owner only): build both styles from the first photo and compare ----------
listings.get('/dev/avatar/:id', requireUser, async (c) => {
  const u = c.get('user')!;
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  const photos = await photosFor(c.env.DB, it.id);
  if (!photos[0]) return c.text('no photo', 400);
  const t0 = Date.now();
  const errors: string[] = [];
  const keys = c.req.query('build') === '0' ? {} : await buildAvatars(c.env, it.id, photos[0].r2_key, (c.req.query('only') ? [c.req.query('only') as 'ai'] : ['cutout', 'ai']), errors, c.req.query('model') || undefined, it.name);
  const ms = Date.now() - t0;
  const have = { cutout: keys.cutout || `${it.id}/avatar-cutout.png`, ai: keys.ai || `${it.id}/avatar-ai.png` };
  const pin = (src: string, label: string, style: string) => (
    <div style="text-align:center">
      <div style="height:170px;background:#EAE6DC;border-radius:14px;position:relative;overflow:hidden"><div class="epin" style={'position:absolute;left:50%;top:120px'}><span class="glow"></span>{src ? <img src={'/p/' + src + '?v=' + t0} alt="" class="emo" style="object-fit:contain;filter:drop-shadow(2px 0 0 #fff) drop-shadow(-2px 0 0 #fff) drop-shadow(0 2px 0 #fff) drop-shadow(0 -2px 0 #fff) drop-shadow(0 3px 3px rgba(30,58,43,.35))" /> : <span class="emo">{it.emoji || '📦'}</span>}<span class="tag">{money(it.price_cents)}<small>/day</small></span></div></div>
      <div style="margin-top:8px;font-weight:800">{label}</div>
      <form method="post" action={'/dev/avatar/' + it.id + '/use'}><input type="hidden" name="style" value={style} /><button class="btn sm" type="submit">Use this</button></form>
    </div>
  );
  return c.html(
    <Layout title="Avatar lab" user={u} back="/listings">
      <div style="padding:12px 16px">
        <div class="hint">Built in {ms} ms · {Object.keys(keys).join(', ') || 'nothing new'} </div>
        {errors.map(e => <div class="flash err" style="margin:8px 0 0;font-size:12px;word-break:break-all">{e}</div>)}
        <img src={'/p/' + photos[0].r2_key} alt="" style="width:120px;height:120px;object-fit:cover;border-radius:12px;margin:10px 0" />
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
          {pin('', 'Emoji (current)', 'emoji')}
          {pin(keys.cutout ? have.cutout : '', 'A · Cut-out sticker', 'cutout')}
          {pin(keys.ai ? have.ai : '', 'B · AI emoji redraw', 'ai')}
        </div>
        <form method="get" style="margin-top:14px"><button class="btn full" type="submit">Regenerate</button></form>
      </div>
    </Layout>
  );
});
listings.post('/dev/avatar/:id/use', requireUser, async (c) => {
  const u = c.get('user')!;
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  const style = String((await c.req.parseBody()).style || '');
  if (style === 'emoji') await c.env.DB.prepare('UPDATE listings SET avatar_key = NULL, avatar_style = NULL WHERE id = ?').bind(it.id).run();
  else if (style === 'cutout' || style === 'ai') await c.env.DB.prepare('UPDATE listings SET avatar_key = ?, avatar_style = ? WHERE id = ?').bind(`${it.id}/avatar-${style}.png`, style, it.id).run();
  return c.redirect('/');
});

// Re-run the sticker cutout for one listing (owner only) and report what happened — used to debug Images transforms.
listings.get('/dev/avatar/:id/retry', requireUser, async (c) => {
  const u = c.get('user')!; const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  const aiKey = `${it.id}/avatar-ai.png`;
  const has = await c.env.PHOTOS.head(aiKey);
  if (!has) { const ph = await photosFor(c.env.DB, it.id); if (!ph[0]) return c.text('no photo'); await autoIcon(c.env, it.id, ph[0].r2_key, it.name, it.description); const after = await listingById(c.env.DB, it.id); return c.text('ran autoIcon → avatar_key=' + after?.avatar_key); }
  try {
    const { makeCutout } = await import('../lib/avatar');
    const cut = await makeCutout(c.env, aiKey);
    if (!cut) return c.text('cutout returned null (not transparent?)');
    await c.env.PHOTOS.put(`${it.id}/avatar.png`, cut, { httpMetadata: { contentType: 'image/png' } });
    await c.env.DB.prepare('UPDATE listings SET avatar_key = ?, avatar_style = ? WHERE id = ?').bind(`${it.id}/avatar.png`, 'ai', it.id).run();
    return c.redirect('/i/' + it.id);
  } catch (e: any) { return c.text('cutout failed: ' + (e?.message || e), 500); }
});

listings.post('/dev/avatar/backfill', requireUser, async (c) => {
  const u = c.get('user')!;
  const rows = await c.env.DB.prepare(`SELECT l.id, l.name, l.description, (SELECT r2_key FROM photos p WHERE p.listing_id = l.id ORDER BY pos LIMIT 1) k FROM listings l WHERE l.owner_id = ? AND l.status != 'removed'`).bind(u.id).all<{ id: string; name: string; description: string | null; k: string | null }>();
  for (const r of rows.results) if (r.k) c.executionCtx.waitUntil(autoIcon(c.env, r.id, r.k, r.name, r.description));
  return c.text(`queued ${rows.results.length} icon jobs`);
});
