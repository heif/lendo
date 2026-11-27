import { shortOf } from './shortname';
// Rental state transitions + the texts they trigger. Used by web routes, Stripe webhook, Blooio webhook and cron.
import type { Env, Rental, User } from './env';
import { logErr } from './log';
import { itemLink } from './urls';
import { addMessage, busyDays, listingById, rentalById, setRentalStatus, userById } from './db';
import { textUser } from './blooio';
import { emailRequest } from './email';
import { cutoutUrl } from './cutout';
import { captureRental, payoutRental, placeDeposit, refundPart, releaseDeposit, releaseHold } from './stripe';
import { payoutOf, quote } from './money';
import { backDay, firstName, fmtDay, fmtRange, localToday, money, now } from './util';

const HOLD_HOURS = 24;

async function parties(env: Env, r: Rental) {
  const [owner, renter, listing] = await Promise.all([userById(env.DB, r.owner_id), userById(env.DB, r.renter_id), listingById(env.DB, r.listing_id)]);
  return { owner: owner!, renter: renter!, listing: listing! };
}

// card authorized → ask the owner
export async function markHeld(env: Env, r: Rental, paymentIntent: string | null, checkoutId: string | null) {
  if (r.status !== 'requested') return;
  const exp = now() + HOLD_HOURS * 3600000;
  await setRentalStatus(env.DB, r.id, 'held', { stripe_payment_intent: paymentIntent, stripe_checkout_id: checkoutId, expires_at: exp, held_at: now() });
  // booking one of the alternatives we suggested replaces the unanswered original (same customer, overlapping days)
  const originals = await env.DB.prepare(`SELECT * FROM rentals WHERE renter_id = ? AND id != ? AND status = 'held' AND alts IS NOT NULL AND end_day >= ? AND start_day <= ?`)
    .bind(r.renter_id, r.id, r.start_day, r.end_day).all<Rental>();
  for (const o of originals.results) {
    if (!(JSON.parse(o.alts || '[]') as string[]).includes(r.listing_id)) continue;
    await decline(env, o, 'canceled');
    const op = await parties(env, o);
    await textUser(env, op.owner, `${firstName(op.renter.name)} found another ${op.listing.name} nearby, so that request is canceled`, 'rental', o.id);
  }
  const { owner, renter, listing } = await parties(env, r);
  const url = `${env.APP_URL}/r/${r.id}`;
  const sibs = await heldTogether(env, r); /* an add-on: another request to this owner for the same days is already waiting */
  await addMessage(env, r.id, null, `${firstName(renter.name)} requested ${fmtRange(r.start_day, r.end_day)} · card held · waiting for ${firstName(owner.name)}`, 'system');
  /* the request goes by email at the same time as the text, always (Scott, 11/24) */
  const ph = await env.DB.prepare('SELECT r2_key FROM photos WHERE listing_id = ? ORDER BY pos LIMIT 1').bind(listing.id).first<{ r2_key: string }>().catch(() => null);
  const em = await emailRequest(env, r, owner, renter, listing, money(payoutOf(r)), ph ? cutoutUrl(env, ph.r2_key, 160, 160) : null).catch(async e => { await logErr(env.DB, 'request email', e, { rental: r.id }); return { ok: false }; });
  if (sibs.length) {
    /* one answer covers them all: a plain YES/NO by text answers every request from this customer for these days (webhooks.ts) */
    await textUser(env, owner, `${firstName(renter.name)} also wants your ${shortOf(listing)}, same days. You'd earn ${money(payoutOf(r))} more. Reply YES or NO for all ${sibs.length + 1} ${url}`, 'rental', r.id, { emailed: em.ok });
    return; /* the customer just added it on the site: no second "requested" text */
  }
  await textUser(env, owner, `${firstName(renter.name)} wants your ${shortOf(listing)} ${fmtRange(r.start_day, r.end_day)}. You'd earn ${money(payoutOf(r))}. Reply YES with a pickup time, like "YES 6pm", or NO ${url}`, 'rental', r.id, { emailed: em.ok });
  /* up to 3 of the owner's other items free those days: "add another" (Scott, 11/25) */
  const others: string[] = [];
  for (const x of (await env.DB.prepare(`SELECT id, name FROM listings WHERE owner_id = ? AND status = 'live' AND id != ? ORDER BY created_at DESC LIMIT 12`).bind(r.owner_id, r.listing_id).all<{ id: string; name: string }>()).results) {
    if (others.length >= 3) break;
    if (!(await busyDays(env.DB, x.id, r.start_day, r.end_day)).size) others.push(x.name);
  }
  const addLine = others.length ? ` · add another from ${firstName(owner.name)} same days? ${others.join(', ')}` : '';
  await textUser(env, renter, `Requested ${shortOf(listing)} from ${firstName(owner.name)} for ${fmtRange(r.start_day, r.end_day)} · card held, not charged, until they say yes${addLine} ${url}`, 'rental', r.id);
}

