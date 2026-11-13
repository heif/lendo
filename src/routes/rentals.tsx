import { Hono } from 'hono';
import { localToday } from '../lib/util';
import { shortName } from '../lib/util';
import { handleText } from './webhooks';
import { acceptExt, askExtension, declineExt, extById, extendableDays, extPrice, EXT_MAX_DAYS, openExt } from '../lib/extend';
import { Grade, GRADES, isGrade } from '../lib/grade';
import { raw } from 'hono/html';
import type { Env, Listing, Rental, Vars } from '../lib/env';
import { Layout } from '../pages/layout';
import { requireUser } from '../lib/auth';
import { addMessage, busyDays, firstPhotos, listingById, photosFor, rentalById, userById } from '../lib/db';
import { id, money, now, daysBetween, dayStr, addDays, fmtRange, rentFor, firstName, fmtDay } from '../lib/util';
import { createCheckout, feeFor, connectOnboardingUrl, flushPendingPayouts, stripe } from '../lib/stripe';
import { accept, decline, customerCancel, markHeld, pickedUp, rate, relay, returned } from '../lib/rentals';
import { textUser } from '../lib/blooio';

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
  const today = localToday(it.lng);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start < today || end < start || daysBetween(start, end) > 60) return c.text('Pick valid days.', 400);
  const busy = await busyDays(c.env.DB, it.id, start, end);
  if (busy.size) return c.text('Some of those days just got booked. Pick again.', 409);
  const days = daysBetween(start, end);
  const rent = rentFor(days, it.price_cents, it.week_cents);
  const fee = feeFor(c.env, rent);
  const rid = id('r');
  const t = now();
  // promo credit ($5 phone bar, or $10 from the list-10 promo): used once, never more than the total
  const prior = await c.env.DB.prepare(`SELECT COUNT(*) n FROM rentals WHERE renter_id = ? AND credit_cents > 0 AND status IN ('held','confirmed','picked_up','returned','closed')`).bind(u.id).first<{ n: number }>();
  const credit = (u.promo_cents || 0) > 0 && !(prior?.n) ? Math.min(u.promo_cents, rent + fee - 50) : 0;
  await c.env.DB.prepare(`INSERT INTO rentals (id, listing_id, owner_id, renter_id, start_day, end_day, days, rent_cents, fee_cents, total_cents, credit_cents, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(rid, it.id, it.owner_id, u.id, start, end, days, rent, fee, rent + fee - Math.max(0, credit), Math.max(0, credit), 'requested', t, t).run();
  const r = (await rentalById(c.env.DB, rid))!;
  const url = await createCheckout(c.env, r, it, u);
  if (url) return c.redirect(url, 303);
  // dev mode (no Stripe key): pretend the card was authorized
  await markHeld(c.env, r, null, null);
  return c.redirect(`/r/${rid}?paid=1`);
});

// ---------- Rental page ----------
// Community agreement: the customer's promise to the owner (prototype "Your promise to …"), signed before pickup
const PROMISES = (owner: string) => [
  `I’ll be on time. If I’m running late, I’ll text ${owner}`,
  `I’ll treat it like my neighbor’s and bring it back clean and working. If I break or lose it, I’ll pay to fix or replace it`,
  `I use it at my own risk. ${owner} and Lendo aren’t responsible if I get hurt`,
];

rentals.get('/r/:id', requireUser, async (c) => {
  const u = c.get('user')!;
  const r = await rentalById(c.env.DB, c.req.param('id'));
  if (!r || (r.owner_id !== u.id && r.renter_id !== u.id)) return c.notFound();
  // opening the thread marks it read (and takes it off the profile-circle count)
  const seen = await c.env.DB.prepare(`SELECT COUNT(*) n FROM messages WHERE rental_id = ? AND sender_id IS NOT NULL AND sender_id != ? AND created_at > COALESCE((SELECT seen_at FROM thread_reads WHERE user_id = ? AND rental_id = ?), 0)`).bind(r.id, u.id, u.id, r.id).first<{ n: number }>().catch(() => null);
  await c.env.DB.prepare(`INSERT INTO thread_reads (user_id, rental_id, seen_at) VALUES (?,?,?) ON CONFLICT(user_id, rental_id) DO UPDATE SET seen_at = excluded.seen_at`).bind(u.id, r.id, Date.now()).run().catch(() => {});
  if (seen?.n && u.unread) u.unread = Math.max(0, u.unread - seen.n);
  const isOwner = u.id === r.owner_id;
  const other = (await userById(c.env.DB, isOwner ? r.renter_id : r.owner_id))!;
  const owner = isOwner ? u : other;
  const it = (await listingById(c.env.DB, r.listing_id))!;
  const photos = await photosFor(c.env.DB, it.id);
  const msgs = await c.env.DB.prepare(`SELECT m.*, u.name sender_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.rental_id = ?1 OR (?2 != 'inquiry' AND m.rental_id IN (SELECT id FROM rentals WHERE listing_id = ?3 AND renter_id = ?4 AND status = 'inquiry')) ORDER BY m.created_at`).bind(r.id, r.status, r.listing_id, r.renter_id).all<{ id: string; sender_id: string | null; body: string; via: string; created_at: number; sender_name: string | null }>();
  const STEPS = ['Requested', 'Confirmed', 'Pickup', 'Returned'];
  const stage = r.status === 'held' || r.status === 'requested' ? 0 : r.status === 'confirmed' ? 1 : r.status === 'picked_up' ? 2 : r.status === 'returned' || r.status === 'closed' ? 3 : -1;
  const dead = ['declined', 'expired', 'canceled'].includes(r.status);
  const myRating = isOwner ? r.owner_rating : r.renter_rating;
  const spots = owner.pickup_spots ? (JSON.parse(owner.pickup_spots) as string[]) : [];
  const fmtT = (t: number) => new Date(t).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  const live = r.status === 'picked_up';
  const xs = await c.env.DB.prepare(`SELECT COALESCE(SUM(rent_cents),0) rent, COALESCE(SUM(total_cents),0) total FROM rental_extensions WHERE rental_id = ? AND status = 'confirmed'`).bind(r.id).first<{ rent: number; total: number }>().catch(() => null);
  const xRent = xs?.rent || 0, xTotal = xs?.total || 0;
  const ox = live ? await openExt(c.env, r.id) : null;
  const extOk = live && !isOwner && !ox ? await extendableDays(c.env, r) : [];
  const extCells = live && !isOwner && !ox ? Array.from({ length: Math.min(EXT_MAX_DAYS, Math.max(7, extOk.length + 1)) }, (_, i) => addDays(r.end_day, i + 1)) : [];
  return c.html(
    <Layout title={isOwner ? 'Rental of your ' + it.name : 'Your rental'} user={u} back="/rentals" flash={c.req.query('paid') ? (r.status === 'held' ? `Card held. Waiting for ${firstName(owner.name)}.` : null) : null}>
      <div style="padding:12px 12px 90px;display:flex;flex-direction:column;gap:10px">
        <a class="card row" href={'/i/' + it.id} style="text-decoration:none;align-items:center">
          {photos[0] ? <img src={'/p/' + photos[0].r2_key} alt="" style="width:64px;height:64px;border-radius:12px;object-fit:cover;background:var(--cream)" /> : <div style="width:64px;height:64px;border-radius:12px;background:var(--cream)"></div>}
          <div style="min-width:0;line-height:1.3">
            <div style="font-size:16px;font-weight:800">{it.name}</div>
            <div style="font-size:13px;font-weight:700;margin-top:2px">{r.status === 'inquiry' ? (isOwner ? 'Question about your item' : 'Questions before renting') : <>{fmtRange(r.start_day, r.end_day)} · {isOwner ? `you earn ${money(r.rent_cents + xRent)}` : `${money(r.total_cents + xTotal)}${r.status === 'held' ? ' held' : ' paid'}`}</>}</div>
            <div class="hint" style="margin-top:1px">{isOwner ? 'to ' : 'from '}<b>{shortName(other.name)}</b>{r.meet_spot ? ' · 📍 ' + r.meet_spot : spots.length ? ' · meet: ' + spots.join(' or ') : ''}</div>
          </div>
        </a>
        {r.status === 'inquiry' ? (!isOwner ? <a class="btn pri full" href={'/i/' + it.id}>Rent it · {money(it.price_cents)}/day</a> : null) : dead ? <div class="flash err" style="margin:0">{r.status === 'declined' ? `${firstName(owner.name)} couldn't do those days.` : r.status === 'expired' ? 'No answer in time.' : 'Canceled.'} Nothing was charged.</div> : (
          <div class="steps">{STEPS.map((s, i) => <div><div class={'bar' + (i < stage ? ' done' : i === stage ? ' on' : '')}></div><div class={'lbl m' + (i <= stage ? ' on' : '')}>{s}</div></div>)}</div>
        )}

        {/* owner decision */}
        {isOwner && r.status === 'held' ? (
          <div class="card" style="border:2px solid var(--ink)">
            <b>{firstName(other.name)} wants it {fmtRange(r.start_day, r.end_day)}. You'd earn {money(r.rent_cents)}.</b>
            <div class="row" style="margin-top:10px;gap:8px">
              <form method="post" action={'/r/' + r.id + '/accept'} style="flex:1" id="acceptForm"><button class="btn pri full" type="submit">YES — accept</button></form>
              <form method="post" action={'/r/' + r.id + '/decline'}><button class="btn" type="submit">No</button></form>
            </div>
            <details class="disc"><summary>Give a discount</summary>
              <label class="field" style="margin-top:8px"><span>Your price for these days ($0 = free, max {money(r.rent_cents)})</span><input form="acceptForm" name="rent" type="number" inputmode="decimal" min="0" max={(r.rent_cents / 100).toFixed(2)} step="0.01" placeholder={(r.rent_cents / 100).toFixed(0)} /></label>
              <div class="hint">Can only go down. Free = no Lendo fee. Then tap YES</div>
            </details>
            <div class="hint" style="margin-top:8px">or reply YES / NO by text · expires {r.expires_at ? fmtT(r.expires_at) : 'in 24h'}</div>
          </div>
        ) : null}

        {/* extend: customer picks a later return day → card hold → owner YES */}
        {ox && ox.status === 'held' ? (isOwner ? (
          <div class="card" style="border:2px solid var(--ink)">
            <b>{firstName(other.name)} wants to keep it until {fmtDay(ox.new_end)} · you'd earn {money(ox.rent_cents)} more</b>
            <div class="row" style="margin-top:10px;gap:8px">
              <form method="post" action={`/r/${r.id}/ext/${ox.id}/accept`} style="flex:1"><button class="btn pri full" type="submit">YES</button></form>
              <form method="post" action={`/r/${r.id}/ext/${ox.id}/decline`}><button class="btn" type="submit">No</button></form>
            </div>
            <div class="hint" style="margin-top:8px">or reply YES / NO by text</div>
          </div>
        ) : <div class="card"><b>Asked {firstName(other.name)} to keep it until {fmtDay(ox.new_end)}</b><div class="hint">{money(ox.total_cents)} held on your card · charged only if {firstName(other.name)} says yes</div></div>) : null}
        {extCells.length ? (
          <form method="post" action={'/r/' + r.id + '/extend'} class="card" data-o={firstName(other.name)}>
            <b>Need it longer?</b><div class="hint" style="margin-top:2px">Now due back {fmtDay(r.end_day)}{extOk.length ? '' : ' · booked right after, so it can’t be extended'}</div>
            {extOk.length ? <>
              <div class="days" style="margin-top:8px">{extCells.map(d => { const ok = extOk.includes(d), p = ok ? extPrice(c.env, r, it.price_cents, it.week_cents, d) : null; const dt = new Date(d + 'T00:00:00Z');
                return <label style="display:block"><input type="radio" name="to" value={d} disabled={!ok} hidden data-p={p ? money(p.total) : ''} onchange="var f=this.form;[].forEach.call(f.querySelectorAll('.days button'),function(b){b.classList.remove('on')});this.nextElementSibling.classList.add('on');f.querySelector('.xgo').disabled=false;f.querySelector('.xgo').textContent='Ask ' + f.dataset.o + ' · +' + this.dataset.p" /><button type="button" class={ok ? '' : 'busy'} disabled={!ok} onclick="this.previousElementSibling.click()" style="width:100%"><small>{dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}</small><b>{dt.getUTCDate()}</b></button></label>; })}</div>
              <button class="btn pri full xgo" type="submit" disabled style="margin-top:10px">Pick a new return day</button>
              <div class="hint" style="margin-top:6px">Card held now · charged only if {firstName(other.name)} says yes</div>
            </> : null}
          </form>
        ) : null}

        {/* customer cancel: free before YES, 50% back after YES */}
        {!isOwner && (r.status === 'held' || r.status === 'confirmed') ? (
          <form method="post" action={'/r/' + r.id + '/cancel'} onsubmit={r.status === 'confirmed' ? `return confirm('Cancel? You get ${money(Math.round(r.total_cents / 2))} back — ${firstName(other.name)} already said yes')` : ''} style="margin:4px 0 10px">
            <button class="btn sm" type="submit" style="width:100%;color:var(--mute)">{r.status === 'held' ? 'Cancel request · nothing charged' : `Cancel · ${money(Math.round(r.total_cents / 2))} back (half)`}</button>
          </form>
        ) : null}

        {/* community agreement: customer signs once confirmed; owner sees status + a copy */}
        {!dead && stage >= 1 ? (() => {
          const ow = firstName(owner.name) || 'the owner', cu = firstName(isOwner ? other.name : u.name) || 'Customer';
          const when = r.promise_at ? new Date(r.promise_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : '';
          const view = (
            <dialog id="promView" class="psheet"><div class="psheet-in">
              <div class="psheet-h"><b>{isOwner ? `${cu}’s promise to you` : `Your promise to ${ow}`}</b><button type="button" class="psheet-x" aria-label="Close" onclick="this.closest('dialog').close()">✕</button></div>
              <div class="hint">{it.name} · {fmtRange(r.start_day, r.end_day)}</div>
              <div class="plist">{PROMISES(ow).map(t => <div class="pitem"><span class="pbox on">✓</span><span>{t}</span></div>)}</div>
              <div class="psig">{r.promise_sig ? <img src={'/p/' + r.promise_sig} alt="Signature" /> : null}<div class="hint row" style="justify-content:space-between"><span>Signed by {isOwner ? cu : 'you'}</span><span>{when}</span></div></div>
              <div class="hint" style="text-align:center;margin-top:8px">{isOwner ? 'You have a copy' : `${ow} has a copy too`}</div>
            </div></dialog>
          );
          if (r.promise_at) return <>{view}<button type="button" class="btn sm full" onclick="document.getElementById('promView').showModal()">✓ {isOwner ? `${cu} signed the promise` : 'Promise signed'} · <u>View</u></button></>;
          if (r.status !== 'confirmed') return null; // only matters before pickup
          if (isOwner) return <div class="hint" style="text-align:center">{cu} hasn’t signed the promise yet · texted a reminder</div>;
          return (<>
            <div class="pcall"><div><b>Sign your promise to {ow}</b><div class="hint">3 quick checks · needed before pickup</div></div><button type="button" class="btn pri sm" onclick="document.getElementById('promSign').showModal()">Sign now</button></div>
            <dialog id="promSign" class="psheet"><form method="post" action={'/r/' + r.id + '/promise'} class="psheet-in" id="promForm">
              <div class="psheet-h"><b>Your promise to {ow}</b><button type="button" class="psheet-x" aria-label="Close" onclick="this.closest('dialog').close()">✕</button></div>
              <div class="hint">Neighbor to neighbor. Tap each one</div>
              <div class="plist">{PROMISES(ow).map((t, i) => <label class="pitem"><input type="checkbox" name={'p' + i} required /><span class="pbox"></span><span>{t}</span></label>)}</div>
              <div class="psig"><div class="row" style="justify-content:space-between;align-items:center"><b style="font-size:13px">Sign with your finger</b><button type="button" class="btn sm" id="sigClear" style="height:30px">Clear</button></div>
                <canvas id="sigpad" width="640" height="200" aria-label="Signature pad"></canvas>
                <div class="hint">Your finger signature is your signature</div></div>
              <input type="hidden" name="sig" id="sigData" />
              <button class="btn pri full" type="submit" id="sigGo" disabled style="margin-top:12px">Sign promise</button>
            </form></dialog>
            {raw(`<script>(function(){var cv=document.getElementById('sigpad'),g=cv.getContext('2d'),f=document.getElementById('promForm'),go=document.getElementById('sigGo'),ink=0,down=false;
g.lineWidth=4;g.lineCap='round';g.lineJoin='round';g.strokeStyle='#1E3A2B';
function pt(e){var b=cv.getBoundingClientRect();return[(e.clientX-b.left)*cv.width/b.width,(e.clientY-b.top)*cv.height/b.height];}
function ok(){var all=[].every.call(f.querySelectorAll('input[type=checkbox]'),function(x){return x.checked;});go.disabled=!(all&&ink>12);go.textContent=!all?'Check all 3':ink>12?'Sign promise':'Sign above with your finger';}
cv.addEventListener('pointerdown',function(e){down=true;cv.setPointerCapture(e.pointerId);var p=pt(e);g.beginPath();g.moveTo(p[0],p[1]);});
cv.addEventListener('pointermove',function(e){if(!down)return;var p=pt(e);g.lineTo(p[0],p[1]);g.stroke();ink++;});
cv.addEventListener('pointerup',function(){down=false;ok();});
document.getElementById('sigClear').onclick=function(){g.clearRect(0,0,cv.width,cv.height);ink=0;ok();};
f.addEventListener('change',ok);f.addEventListener('submit',function(){document.getElementById('sigData').value=cv.toDataURL('image/png');});ok();})();</script>`)}
          </>);
        })() : null}

        {/* quick actions */}
        {!dead && stage >= 1 && stage < 3 ? (
          <div style="display:grid;grid-template-columns:1fr;gap:6px">
            {[["I'm here", "I'm here"]].map(([l, m]) => (
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
            {(() => { const T = (id: string, label: string) => <div class="ratrow"><b>{label}</b><div class="thumbs-pick">{[[5, '👍'], [1, '👎']].map(([n, e]) => <button type="button" data-n={String(n)} aria-label={n === 5 ? 'Thumbs up' : 'Thumbs down'} onclick={`document.getElementById('${id}').value=this.dataset.n;[].forEach.call(this.parentNode.children,function(b){b.classList.remove('on')});this.classList.add('on')`}>{e}</button>)}</div><input type="hidden" name={id} id={id} /></div>;
              return isOwner ? T('stars', `How was ${firstName(other.name)}?`) : <>{T('item_stars', `The ${it.name}`)}{T('stars', firstName(other.name))}</>; })()}
            {!isOwner ? <><div class="hint" style="margin-top:10px">{it.name} condition when you returned it</div><div class="grdpick" style="margin-top:4px">{GRADES.map(g => <label><input type="radio" name="grade" value={g} /><Grade g={g} cls="sm" /></label>)}</div></> : null}
            <input name="review" placeholder="One line others will see (optional)" maxlength={200} style="width:100%;height:42px;border-radius:10px;border:1.5px solid var(--line);padding:0 12px;margin-top:8px" />
            <button class="btn pri full" type="submit" style="margin-top:8px">Rate</button>
          </form>
        ) : myRating ? <div class="hint">You gave {myRating >= 3 ? '👍' : '👎'}</div> : null}

        <div class="m" style="font-size:8px;color:var(--mute);margin:6px 2px 0">history</div>
        <div class="msgs">
          {msgs.results.map(m => {
            const me = m.sender_id === u.id, sys = !m.sender_id;
            return <div class={'msg' + (me ? ' me' : sys ? ' sys' : '')}><div class="bub"><Linked t={m.body} /></div><div class="meta">{sys ? '' : (me ? 'You' : firstName(m.sender_name)) + (m.via === 'text' ? ' · by text' : '') + ' · '}{fmtT(m.created_at)}</div></div>;
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
  const f = await c.req.parseBody();
  const disc = String(f.rent || '').trim();
  const cents = disc === '' ? undefined : Math.round(parseFloat(disc) * 100);
  await accept(c.env, r, cents != null && !isNaN(cents) ? Math.max(0, Math.min(cents, r.rent_cents)) : undefined);
  return c.redirect('/r/' + r.id);
});
rentals.post('/r/:id/cancel', requireUser, async (c) => {
  const u = c.get('user')!; const r = await rentalById(c.env.DB, c.req.param('id'));
  if (!r || r.renter_id !== u.id) return c.notFound();
  await customerCancel(c.env, r);
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
  if (body && r.status === 'inquiry') {
    await c.env.DB.prepare('UPDATE rentals SET updated_at = ? WHERE id = ?').bind(now(), r.id).run();
    const first = !(await c.env.DB.prepare('SELECT 1 FROM messages WHERE rental_id = ? LIMIT 1').bind(r.id).first());
    if (first && u.id === r.renter_id) {
      const it = (await listingById(c.env.DB, r.listing_id))!; const owner = (await userById(c.env.DB, r.owner_id))!;
      await addMessage(c.env, r.id, u.id, body, 'web');
      await textUser(c.env, owner, `${firstName(u.name)} asked about your ${it.name}: "${body}" · reply here to answer ${c.env.APP_URL}/r/${r.id}`, 'rental', r.id);
      return c.redirect('/r/' + r.id);
    }
  }
  if (body) await relay(c.env, r, u, body, 'web');
  return c.redirect('/r/' + r.id);
});
rentals.post('/r/:id/extend', requireUser, async (c) => {
  const u = c.get('user')!; const r = await rentalById(c.env.DB, c.req.param('id'));
  if (!r || r.renter_id !== u.id) return c.notFound();
  const to = String((await c.req.parseBody()).to || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) return c.redirect('/r/' + r.id);
  const res = await askExtension(c.env, r, to);
  if ('error' in res) return c.text(res.error, 409);
  return c.redirect(res.url, 303);
});
rentals.post('/r/:id/ext/:xid/:v', requireUser, async (c) => {
  const u = c.get('user')!; const r = await rentalById(c.env.DB, c.req.param('id'));
  if (!r || r.owner_id !== u.id) return c.notFound();
  const x = await extById(c.env, c.req.param('xid'));
  if (!x || x.rental_id !== r.id || x.status !== 'held') return c.redirect('/r/' + r.id);
  if (c.req.param('v') === 'accept') await acceptExt(c.env, x); else if (c.req.param('v') === 'decline') await declineExt(c.env, x, 'declined');
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
rentals.post('/r/:id/promise', requireUser, async (c) => {
  const u = c.get('user')!;
  const r = await rentalById(c.env.DB, c.req.param('id'));
  if (!r || r.renter_id !== u.id) return c.notFound();
  if (r.promise_at) return c.redirect('/r/' + r.id);
  const f = await c.req.parseBody();
  if (!['p0', 'p1', 'p2'].every(k => f[k])) return c.redirect('/r/' + r.id);
  const m = String(f.sig || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  let key: string | null = null;
  if (m && m[1].length < 400_000) {
    const bin = Uint8Array.from(atob(m[1]), ch => ch.charCodeAt(0));
    key = `rentals/${r.id}/promise.png`;
    await c.env.PHOTOS.put(key, bin, { httpMetadata: { contentType: 'image/png' } });
  }
  await c.env.DB.prepare('UPDATE rentals SET promise_at = ?, promise_sig = ? WHERE id = ? AND promise_at IS NULL').bind(Date.now(), key, r.id).run();
  const owner = await userById(c.env.DB, r.owner_id);
  if (owner) c.executionCtx.waitUntil(textUser(c.env, owner, `${firstName(u.name) || 'Your customer'} signed the promise for your ${(await listingById(c.env.DB, r.listing_id))?.name || 'item'} ${c.env.APP_URL}/r/${r.id}`, 'rental').catch(() => {}));
  return c.redirect('/r/' + r.id);
});

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
  const itemStars = Math.min(5, Math.max(0, parseInt(String(f.item_stars || '0'), 10) || 0));
  if (u.id === r.renter_id && itemStars) await c.env.DB.prepare('UPDATE rentals SET item_rating = ? WHERE id = ?').bind(itemStars, r.id).run().catch(() => {});
  if (stars) await rate(c.env, r, u, stars, String(f.review || '').trim().slice(0, 200));
  if (u.id === r.renter_id && isGrade(f.grade)) await c.env.DB.prepare('UPDATE rentals SET grade = ? WHERE id = ?').bind(f.grade, r.id).run().catch(() => {});
  return c.redirect('/r/' + r.id);
});

// ---------- Message the owner before renting: an 'inquiry' thread (same chat as rentals, same text relay) ----------
rentals.get('/i/:id/ask', requireUser, async (c) => {
  const u = c.get('user')!;
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.status !== 'live' || it.demo) return c.notFound();
  if (it.owner_id === u.id) return c.redirect('/i/' + it.id);
  const ex = await c.env.DB.prepare(`SELECT id FROM rentals WHERE listing_id = ? AND renter_id = ? AND status = 'inquiry' ORDER BY updated_at DESC LIMIT 1`).bind(it.id, u.id).first<{ id: string }>();
  if (ex) return c.redirect('/r/' + ex.id);
  const rid = id('r'), t = now(), d = dayStr(new Date());
  await c.env.DB.prepare(`INSERT INTO rentals (id, listing_id, owner_id, renter_id, start_day, end_day, days, rent_cents, fee_cents, total_cents, credit_cents, status, created_at, updated_at) VALUES (?,?,?,?,?,?,0,0,0,0,0,'inquiry',?,?)`)
    .bind(rid, it.id, it.owner_id, u.id, d, d, t, t).run();
  return c.redirect('/r/' + rid);
});

// ---------- Your rentals + Inbox ----------
rentals.get('/rentals', requireUser, async (c) => {
  const u = c.get('user')!;
  const rows = await c.env.DB.prepare(`SELECT r.*, l.name item, o.name owner_name, n.name renter_name, (SELECT COUNT(*) FROM messages m WHERE m.rental_id = r.id AND m.sender_id IS NOT NULL AND m.sender_id != ?3 AND m.created_at > COALESCE((SELECT seen_at FROM thread_reads t WHERE t.user_id = ?3 AND t.rental_id = r.id), 0)) unread, (SELECT COALESCE(SUM(x.rent_cents),0) FROM rental_extensions x WHERE x.rental_id = r.id AND x.status = 'confirmed') x_rent, (SELECT COALESCE(SUM(x.total_cents),0) FROM rental_extensions x WHERE x.rental_id = r.id AND x.status = 'confirmed') x_total FROM rentals r JOIN listings l ON l.id = r.listing_id JOIN users o ON o.id = r.owner_id JOIN users n ON n.id = r.renter_id WHERE (r.owner_id = ?1 OR r.renter_id = ?2) AND r.status != 'requested' AND NOT (r.status = 'inquiry' AND EXISTS (SELECT 1 FROM rentals x WHERE x.listing_id = r.listing_id AND x.renter_id = r.renter_id AND x.status NOT IN ('inquiry','requested') AND x.created_at > r.created_at)) ORDER BY r.updated_at DESC LIMIT 100`).bind(u.id, u.id, u.id).all<Rental & { item: string; owner_name: string | null; renter_name: string | null; unread: number; x_rent: number; x_total: number }>().catch(() => ({ results: [] as any[] }));
  const ph = await firstPhotos(c.env.DB, [...new Set(rows.results.map(r => r.listing_id))]);
  const label = (r: Rental) => ({ held: 'waiting for YES', confirmed: 'confirmed · set pickup', picked_up: 'out', returned: 'returned · rate', closed: 'done', declined: 'declined', expired: 'expired', canceled: 'canceled', requested: '', inquiry: 'question' }[r.status]);
  return c.html(
    <Layout title="Your rentals" user={u}>
      <div style="padding:10px 16px 0;display:flex;justify-content:flex-end"><a class="btn sm" href="/payout" style="width:auto">💸 Get paid</a></div>
      <div style="height:12px"></div>
      {rows.results.length ? rows.results.map(r => (
        <a class="inboxrow" href={'/r/' + r.id}>
          {ph[r.listing_id] ? <img src={'/p/' + ph[r.listing_id]} alt="" /> : <div class="ph"></div>}
          <div style="min-width:0;flex:1">
            <div style="font-weight:800">{r.item}</div>
            <div style="font-size:13px">{r.status === 'inquiry' ? (r.owner_id === u.id ? `${firstName(r.renter_name)} asked` : `asked ${firstName(r.owner_name)}`) : <>{fmtRange(r.start_day, r.end_day)} · {r.owner_id === u.id ? `to ${firstName(r.renter_name)} · +${money(r.rent_cents + (r.x_rent || 0))}` : `from ${firstName(r.owner_name)} · ${money(r.total_cents + (r.x_total || 0))}`}</>}</div>
            <div class="hint">{label(r)}</div>
          </div>
          {r.status === 'held' && r.owner_id === u.id ? <span class="pill" style="background:var(--orange);color:#fff">YES?</span> : r.unread ? <span class="badge-n">{r.unread}</span> : null}
        </a>
      )) : <div class="hint" style="padding:24px 16px">No rentals yet. <a href="/">Browse the map</a>.</div>}
    </Layout>
  );
});

// Saved-search alerts: every search is saved automatically; this is where they turn them off
rentals.get('/alerts', requireUser, async (c) => {
  const u = c.get('user')!;
  const rows = (await c.env.DB.prepare('SELECT id, query, hood, active, created_at FROM saved_searches WHERE user_id = ? ORDER BY active DESC, created_at DESC LIMIT 100').bind(u.id).all<{ id: string; query: string; hood: string | null; active: number; created_at: number }>()).results;
  return c.html(
    <Layout title="Search alerts" user={u}>
      <div style="padding:14px 16px 4px"><div style="font-size:22px;font-weight:900">Search alerts</div>
        <div class="hint">Every search is saved. When a match is listed nearby you get a text — 1 a day, reply YES for more. Held matches come in one morning text</div></div>
      {rows.length ? rows.map(r => (
        <form method="post" action={`/alerts/${r.id}/toggle`} class="inboxrow" style={r.active ? '' : 'opacity:.5'}>
          <div style="min-width:0;flex:1"><div style="font-weight:800">{r.query}</div><div class="hint">{r.hood ? `near ${r.hood}` : 'near where you searched'}{r.active ? '' : ' · off'}</div></div>
          <button class="btn" style="width:auto;height:36px;padding:0 14px;font-size:14px">{r.active ? 'Turn off' : 'Turn on'}</button>
        </form>
      )) : <div class="hint" style="padding:24px 16px">No alerts yet. Search the <a href="/">map</a> for something you'd rent</div>}
    </Layout>
  );
});
rentals.post('/alerts/:id/toggle', requireUser, async (c) => {
  const u = c.get('user')!;
  await c.env.DB.prepare('UPDATE saved_searches SET active = 1 - active WHERE id = ? AND user_id = ?').bind(c.req.param('id'), u.id).run();
  return c.redirect('/alerts');
});

// URLs in a message → tappable links (text stays escaped by JSX)
const Linked = ({ t }: { t: string }) => <>{t.split(/(https?:\/\/[^\s)]+)/g).map((part, i) => i % 2 ? <a href={part.replace(/[.,!?]+$/, '')} class="msglink">{part.replace(/^https?:\/\//, '').replace(/[.,!?]+$/, '')}</a> : part)}</>;

// Inbox = the chat with Lendo: what we text you + what you send back, oldest at top, newest at the bottom, box at the bottom.
rentals.get('/inbox', requireUser, async (c) => {
  const u = c.get('user')!;
  const out = (await c.env.DB.prepare(`SELECT body, category, rental_id, created_at FROM outbound_texts WHERE user_id = ? AND category != 'login' ORDER BY created_at DESC LIMIT 100`).bind(u.id).all<{ body: string; category: string; rental_id: string | null; created_at: number }>()).results;
  const inn = (await c.env.DB.prepare(`SELECT body, via, created_at FROM inbound_texts WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`).bind(u.id).all<{ body: string; via: string; created_at: number }>().catch(() => ({ results: [] as { body: string; via: string; created_at: number }[] }))).results;
  const all = [...out.map(t => ({ me: false, body: t.body, rid: t.rental_id, at: t.created_at, via: '' })), ...inn.map(t => ({ me: true, body: t.body, rid: null as string | null, at: t.created_at, via: t.via }))]
    .sort((a, b) => a.at - b.at).slice(-150);
  const fmtT = (t: number) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  return c.html(
    <Layout title="Inbox" user={u}>
      <div class="msgs" id="inbox" style="padding:12px 12px 8px">
        {all.length ? all.map(m => (
          <div class={'msg' + (m.me ? ' me' : '')}>
            <div class="bub"><Linked t={m.me ? m.body : m.body.replace(/\s*\(Reply OK to get links \+ updates here\.?\)\s*$/, '')} /></div>
            <div class="meta">{m.me ? 'You' + (m.via === 'text' ? ' · by text' : '') : 'Lendo'} · {fmtT(m.at)}{m.rid ? <> · <a href={'/r/' + m.rid}>open</a></> : null}</div>
          </div>
        )) : <div class="hint" style="padding:16px 4px">Nothing here yet</div>}
        <div id="end" />
      </div>
      <form method="post" action="/inbox" class="compose">
        <input name="body" placeholder="Message Lendo (same as texting us)" required maxlength={500} autocomplete="off" />
        <button type="submit" aria-label="Send">↑</button>
      </form>
      <script dangerouslySetInnerHTML={{ __html: `window.scrollTo(0, document.body.scrollHeight)` }} />
    </Layout>
  );
});
rentals.post('/inbox', requireUser, async (c) => {
  const u = c.get('user')!;
  const body = String((await c.req.parseBody()).body || '').trim().slice(0, 500);
  if (body) await handleText(c, u, body, 'web');
  return c.redirect('/inbox#end');
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
