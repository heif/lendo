import { Hono } from 'hono';
import { logEvent } from '../lib/log';
import { CHAT_SVG, SEND_SVG, X_SVG } from '../lib/icons';
import { localToday, tzFor } from '../lib/util';
import { shortName } from '../lib/util';
import { handleText } from './webhooks';
import { acceptExt, askExtension, declineExt, extById, extendableDays, extPrice, EXT_MAX_DAYS, openExt } from '../lib/extend';
import { Grade, GRADES, isGrade } from '../lib/grade';
import { raw } from 'hono/html';
import type { Env, Listing, Rental, User, Vars } from '../lib/env';
import type { Context } from 'hono';
type Ctx = Context<{ Bindings: Env; Variables: Vars }>;
import { Layout } from '../pages/layout';
import { createFlag, Flag, FLAGGABLE, type FlagKind } from '../lib/flags';
import { requireUser } from '../lib/auth';
import { addMessage, busyDays, firstPhotos, listingById, photosFor, rentalById, userById } from '../lib/db';
import { id, money, now, daysBetween, dayStr, addDays, fmtRange, rentFor, firstName, fmtDay, backDay } from '../lib/util';
import { cardSetupUrl, createCheckout, connectOnboardingUrl, flushPendingPayouts, stripe } from '../lib/stripe';
import { HIGH_CENTS, holdFor } from '../lib/value';
import { canOpen, claimFor, isOpen } from '../lib/claims';
import { payoutOf, quote, taxRateFor } from '../lib/money';
import { selfMigrate } from '../lib/migrate';
import { accept, allGood, decline, customerCancel, holdDeposit, markHeld, pickedUp, rate, relay, returned } from '../lib/rentals';
import { smsHref, textsPaused, textUser } from '../lib/blooio';

export const rentals = new Hono<{ Bindings: Env; Variables: Vars }>();