/** other requests still waiting from the same customer to the same owner for the same days ("add another from Scott", 11/25) */
export async function heldTogether(env: Env, r: Rental): Promise<Rental[]> {
  return (await env.DB.prepare(`SELECT * FROM rentals WHERE owner_id = ? AND renter_id = ? AND start_day = ? AND end_day = ? AND status = 'held' AND id != ? ORDER BY created_at`)
    .bind(r.owner_id, r.renter_id, r.start_day, r.end_day, r.id).all<Rental>()).results;
}

// rentCents: owner's "Give a discount" — any amount from the requested rent down to 0, never higher.
// quiet: an add-on answered together with another request: same money steps, no texts (the caller sends one summary)
/* quiet: true = no texts at all; 'customer' = owner texts only (the caller sends the customer one combined text) */
/* '18:30' → '6:30 PM' */
export const hm12 = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
/* a time an owner texts with YES: "6", "6pm", "6:30", "630p" → '18:30'. No am/pm: 1–9 = PM, 10–11 = AM, 12 = noon */
export function parseHM(raw: string): string | null {
  const m = raw.trim().toLowerCase().match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm|a|p)?$/); if (!m) return null;
  let h = +m[1]; const mi = m[2] ? +m[2] : 0; if (h < 1 || h > 12 || mi > 59) return null;
  const ap = m[3]?.[0]; if (ap === 'p' && h < 12) h += 12; else if (ap === 'a' && h === 12) h = 0; else if (!ap && h <= 9) h += 12;
  return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
}
export async function accept(env: Env, r0: Rental, rentCents?: number, quiet?: boolean | 'customer'): Promise<boolean> {
  if (r0.status !== 'held') return false;
  let r = r0;
  if (rentCents != null && rentCents >= 0 && rentCents < r0.rent_cents) {
    // same rule as at request: credit off the rent, tax on rent after credit, fee (on the rent only) from the owner's side; free = no tax, no fee
    const q = quote(env, rentCents, r0.credit_cents, r0.tax_rate || 0);
    await env.DB.prepare('UPDATE rentals SET list_rent_cents = COALESCE(list_rent_cents, rent_cents), rent_cents = ?, fee_cents = ?, total_cents = ?, credit_cents = ?, tax_cents = ?, payout_cents = ? WHERE id = ?').bind(q.rent, q.fee, q.total, q.credit, q.tax, q.payout, r0.id).run();
    r = { ...r0, rent_cents: q.rent, fee_cents: q.fee, total_cents: q.total, credit_cents: q.credit, tax_cents: q.tax, payout_cents: q.payout };
  }
  const { owner, renter, listing } = await parties(env, r);
  let how: string;
  try { how = await captureRental(env, r); } catch (e) { await logErr(env.DB, 'capture failed', e, { rental: r.id }); return false; }
  await setRentalStatus(env.DB, r.id, 'confirmed', { expires_at: null });
  const url = `${env.APP_URL}/r/${r.id}`;
  const paidLine = r.total_cents <= 0 || how === 'released' ? 'free — nothing charged' : `${money(r.total_cents)} paid`;
  await addMessage(env, r.id, null, `${firstName(owner.name)} said yes · ${paidLine} · set a pickup time`, 'system');
  const spot = owner.pickup_spots ? ` Meet: ${(JSON.parse(owner.pickup_spots) as string[]).join(' or ')}` : '';
  if (quiet === true) return true;
  const gift = r.rent_cents === 0 ? ` ${firstName(owner.name)} is lending it to you free!` : r0.rent_cents > r.rent_cents ? ` ${firstName(owner.name)} gave you a discount` : '';
  // owner is asked for a pickup time right after YES (no pickup hours); their reply relays to the customer, SKIP leaves it to the customer
  /* one text: yes + paid + pickup day + spot + hold; the time follows when the owner replies one */
  const holdNote = (r.deposit_cents || 0) > 0 ? ` · ${money(r.deposit_cents!)} card hold (like a hotel check-in, not a charge) at pickup, off after an on-time return` : '';
  if (!quiet) await textUser(env, renter, `${firstName(owner.name)} said yes!${gift} · ${paidLine} · pickup ${fmtDay(r.start_day)}${r.pickup_time ? ' ' + hm12(r.pickup_time) : ''}${spot ? ' ·' + spot.replace(' Meet:', ' at') : ''}${r.pickup_time ? ' · back ' + fmtDay(backDay(r.end_day)) + ' ' + hm12(r.return_time || r.pickup_time) + ' (late = 1 day\'s rent per day, from the hold)' : ' (time coming from ' + firstName(owner.name) + ')'}${holdNote} · next: sign your promise (3 quick checks) ${url}#promise`, 'money', r.id);
  await textUser(env, owner, `${r.rent_cents === 0 ? 'Done — lending it free' : `Done. ${firstName(renter.name)} paid`}. When can ${firstName(renter.name)} pick it up? Reply a time (like "after 6"), or SKIP`, 'rental', r.id);
  if (!owner.stripe_account_id && r.rent_cents > 0) {
    await textUser(env, owner, `Where should your ${money(payoutOf(r))} go? Add a debit card or bank, takes 30 sec: ${env.APP_URL}/payout`, 'money', r.id);
  }
  return true;
}

