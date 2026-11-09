import { Hono } from 'hono';
import { raw } from 'hono/html';
import type { Env, Listing, Rental, Vars } from '../lib/env';
import { Layout } from '../pages/layout';
import { requireUser } from '../lib/auth';
import { busyDays, firstPhotos, listingById, photosFor, rentalById, userById } from '../lib/db';
import { id, money, now, daysBetween, dayStr, addDays, fmtRange, rentFor, firstName, fmtDay } from '../lib/util';
import { createCheckout, feeFor, connectOnboardingUrl, flushPendingPayouts, stripe } from '../lib/stripe';
import { accept, decline, markHeld, pickedUp, rate, relay, returned } from '../lib/rentals';

export const rentals = new Hono<{ Bindings: Env; Variables: Vars }>();

// ---------- Request → Stripe Checkout ----------
rentals.post('/i/:id/rent', async (c) => {
  const u = c.get('user');
  const lid = c.req.param('id');
  const f = await c.req.parseBody();
  const start = String(f.start || ''), end = String(f.end || '');
  if (!u) return c.redirect('/login?next=' + encodeURIComponent(`/i/${lid}`));
  const it = await listingById(c.env.DB, lid);
  if ((it as any)?.demo) return c.redirect('/i/' + c.req.param('id'));
  if (!it || it.status !== 'live') return c.notFound();
  if (it.owner_id === u.id) return c.text("That's your own listing.", 400);
  const today = dayStr(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start < today || end < start || daysBetween(start, end) > 60) return c.text('Pick valid days.', 400);
  const busy = await busyDays(c.env.DB, it.id, start, end);
  if (busy.size) return c.text('Some of those days just got booked. Pick again.', 409);
  const days = daysBetween(start, end);
  const rent = rentFor(days, it.price_cents, it.week_cents);
  const fee = feeFor(c.env, rent);
  const rid = id('r');
  const t = now();
  await c.env.DB.prepare(`INSERT INTO rentals (id, listing_id, owner_id, renter_id, start_day, end_day, days, rent_cents, fee_cents, total_cents, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(rid, it.id, it.owner_id, u.id, start, end, days, rent, fee, rent + fee, 'requested', t, t).run();
  const r = (await rentalById(c.env.DB, rid))!;
  const url = await createCheckout(c.env, r, it, u);
  if (url) return c.redirect(url, 303);
  // dev mode (no Stripe key): pretend the card was authorized
  await markHeld(c.env, r, null, null);
  return c.redirect(`/r/${rid}?paid=1`);
});

// ---------- Rental page ----------
rentals.get('/r/:id', requireUser, async (c) => {
  const u = c.get('user')!;
  const r = await rentalById(c.env.DB, c.req.param('id'));
  if (!r || (r.owner_id !== u.id && r.renter_id !== u.id)) return c.notFound();
  const isOwner = u.id === r.owner_id;
  const other = (await userById(c.env.DB, isOwner ? r.renter_id : r.owner_id))!;
  const owner = isOwner ? u : other;
  const it = (await listingById(c.env.DB, r.listing_id))!;
  const photos = await photosFor(c.env.DB, it.id);
  const msgs = await c.env.DB.prepare('SELECT m.*, u.name sender_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.rental_id = ? ORDER BY m.created_at').bind(r.id).all<{ id: string; sender_id: string | null; body: string; via: string; created_at: number; sender_name: string | null }>();
  const STEPS = ['Requested', 'Confirmed', 'Pickup', 'Returned'];
  const stage = r.status === 'held' || r.status === 'requested' ? 0 : r.status === 'confirmed' ? 1 : r.status === 'picked_up' ? 2 : r.status === 'returned' || r.status === 'closed' ? 3 : -1;
  const dead = ['declined', 'expired', 'canceled'].includes(r.status);
  const myRating = isOwner ? r.owner_rating : r.renter_rating;
  const spots = owner.pickup_spots ? (JSON.parse(owner.pickup_spots) as string[]) : [];
  const fmtT = (t: number) => new Date(t).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  return c.html(
    <Layout title={isOwner ? 'Rental of your ' + it.name : 'Your rental'} user={u} back="/rentals" flash={c.req.query('paid') ? (r.status === 'held' ? `Card held. Waiting for ${firstName(owner.name)}.` : null) : null}>
      <div style="padding:12px 12px 90px;display:flex;flex-direction:column;gap:10px">
        <a class="card row" href={'/i/' + it.id} style="text-decoration:none;align-items:center">
          {photos[0] ? <img src={'/p/' + photos[0].r2_key} alt="" style="width:64px;height:64px;border-radius:12px;object-fit:cover;background:var(--cream)" /> : <div style="width:64px;height:64px;border-radius:12px;background:var(--cream)"></div>}
          <div style="min-width:0;line-height:1.3">
            <div style="font-size:16px;font-weight:800">{it.name}</div>
            <div style="font-size:13px;font-weight:700;margin-top:2px">{fmtRange(r.start_day, r.end_day)} · {isOwner ? `you earn ${money(r.rent_cents)}` : `${money(r.total_cents)}${r.status === 'held' ? ' held' : ' paid'}`}</div>
            <div class="hint" style="margin-top:1px">{isOwner ? 'to ' : 'from '}<b>{other.name || 'Neighbor'}</b>{r.meet_spot ? ' · 📍 ' + r.meet_spot : spots.length ? ' · meet: ' + spots.join(' or ') : ''}</div>
          </div>
        </a>
        {dead ? <div class="flash err" style="margin:0">{r.status === 'declined' ? `${firstName(owner.name)} couldn't do those days.` : r.status === 'expired' ? 'No answer in time.' : 'Canceled.'} Nothing was charged.</div> : (
          <div class="steps">{STEPS.map((s, i) => <div><div class={'bar' + (i < stage ? ' done' : i === stage ? ' on' : '')}></div><div class={'lbl m' + (i <= stage ? ' on' : '')}>{s}</div></div>)}</div>
        )}

        {/* owner decision */}
        {isOwner && r.status === 'held' ? (
          <div class="card" style="border:2px solid var(--ink)">
            <b>{firstName(other.name)} wants it {fmtRange(r.start_day, r.end_day)}. You'd earn {money(r.rent_cents)}.</b>
            <div class="row" style="margin-top:10px;gap:8px">
              <form method="post" action={'/r/' + r.id + '/accept'} style="flex:1"><button class="btn pri full" type="submit">YES — accept</button></form>
              <form method="post" action={'/r/' + r.id + '/decline'}><button class="btn" type="submit">No</button></form>
            </div>
            <div class="hint" style="margin-top:8px">or reply YES / NO by text · expires {r.expires_at ? fmtT(r.expires_at) : 'in 24h'}</div>
          </div>
        ) : null}

        {/* quick actions */}
        {!dead && stage >= 1 && stage < 3 ? (
          <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">
            {[['Running late', 'Running ~10 min late'], ["I'm here", "I'm here"], ['Change time?', 'Could we change the pickup time?']].map(([l, m]) => (
              <form method="post" action={'/r/' + r.id + '/msg'}><input type="hidden" name="body" value={m} /><button class="btn sm full" type="submit">{l}</button></form>
            ))}
          </div>
        ) : null}
        {!dead && stage === 1 && spots.length && !r.meet_spot ? (
          <form method="post" action={'/r/' + r.id + '/spot'} class="row" style="gap:6px;flex-wrap:wrap">
            <span class="hint">Meet at:</span>{spots.map(s => <button class="btn sm" name="spot" value={s} type="submit">📍 {s}</button>)}
          </form>
        ) : null}

        {/* pickup / return photo (owner's phone) */}
        {isOwner && !dead && stage === 1 ? (
          <form method="post" action={'/r/' + r.id + '/pickup'} enctype="multipart/form-data" class="card" style="background:var(--orange);color:#fff;border:2px solid var(--ink);box-shadow:3px 3px 0 var(--ink)">
            <label style="display:flex;align-items:center;gap:12px;cursor:pointer"><span style="font-size:26px">📷</span><span><b style="display:block">Photo of {firstName(other.name)} with it</b></span><input type="file" name="photo" accept="image/*" capture="environment" style="display:none" onchange="this.form.submit()" /></label>
            <button class="btn sm" type="submit" style="margin-top:8px;background:#fff">Mark picked up without photo</button>
          </form>
        ) : null}
        {isOwner && !dead && stage === 2 ? (
          <form method="post" action={'/r/' + r.id + '/return'} enctype="multipart/form-data" class="card" style="border:2px solid var(--ink)">
            <label style="display:flex;align-items:center;gap:12px;cursor:pointer"><span style="font-size:26px">📷</span><span><b style="display:block">Got it back? Snap it</b></span><input type="file" name="photo" accept="image/*" capture="environment" style="display:none" onchange="this.form.submit()" /></label>
            <button class="btn sm" type="submit" style="margin-top:8px">Mark returned without photo</button>
          </form>
        ) : null}
        {r.pickup_photo_key ? <div class="row"><img src={'/p/' + r.pickup_photo_key} alt="pickup" style="width:72px;height:72px;object-fit:cover;border-radius:10px;border:1.5px solid var(--ink)" /><span class="hint">pickup photo · {r.return_photo_key ? 'return photo ✓' : 'until it comes back'}</span>{r.return_photo_key ? <img src={'/p/' + r.return_photo_key} alt="return" style="width:72px;height:72px;object-fit:cover;border-radius:10px;border:1.5px solid var(--ink)" /> : null}</div> : null}

        {/* rating */}
        {(r.status === 'returned' || r.status === 'closed') && !myRating ? (
          <form method="post" action={'/r/' + r.id + '/rate'} class="card" style="border:2px solid var(--ink)">
            <b>How was {isOwner ? firstName(other.name) : 'the ' + it.name + ' and ' + firstName(other.name)}?</b>
            <div class="stars" style="margin-top:8px">{[1, 2, 3, 4, 5].map(n => <button type="button" data-n={n} onclick="var n=+this.dataset.n;document.getElementById('stars').value=n;[].forEach.call(this.parentNode.children,function(b,i){b.classList.toggle('on',i<n)})">★</button>)}</div>
            <input type="hidden" name="stars" id="stars" />
            <input name="review" placeholder="One line others will see (optional)" maxlength={200} style="width:100%;height:42px;border-radius:10px;border:1.5px solid var(--line);padding:0 12px;margin-top:8px" />
            <button class="btn pri full" type="submit" style="margin-top:8px">Rate</button>
          </form>
        ) : myRating ? <div class="hint">You rated {'★'.repeat(myRating)}</div> : null}

        <div class="m" style="font-size:8px;color:var(--mute);margin:6px 2px 0">history</div>
        <div class="msgs">
          {msgs.results.map(m => {
            const me = m.sender_id === u.id, sys = !m.sender_id;
            return <div class={'msg' + (me ? ' me' : sys ? ' sys' : '')}><div class="bub">{m.body}</div><div class="meta">{sys ? '' : (me ? 'You' : firstName(m.sender_name)) + (m.via === 'text' ? ' · by text' : '') + ' · '}{fmtT(m.created_at)}</div></div>;
          })}
        </div>
      </div>
      {!dead ? (
        <form method="post" action={'/r/' + r.id + '/msg'} class="compose">
          <input name="body" placeholder={`Message ${firstName(other.name)} (or just reply to the text)`} required maxlength={500} autocomplete="off" />
          <button type="submit" aria-label="Send">↑</button>
        </form>
      ) : null}
    </Layout>
  );
});

