// Extend a rental (option A): customer picks a later return day on the rental page.
// Same money pattern as a rental: card hold → owner YES → capture (+ extra rent to owner) | NO / 24h → hold released.
// Blocked when any of the extra days (plus the buffer day after) is taken.
import Stripe from 'stripe';
import { logErr, logEvent } from './log';
import type { Env, Rental } from './env';
import { addMessage, listingById, rentalById, userById } from './db';
import { textUser } from './blooio';
import { stripe } from './stripe';
import { payoutOf, quote } from './money';
import { addDays, daysBetween, firstName, fmtDay, id, money, now, rentFor } from './util';

export type Ext = { id: string; rental_id: string; listing_id: string; from_day: string; new_end: string; days: number; rent_cents: number; fee_cents: number; total_cents: number; tax_cents?: number; payout_cents?: number | null; status: 'requested' | 'held' | 'confirmed' | 'declined' | 'expired' | 'canceled'; stripe_checkout_id: string | null; stripe_payment_intent: string | null; paid_out: number; expires_at: number | null; created_at: number; updated_at: number };
const HOLD_HOURS = 24;
export const EXT_MAX_DAYS = 14;

export const extById = (env: Env, xid: string) => env.DB.prepare('SELECT * FROM rental_extensions WHERE id = ?').bind(xid).first<Ext>();
export const openExt = (env: Env, rid: string) => env.DB.prepare(`SELECT * FROM rental_extensions WHERE rental_id = ? AND status IN ('requested','held') ORDER BY created_at DESC LIMIT 1`).bind(rid).first<Ext>().catch(() => null);

// Days after the current return day that can be the new return day: walk forward, stop at the first taken day.
// Taken = blocked by the owner, or another rental / held extension incl. its buffer day (so a free day always sits between rentals).
export async function extendableDays(env: Env, r: Rental): Promise<string[]> {
  const from = addDays(r.end_day, 1), to = addDays(r.end_day, EXT_MAX_DAYS), taken = new Set<string>();
  const add = (a: string, b: string) => { for (let d = a; d <= b; d = addDays(d, 1)) taken.add(d); };
  for (const b of (await env.DB.prepare('SELECT day FROM blocked_days WHERE listing_id = ? AND day BETWEEN ? AND ?').bind(r.listing_id, from, to).all<{ day: string }>()).results) taken.add(b.day);
  for (const o of (await env.DB.prepare(`SELECT start_day, end_day FROM rentals WHERE listing_id = ? AND id != ? AND status IN ('held','confirmed','picked_up') AND end_day >= ? AND start_day <= ?`).bind(r.listing_id, r.id, addDays(from, -1), addDays(to, 1)).all<{ start_day: string; end_day: string }>()).results) add(addDays(o.start_day, -1), addDays(o.end_day, 1));
  for (const o of (await env.DB.prepare(`SELECT from_day, new_end FROM rental_extensions WHERE listing_id = ? AND rental_id != ? AND status = 'held' AND new_end >= ? AND from_day <= ?`).bind(r.listing_id, r.id, addDays(from, -1), addDays(to, 1)).all<{ from_day: string; new_end: string }>().catch(() => ({ results: [] as { from_day: string; new_end: string }[] }))).results) add(o.from_day, addDays(o.new_end, 1));
  const out: string[] = [];
  for (let d = from; d <= to && !taken.has(d); d = addDays(d, 1)) out.push(d);
  return out;
}

export function extPrice(env: Env, r: Rental, priceCents: number, weekCents: number | null, newEnd: string) {
  const days = daysBetween(addDays(r.end_day, 1), newEnd);
  const list = rentFor(r.days, priceCents, weekCents);
  // owner gave this rental a lower price (or free) → the extra days follow the same rate
  const rent = r.rent_cents < list ? Math.round((r.days ? r.rent_cents / r.days : 0) * days) : Math.max(0, rentFor(r.days + days, priceCents, weekCents) - list);
  const q = quote(env, rent, 0, r.tax_rate || 0); /* same tax rate as the rental; fee comes out of the owner's side */
  return { days, rent, tax: q.tax, fee: q.fee, total: q.total, payout: q.payout };
}