export async function decline(env: Env, r: Rental, reason: 'declined' | 'expired' | 'canceled', quiet?: boolean) {
  if (r.status !== 'held' && r.status !== 'requested') return false;
  await releaseHold(env, r);
  await setRentalStatus(env.DB, r.id, reason, { expires_at: null });
  const { owner, renter, listing } = await parties(env, r);
  const why = reason === 'declined' ? `${firstName(owner.name)} can't do those days` : reason === 'expired' ? `${firstName(owner.name)} didn't answer in time` : 'request canceled';
  await addMessage(env, r.id, null, `${why} · hold released, nothing charged`, 'system');
  if (reason !== 'canceled' && !quiet) await textUser(env, renter, `${shortOf(listing)}: ${why}. Nothing was charged. Browse more: ${env.APP_URL}/`, 'rental', r.id);
  return true;
}

// Customer cancels. Before the owner's YES: full release. After YES, before pickup: 50% back, owner keeps half the rent.
export async function customerCancel(env: Env, r: Rental): Promise<'released' | 'half' | false> {
  const { owner, renter, listing } = await parties(env, r);
  if (r.status === 'held' || r.status === 'requested') {
    await decline(env, r, 'canceled');
    if (r.status === 'held') await textUser(env, owner, `${firstName(renter.name)} canceled the request for your ${shortOf(listing)}`, 'rental', r.id);
    return 'released';
  }
  if (r.status !== 'confirmed') return false;
  await releaseDeposit(env, r);
  const refund = Math.round(r.total_cents * 0.5);
  const paid = r.total_cents >= 50; /* nothing was charged on a free / near-free rental */
  if (paid) { try { await refundPart(env, r, refund); } catch (e) { await logErr(env.DB, 'late cancel refund failed', e, { rental: r.id }); return false; } }
  const charged = paid ? Math.max(0, r.total_cents - refund) : 0;
  // half of everything stays: half the rent (and its tax) → owner gets that minus the fee on it
  const keepRent = paid ? Math.round(r.rent_cents * 0.5) : 0, keepTax = paid ? Math.round((r.tax_cents || 0) * 0.5) : 0;
  const legacy = r.payout_cents == null; /* booked before Nov 13: customer paid the fee, owner gets the rent */
  const ownerFee = legacy ? Math.max(0, charged - keepRent) : keepRent > 0 ? Math.min(keepRent, Math.round((r.fee_cents || 0) * 0.5)) : 0; /* half the fee this rental was booked with (rent-only since 11/25; rent + tax before) */
  const keep = legacy ? keepRent : Math.max(0, keepRent - ownerFee);
  await setRentalStatus(env.DB, r.id, 'canceled', { late_cancel: 1, rent_cents: keepRent, tax_cents: keepTax, fee_cents: ownerFee, payout_cents: legacy ? null : keep, total_cents: charged });
  const fresh = (await rentalById(env.DB, r.id))!;
  await addMessage(env, r.id, null, `${firstName(renter.name)} canceled after the yes · ${money(refund)} refunded · ${firstName(owner.name)} keeps ${money(keep)}`, 'system');
  try { await payoutRental(env, fresh, owner); } catch (e) { await logErr(env.DB, 'late cancel payout failed', e, { rental: r.id }); }
  await textUser(env, owner, `${firstName(renter.name)} canceled the ${shortOf(listing)} rental — you keep ${money(keep)}`, 'money', r.id);
  await textUser(env, renter, `Canceled. ${money(refund)} back to your card (half, since ${firstName(owner.name)} had already said yes)`, 'money', r.id);
  return 'half';
}