rentals.post('/r/:id/accept', requireUser, async (c) => {
  const u = c.get('user')!; const r = await rentalById(c.env.DB, c.req.param('id'));
  if (!r || r.owner_id !== u.id) return c.notFound();
  await accept(c.env, r);
  return c.redirect('/r/' + r.id);
});
rentals.post('/r/:id/decline', requireUser, async (c) => {
  const u = c.get('user')!; const r = await rentalById(c.env.DB, c.req.param('id'));
  if (!r || r.owner_id !== u.id) return c.notFound();
  await decline(c.env, r, 'declined');
  return c.redirect('/r/' + r.id);
});
rentals.post('/r/:id/msg', requireUser, async (c) => {
  const u = c.get('user')!; const r = await rentalById(c.env.DB, c.req.param('id'));
  if (!r || (r.owner_id !== u.id && r.renter_id !== u.id)) return c.notFound();
  const body = String((await c.req.parseBody()).body || '').trim().slice(0, 500);
  if (body) await relay(c.env, r, u, body, 'web');
  return c.redirect('/r/' + r.id);
});
rentals.post('/r/:id/spot', requireUser, async (c) => {
  const u = c.get('user')!; const r = await rentalById(c.env.DB, c.req.param('id'));
  if (!r || (r.owner_id !== u.id && r.renter_id !== u.id)) return c.notFound();
  const spot = String((await c.req.parseBody()).spot || '').trim().slice(0, 80);
  if (spot) { await c.env.DB.prepare('UPDATE rentals SET meet_spot = ?, updated_at = ? WHERE id = ?').bind(spot, now(), r.id).run(); await relay(c.env, r, u, `Let's meet at ${spot}`, 'web'); }
  return c.redirect('/r/' + r.id);
});
async function savePhoto(c: any, r: Rental, kind: 'pickup' | 'return'): Promise<string | null> {
  const f = await c.req.parseBody();
  const p = f.photo;
  if (!(p instanceof File) || !p.size) return null;
  const key = `rentals/${r.id}/${kind}-${id()}.jpg`;
  await c.env.PHOTOS.put(key, await p.arrayBuffer(), { httpMetadata: { contentType: p.type || 'image/jpeg' } });
  return key;
}
rentals.post('/r/:id/pickup', requireUser, async (c) => {
  const u = c.get('user')!; const r = await rentalById(c.env.DB, c.req.param('id'));
  if (!r || r.owner_id !== u.id) return c.notFound();
  await pickedUp(c.env, r, await savePhoto(c, r, 'pickup'));
  return c.redirect('/r/' + r.id);
});
rentals.post('/r/:id/return', requireUser, async (c) => {
  const u = c.get('user')!; const r = await rentalById(c.env.DB, c.req.param('id'));
  if (!r || r.owner_id !== u.id) return c.notFound();
  await returned(c.env, r, await savePhoto(c, r, 'return'));
  return c.redirect('/r/' + r.id);
});
rentals.post('/r/:id/rate', requireUser, async (c) => {
  const u = c.get('user')!; const r = await rentalById(c.env.DB, c.req.param('id'));
  if (!r || (r.owner_id !== u.id && r.renter_id !== u.id) || !['returned', 'closed'].includes(r.status)) return c.notFound();
  const f = await c.req.parseBody();
  const stars = Math.min(5, Math.max(1, parseInt(String(f.stars || '0'), 10) || 0));
  if (stars) await rate(c.env, r, u, stars, String(f.review || '').trim().slice(0, 200));
  return c.redirect('/r/' + r.id);
});