// ---------- Request → Stripe Checkout ----------
rentals.post('/i/:id/rent', async (c) => {
  const u = c.get('user');
  const lid = c.req.param('id');
  const f = await c.req.parseBody();
  const start = String(f.start || ''), end = String(f.end || '');
  if (!u) return c.redirect('/login?next=' + encodeURIComponent(`/i/${lid}` + (/^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) ? `?start=${start}&end=${addDays(end, 1)}` : '')));
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
  const rid = id('r');
  const t = now();
  // promo credit ($5 phone bar, or $10 from the list-10 promo): used once, off the rent only. Tax is on the rent after credit; Lendo's fee comes out of the owner's payout
  const prior = await c.env.DB.prepare(`SELECT COUNT(*) n FROM rentals WHERE renter_id = ? AND credit_cents > 0 AND status IN ('held','confirmed','picked_up','returned','closed')`).bind(u.id).first<{ n: number }>();
  const rate = taxRateFor(it.lat, it.lng);
  const q = quote(c.env, rent, (u.promo_cents || 0) > 0 && !(prior?.n) ? u.promo_cents : 0, rate);
  const ins = () => c.env.DB.prepare(`INSERT INTO rentals (id, listing_id, owner_id, renter_id, start_day, end_day, days, rent_cents, fee_cents, total_cents, credit_cents, tax_cents, tax_rate, payout_cents, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(rid, it.id, it.owner_id, u.id, start, end, days, q.rent, q.fee, q.total, q.credit, q.tax, rate, q.payout, 'requested', t, t).run();
  /* right after a deploy the tax columns may not exist yet (cron migrates every 5 min) → migrate now and retry */
  try { await ins(); } catch { await selfMigrate(c.env); await ins(); }
  /* every rental: a deposit hold at pickup for the item's value, set by AI in the background ~1h after listing (value.ts). The request never waits on the AI: no value yet → an estimate from the daily price. The card is saved at checkout for the hold */
  const val = await holdFor(c.env, it);
  await c.env.DB.prepare(`UPDATE rentals SET deposit_cents = ?, deposit_status = 'due' WHERE id = ?`).bind(val.cents, rid).run();
  await logEvent(c.env.DB, 'rental.deposit_set', { user: u.id, rental: rid, listing: it.id, cents: val.cents, data: { src: val.src, capped: val.capped } });
  const r = (await rentalById(c.env.DB, rid))!;
  const url = await createCheckout(c.env, r, it, u);
  if (url) return c.redirect(url, 303);
  // dev mode (no Stripe key): pretend the card was authorized
  await markHeld(c.env, r, null, null);
  return c.redirect(`/r/${rid}?paid=1`);
});

// ---------- Rental page ----------
// Community agreement: the customer's promise to the owner (prototype "Your promise to …"), signed before pickup
const PROMISES = (owner: string, dep?: string) => [
  `I’ll be on time. If I’m running late, I’ll text ${owner}`,
  `I’ll treat it like my neighbor’s and bring it back clean and working. If I break or lose it, I’ll pay to fix or replace it${dep ? `, up to the ${dep} hold on my card. If ${owner} and I disagree, Lendo’s AI decides from the photos and what we each say, and we both go with it` : ''}`,
  `I use it at my own risk. ${owner} and Lendo aren’t responsible if I get hurt`,
];

/* meetup timing helpers (times are "HH:MM" local to the item) */
const TIMES = Array.from({ length: 31 }, (_, i) => { const m = 7 * 60 + i * 30; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); });
const fmtHM = (t: string) => { const [h, m] = t.split(':').map(Number); return (h % 12 || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + (h < 12 ? 'am' : 'pm'); };
const timeWord = (t?: string | null) => t ? ' ~' + fmtHM(t) : '';
const dayWord = (d: string, lng?: number | null) => { const t = localToday(lng); return d === t ? 'today' : d === addDays(t, 1) ? 'tomorrow' : d < t ? fmtDay(d) + ' (late)' : fmtDay(d); };
const nowMin = (lng?: number | null) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: tzFor(lng), hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date()); const g = (k: string) => Number(p.find(x => x.type === k)?.value || 0); return (g('hour') % 24) * 60 + g('minute'); };
/* "I'm here" shows when a meetup is due: the day has come, and if a time is set, from an hour before it */
function meetDue(day: string, time: string | null | undefined, lng?: number | null) {
  const t = localToday(lng); if (t < day) return false; if (t > day || !time) return true;
  const [h, m] = time.split(':').map(Number); return nowMin(lng) >= h * 60 + m - 60;
}

/* one chat picker everywhere: All · a person · a rental */
type ChatRow = { id: string; owner_id: string; renter_id: string; item: string; owner_name: string | null; renter_name: string | null };
const chatList = async (db: D1Database, uid: string) => (await db.prepare(`SELECT r.id, r.owner_id, r.renter_id, l.name item, o.name owner_name, n.name renter_name FROM rentals r JOIN listings l ON l.id = r.listing_id JOIN users o ON o.id = r.owner_id JOIN users n ON n.id = r.renter_id WHERE r.owner_id = ?1 OR r.renter_id = ?1 ORDER BY r.created_at DESC LIMIT 40`).bind(uid).all<ChatRow>().catch(() => ({ results: [] as ChatRow[] }))).results;
function ChatPick(p: { rows: ChatRow[]; me: string; cur: string }) {
  const who = (r: ChatRow) => r.owner_id === p.me ? { id: r.renter_id, name: firstName(r.renter_name) } : { id: r.owner_id, name: firstName(r.owner_name) };
  const people = p.rows.map(who).filter((x, i, a) => a.findIndex(y => y.id === x.id) === i);
  const O = (v: string, t: string) => <option value={v} selected={v === p.cur}>{t}</option>;
  return <div class="chatbar"><label class="chatpick"><span dangerouslySetInnerHTML={{ __html: CHAT_SVG }} /><select aria-label="Which chat" onchange="location.href=this.value">
    {O('/inbox', 'All chats')}
    {people.length ? <optgroup label="People">{people.map(x => O('/inbox?with=' + x.id, x.name))}</optgroup> : null}
    {p.rows.length ? <optgroup label="Rentals">{p.rows.map(r => O('/r/' + r.id, who(r).name + ' · ' + r.item))}</optgroup> : null}
  </select></label>{raw(`<script>document.documentElement.style.setProperty('--hh',document.querySelector('.hdr').offsetHeight+'px')</script>`)}</div>;
}

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
  const cl = await claimFor(c.env, r.id);
  /* deposit hold: owner opening the pickup on/after pickup day places it, so they see "OK to hand over" before letting go */
  if (isOwner && r.status === 'confirmed' && r.deposit_status === 'due' && r.start_day <= localToday(it.lng)) { try { await holdDeposit(c.env, r); Object.assign(r, await rentalById(c.env.DB, r.id)); } catch { /* cron retries */ } }
  const photos = await photosFor(c.env.DB, it.id);
  const msgs = await c.env.DB.prepare(`SELECT m.*, u.name sender_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.rental_id = ?1 OR (?2 != 'inquiry' AND m.rental_id IN (SELECT id FROM rentals WHERE listing_id = ?3 AND renter_id = ?4 AND status = 'inquiry')) ORDER BY m.created_at`).bind(r.id, r.status, r.listing_id, r.renter_id).all<{ id: string; sender_id: string | null; body: string; via: string; created_at: number; sender_name: string | null }>();
  const STEPS = ['Requested', 'Confirmed', 'Pickup', 'Returned'];
  const stage = r.status === 'held' || r.status === 'requested' ? 0 : r.status === 'confirmed' ? 1 : r.status === 'picked_up' ? 2 : r.status === 'returned' || r.status === 'closed' ? 3 : -1;
  const dead = ['declined', 'expired', 'canceled'].includes(r.status);
  const myRating = isOwner ? r.owner_rating : r.renter_rating;
  const spots = owner.pickup_spots ? (JSON.parse(owner.pickup_spots) as string[]) : [];
  const fmtT = (t: number) => new Date(t).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  const live = r.status === 'picked_up';
  const xs = await c.env.DB.prepare(`SELECT COALESCE(SUM(COALESCE(payout_cents, rent_cents)),0) rent, COALESCE(SUM(total_cents),0) total FROM rental_extensions WHERE rental_id = ? AND status = 'confirmed'`).bind(r.id).first<{ rent: number; total: number }>().catch(() => null);
  const xRent = xs?.rent || 0, xTotal = xs?.total || 0;
  const ox = live ? await openExt(c.env, r.id) : null;
  const extOk = live && !isOwner && !ox ? await extendableDays(c.env, r) : [];
  const paused = await textsPaused(c.env, u);
  const chats = await chatList(c.env.DB, u.id);
  const extCells = live && !isOwner && !ox ? Array.from({ length: Math.min(EXT_MAX_DAYS, Math.max(7, extOk.length + 1)) }, (_, i) => addDays(r.end_day, i + 1)) : [];
  return c.html(
    <Layout title={isOwner ? 'Rental of your ' + it.name : 'Your rental'} user={u} back="/inbox" headerCenter={<span class="sp"></span>} flash={c.req.query('paid') ? (r.status === 'held' ? `Card held. Waiting for ${firstName(owner.name)}.` : null) : null} flashErr={c.req.query('needphoto') ? 'Take the handover photo first · it shows what was handed over' : undefined}>
      <ChatPick rows={chats} me={u.id} cur={'/r/' + r.id} />
      <div class="rpage">
      <div class="rcard">
        {/* 3A: compact header (who · item · dates · $) + pinned where/when strip */}
        <a class="rhd" href={'/i/' + it.id}>
          {it.avatar_key ? <img class="cut" data-trim="1" src={'/p/' + it.avatar_key} alt="" /> : photos[0] ? <img class="cut" data-trim="1" src={'/c/' + photos[0].r2_key + '?s=200'} alt="" /> : <span class="rhd-ph"></span>}
          <div style="min-width:0"><b class="rhd-t">{it.name}</b>
            <div>{isOwner ? '' : 'from '}<span class="ownlink" onclick={`event.preventDefault();location.href='${(other as any).handle ? '/' + (other as any).handle : '/u/' + other.id}'`}>{shortName(other.name)}</span> · {r.status === 'inquiry' ? (isOwner ? 'question about your item' : 'questions before renting') : <>{fmtRange(r.start_day, r.end_day)}{dead ? <> · {isOwner ? `you earn ${money(payoutOf(r) + xRent)}` : money(r.total_cents + xTotal)}</> : null}</>}</div></div>
        </a>
        {r.status !== 'inquiry' && !dead ? (() => { const nm = firstName(other.name), spot = r.meet_spot || (spots.length === 1 ? spots[0] : '');
          const chg = spots.length > 1 ? <u onclick="var d=document.querySelector('.rstrip');d.open=!d.open">Change</u> : null;
          const tot = money(r.total_cents + xTotal), earn = money(payoutOf(r) + xRent);
          const dep = (r.deposit_cents || 0) > 0 ? money(r.deposit_cents!) : '', dst = r.deposit_status;
          const pickNote = !dep ? null : dst === 'held' || stage >= 2 ? (isOwner ? `✓ ${dep} hold on ${nm}'s card${stage === 1 ? ' · OK to hand over' : ''}` : `✓ ${dep} hold (not a charge) on your card`) : dst === 'failed' ? null : (isOwner ? `${dep} hold goes on ${nm}'s card` : `${dep} hold (not a charge) on your card`);
          const retNote = !dep ? null : dst === 'captured' ? 'hold settled by the decision' : dst === 'released' ? `✓ ${dep} hold released` : stage === 3 && dst === 'held' ? (cl && cl.status !== 'withdrawn' ? `${dep} hold stays until the problem is decided` : `${dep} hold released within 24h`) : stage === 3 ? null : `${dep} hold released after it’s back`;
          /* A · clean list (11/22): one size, each step's detail on its own line, promise is a step, Cancel in a footer */
          const how = stage === 1 && !r.pickup_time ? `set a time with ${nm} in the chat` : stage === 2 && !r.return_time ? `set a return time with ${nm} in the chat` : null;
          const signed = !!r.promise_at, promNow = stage === 1 && !signed;
          const sep = (xs: any[]) => xs.filter(Boolean).flatMap((x, k) => k ? [' · ', x] : [x]);
          const S: [string, any[]][] = [
            [isOwner ? `${nm} asked` : 'You asked', stage === 0 ? [isOwner ? `you’d earn ${earn} after ${c.env.FEE_PCT}% fee` : `${tot} held (not a charge)`] : []],
            [stage === 0 ? (isOwner ? 'Say YES or NO' : `Waiting for ${nm}’s YES`) : (isOwner ? 'You said YES' : `${nm} said YES`), stage >= 1 ? [isOwner ? `you earn ${earn}` : `${tot} paid`] : []],
            [signed ? (isOwner ? `${nm} signed Promise` : 'You signed Promise') : isOwner ? `${nm}’s Promise` : `Sign Promise to ${nm}`,
              signed ? [<u onclick="document.getElementById('promView').showModal()">View</u>] : promNow ? (isOwner ? ['not signed yet · reminder texted'] : []) : stage === 0 ? ['before pickup'] : []],
            [stage > 2 || r.status === 'picked_up' ? 'Picked up' : 'Pickup ' + dayWord(r.start_day, it.lng) + timeWord(r.pickup_time), stage === 1 && !promNow ? [spot, chg, how, pickNote] : stage >= 2 ? [pickNote] : []],
            [stage === 3 ? 'Returned' : 'Return ' + dayWord(backDay(r.end_day), it.lng) + timeWord(r.return_time || r.pickup_time), stage === 2 ? [spot, chg, how, retNote] : stage === 3 ? [retNote] : []],
          ];
          const now = stage === 0 ? 1 : promNow ? 2 : stage === 1 ? 3 : stage === 2 ? 4 : 5;
          const cancel = !isOwner && stage <= 1 ? <button type="submit" form="cancelForm">{stage === 0 ? 'Cancel request' : 'Cancel rental'}</button> : null;
          return <>
            <ol class="rlist">{S.map(([t, d], i) => { const dd = sep(d); return <li class={i < now || (i === 2 && signed) ? 'done' : i === now ? 'now' : ''}><i></i><div><b>{t}</b>{dd.length ? <span>{dd}</span> : null}{i === 2 && promNow && !isOwner ? <button type="button" class="rsign" onclick="document.getElementById('promSign').showModal()">✍️ Sign</button> : null}</div></li>; })}</ol>
            {cancel ? <div class="rfoot">{paused ? <a class="rpaused sms-only" href={smsHref(c.env, 'OK')}>📵 Texts paused · <u>text OK</u></a> : <span></span>}{cancel}</div> : null}
          </>; })() : null}
        {paused && !(!isOwner && stage <= 1 && r.status !== 'inquiry' && !dead) ? <a class="hint sms-only" href={smsHref(c.env, 'OK')} style="text-align:center;color:#b3261e;font-weight:700;display:block">📵 Lendo texts paused · <u>tap to text OK</u></a> : null}
        {r.status === 'inquiry' ? (!isOwner ? <a class="btn pri full" href={'/i/' + it.id}>Rent it · {money(it.price_cents)}/day</a> : null) : dead ? <div class="flash err" style="margin:0">{r.status === 'declined' ? `${firstName(owner.name)} couldn't do those days.` : r.status === 'expired' ? 'No answer in time.' : 'Canceled.'} Nothing was charged.</div> : null}
        {!dead && (stage === 1 || stage === 2) ? (
          <details class="rstrip">
            <summary><span>📍 <b>{r.meet_spot || (spots.length === 1 ? spots[0] : 'Pick a meet spot')}</b> <span class="hint">· {stage === 1 ? 'pickup ' + dayWord(r.start_day, it.lng) + timeWord(r.pickup_time) : 'back ' + dayWord(backDay(r.end_day), it.lng) + timeWord(r.return_time || r.pickup_time)}</span></span><u>Change</u></summary>
            <div class="rstrip-in">
              {spots.length ? <form method="post" action={'/r/' + r.id + '/spot'} class="row" style="gap:6px;flex-wrap:wrap">{spots.map(sp => <button class={'btn sm' + (sp === r.meet_spot ? ' pri' : '')} name="spot" value={sp} type="submit">📍 {sp}</button>)}</form> : null}

            </div>
          </details>
        ) : null}

        {/* owner decision */}
        {isOwner && r.status === 'held' ? (
          <div class="card" style="border:2px solid var(--ink)">
            <div class="row" style="gap:8px">
              {/* phones: YES/NO open Messages with the reply typed (a real text keeps Lendo texts flowing); computers: plain buttons */}
              <a class="btn pri sms-only" style="flex:1;display:grid;place-items:center;text-decoration:none" href={smsHref(c.env, 'YES ' + r.id.slice(-4))}>💬 YES — accept</a>
              <a class="btn sms-only" style="display:grid;place-items:center;text-decoration:none" href={smsHref(c.env, 'NO ' + r.id.slice(-4))}>No</a>
              <div style="flex:1" class="web-only"><button class="btn pri full" type="submit" form="acceptForm2">YES — accept</button></div>
              <form method="post" action={'/r/' + r.id + '/decline'} class="web-only"><button class="btn" type="submit">No</button></form>
            </div>
            <div class="hint sms-only" style="margin-top:6px">Opens Messages with “YES” typed · tap Send · <button type="submit" form="acceptForm2" style="background:none;border:0;padding:0;font:inherit;color:inherit;text-decoration:underline">or accept here</button></div>
            <form method="post" action={'/r/' + r.id + '/accept'} id="acceptForm2"></form>
            <details class="disc"><summary>Give a discount</summary>
              <label class="field" style="margin-top:8px"><span>Your price for these days ($0 = free, max {money(r.rent_cents)})</span><input form="acceptForm2" name="rent" type="number" inputmode="decimal" min="0" max={(r.rent_cents / 100).toFixed(2)} step="0.01" placeholder={(r.rent_cents / 100).toFixed(0)} /></label>
              <div class="hint">Can only go down. Free = no Lendo fee</div><button class="btn pri full" type="submit" form="acceptForm2" style="margin-top:8px">Accept at this price</button>
            </details>
            <div class="hint" style="margin-top:8px"><span class="web-only">or reply YES / NO by text · </span>expires {r.expires_at ? fmtT(r.expires_at) : 'in 24h'}</div>
          </div>
        ) : null}

        {/* extend: customer picks a later return day → card hold → owner YES */}
        {ox && ox.status === 'held' ? (isOwner ? (
          <div class="card" style="border:2px solid var(--ink)">
            <b>{firstName(other.name)} wants to keep it until {fmtDay(backDay(ox.new_end))} · you'd earn {money(payoutOf(ox))} more</b>
            <div class="row" style="margin-top:10px;gap:8px">
              <a class="btn pri sms-only" style="flex:1;display:grid;place-items:center;text-decoration:none" href={smsHref(c.env, 'YES')}>💬 YES</a>
              <form method="post" action={`/r/${r.id}/ext/${ox.id}/accept`} style="flex:1" class="web-only"><button class="btn pri full" type="submit">YES</button></form>
              <form method="post" action={`/r/${r.id}/ext/${ox.id}/decline`}><button class="btn" type="submit">No</button></form>
            </div>
            <div class="hint" style="margin-top:8px">or reply YES / NO by text</div>
          </div>
        ) : <div class="card"><b>Asked {firstName(other.name)} to keep it until {fmtDay(backDay(ox.new_end))}</b><div class="hint">{money(ox.total_cents)} held on your card · charged only if {firstName(other.name)} says yes</div></div>) : null}
        {extCells.length ? (
          <form method="post" action={'/r/' + r.id + '/extend'} class="card" data-o={firstName(other.name)}>
            <b>Need it longer?</b><div class="hint" style="margin-top:2px">Now due back {fmtDay(backDay(r.end_day))}{extOk.length ? '' : ' · booked right after, so it can’t be extended'}</div>
            {extOk.length ? <>
              <div class="days" style="margin-top:8px">{extCells.map(d => { const ok = extOk.includes(d), p = ok ? extPrice(c.env, r, it.price_cents, it.week_cents, d) : null; const dt = new Date(backDay(d) + 'T00:00:00Z'); /* cell shows the return day (24h after the last rented day) */
                return <label style="display:block"><input type="radio" name="to" value={d} disabled={!ok} hidden data-p={p ? money(p.total) : ''} onchange="var f=this.form;[].forEach.call(f.querySelectorAll('.days button'),function(b){b.classList.remove('on')});this.nextElementSibling.classList.add('on');f.querySelector('.xgo').disabled=false;f.querySelector('.xgo').textContent='Ask ' + f.dataset.o + ' · +' + this.dataset.p" /><button type="button" class={ok ? '' : 'busy'} disabled={!ok} onclick="this.previousElementSibling.click()" style="width:100%"><small>{dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}</small><b>{dt.getUTCDate()}</b></button></label>; })}</div>
              <button class="btn pri full xgo" type="submit" disabled style="margin-top:10px">Pick a new return day</button>
              <div class="hint" style="margin-top:6px">Card held now · charged only if {firstName(other.name)} says yes</div>
            </> : null}
          </form>
        ) : null}



        {/* a problem was reported: both sides get to the claim from here */}
        {cl && cl.status !== 'withdrawn' ? <a class="card" href={'/r/' + r.id + '/claim'} style="border:2px solid var(--ink);display:block;text-decoration:none;color:inherit">
          <b>{cl.status === 'final' ? `Decided · ${(cl.final_cents || 0) > 0 ? `${isOwner ? firstName(other.name) + ' owes' : 'you owe'} ${money(cl.final_cents!)}` : 'no charge'}` : isOpen(cl) && cl.status === 'ruled' ? `Decision · ${(cl.award_cents || 0) > 0 ? money(cl.award_cents!) : 'no charge'} · OK it or ask for a second look` : 'Problem reported · being decided'}</b>
          <div class="hint">{(cl.status === 'response' || cl.status === 'reply') ? (isOwner ? `Waiting for ${firstName(other.name)}’s side` : 'Your turn · add your side') : cl.status === 'rebuttal' ? (isOwner ? 'Your turn · reply' : `Waiting for ${firstName(other.name)}’s reply`) : cl.status === 'final' ? 'Final' : ''} <u>View</u></div>
        </a> : null}
        {/* returned: the hold stays 24h so the owner can check the item */}
        {isOwner && stage === 3 && r.deposit_status === 'held' && !cl ? <div class="card" style="border:2px solid var(--ink)">
          <b>All good with the {it.name}?</b>
          <div class="row" style="margin-top:10px;gap:8px">
            <form method="post" action={'/r/' + r.id + '/allgood'} style="flex:1"><button class="btn pri full" type="submit">All good · release hold</button></form>
            <a class="btn" href={'/r/' + r.id + '/claim'} style="display:grid;place-items:center;text-decoration:none">Report a problem</a>
          </div>
          <div class="hint" style="margin-top:8px">{money(r.deposit_cents || 0)} hold on {firstName(other.name)}’s card releases on its own {fmtT((r.returned_at || r.updated_at) + 24 * 3600e3)}</div>
        </div> : null}
        {isOwner && !cl && canOpen(r, it) === 'not_returned' ? <a class="hint" href={'/r/' + r.id + '/claim'} style="display:block;text-align:center;font-weight:700;color:#b3261e">Not back yet? Report it</a> : null}

        {/* community agreement: customer signs once confirmed; owner sees status + a copy */}
        {!dead && stage >= 1 ? (() => {
          const ow = firstName(owner.name) || 'the owner', cu = firstName(isOwner ? other.name : u.name) || 'Customer';
          const when = r.promise_at ? new Date(r.promise_at).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : '';
          const view = (
            <dialog id="promView" class="psheet"><div class="psheet-in">
              <div class="psheet-h"><b>{isOwner ? `${cu}’s promise to you` : `Your promise to ${ow}`}</b><button type="button" class="psheet-x" aria-label="Close" onclick="this.closest('dialog').close()" dangerouslySetInnerHTML={{ __html: X_SVG }} /></div>
              <div class="hint">{it.name} · {fmtRange(r.start_day, r.end_day)}</div>
              <div class="plist">{PROMISES(ow, (r.deposit_cents || 0) > 0 ? money(r.deposit_cents!) : undefined).map(t => <div class="prom"><span class="pbox on">✓</span><span>{t}</span></div>)}</div>
              <div class="psig">{r.promise_sig ? <img src={'/p/' + r.promise_sig} alt="Signature" /> : null}<div class="hint row" style="justify-content:space-between"><span>Signed by {isOwner ? cu : 'you'}</span><span>{when}</span></div></div>
              <div class="hint" style="text-align:center;margin-top:8px">{isOwner ? 'You have a copy' : `${ow} has a copy too`}</div>
            </div></dialog>
          );
          if (r.promise_at) return view; /* "Promise signed · View" is a step in the list */
          if (r.status !== 'confirmed') return null; // only matters before pickup
          if (isOwner) return null; /* shown as the promise step */
          return (<>
            <dialog id="promSign" class="psheet"><form method="post" action={'/r/' + r.id + '/promise'} class="psheet-in" id="promForm">
              <div class="psheet-h"><b>Your promise to {ow}</b><button type="button" class="psheet-x" aria-label="Close" onclick="this.closest('dialog').close()" dangerouslySetInnerHTML={{ __html: X_SVG }} /></div>
              <div class="hint">Neighbor to neighbor. Tap each one</div>
              <div class="plist">{PROMISES(ow, (r.deposit_cents || 0) > 0 ? money(r.deposit_cents!) : undefined).map((t, i) => <label class="prom"><input type="checkbox" name={'p' + i} required /><span class="pbox"></span><span>{t}</span></label>)}</div>
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
f.addEventListener('change',ok);f.addEventListener('submit',function(){document.getElementById('sigData').value=cv.toDataURL('image/png');});ok();if(location.hash==='#promise'){history.replaceState(null,'',location.pathname+location.search);var d=document.getElementById('promSign');if(d&&!d.open)d.showModal();}})();</script>`)}
          </>);
        })() : null}

        {/* quick actions */}
        {/* customer cancel: free before YES, 50% back after YES */}
        {!isOwner && (r.status === 'held' || r.status === 'confirmed') ? (
          <form method="post" action={'/r/' + r.id + '/cancel'} onsubmit={r.status === 'confirmed' ? `return confirm('Cancel? You get ${money(Math.round(r.total_cents / 2))} back — ${firstName(other.name)} already said yes')` : "return confirm('Cancel request? Nothing is charged')"} id="cancelForm" hidden>
            <button type="submit" style="width:100%;background:none;border:0;color:var(--mute);text-decoration:underline;font:inherit;font-size:13px">{r.status === 'held' ? 'Cancel request · nothing charged' : `Cancel · ${money(Math.round(r.total_cents / 2))} back (half)`}</button>
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
        {isOwner && (r.status === 'returned' || r.status === 'closed') && !cl && r.deposit_status !== 'held' ? <div class="flagrow" style="justify-content:flex-start"><Flag kind="rental" target={r.id} rental={r.id} back={'/r/' + r.id} user={u} label="Problem with the return?" /></div> : null}

      </div>
        <div class="msgs">
          {msgs.results.map(m => {
            const me = m.sender_id === u.id, sys = !m.sender_id;
            return <div class={'msg' + (me ? ' me' : sys ? ' sys' : '')}><div class="bub"><Linked t={m.body} />{!me && !sys && FLAGGABLE.test(m.body) ? <Flag kind="message" target={String(m.id)} rental={r.id} back={'/r/' + r.id} user={u} cls="msgflag" /> : null /* flag only shows on flaggable text */}</div><div class="meta">{sys ? '' : (me ? 'You' : firstName(m.sender_name)) + (m.via === 'text' ? ' · by text' : '') + ' · '}{fmtT(m.created_at)}</div></div>;
          })}
        </div>
      </div>
      {!dead ? (
        <div class="rdock">
          {(r.deposit_cents || 0) > 0 && (stage === 1 || stage === 2) && r.deposit_status !== 'released' ? (() => {
            const amt = money(r.deposit_cents!), nm = firstName(other.name), st = r.deposit_status;
            if (st === 'held') return null;
            if (st === 'failed') return isOwner
              ? <form class="rhold bad" method="post" action={'/r/' + r.id + '/hold'}>✕ {nm}'s card didn't take the {amt} hold — hold off on handing it over <button type="submit">Try again</button></form>
              : <div class="rhold bad">Your card didn't take the {amt} hold · <a href={'/r/' + r.id + '/card'}>Add a card</a></div>;
            return null;
          })() : null}
          {stage === 1 || stage === 2 ? <div class="rchips">
            {isOwner ? <>
              <form method="post" action={'/r/' + r.id + (stage === 1 ? '/pickup' : '/return')} enctype="multipart/form-data"><label class="rchip hot">📷 {stage === 1 ? 'Handed over' : 'Got it back'}<input type="file" name="photo" accept="image/*" capture="environment" hidden onchange="this.form.submit()" /></label></form>
              {stage === 1 && (r.deposit_cents || 0) > HIGH_CENTS ? null : <form method="post" action={'/r/' + r.id + (stage === 1 ? '/pickup' : '/return')} enctype="multipart/form-data" onsubmit={`return confirm('${stage === 1 ? 'Mark picked up' : 'Mark returned'} without a photo?')`}><button class="rchip" type="submit">✓ No photo</button></form>}
            </> : null}
            {meetDue(stage === 1 ? r.start_day : backDay(r.end_day), stage === 1 ? r.pickup_time : r.return_time || r.pickup_time, it.lng) ? <><span class="qrlbl">Tap to send</span><a class="rchip qr sms-only" href={smsHref(c.env, "I'm here")} style="text-decoration:none">👋 “I’m here” <i aria-hidden="true">↑</i></a><form method="post" action={'/r/' + r.id + '/msg'} class="web-only"><input type="hidden" name="body" value="I'm here" /><button class="rchip qr" type="submit">👋 “I’m here” <i aria-hidden="true">↑</i></button></form></> : null}

          </div> : null}
          <form method="post" action={'/r/' + r.id + '/msg'} class="compose" style="position:static;padding:6px 0 0">
            <input name="body" placeholder={`Message ${firstName(other.name)}`} required maxlength={500} autocomplete="off" />
            <button type="submit" aria-label="Send" dangerouslySetInnerHTML={{ __html: SEND_SVG }} />
          </form>
        </div>
      ) : null}
      <script src="/live.js" data-ver={'/api/chatver?r=' + r.id} defer></script>
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
/* a customer's message before renting: first one texts the owner the question, later ones relay */
async function sendMsg(c: Ctx, u: User, r: Rental, body: string) {
  if (body && r.status === 'inquiry') {
    await c.env.DB.prepare('UPDATE rentals SET updated_at = ? WHERE id = ?').bind(now(), r.id).run();
    const first = !(await c.env.DB.prepare('SELECT 1 FROM messages WHERE rental_id = ? LIMIT 1').bind(r.id).first());
    if (first && u.id === r.renter_id) {
      const it = (await listingById(c.env.DB, r.listing_id))!; const owner = (await userById(c.env.DB, r.owner_id))!;
      await addMessage(c.env, r.id, u.id, body, 'web');
      await textUser(c.env, owner, `${firstName(u.name)} asked about your ${it.name}: "${body}" · reply here to answer ${c.env.APP_URL}/r/${r.id}`, 'rental', r.id);
      return;
    }
  }
  if (body) await relay(c.env, r, u, body, 'web');
}
rentals.post('/r/:id/msg', requireUser, async (c) => {
  const u = c.get('user')!; const r = await rentalById(c.env.DB, c.req.param('id'));
  if (!r || (r.owner_id !== u.id && r.renter_id !== u.id)) return c.notFound();
  const b = await c.req.parseBody();
  await sendMsg(c, u, r, String(b.body || '').trim().slice(0, 500));
  const bk = String(b.back || '');
  return c.redirect(/^\/inbox\?with=[\w-]+$/.test(bk) ? bk + '#end' : '/r/' + r.id + '#end');
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
rentals.post('/r/:id/time', requireUser, async (c) => {
  const u = c.get('user')!; const r = await rentalById(c.env.DB, c.req.param('id'));
  if (!r || (r.owner_id !== u.id && r.renter_id !== u.id)) return c.notFound();
  const f = await c.req.parseBody(), t = String(f.t || ''), kind = f.kind === 'return' ? 'return' : 'pickup';
  if (!TIMES.includes(t)) return c.redirect('/r/' + r.id);
  const col = kind === 'return' ? 'return_time' : 'pickup_time';
  await c.env.DB.prepare(`UPDATE rentals SET ${col} = ?, updated_at = ? WHERE id = ?`).bind(t, now(), r.id).run();
  await logEvent(c.env.DB, 'rental.' + col, { user: u.id, rental: r.id, data: { t, was: (r as any)[col] ?? null } });
  const it = (await listingById(c.env.DB, r.listing_id))!;
  await relay(c.env, r, u, `${kind === 'return' ? 'Return' : 'Pickup'} ${dayWord(kind === 'return' ? backDay(r.end_day) : r.start_day, it.lng)} around ${fmtHM(t)}?`, 'web');
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

/* owner checked the returned item: release the hold now */
rentals.post('/r/:id/allgood', requireUser, async (c) => {
  const u = c.get('user')!; const r = await rentalById(c.env.DB, c.req.param('id'));
  if (!r || r.owner_id !== u.id) return c.notFound();
  await allGood(c.env, r, 'owner');
  return c.redirect('/r/' + r.id);
});
/* deposit hold: owner retries a hold that didn't take; customer adds a card for it */
rentals.post('/r/:id/hold', requireUser, async (c) => {
  const u = c.get('user')!; const r = await rentalById(c.env.DB, c.req.param('id'));
  if (!r || r.owner_id !== u.id) return c.notFound();
  if ((r.status === 'confirmed' || r.status === 'picked_up') && r.deposit_status === 'failed') await holdDeposit(c.env, r);
  return c.redirect('/r/' + r.id);
});
rentals.get('/r/:id/card', requireUser, async (c) => {
  const u = c.get('user')!; const r = await rentalById(c.env.DB, c.req.param('id'));
  if (!r || r.renter_id !== u.id) return c.notFound();
  if (r.deposit_status !== 'failed' && r.deposit_status !== 'due') return c.redirect('/r/' + r.id);
  const url = await cardSetupUrl(c.env, r);
  return c.redirect(url || '/r/' + r.id);
});
rentals.post('/r/:id/pickup', requireUser, async (c) => {
  const u = c.get('user')!; const r = await rentalById(c.env.DB, c.req.param('id'));
  if (!r || r.owner_id !== u.id) return c.notFound();
  const photo = await savePhoto(c, r, 'pickup');
  /* a hold over $500 needs the handover photo: it's the proof of what was handed over, and in what shape */
  if (!photo && (r.deposit_cents || 0) > HIGH_CENTS && r.status === 'confirmed') return c.redirect('/r/' + r.id + '?needphoto=1');
  await pickedUp(c.env, r, photo);
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
async function inquiryFor(c: Ctx, u: User, it: Listing) {
  const ex = await c.env.DB.prepare(`SELECT * FROM rentals WHERE listing_id = ? AND renter_id = ? AND status = 'inquiry' ORDER BY updated_at DESC LIMIT 1`).bind(it.id, u.id).first<Rental>();
  if (ex) return ex;
  const rid = id('r'), t = now(), d = dayStr(new Date());
  await c.env.DB.prepare(`INSERT INTO rentals (id, listing_id, owner_id, renter_id, start_day, end_day, days, rent_cents, fee_cents, total_cents, credit_cents, status, created_at, updated_at) VALUES (?,?,?,?,?,?,0,0,0,0,0,'inquiry',?,?)`)
    .bind(rid, it.id, it.owner_id, u.id, d, d, t, t).run();
  return (await rentalById(c.env.DB, rid))!;
}
rentals.get('/i/:id/ask', requireUser, async (c) => {
  const u = c.get('user')!;
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.status !== 'live' || it.demo) return c.notFound();
  if (it.owner_id === u.id) return c.redirect('/i/' + it.id);
  return c.redirect('/r/' + (await inquiryFor(c, u, it)).id);
});
/* inline ask on the item page */
rentals.post('/i/:id/ask', requireUser, async (c) => {
  const u = c.get('user')!;
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.status !== 'live' || it.demo || it.owner_id === u.id) return c.notFound();
  const body = String((await c.req.parseBody()).body || '').trim().slice(0, 500);
  const r = await inquiryFor(c, u, it);
  if (body) { await sendMsg(c, u, r, body); await logEvent(c.env.DB, 'rental.question', { user: u.id, rental: r.id, listing: it.id }); }
  return (c.req.header('accept') || '').includes('application/json') ? c.json({ ok: true, rid: r.id }) : c.redirect('/r/' + r.id);
});

// ---------- Your rentals + Inbox ----------
rentals.get('/rentals', requireUser, async (c) => {
  const u = c.get('user')!;
  const rows = await c.env.DB.prepare(`SELECT r.*, l.name item, o.name owner_name, n.name renter_name, (SELECT COUNT(*) FROM messages m WHERE m.rental_id = r.id AND m.sender_id IS NOT NULL AND m.sender_id != ?3 AND m.created_at > COALESCE((SELECT seen_at FROM thread_reads t WHERE t.user_id = ?3 AND t.rental_id = r.id), 0)) unread, (SELECT COALESCE(SUM(COALESCE(x.payout_cents, x.rent_cents)),0) FROM rental_extensions x WHERE x.rental_id = r.id AND x.status = 'confirmed') x_rent, (SELECT COALESCE(SUM(x.total_cents),0) FROM rental_extensions x WHERE x.rental_id = r.id AND x.status = 'confirmed') x_total FROM rentals r JOIN listings l ON l.id = r.listing_id JOIN users o ON o.id = r.owner_id JOIN users n ON n.id = r.renter_id WHERE (r.owner_id = ?1 OR r.renter_id = ?2) AND r.status != 'requested' AND NOT (r.status = 'inquiry' AND EXISTS (SELECT 1 FROM rentals x WHERE x.listing_id = r.listing_id AND x.renter_id = r.renter_id AND x.status NOT IN ('inquiry','requested') AND x.created_at > r.created_at)) ORDER BY r.updated_at DESC LIMIT 100`).bind(u.id, u.id, u.id).all<Rental & { item: string; owner_name: string | null; renter_name: string | null; unread: number; x_rent: number; x_total: number }>().catch(() => ({ results: [] as any[] }));
  const ph = await firstPhotos(c.env.DB, [...new Set(rows.results.map(r => r.listing_id))]);
  const label = (r: Rental) => ({ held: 'waiting for YES', confirmed: 'confirmed · set pickup', picked_up: 'out', returned: 'returned · rate', closed: 'done', declined: 'declined', expired: 'expired', canceled: 'canceled', requested: '', inquiry: 'question' }[r.status]);
  return c.html(
    <Layout title="Your rentals" user={u}>
      <div style="padding:10px 16px 0;display:flex;justify-content:flex-end"><a class="btn sm" href="/payout" style="width:auto">💸 Get paid</a></div>
      <div style="height:12px"></div>
      {rows.results.length ? rows.results.map(r => (
        <a class="inboxrow" href={'/r/' + r.id}>
          {ph[r.listing_id] ? <img class="cut" data-trim="1" src={'/c/' + ph[r.listing_id] + '?s=200'} alt="" /> : <div class="ph"></div>}
          <div style="min-width:0;flex:1">
            <div style="font-weight:800">{r.item}</div>
            <div style="font-size:13px">{r.status === 'inquiry' ? (r.owner_id === u.id ? `${firstName(r.renter_name)} asked` : `asked ${firstName(r.owner_name)}`) : <>{fmtRange(r.start_day, r.end_day)} · {r.owner_id === u.id ? `to ${firstName(r.renter_name)} · +${money(payoutOf(r) + (r.x_rent || 0))}` : `from ${firstName(r.owner_name)} · ${money(r.total_cents + (r.x_total || 0))}`}</>}</div>
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
  await logEvent(c.env.DB, 'alert.toggled', { user: u.id, data: { id: c.req.param('id') } });
  const back = String((await c.req.parseBody().catch(() => ({} as any))).back || '');
  return c.redirect(back === '/saved' ? '/saved' : '/alerts');
});

// URLs in a message → tappable links (text stays escaped by JSX)
const Linked = ({ t }: { t: string }) => <>{t.split(/(https?:\/\/[^\s)]+)/g).map((part, i) => i % 2 ? <a href={part.replace(/[.,!?]+$/, '')} class="msglink">{part.replace(/^https?:\/\//, '').replace(/[.,!?]+$/, '')}</a> : part)}</>;

// Inbox = the chat with Lendo: what we text you + what you send back, oldest at top, newest at the bottom, box at the bottom.
/* live chat: pages poll this every 10s (only while visible) and refresh the chat + status card when it changes */
rentals.get('/api/chatver', requireUser, async (c) => {
  const u = c.get('user')!, rid = c.req.query('r') || '', wid = c.req.query('with') || '';
  let v = '';
  if (rid) {
    const r = await rentalById(c.env.DB, rid);
    if (!r || (r.owner_id !== u.id && r.renter_id !== u.id)) return c.json({ v: '' }, 404);
    const m = await c.env.DB.prepare(`SELECT COUNT(*) n, MAX(created_at) t FROM messages WHERE rental_id IN (SELECT id FROM rentals WHERE id = ?1 OR (listing_id = ?2 AND renter_id = ?3 AND status = 'inquiry'))`).bind(r.id, r.listing_id, r.renter_id).first<{ n: number; t: number }>();
    const x = await c.env.DB.prepare(`SELECT COUNT(*) || ':' || GROUP_CONCAT(status) s FROM rental_extensions WHERE rental_id = ?`).bind(r.id).first<{ s: string }>().catch(() => null);
    v = [m?.n, m?.t, r.status, r.updated_at, r.deposit_status, r.promise_at, r.meet_spot, r.pickup_time, r.return_time, r.owner_rating, r.renter_rating, x?.s].join('|');
  } else {
    const a = await c.env.DB.prepare(`SELECT (SELECT COUNT(*) || ':' || COALESCE(MAX(created_at),0) FROM outbound_texts WHERE user_id = ?1) o, (SELECT COUNT(*) || ':' || COALESCE(MAX(created_at),0) FROM inbound_texts WHERE user_id = ?1) i, (SELECT COUNT(*) || ':' || COALESCE(MAX(created_at),0) FROM messages WHERE rental_id IN (SELECT id FROM rentals WHERE (owner_id = ?1 AND (?2 = '' OR renter_id = ?2)) OR (renter_id = ?1 AND (?2 = '' OR owner_id = ?2)))) m`).bind(u.id, wid).first<{ o: string; i: string; m: string }>().catch(() => null);
    v = [a?.o, a?.i, a?.m].join('|');
  }
  return c.json({ v }, 200, { 'cache-control': 'no-store' });
});
rentals.get('/inbox', requireUser, async (c) => {
  const u = c.get('user')!;
  const out = (await c.env.DB.prepare(`SELECT body, category, rental_id, created_at FROM outbound_texts WHERE user_id = ? AND category != 'login' ORDER BY created_at DESC LIMIT 100`).bind(u.id).all<{ body: string; category: string; rental_id: string | null; created_at: number }>()).results;
  const inn = (await c.env.DB.prepare(`SELECT body, via, created_at FROM inbound_texts WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`).bind(u.id).all<{ body: string; via: string; created_at: number }>().catch(() => ({ results: [] as { body: string; via: string; created_at: number }[] }))).results;
  const all = [...out.map(t => ({ me: false, body: t.body, rid: t.rental_id, at: t.created_at, via: '' })), ...inn.map(t => ({ me: true, body: t.body, rid: null as string | null, at: t.created_at, via: t.via }))]
    .sort((a, b) => a.at - b.at).slice(-150);
  const chats = await chatList(c.env.DB, u.id);
  /* ?with=<user>: every message between the two of them, across rentals; sending goes to the latest rental */
  const wid = c.req.query('with') || '';
  const wrows = wid ? chats.filter(r => r.owner_id === wid || r.renter_id === wid) : [];
  if (wid && !wrows.length) return c.redirect('/inbox');
  const wname = wrows.length ? firstName(wrows[0].owner_id === wid ? wrows[0].owner_name : wrows[0].renter_name) : '';
  const wmsgs = wrows.length ? (await c.env.DB.prepare(`SELECT sender_id, body, rental_id, created_at FROM messages WHERE rental_id IN (${wrows.map(() => '?').join(',')}) ORDER BY created_at`).bind(...wrows.map(r => r.id)).all<{ sender_id: string | null; body: string; rental_id: string; created_at: number }>()).results : [];
  const itemOf = (rid: string) => wrows.find(r => r.id === rid)?.item || '';
  const paused = await textsPaused(c.env, u);
  const fmtT = (t: number) => new Date(t).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  return c.html(
    <Layout title="Chats" user={u} headerCenter={<span class="sp"></span>}>
      <ChatPick rows={chats} me={u.id} cur={wid ? '/inbox?with=' + wid : '/inbox'} />
      {paused ? <a class="hint sms-only" href={smsHref(c.env, 'OK')} style="text-align:center;color:#b3261e;font-weight:700;margin:10px 12px 0;display:block">📵 Texts to your phone are paused · <u>tap to text OK</u></a> : null}
      <div class="msgs" id="inbox" style="padding:12px 12px 8px">
        {wid ? wmsgs.map(m => { const me = m.sender_id === u.id, sys = !m.sender_id; return (
          <div class={'msg' + (me ? ' me' : sys ? ' sys' : '')}>
            <div class="bub"><Linked t={m.body} /></div>
            <div class="meta">{sys ? '' : (me ? 'You' : wname) + ' · '}{fmtT(m.created_at)} · <a href={'/r/' + m.rental_id}>{itemOf(m.rental_id)}</a></div>
          </div>); }) : all.length ? all.map(m => (
          <div class={'msg' + (m.me ? ' me' : '')}>
            <div class="bub"><Linked t={m.me ? m.body : m.body.replace(/\s*\(Reply OK to get links \+ updates here\.?\)\s*$/, '')} /></div>
            <div class="meta">{m.me ? 'You' + (m.via === 'text' ? ' · by text' : '') : 'Lendo'} · {fmtT(m.at)}{m.rid ? <> · <a href={'/r/' + m.rid}>open</a></> : null}</div>
          </div>
        )) : <div class="hint" style="padding:16px 4px">Nothing here yet</div>}
        <div id="end" />
      </div>
      <form method="post" action={wid ? '/r/' + wrows[0].id + '/msg' : '/inbox'} class="compose" id="compose">
        {wid ? <input type="hidden" name="back" value={'/inbox?with=' + wid} /> : null}
        <input name="body" placeholder={wid ? `Message ${wname}` : 'Message Lendo (same as texting us)'} required maxlength={500} autocomplete="off" />
        <button type="submit" aria-label="Send" dangerouslySetInnerHTML={{ __html: SEND_SVG }} />
      </form>
      <script dangerouslySetInnerHTML={{ __html: `window.scrollTo(0, document.body.scrollHeight)` }} />
      <script src="/live.js" data-ver={'/api/chatver' + (wid ? '?with=' + wid : '')} defer></script>
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
  const pending = await c.env.DB.prepare(`SELECT COALESCE(SUM(COALESCE(payout_cents, rent_cents)),0) s FROM rentals WHERE owner_id = ? AND status IN ('confirmed','picked_up','returned','closed') AND paid_out = 0`).bind(u.id).first<{ s: number }>();
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

// ---------- Flags ----------
rentals.post('/flag', requireUser, async (c) => {
  const u = c.get('user')!; const f = await c.req.parseBody();
  const kind = String(f.kind) as FlagKind, target = String(f.id || '').slice(0, 64), back = String(f.back || '/');
  const safeBack = back.startsWith('/') && !back.startsWith('//') ? back : '/';
  let rental: string | null = f.rental ? String(f.rental).slice(0, 64) : null;
  /* must be able to see what they flag: a rental/message only by its parties */
  if (rental) { const r = await rentalById(c.env.DB, rental); if (!r || (r.owner_id !== u.id && r.renter_id !== u.id)) return c.notFound();
    if (kind === 'message') { const m = await c.env.DB.prepare('SELECT 1 FROM messages WHERE id = ? AND rental_id = ?').bind(target, rental).first(); if (!m) return c.notFound(); } }
  else if (kind === 'rental' || kind === 'message') return c.notFound();
  const fid = await createFlag(c.env, u, kind, target, String(f.reason || ''), String(f.note || '').trim().slice(0, 500), rental, c.executionCtx);
  return c.redirect(safeBack + (safeBack.includes('?') ? '&' : '?') + (fid ? 'flagged=1' : 'flagerr=1'));
});