export async function pickedUp(env: Env, r: Rental, photoKey: string | null) {
  if (r.status !== 'confirmed') return false;
  if (r.deposit_status === 'due' || r.deposit_status === 'failed') await holdDeposit(env, r); /* owner was shown the hold state before handing over */
  await setRentalStatus(env.DB, r.id, 'picked_up', { pickup_photo_key: photoKey });
  const { owner, renter, listing } = await parties(env, r);
  await addMessage(env, r.id, null, photoKey ? `${firstName(owner.name)} took the pickup photo · time-stamped, you both have it` : `Picked up`, 'system');
  await textUser(env, renter, `You've got the ${shortOf(listing)} · back ${fmtDay(backDay(r.end_day))}${r.pickup_time ? ' around the same time' : ''} · reply OK to confirm`, 'pickup', r.id);
  try { if (await payoutRental(env, r, owner)) await textUser(env, owner, `${money(payoutOf(r))} is on its way to your account`, 'money', r.id); } catch (e) { await logErr(env.DB, 'payout failed', e, { rental: r.id }); }
  return true;
}

export async function returned(env: Env, r: Rental, photoKey: string | null) {
  if (r.status !== 'picked_up' && r.status !== 'confirmed') return false;
  await setRentalStatus(env.DB, r.id, 'returned', { return_photo_key: photoKey, returned_at: now() });
  const { owner, renter, listing } = await parties(env, r);
  const url = `${env.APP_URL}/r/${r.id}`;
  /* the hold stays 24h after return so the owner can check the item: "All good" releases it now, "Report a problem" opens a claim (claims.ts) */
  const held = r.deposit_status === 'held', dep = money(r.deposit_cents || 0);
  await addMessage(env, r.id, null, `${firstName(owner.name)} confirmed the return · rate each other${held ? ` · ${dep} hold released within 24h` : ''}`, 'system');
  await textUser(env, renter, `${firstName(owner.name)} confirmed the return.${held ? ` Your ${dep} hold is released within 24h.` : ''} How was the ${shortOf(listing)}? Rate it: ${url}`, 'rental', r.id);
  await textUser(env, owner, `Returned. ${held ? `All good? Release ${firstName(renter.name)}'s ${dep} hold, or report a problem within 24h: ${url}` : `How was ${firstName(renter.name)}? Rate them: ${url}`}`, 'rental', r.id);
  return true;
}

// Owner says the item came back fine (or 24h passed with no claim): the hold comes off.
export async function allGood(env: Env, r: Rental, by: 'owner' | 'clock'): Promise<boolean> {
  if ((r.status !== 'returned' && r.status !== 'closed') || r.deposit_status !== 'held') return false;
  if (await env.DB.prepare(`SELECT 1 FROM claims WHERE rental_id = ? AND status != 'withdrawn'`).bind(r.id).first().catch(() => null)) return false;
  await releaseDeposit(env, r);
  const { owner, renter, listing } = await parties(env, r);
  await addMessage(env, r.id, null, by === 'owner' ? `${firstName(owner.name)} says all good · ${money(r.deposit_cents!)} hold released` : `${money(r.deposit_cents!)} hold released`, 'system');
  await textUser(env, renter, `Your ${money(r.deposit_cents!)} hold for the ${shortOf(listing)} is released. Your bank drops it within a few days`, 'money', r.id);
  return true;
}

export async function rate(env: Env, r: Rental, by: User, stars: number, review: string) {
  const isOwner = by.id === r.owner_id;
  const col = isOwner ? 'owner' : 'renter';
  await env.DB.prepare(`UPDATE rentals SET ${col}_rating = ?, ${col}_review = ?, updated_at = ? WHERE id = ?`).bind(stars, review || null, now(), r.id).run();
  const fresh = (await rentalById(env.DB, r.id))!;
  if (fresh.owner_rating && fresh.renter_rating && fresh.status === 'returned') await setRentalStatus(env.DB, r.id, 'closed');
}

// relay a chat message to the other party by text
export async function relay(env: Env, r: Rental, from: User, body: string, via: 'web' | 'text') {
  await addMessage(env, r.id, from.id, body, via);
  const toId = from.id === r.owner_id ? r.renter_id : r.owner_id;
  const to = (await userById(env.DB, toId))!;
  const res = await textUser(env, to, `${firstName(from.name)}: ${body}\n\nChat: ${env.APP_URL}/r/${r.id}`, 'chat', r.id); /* link back to the chat on Lendo */ /* a person's words: no confirm ask; a reply goes back to them */
  /* didn't reach their phone (paused / STOP): tell the sender instead of silence */
  if (via === 'text' && !res?.ok) await textUser(env, from, `${firstName(to.name)} isn't getting texts right now — your message is in the chat ${env.APP_URL}/r/${r.id}`, 'rental', r.id);
}

// the rental a texter most likely means (newest active one they're part of)
export async function activeRentalFor(env: Env, uid: string, statuses: Rental['status'][] = ['held', 'confirmed', 'picked_up', 'returned']) {
  const q = `SELECT * FROM rentals WHERE (owner_id = ? OR renter_id = ?) AND status IN (${statuses.map(() => '?').join(',')}) ORDER BY updated_at DESC LIMIT 1`;
  return env.DB.prepare(q).bind(uid, uid, ...statuses).first<Rental>();
}

// Owner hasn't answered: re-text at 30 min, 1 h, 2 h. At 4 h, text the customer similar items nearby (request stays open).
const NUDGE_AT = [30, 60, 120].map(m => m * 60000);
const ALTS_AT = 4 * 3600000;
export async function chaseHolds(env: Env) {
  const rows = (await env.DB.prepare(`SELECT * FROM rentals WHERE status = 'held' AND held_at IS NOT NULL`).all<Rental>()).results;
  let sent = 0;
  for (const r of rows) {
    const age = now() - (r.held_at || now());
    const due = NUDGE_AT.filter(t => age >= t).length;
    if (due > r.owner_nudges) {
      const { owner, renter, listing } = await parties(env, r);
      await textUser(env, owner, `${firstName(renter.name)} is still waiting on your ${shortOf(listing)} for ${fmtRange(r.start_day, r.end_day)} — reply YES or NO ${env.APP_URL}/r/${r.id}`, 'rental', r.id);
      await env.DB.prepare('UPDATE rentals SET owner_nudges = ? WHERE id = ?').bind(due, r.id).run();
      sent++;
    }
    if (age >= ALTS_AT && r.alts == null) {
      const { owner, renter, listing } = await parties(env, r);
      const alts = await similarNearby(env, r, listing);
      await env.DB.prepare('UPDATE rentals SET alts = ? WHERE id = ?').bind(JSON.stringify(alts.map(a => a.id)), r.id).run();
      if (alts.length) {
        const lines = (await Promise.all(alts.map(async a => `${a.name} ${money(a.price_cents)}/day ${await itemLink(env, a.id)}`))).join('\n');
        await textUser(env, renter, `${firstName(owner.name)} hasn't answered yet. Similar nearby, free those days:\n${lines}\nYour first request stays open too`, 'rental', r.id);
        sent++;
      }
    }
  }
  return sent;
}

// up to 3 live listings like this one within ~2 km, other owners, free for the requested days
async function similarNearby(env: Env, r: Rental, listing: { id: string; name: string; emoji: string | null; avatar_key: string | null; lat: number | null; lng: number | null; owner_id: string }) {
  if (listing.lat == null || listing.lng == null) return [];
  const d = 0.02;
  const cands = (await env.DB.prepare(`SELECT id, name, emoji, avatar_key, price_cents, lat, lng FROM listings WHERE status = 'live' AND owner_id != ? AND id != ? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`)
    .bind(listing.owner_id, listing.id, listing.lat - d, listing.lat + d, listing.lng - d * 1.3, listing.lng + d * 1.3).all<{ id: string; name: string; emoji: string | null; avatar_key: string | null; price_cents: number; lat: number; lng: number }>()).results;
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3);
  const mine = new Set(words(listing.name));
  const alike = cands.filter(c => words(c.name).some(w => mine.has(w)) || (listing.avatar_key && c.avatar_key === listing.avatar_key) || (listing.emoji && listing.emoji !== '📦' && c.emoji === listing.emoji));
  alike.sort((a, b) => Math.hypot(a.lat - listing.lat!, a.lng - listing.lng!) - Math.hypot(b.lat - listing.lat!, b.lng - listing.lng!));
  const out = [];
  for (const c of alike) {
    const busy = await busyDays(env.DB, c.id, r.start_day, r.end_day);
    if (!busy.size) out.push(c);
    if (out.length >= 3) break;
  }
  return out;
}