// ---------- Your rentals + Inbox ----------
rentals.get('/rentals', requireUser, async (c) => {
  const u = c.get('user')!;
  const rows = await c.env.DB.prepare(`SELECT r.*, l.name item, o.name owner_name, n.name renter_name FROM rentals r JOIN listings l ON l.id = r.listing_id JOIN users o ON o.id = r.owner_id JOIN users n ON n.id = r.renter_id WHERE (r.owner_id = ? OR r.renter_id = ?) AND r.status != 'requested' ORDER BY r.updated_at DESC LIMIT 100`).bind(u.id, u.id).all<Rental & { item: string; owner_name: string | null; renter_name: string | null }>();
  const ph = await firstPhotos(c.env.DB, [...new Set(rows.results.map(r => r.listing_id))]);
  const label = (r: Rental) => ({ held: 'waiting for YES', confirmed: 'confirmed · set pickup', picked_up: 'out', returned: 'returned · rate', closed: 'done', declined: 'declined', expired: 'expired', canceled: 'canceled', requested: '' }[r.status]);
  return c.html(
    <Layout title="Your rentals" user={u}>
      <div style="height:12px"></div>
      {rows.results.length ? rows.results.map(r => (
        <a class="inboxrow" href={'/r/' + r.id}>
          {ph[r.listing_id] ? <img src={'/p/' + ph[r.listing_id]} alt="" /> : <div class="ph"></div>}
          <div style="min-width:0;flex:1">
            <div style="font-weight:800">{r.item}</div>
            <div style="font-size:13px">{fmtRange(r.start_day, r.end_day)} · {r.owner_id === u.id ? `to ${firstName(r.renter_name)} · +${money(r.rent_cents)}` : `from ${firstName(r.owner_name)} · ${money(r.total_cents)}`}</div>
            <div class="hint">{label(r)}</div>
          </div>
          {r.status === 'held' && r.owner_id === u.id ? <span class="pill" style="background:var(--orange);color:#fff">YES?</span> : null}
        </a>
      )) : <div class="hint" style="padding:24px 16px">No rentals yet. <a href="/">Browse the map</a>.</div>}
    </Layout>
  );
});

