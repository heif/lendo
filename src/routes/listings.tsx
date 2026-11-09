import { Hono } from 'hono';
import { raw } from 'hono/html';
import type { Env, Listing, Vars } from '../lib/env';
import { Layout } from '../pages/layout';
import { requireUser } from '../lib/auth';
import { firstPhotos, listingById, photosFor, busyDays } from '../lib/db';
import { id, money, now, fuzz, weekDefault, dayStr, addDays, fmtDay } from '../lib/util';
import { hoodFor, geocodePlace } from '../lib/geo';
import { emojiFor } from '../lib/emoji';
import { buildAvatars, autoIcon } from '../lib/avatar';
import { assignHood } from '../lib/hoods';

export const listings = new Hono<{ Bindings: Env; Variables: Vars }>();

// ---------- List fast ----------
listings.get('/list', async (c) => {
  const u = c.get('user');
  const n = u ? ((await c.env.DB.prepare(`SELECT COUNT(*) n FROM listings WHERE owner_id = ? AND status != 'removed'`).bind(u.id).first<{ n: number }>())?.n ?? 0) : 0;
  const minP = parseInt(c.env.MIN_PRICE_CENTS, 10) / 100;
  return c.html(
    <Layout title="List your stuff" user={u}>
      <div class="camwrap">
        <div class="row" style="justify-content:space-between;margin-bottom:10px">
          <div style="font-size:22px;font-weight:900;letter-spacing:-.02em">Snap it. Price it. Live.</div>
          {n ? <span class="pill" style="background:#fff">{n} listed</span> : null}
        </div>
        <p style="margin:0 0 12px;font-size:14px;opacity:.85">Clean photo, bold price. ~20 seconds a thing. Things people rent: tools, camping gear, party stuff, kitchen gadgets, bikes, strollers, instruments, cameras.</p>
        <form id="lf" enctype="multipart/form-data" method="post" action="/list">
          <label class="bigcam" id="camLbl"><span style="font-size:34px">📷</span><span id="camTxt">Take a photo</span><input id="file" type="file" accept="image/*" capture="environment" multiple style="display:none" /></label>
          <div class="shots" id="shots"></div>
          <label class="field"><span>What is it?</span><input name="name" id="name" type="text" placeholder="DeWalt 20V drill + bits" required maxlength={80} /></label>
          <div style="display:flex;gap:10px">
            <label class="field" style="flex:1"><span>$ per day (min ${minP})</span><input name="price" id="price" type="number" inputmode="decimal" min={minP} step="1" placeholder="8" required /></label>
            <label class="field" style="flex:1"><span>$ per week</span><input name="week" id="week" type="number" inputmode="decimal" min="0" step="1" placeholder="auto: 30% off" /></label>
          </div>
          <label class="field"><span>Details renters should know (optional)</span><textarea name="description" maxlength={600} placeholder="Two batteries, charger, case. Return it charged."></textarea></label>
          <input type="hidden" name="lat" id="lat" /><input type="hidden" name="lng" id="lng" />
          <div class="hint" id="locTxt" style="color:rgba(255,255,255,.8)">📍 locating… (we show a ~block radius, never your address)</div>
          <button class="btn pri full" type="submit" id="go" style="margin-top:14px">MAKE IT LIVE</button>
          <div class="hint" style="margin-top:10px;color:rgba(255,255,255,.7)">You'll get a text when someone wants it. Reply YES to accept. Owners keep 100% of the rent.</div>
        </form>
      </div>
      {raw(`<script>
(function(){var files=[],inp=document.getElementById('file'),shots=document.getElementById('shots');
function resize(f){return new Promise(function(res){var img=new Image();img.onload=function(){var M=1400,s=Math.min(1,M/Math.max(img.width,img.height));var cv=document.createElement('canvas');cv.width=Math.round(img.width*s);cv.height=Math.round(img.height*s);cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);cv.toBlob(function(b){res(b)},'image/jpeg',0.86)};img.src=URL.createObjectURL(f)})}
inp.addEventListener('change',function(){[].slice.call(inp.files).forEach(function(f){resize(f).then(function(b){files.push(b);var im=document.createElement('img');im.src=URL.createObjectURL(b);shots.appendChild(im);document.getElementById('camTxt').textContent='Add another photo ('+files.length+')'})});inp.value=''});
document.getElementById('price').addEventListener('input',function(){var w=document.getElementById('week');if(!w.dataset.touched)w.placeholder='auto: $'+Math.round(this.value*7*0.7)});
document.getElementById('week').addEventListener('input',function(){this.dataset.touched=1});
navigator.geolocation&&navigator.geolocation.getCurrentPosition(function(p){lat.value=p.coords.latitude;lng.value=p.coords.longitude;locTxt.textContent='📍 location set (shown as a ~block radius)'},function(){locTxt.textContent='📍 no location — we\\'ll use your home base from your profile'},{timeout:6000});
document.getElementById('lf').addEventListener('submit',function(e){e.preventDefault();if(!files.length){alert('Add at least one photo');return}var fd=new FormData(this);files.forEach(function(b,i){fd.append('photo',b,'p'+i+'.jpg')});var g=document.getElementById('go');g.disabled=true;g.textContent='Uploading…';fetch('/list',{method:'POST',body:fd}).then(function(r){if(r.redirected){location.href=r.url}else return r.text().then(function(t){alert(t);g.disabled=false;g.textContent='MAKE IT LIVE'})})});
})();
</script>`)}
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
  const week = !isNaN(weekIn) && weekIn > 0 ? Math.round(weekIn * 100) : weekDefault(price);
  let lat = parseFloat(String(f.lat || '')), lng = parseFloat(String(f.lng || ''));
  let hood = u.hood;
  let fromGps = !isNaN(lat) && !isNaN(lng);
  if (!fromGps) { lat = u.lat ?? NaN; lng = u.lng ?? NaN; }
  let mbId: string | null = fromGps ? null : u.mapbox_id, geoAt: number | null = fromGps ? null : u.geocoded_at;
  if (isNaN(lat) && (u.address || u.cross_streets || u.hood)) {
    const q0 = u.address || (u.cross_streets ? u.cross_streets + (u.hood ? ', ' + u.hood : '') : u.hood!);
    const g = await geocodePlace(c.env, q0);
    if (g) { lat = g.lat; lng = g.lng; mbId = g.mapbox_id; geoAt = g.mapbox_id ? Date.now() : null; await c.env.DB.prepare('UPDATE users SET lat = COALESCE(lat, ?), lng = COALESCE(lng, ?), mapbox_id = COALESCE(mapbox_id, ?), geocoded_at = COALESCE(geocoded_at, ?) WHERE id = ?').bind(g.lat, g.lng, mbId, geoAt, u.id).run(); }
  }
  if (fromGps) {
    const g = await hoodFor(lat, lng);
    if (g.hood) hood = g.hood;
    if (!u.lat) await c.env.DB.prepare('UPDATE users SET lat = ?, lng = ?, hood = COALESCE(hood, ?) WHERE id = ?').bind(lat, lng, g.hood, u.id).run();
  }
  const lid = id('l');
  const [flat, flng] = !isNaN(lat) ? fuzz(lat, lng) : [null, null];
  const desc = String(f.description || '').trim().slice(0, 600) || null;
  await c.env.DB.prepare('INSERT INTO listings (id, owner_id, name, description, price_cents, week_cents, status, hood, lat, lng, emoji, mapbox_id, geocoded_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(lid, u.id, name, desc, price, week, 'live', hood, flat, flng, emojiFor(name, desc), mbId, geoAt, now()).run();
  if (flat != null) { try { await assignHood(c.env, 'listings', lid, lat, lng); if (!u.hood_id) await assignHood(c.env, 'users', u.id, lat, lng); } catch (e) { console.warn('hood assign', e); } }
  const photos = ([] as unknown[]).concat(f.photo || []).filter((p): p is File => p instanceof File);
  let pos = 0;
  for (const p of photos.slice(0, 6)) {
    const key = `${lid}/${id()}.jpg`;
    await c.env.PHOTOS.put(key, await p.arrayBuffer(), { httpMetadata: { contentType: p.type || 'image/jpeg' } });
    await c.env.DB.prepare('INSERT INTO photos (id, listing_id, r2_key, pos) VALUES (?,?,?,?)').bind(id('ph'), lid, key, pos++).run();
  }
  const first = await c.env.DB.prepare('SELECT r2_key FROM photos WHERE listing_id = ? ORDER BY pos LIMIT 1').bind(lid).first<{ r2_key: string }>();
  if (first) c.executionCtx.waitUntil(autoIcon(c.env, lid, first.r2_key, name, desc));
  return c.redirect('/listings?just=' + lid);
});

// ---------- Your listings ----------
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
        <a class="btn pri" href="/list">📷 Snap more</a>
        <button class="btn" type="button" onclick={`navigator.share?navigator.share({text:'My stuff for rent on Lendo',url:'${shareUrl}'}):(navigator.clipboard.writeText('${shareUrl}'),toast('Link copied'))`}>Share it ↗</button>
      </div>
      {rows.results.map(it => (
        <div class="card" style={'margin:0 12px 10px' + (it.id === just ? ';border:2px solid var(--ink)' : '')}>
          <div class="row" style="align-items:flex-start">
            <a href={'/i/' + it.id}>{ph[it.id] ? <img src={'/p/' + ph[it.id]} alt="" style="width:72px;height:72px;object-fit:cover;border-radius:10px;background:var(--cream)" /> : <div class="ph" style="width:72px;height:72px;border-radius:10px;background:var(--cream)"></div>}</a>
            <div style="flex:1;min-width:0">
              <div class="row" style="justify-content:space-between"><a href={'/i/' + it.id} style="font-weight:800;text-decoration:none">{it.name}</a><span class="pill" style={it.status === 'live' ? 'background:var(--mint)' : ''}>{it.status}</span></div>
              {it.lat == null ? <a href="/profile/edit" class="hint" style="color:var(--red);font-weight:700">⚠ Not on the map yet — set your home base</a> : null}
              <form method="post" action={'/listings/' + it.id + '/price'} class="row" style="margin-top:6px;gap:6px">
                <button class="btn sm" name="delta" value="-100" type="submit" aria-label="Lower price $1">−</button>
                <span class="price" style="font-size:22px">{money(it.price_cents)}<span style="font-size:11px;font-weight:700">/day</span></span>
                <button class="btn sm" name="delta" value="100" type="submit" aria-label="Raise price $1">+</button>
                <span class="hint">{it.week_cents ? money(it.week_cents) + '/wk' : ''}</span>
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
        <label class="field"><span>More details · renters read this</span><textarea name="description" maxlength={600}>{it.description || ''}</textarea></label>
        <div class="m" style="font-size:11px;color:var(--mute);margin-top:8px">available · tap a day to block it</div>
        <div class="days">
          {days.map(d => {
            const rented = busy.has(d) && !blocked.has(d);
            const dt = new Date(d + 'T12:00:00Z');
            return <label><input type="checkbox" name="block" value={d} checked={blocked.has(d)} disabled={rented} style="display:none" /><button type="button" class={rented ? 'busy' : blocked.has(d) ? 'on' : ''} disabled={rented} onclick="var i=this.previousElementSibling;i.checked=!i.checked;this.classList.toggle('on',i.checked)" aria-label={fmtDay(d) + (rented ? ' rented' : '')} style="width:100%">{dt.toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' })} {dt.getUTCDate()}</button></label>;
          })}
        </div>
        <div class="hint" style="margin-top:6px">dark = blocked by you · grey = rented</div>
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

listings.post('/dev/avatar/backfill', requireUser, async (c) => {
  const u = c.get('user')!;
  const rows = await c.env.DB.prepare(`SELECT l.id, l.name, l.description, (SELECT r2_key FROM photos p WHERE p.listing_id = l.id ORDER BY pos LIMIT 1) k FROM listings l WHERE l.owner_id = ? AND l.status != 'removed'`).bind(u.id).all<{ id: string; name: string; description: string | null; k: string | null }>();
  for (const r of rows.results) if (r.k) c.executionCtx.waitUntil(autoIcon(c.env, r.id, r.k, r.name, r.description));
  return c.text(`queued ${rows.results.length} icon jobs`);
});
