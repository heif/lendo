import { Hono } from 'hono';
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
  const u = c.get('user');
  if (!u) return c.redirect('/login?next=/list');
  const cfg = JSON.stringify({ minPrice: parseInt(c.env.MIN_PRICE_CENTS, 10) / 100, hood: u.hood || '', shareUrl: `${c.env.APP_URL}/u/${u.id}` });
  return c.html(
    <Layout title="Rent out your stuff" user={u} htmlClass="mappage" head={<link rel="stylesheet" href="/list.css" />}>
      {/* ideas */}
      <section id="st-ideas" class="lf">
        <div class="lf-scroll">
          <div class="lf-h">What have you got?</div>
          <div id="ideas" class="ideas"></div>
          <button type="button" class="btn full" id="moreIdeas" style="margin-top:8px">12 more ideas →</button>
        </div>
        <div class="lf-foot"><button type="button" class="cta" id="toCam">OPEN CAMERA</button></div>
      </section>
      {/* camera */}
      <section id="st-cam" class="cam" hidden>
        <video id="cam" playsinline muted autoplay></video>
        <input type="file" id="file" accept="image/*" capture="environment" hidden />
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
          <div class="lf-h">Check names and prices.</div>
          <div id="rows"></div>
        </div>
        <div class="lf-foot"><button type="button" class="cta" id="listBtn">LIST</button></div>
      </section>
      {/* done */}
      <section id="st-done" class="lf" hidden>
        <div class="lf-scroll">
          <div class="tray" id="tray"></div>
          <div class="dn-head" id="dnHead">Posted.</div>
          <div class="dn-sub" id="dnSub">Neighbors can rent it now. Tell them.</div>
          <div class="share">
            <div class="share-h">Share it. Post it.</div>
            <div class="flyer"><div class="flyer-h">FOR RENT ON MY BLOCK</div><div class="flyer-tray" id="shTray"></div><div class="flyer-l" id="shLine"></div><div class="flyer-u">lendo.co/u/{u.id.slice(0, 8)}…</div></div>
            <div class="shbtns" id="shBtns"></div>
          </div>
          <div class="dn-acts"><button type="button" class="btn" id="again" style="box-shadow:3px 3px 0 var(--ink)">+ Keep going</button><a class="btn dark" href="/">See the map</a></div>
        </div>
        <div class="toast" id="shToast" style="display:none"></div>
      </section>
      {raw(`<script>window.LENDO_LIST=${cfg};</script>`)}
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
listings.post('/api/list', async (c) => {
  const u = c.get('user');
  if (!u) return c.json({ error: 'login' }, 401);
  const f = await c.req.parseBody({ all: true });
  const lat = parseFloat(String(f.lat || '')), lng = parseFloat(String(f.lng || ''));
  const minP = parseInt(c.env.MIN_PRICE_CENTS, 10);
  const out: { id: string; name: string }[] = [];
  for (let i = 0; i < 30; i++) {
    const name = String(f[`name_${i}`] || '').trim(); if (!name) continue;
    const price = Math.round(parseFloat(String(f[`price_${i}`] || '0')) * 100); if (isNaN(price) || price < minP) continue;
    const photo = f[`photo_${i}`];
    const photos = photo instanceof File ? [{ bytes: await photo.arrayBuffer(), type: photo.type }] : [];
    const wk = Math.round(parseFloat(String(f[`week_${i}`] || '0')) * 100);
    const lid = await createListing(c.env, c.executionCtx, u, { name, priceCents: price, weekCents: wk > 0 ? wk : null, description: String(f[`note_${i}`] || ''), lat: isNaN(lat) ? null : lat, lng: isNaN(lng) ? null : lng, photos });
    out.push({ id: lid, name });
  }
  return c.json({ listed: out, count: out.length });
});
listings.get('/listings', requireUser, async (c) => {
  const u = c.get('user')!;
  const rows = await c.env.DB.prepare(`SELECT * FROM listings WHERE owner_id = ? AND status != 'removed' ORDER BY created_at DESC`).bind(u.id).all<Listing>();
  const ph = await firstPhotos(c.env.DB, rows.results.map(r => r.id));
  const earned = await c.env.DB.prepare(`SELECT COALESCE(SUM(rent_cents),0) s, COUNT(*) n FROM rentals WHERE owner_id = ? AND status IN ('confirmed','picked_up','returned','closed')`).bind(u.id).first<{ s: number; n: number }>();
  const just = c.req.query('just');
  const live = rows.results.filter(r => r.status === 'live').length;
  const shareUrl = `${c.env.APP_URL}/u/${u.id}`;
  return c.html(
    <Layout title="Your listings" user={u} flash={just ? "It's live. Anyone nearby can rent it now." : null}>
      <div style="padding:12px 16px 0" class="row">
        <div><div class="price" style="font-size:30px;line-height:1">{money(earned?.s || 0)}</div><div class="hint">earned · {earned?.n || 0} rentals</div></div>
        <span class="sp" style="flex:1"></span>
        <div style="text-align:right"><div class="price" style="font-size:30px;line-height:1">{live}</div><div class="hint">live</div></div>
      </div>
      <div style="padding:10px 16px" class="row">
        <a class="btn pri" href="/list">📷 List more</a>
        <button class="btn" type="button" onclick={`navigator.share?navigator.share({text:'My stuff for rent on Lendo',url:'${shareUrl}'}):(navigator.clipboard.writeText('${shareUrl}'),toast('Link copied'))`}>Share it ↗</button>
      </div>
      {rows.results.map(it => (
        <div class="card" style={'margin:0 12px 10px' + (it.id === just ? ';border:2px solid var(--ink)' : '')}>
          <div class="row" style="align-items:flex-start">
            <a href={'/i/' + it.id}>{avatarUrl(c.env, it.avatar_key, ph[it.id] || null) ? <img src={avatarUrl(c.env, it.avatar_key, ph[it.id] || null)!} alt="" style="width:72px;height:72px;object-fit:contain;border-radius:10px;background:#fff;border:1.5px solid var(--line)" /> : <div class="ph" style="width:72px;height:72px;border-radius:10px;background:var(--cream)"></div>}</a>
            <div style="flex:1;min-width:0">
              <div class="row" style="justify-content:space-between"><a href={'/i/' + it.id} style="font-weight:800;text-decoration:none">{it.name}</a><span class="pill" style={it.status === 'live' ? 'background:var(--mint)' : ''}>{it.status}</span></div>
              {it.lat == null ? <a href="/profile/edit" class="hint" style="color:var(--red);font-weight:700">⚠ Not on the map yet — set your home base</a> : null}
              <form method="post" action={'/listings/' + it.id + '/price'} class="row" style="margin-top:6px;gap:6px">
                <button class="btn sm" name="delta" value="-100" type="submit" aria-label="Lower price $1">−</button>
                <span class="price" style="font-size:22px">{money(it.price_cents)}<span style="font-size:11px;font-weight:700">/day</span></span>
                <button class="btn sm" name="delta" value="100" type="submit" aria-label="Raise price $1">+</button>
              </form>
            </div>
          </div>
          <div class="row" style="margin-top:10px;gap:6px;flex-wrap:wrap">
            <a class="btn sm" href={'/listings/' + it.id + '/edit'}>Edit</a>
            <form method="post" action={'/listings/' + it.id + '/toggle'}><button class="btn sm" type="submit">{it.status === 'live' ? 'Pause' : 'Go live'}</button></form>
            <form method="post" action={'/listings/' + it.id + '/remove'} onsubmit="return confirm('Remove this listing?')"><button class="btn sm" type="submit" style="color:var(--red)">Remove</button></form>
          </div>
        </div>
      ))}
      {!rows.results.length ? <div class="hint" style="padding:24px 16px">Nothing listed yet.</div> : null}
    </Layout>
  );
});

listings.post('/listings/:id/price', requireUser, async (c) => {
  const u = c.get('user')!;
  const d = parseInt(String((await c.req.parseBody()).delta || '0'), 10) || 0;
  const minP = parseInt(c.env.MIN_PRICE_CENTS, 10);
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  const np = Math.max(minP, it.price_cents + d);
  const week = it.week_cents === weekDefault(it.price_cents) ? weekDefault(np) : it.week_cents; // keep auto week in sync
  await c.env.DB.prepare('UPDATE listings SET price_cents = ?, week_cents = ? WHERE id = ?').bind(np, week, it.id).run();
  return c.redirect('/listings');
});

listings.post('/listings/:id/toggle', requireUser, async (c) => {
  const u = c.get('user')!;
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  await c.env.DB.prepare('UPDATE listings SET status = ? WHERE id = ?').bind(it.status === 'live' ? 'paused' : 'live', it.id).run();
  return c.redirect('/listings');
});

listings.post('/listings/:id/remove', requireUser, async (c) => {
  const u = c.get('user')!;
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  await c.env.DB.prepare(`UPDATE listings SET status = 'removed' WHERE id = ?`).bind(it.id).run();
  return c.redirect('/listings');
});

listings.get('/listings/:id/edit', requireUser, async (c) => {
  const u = c.get('user')!;
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  const photos = await photosFor(c.env.DB, it.id);
  const today = dayStr(new Date());
  const busy = await busyDays(c.env.DB, it.id, today, addDays(today, 13));
  const blocked = new Set((await c.env.DB.prepare('SELECT day FROM blocked_days WHERE listing_id = ? AND day >= ?').bind(it.id, today).all<{ day: string }>()).results.map(r => r.day));
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  return c.html(
    <Layout title="Edit listing" user={u} back="/listings">
      <form method="post" action={'/listings/' + it.id + '/edit'} style="padding:12px 16px 40px">
        <div class="thumbs" style="padding:0 0 8px">{photos.map(p => <img src={'/p/' + p.r2_key} alt="" />)}</div>
        <div style="display:flex;gap:10px;align-items:flex-end">
          <label class="field" style="flex:1"><span>Name</span><input name="name" value={it.name} required maxlength={80} /></label>
          <label class="field" style="width:84px"><span>Map icon</span><input name="emoji" value={it.emoji || emojiFor(it.name, it.description)} maxlength={8} style="text-align:center;font-size:24px!important" /></label>
        </div>
        <div style="display:flex;gap:10px">
          <label class="field" style="flex:1"><span>$ per day</span><input name="price" type="number" step="1" min={parseInt(c.env.MIN_PRICE_CENTS, 10) / 100} value={it.price_cents / 100} required /></label>
          <label class="field" style="flex:1"><span>$ per week</span><input name="week" type="number" step="1" min="0" value={(it.week_cents || 0) / 100} /></label>
        </div>
        <label class="field"><span>Note</span><textarea name="description" maxlength={600}>{it.description || ''}</textarea></label>
        <div class="m" style="font-size:11px;color:var(--mute);margin-top:8px">tap a day to block it</div>
        <div class="days">
          {days.map(d => {
            const rented = busy.has(d) && !blocked.has(d);
            const dt = new Date(d + 'T12:00:00Z');
            return <label><input type="checkbox" name="block" value={d} checked={blocked.has(d)} disabled={rented} style="display:none" /><button type="button" class={rented ? 'busy' : blocked.has(d) ? 'on' : ''} disabled={rented} onclick="var i=this.previousElementSibling;i.checked=!i.checked;this.classList.toggle('on',i.checked)" aria-label={fmtDay(d) + (rented ? ' rented' : '')} style="width:100%">{dt.toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' })} {dt.getUTCDate()}</button></label>;
          })}
        </div>
        
        <button class="btn pri full" type="submit" style="margin-top:16px">Save</button>
      </form>
    </Layout>
  );
});

listings.post('/listings/:id/edit', requireUser, async (c) => {
  const u = c.get('user')!;
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  const f = await c.req.parseBody({ all: true });
  const minP = parseInt(c.env.MIN_PRICE_CENTS, 10);
  const price = Math.max(minP, Math.round(parseFloat(String(f.price || '0')) * 100) || minP);
  const weekIn = parseFloat(String(f.week || ''));
  const week = !isNaN(weekIn) && weekIn > 0 ? Math.round(weekIn * 100) : weekDefault(price);
  const nm = String(f.name || it.name).trim().slice(0, 80), ds = String(f.description || '').trim().slice(0, 600) || null;
  const em = String(f.emoji || '').trim().slice(0, 8) || emojiFor(nm, ds);
  await c.env.DB.prepare('UPDATE listings SET name = ?, description = ?, price_cents = ?, week_cents = ?, emoji = ? WHERE id = ?')
    .bind(nm, ds, price, week, em, it.id).run();
  const today = dayStr(new Date());
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