rentals.get('/inbox', requireUser, async (c) => {
  const u = c.get('user')!;
  const texts = await c.env.DB.prepare('SELECT * FROM outbound_texts WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').bind(u.id).all<{ id: string; body: string; category: string; rental_id: string | null; created_at: number }>();
  const fmtT = (t: number) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  return c.html(
    <Layout title="Inbox" user={u}>
      <div style="padding:12px 16px 4px" class="hint">What we text you</div>
      <div class="msgs" style="padding:8px 12px 40px">
        {texts.results.length ? texts.results.map(t => (
          <div class="msg">
            <div class="bub" style={t.category === 'login' ? 'opacity:.6' : ''}>{t.body}</div>
            <div class="meta">{fmtT(t.created_at)} · <span class="m">{t.category}</span>{t.rental_id ? <> · <a href={'/r/' + t.rental_id}>open</a></> : null}</div>
          </div>
        )) : <div class="hint" style="padding:16px 4px">Nothing here yet.</div>}
      </div>
    </Layout>
  );
});

// ---------- Owner payouts (Stripe Connect Express) ----------
rentals.get('/payout', requireUser, async (c) => {
  const u = c.get('user')!;
  const s = stripe(c.env);
  let connected = false, detail = '';
  if (s && u.stripe_account_id) {
    try { const a = await s.accounts.retrieve(u.stripe_account_id); connected = !!a.payouts_enabled; detail = connected ? 'Payouts on.' : 'Setup not finished yet.'; } catch { detail = 'Could not reach Stripe.'; }
    if (connected && c.req.query('done')) { const n = await flushPendingPayouts(c.env, u); if (n) detail += ` Sent ${n} pending payout${n === 1 ? '' : 's'}.`; }
  }
  const pending = await c.env.DB.prepare(`SELECT COALESCE(SUM(rent_cents),0) s FROM rentals WHERE owner_id = ? AND status IN ('confirmed','picked_up','returned','closed') AND paid_out = 0`).bind(u.id).first<{ s: number }>();
  return c.html(
    <Layout title="Get paid" user={u}>
      <section class="sec" style="border-bottom:0">
        <h2 style="margin:0 0 12px;font-size:24px;font-weight:900;letter-spacing:-.02em">Where should your money go?</h2>
        {pending?.s ? <div class="flash" style="margin:0 0 12px">{money(pending.s)} waiting to be paid out.</div> : null}
        {!s ? <div class="flash err" style="margin:0 0 12px">Stripe isn't configured on this server yet.</div> : connected ? <div class="flash" style="margin:0 0 12px">✓ Connected. {detail}</div> : (
          <form method="post" action="/payout"><button class="btn pri full" type="submit">{u.stripe_account_id ? 'Finish setup' : 'Add a debit card or bank'}</button>{detail ? <p class="hint">{detail}</p> : null}</form>
        )}
      </section>
    </Layout>
  );
});
rentals.post('/payout', requireUser, async (c) => {
  const u = c.get('user')!;
  const r = await connectOnboardingUrl(c.env, u);
  if (!r) return c.redirect('/payout');
  return c.redirect(r.url, 303);
});