// customer asks → Checkout (card hold). Returns a URL to send them to.
export async function askExtension(env: Env, r: Rental, newEnd: string): Promise<{ url: string } | { error: string }> {
  // only once it's picked up: before that, a late cancel refunds against the rental's own charge only
  if (r.status !== 'picked_up') return { error: 'You can extend once you have it' };
  if (await openExt(env, r.id)) return { error: 'There’s already a request waiting for an answer' };
  const ok = await extendableDays(env, r);
  if (!ok.includes(newEnd)) return { error: 'Those days are taken. Pick an earlier day' };
  const it = (await listingById(env.DB, r.listing_id))!;
  const p = extPrice(env, r, it.price_cents, it.week_cents, newEnd);
  const xid = id('x'), t = now();
  await env.DB.prepare(`INSERT INTO rental_extensions (id, rental_id, listing_id, from_day, new_end, days, rent_cents, fee_cents, total_cents, tax_cents, payout_cents, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'requested',?,?)`)
    .bind(xid, r.id, r.listing_id, addDays(r.end_day, 1), newEnd, p.days, p.rent, p.fee, p.total, p.tax, p.payout, t, t).run();
  const s = stripe(env);
  if (!s || p.total < 50) { await markExtHeld(env, xid, null, null); return { url: `/r/${r.id}?ext=1` }; }
  const session = await s.checkout.sessions.create({
    mode: 'payment',
    client_reference_id: xid,
    line_items: [
      { quantity: 1, price_data: { currency: 'usd', unit_amount: p.rent, product_data: { name: `${it.name} · ${p.days} more day${p.days === 1 ? '' : 's'}` } } },
      ...(p.tax > 0 ? [{ quantity: 1, price_data: { currency: 'usd', unit_amount: p.tax, product_data: { name: `Sales tax (${+(r.tax_rate * 100).toFixed(3)}%)` } } }] : []),
    ],
    payment_intent_data: { capture_method: 'manual', metadata: { ext_id: xid, rental_id_ext: r.id }, description: `Lendo extension ${xid} of ${r.id}` },
    metadata: { ext_id: xid },
    success_url: `${env.APP_URL}/r/${r.id}?ext=1`,
    cancel_url: `${env.APP_URL}/r/${r.id}`,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
  });
  await env.DB.prepare('UPDATE rental_extensions SET stripe_checkout_id = ? WHERE id = ?').bind(session.id, xid).run();
  await logEvent(env.DB, 'ext.requested', { rental: r.id, cents: p.total, data: { ext: xid, new_end: newEnd, rent: p.rent, tax: p.tax, session: session.id } });
  return { url: session.url! };
}

// card held → ask the owner
export async function markExtHeld(env: Env, xid: string, pi: string | null, cs: string | null) {
  const x = await extById(env, xid); if (!x || x.status !== 'requested') return;
  // a double submit can leave two paid checkouts: keep the first held one, release the other
  const other = await env.DB.prepare(`SELECT 1 FROM rental_extensions WHERE rental_id = ? AND status = 'held' AND id != ?`).bind(x.rental_id, x.id).first();
  if (other) { await env.DB.prepare(`UPDATE rental_extensions SET stripe_payment_intent = ? WHERE id = ?`).bind(pi, xid).run(); await declineExt(env, { ...x, stripe_payment_intent: pi }, 'canceled'); return; }
  await env.DB.prepare(`UPDATE rental_extensions SET status = 'held', stripe_payment_intent = ?, stripe_checkout_id = COALESCE(?, stripe_checkout_id), expires_at = ?, updated_at = ? WHERE id = ?`).bind(pi, cs, now() + HOLD_HOURS * 3600000, now(), xid).run();
  const r = (await rentalById(env.DB, x.rental_id))!;
  const [owner, cust, it] = await Promise.all([userById(env.DB, r.owner_id), userById(env.DB, r.renter_id), listingById(env.DB, r.listing_id)]);
  await addMessage(env, r.id, null, `${firstName(cust!.name)} asked to keep it until ${fmtDay(x.new_end)} (+${x.days} day${x.days === 1 ? '' : 's'})`, 'system');
  await textUser(env, owner!, `${firstName(cust!.name)} wants to keep your ${it!.name} until ${fmtDay(x.new_end)} · you'd earn ${money(payoutOf(x))} more. Reply YES or NO`, 'rental', r.id);
}