export async function expireHolds(env: Env) {
  const rows = await env.DB.prepare(`SELECT * FROM rentals WHERE status = 'held' AND expires_at IS NOT NULL AND expires_at < ?`).bind(now()).all<Rental>();
  for (const r of rows.results) await decline(env, r, 'expired');
  // abandoned checkouts
  await env.DB.prepare(`UPDATE rentals SET status = 'canceled', updated_at = ? WHERE status = 'requested' AND created_at < ?`).bind(now(), now() - 2 * 3600000).run();
  return rows.results.length;
}

// Promise reminder: a confirmed customer who hasn't signed an hour after the YES gets one text
export async function nudgePromises(env: Env) {
  const rows = (await env.DB.prepare(`SELECT r.id, r.renter_id, r.owner_id, r.promise_nudged, r.updated_at FROM rentals r
    WHERE r.status = 'confirmed' AND r.promise_at IS NULL AND r.promise_nudged < 1 AND r.updated_at < ? LIMIT 20`).bind(Date.now() - 3600e3).all<{ id: string; renter_id: string; owner_id: string; promise_nudged: number; updated_at: number }>().catch(() => ({ results: [] as any[] }))).results;
  for (const r of rows) {
    const cu = await userById(env.DB, r.renter_id), ow = await userById(env.DB, r.owner_id); if (!cu || !ow) continue;
    await textUser(env, cu, `Before pickup: sign your promise to ${firstName(ow.name) || 'the owner'} (3 quick checks) ${env.APP_URL}/r/${r.id}#promise`, 'rental');
    await env.DB.prepare('UPDATE rentals SET promise_nudged = promise_nudged + 1 WHERE id = ?').bind(r.id).run();
  }
}