// owner YES → capture, move the return day, pay the owner the extra rent
export async function acceptExt(env: Env, x: Ext): Promise<boolean> {
  if (x.status !== 'held') return false;
  const r = (await rentalById(env.DB, x.rental_id))!;
  // rental moved on, or another extension already changed the return day → release this hold
  if (r.status !== 'picked_up' || x.from_day !== addDays(r.end_day, 1)) { await declineExt(env, x, 'canceled'); return false; }
  // claim the row first so a double YES can't capture twice
  const claim = await env.DB.prepare(`UPDATE rental_extensions SET status = 'confirmed', updated_at = ? WHERE id = ? AND status = 'held'`).bind(now(), x.id).run();
  if (!claim.meta.changes) return false;
  await logEvent(env.DB, 'ext.confirmed', { rental: r.id, cents: x.total_cents, data: { ext: x.id, new_end: x.new_end } });
  const s = stripe(env);
  if (s && x.stripe_payment_intent) {
    try {
      if (x.total_cents < 50) await s.paymentIntents.cancel(x.stripe_payment_intent);
      else { await s.paymentIntents.capture(x.stripe_payment_intent, { amount_to_capture: x.total_cents }, { idempotencyKey: `extcap_${x.id}` }); await logEvent(env.DB, 'money.capture', { rental: r.id, cents: x.total_cents, data: { ext: x.id, pi: x.stripe_payment_intent } }); }
    } catch (e) {
      await logErr(env.DB, 'ext capture', e, { rental: r.id });
      await env.DB.prepare(`UPDATE rental_extensions SET status = 'expired', updated_at = ? WHERE id = ?`).bind(now(), x.id).run();
      const cust = (await userById(env.DB, r.renter_id))!;
      await textUser(env, cust, `The card hold for the extra days ran out, so it wasn't extended · return day stays ${fmtDay(r.end_day)}`, 'rental', r.id);
      return false;
    }
  }
  await env.DB.prepare('UPDATE rentals SET end_day = ?, days = days + ?, updated_at = ? WHERE id = ?').bind(x.new_end, x.days, now(), r.id).run();
  const [owner, cust, it] = await Promise.all([userById(env.DB, r.owner_id), userById(env.DB, r.renter_id), listingById(env.DB, r.listing_id)]);
  // extra rent → owner (same rule as rentals: only when there's something to send and they're connected; else flushed later by hand)
  if (s && owner!.stripe_account_id && payoutOf(x) > 0 && x.total_cents >= 50) {
    try {
      await s.transfers.create({ amount: payoutOf(x), currency: 'usd', destination: owner!.stripe_account_id, transfer_group: r.id, metadata: { rental_id: r.id, ext_id: x.id } }, { idempotencyKey: `payout_${x.id}` });
      await env.DB.prepare('UPDATE rental_extensions SET paid_out = 1 WHERE id = ?').bind(x.id).run();
      await logEvent(env.DB, 'money.payout', { rental: r.id, user: owner!.id, cents: payoutOf(x), data: { ext: x.id } });
    } catch (e) { await logErr(env.DB, 'ext payout', e, { rental: r.id }); }
  }
  await addMessage(env, r.id, null, `Extended · now due back ${fmtDay(x.new_end)}`, 'system');
  await textUser(env, cust!, `${firstName(owner!.name)} said yes · keep the ${it!.name} until ${fmtDay(x.new_end)}${x.total_cents >= 50 ? ` · ${money(x.total_cents)} charged` : ''}`, 'money', r.id);
  await textUser(env, owner!, `Done · ${firstName(cust!.name)} brings it back ${fmtDay(x.new_end)}`, 'rental', r.id);
  return true;
}

export async function declineExt(env: Env, x: Ext, why: 'declined' | 'expired' | 'canceled') {
  const claim = await env.DB.prepare(`UPDATE rental_extensions SET status = ?, updated_at = ? WHERE id = ? AND status IN ('requested','held')`).bind(why, now(), x.id).run();
  if (!claim.meta.changes) return;
  await logEvent(env.DB, 'ext.' + why, { rental: x.rental_id, data: { ext: x.id } });
  const s = stripe(env);
  if (s && x.stripe_payment_intent) { try { await s.paymentIntents.cancel(x.stripe_payment_intent); } catch (e) { console.error('ext release failed', e); } }
  if (x.status !== 'held') return; // never got to the owner: nothing to tell anyone
  const r = (await rentalById(env.DB, x.rental_id))!;
  const [owner, cust] = await Promise.all([userById(env.DB, r.owner_id), userById(env.DB, r.renter_id)]);
  await addMessage(env, r.id, null, `Not extended · due back ${fmtDay(r.end_day)}`, 'system');
  await textUser(env, cust!, `${why === 'declined' ? `${firstName(owner!.name)} can't do the extra days` : 'No answer on the extra days'} · nothing charged · due back ${fmtDay(r.end_day)}`, 'rental', r.id);
}

// owner's YES/NO by text: the newest held extension on one of their rentals
export const heldExtForOwner = (env: Env, ownerId: string) => env.DB.prepare(`SELECT x.* FROM rental_extensions x JOIN rentals r ON r.id = x.rental_id WHERE r.owner_id = ? AND x.status = 'held' ORDER BY x.created_at DESC LIMIT 1`).bind(ownerId).first<Ext>().catch(() => null);

// cron: holds unanswered for 24h → released; abandoned checkouts (>1h) → canceled
export async function expireExtensions(env: Env) {
  const rows = (await env.DB.prepare(`SELECT * FROM rental_extensions WHERE (status = 'held' AND expires_at < ?) OR (status = 'requested' AND created_at < ?)`).bind(now(), now() - 3600000).all<Ext>().catch(() => ({ results: [] as Ext[] }))).results;
  for (const x of rows) await declineExt(env, x, x.status === 'held' ? 'expired' : 'canceled');
  return rows.length;
}

export function extFromSession(cs: Stripe.Checkout.Session) { return cs.metadata?.ext_id || null; }