// Deposit hold (the item's value): place it (pickup day / Handed over / new card) and tell both sides. Returns the hold state.
export async function holdDeposit(env: Env, r: Rental): Promise<'held' | 'failed' | 'skip'> {
  const res = await placeDeposit(env, r);
  if (res === 'skip') return res;
  const { owner, renter, listing } = await parties(env, r);
  if (res === 'held') {
    await addMessage(env, r.id, null, `${money(r.deposit_cents!)} hold on ${firstName(renter.name)}'s card · OK to hand over`, 'system');
    await textUser(env, renter, `${money(r.deposit_cents!)} hold (not a charge) is on your card until the ${shortOf(listing)} is back with ${firstName(owner.name)}. Reply OK to confirm`, 'money', r.id);
  } else {
    await addMessage(env, r.id, null, `${firstName(renter.name)}'s card didn't take the ${money(r.deposit_cents!)} hold · hold off on handing it over`, 'system');
    await textUser(env, renter, `Your card didn't take the ${money(r.deposit_cents!)} hold for the ${shortOf(listing)}. Add a card so ${firstName(owner.name)} can hand it over: ${env.APP_URL}/r/${r.id}/card`, 'money', r.id);
  }
  return res;
}

// cron: holds due on pickup day (owner's local date); renew holds older than 6 days while the item is out or a claim is open
// (card auths lapse ~7 days); release holds 24h after return when no problem was reported
export async function depositsDue(env: Env): Promise<number> {
  let n = 0;
  const due = await env.DB.prepare(`SELECT r.* FROM rentals r WHERE r.status = 'confirmed' AND r.deposit_status = 'due' AND r.start_day <= ? LIMIT 20`).bind(localToday()).all<Rental>();
  for (const r of due.results) { try { await holdDeposit(env, r); n++; } catch (e) { await logErr(env.DB, 'deposit due', e, { rental: r.id }); } }
  const old = await env.DB.prepare(`SELECT * FROM rentals WHERE deposit_status = 'held' AND deposit_at < ? AND (status = 'picked_up' OR id IN (SELECT rental_id FROM claims WHERE status IN ('response','rebuttal','reply','judging','ruled','reviewing'))) LIMIT 20`).bind(Date.now() - 6 * 86400000).all<Rental>();
  for (const r of old.results) { try { await placeDeposit(env, r, true); n++; } catch (e) { await logErr(env.DB, 'deposit renew', e, { rental: r.id }); } }
  const back = await env.DB.prepare(`SELECT * FROM rentals WHERE status IN ('returned','closed') AND deposit_status = 'held' AND COALESCE(returned_at, updated_at) < ? AND id NOT IN (SELECT rental_id FROM claims WHERE status != 'withdrawn') LIMIT 20`).bind(Date.now() - 24 * 3600000).all<Rental>();
  for (const r of back.results) { try { if (await allGood(env, r, 'clock')) n++; } catch (e) { await logErr(env.DB, 'deposit release', e, { rental: r.id }); } }
  /* returned with a hold that never went on (card didn't take it, or handed back early): nothing to release, close it out */
  await env.DB.prepare(`UPDATE rentals SET deposit_status = 'released' WHERE status IN ('returned','closed') AND deposit_status IN ('due','failed') AND COALESCE(returned_at, updated_at) < ? AND id NOT IN (SELECT rental_id FROM claims WHERE status != 'withdrawn')`).bind(Date.now() - 24 * 3600000).run();
  return n;
}
