// Rental state transitions + the texts they trigger. Used by web routes, Stripe webhook, Blooio webhook and cron.
import type { Env, Rental, User } from './env';
import { itemLink } from './urls';
import { addMessage, busyDays, listingById, rentalById, setRentalStatus, userById } from './db';
import { textUser } from './blooio';
import { captureRental, feeFor, payoutRental, refundPart, releaseHold } from './stripe';
import { firstName, fmtRange, money, now } from './util';

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
  await addMessage(env, r.id, null, `${firstName(renter.name)} requested ${fmtRange(r.start_day, r.end_day)} · card held · waiting for ${firstName(owner.name)}`, 'system');
  await textUser(env, owner, `${firstName(renter.name)} wants your ${listing.name} ${fmtRange(r.start_day, r.end_day)}. You'd earn ${money(r.rent_cents)}. Reply YES to accept or NO to pass. ${url}`, 'rental', r.id);
  await textUser(env, renter, `Requested ${listing.name} from ${firstName(owner.name)} for ${fmtRange(r.start_day, r.end_day)}. Your card is held, not charged, until they say yes. We'll text you. ${url}`, 'rental', r.id);
}

// rentCents: owner's "Give a discount" — any amount from the requested rent down to 0, never higher.
export async function accept(env: Env, r0: Rental, rentCents?: number): Promise<boolean> {
  if (r0.status !== 'held') return false;
  let r = r0;
  if (rentCents != null && rentCents >= 0 && rentCents < r0.rent_cents) {
    const fee = rentCents === 0 ? 0 : feeFor(env, rentCents);           // free rental = no fee
    const total = Math.max(0, rentCents + fee - r0.credit_cents);
    await env.DB.prepare('UPDATE rentals SET list_rent_cents = COALESCE(list_rent_cents, rent_cents), rent_cents = ?, fee_cents = ?, total_cents = ? WHERE id = ?').bind(rentCents, fee, total, r0.id).run();
    r = { ...r0, rent_cents: rentCents, fee_cents: fee, total_cents: total };
  }
  const { owner, renter, listing } = await parties(env, r);
  let how: string;
  try { how = await captureRental(env, r); } catch (e) { console.error('capture failed', e); return false; }
  await setRentalStatus(env.DB, r.id, 'confirmed', { expires_at: null });
  const url = `${env.APP_URL}/r/${r.id}`;
  const paidLine = r.total_cents <= 0 || how === 'released' ? 'free — nothing charged' : `${money(r.total_cents)} paid`;
  await addMessage(env, r.id, null, `${firstName(owner.name)} said yes · ${paidLine} · set a pickup time`, 'system');
  const spot = owner.pickup_spots ? ` Meet: ${(JSON.parse(owner.pickup_spots) as string[]).join(' or ')}` : '';
  const gift = r.rent_cents === 0 ? ` ${firstName(owner.name)} is lending it to you free!` : r0.rent_cents > r.rent_cents ? ` ${firstName(owner.name)} gave you a discount` : '';
  // owner is asked for a pickup time right after YES (no pickup hours); their reply relays to the customer, SKIP leaves it to the customer
  await textUser(env, renter, `${firstName(owner.name)} said yes!${gift} ${paidLine[0].toUpperCase() + paidLine.slice(1)}.${spot} ${firstName(owner.name)} will text a pickup time ${url}`, 'money', r.id);
  await textUser(env, owner, `${r.rent_cents === 0 ? 'Done — lending it free' : `Done. ${firstName(renter.name)} paid`}. When can ${firstName(renter.name)} pick it up? Reply a time (like "after 6"), or SKIP`, 'rental', r.id);
  if (!owner.stripe_account_id && r.rent_cents > 0) {
    await textUser(env, owner, `Where should your ${money(r.rent_cents)} go? Add a debit card or bank, takes 30 sec: ${env.APP_URL}/payout`, 'money', r.id);
  }
  return true;
}

export async function decline(env: Env, r: Rental, reason: 'declined' | 'expired' | 'canceled') {
  if (r.status !== 'held' && r.status !== 'requested') return false;
  await releaseHold(env, r);
  await setRentalStatus(env.DB, r.id, reason, { expires_at: null });
  const { owner, renter, listing } = await parties(env, r);
  const why = reason === 'declined' ? `${firstName(owner.name)} can't do those days` : reason === 'expired' ? `${firstName(owner.name)} didn't answer in time` : 'request canceled';
  await addMessage(env, r.id, null, `${why} · hold released, nothing charged`, 'system');
  if (reason !== 'canceled') await textUser(env, renter, `${listing.name}: ${why}. Nothing was charged. Browse more: ${env.APP_URL}/`, 'rental', r.id);
  return true;
}

// Customer cancels. Before the owner's YES: full release. After YES, before pickup: 50% back, owner keeps half the rent.
export async function customerCancel(env: Env, r: Rental): Promise<'released' | 'half' | false> {
  const { owner, renter, listing } = await parties(env, r);
  if (r.status === 'held' || r.status === 'requested') {
    await decline(env, r, 'canceled');
    if (r.status === 'held') await textUser(env, owner, `${firstName(renter.name)} canceled the request for your ${listing.name}`, 'rental', r.id);
    return 'released';
  }
  if (r.status !== 'confirmed') return false;
  const refund = Math.round(r.total_cents * 0.5);
  const keep = r.total_cents >= 50 ? Math.round(r.rent_cents * 0.5) : 0; // nothing was charged on a free / near-free rental
  if (r.total_cents >= 50) { try { await refundPart(env, r, refund); } catch (e) { console.error('late cancel refund failed', e); return false; } }
  const charged = Math.max(0, r.total_cents - refund);
  await setRentalStatus(env.DB, r.id, 'canceled', { late_cancel: 1, rent_cents: keep, fee_cents: Math.max(0, charged - keep), total_cents: charged });
  const fresh = (await rentalById(env.DB, r.id))!;
  await addMessage(env, r.id, null, `${firstName(renter.name)} canceled after the yes · ${money(refund)} refunded · ${firstName(owner.name)} keeps ${money(keep)}`, 'system');
  try { await payoutRental(env, fresh, owner); } catch (e) { console.error('late cancel payout failed', e); }
  await textUser(env, owner, `${firstName(renter.name)} canceled the ${listing.name} rental — you keep ${money(keep)}`, 'money', r.id);
  await textUser(env, renter, `Canceled. ${money(refund)} back to your card (half, since ${firstName(owner.name)} had already said yes)`, 'money', r.id);
  return 'half';
}

export async function pickedUp(env: Env, r: Rental, photoKey: string | null) {
  if (r.status !== 'confirmed') return false;
  await setRentalStatus(env.DB, r.id, 'picked_up', { pickup_photo_key: photoKey });
  const { owner, renter, listing } = await parties(env, r);
  await addMessage(env, r.id, null, photoKey ? `${firstName(owner.name)} took the pickup photo · time-stamped, you both have it` : `Picked up`, 'system');
  await textUser(env, renter, `You've got the ${listing.name}. Return ${fmtRange(r.end_day, r.end_day)}`, 'pickup', r.id);
  try { if (await payoutRental(env, r, owner)) await textUser(env, owner, `${money(r.rent_cents)} is on its way to your account`, 'money', r.id); } catch (e) { console.error('payout failed', e); }
  return true;
}

export async function returned(env: Env, r: Rental, photoKey: string | null) {
  if (r.status !== 'picked_up' && r.status !== 'confirmed') return false;
  await setRentalStatus(env.DB, r.id, 'returned', { return_photo_key: photoKey });
  const { owner, renter, listing } = await parties(env, r);
  const url = `${env.APP_URL}/r/${r.id}`;
  await addMessage(env, r.id, null, `${firstName(owner.name)} confirmed the return · rate each other`, 'system');
  await textUser(env, renter, `${firstName(owner.name)} confirmed the return. How was the ${listing.name}? Rate it: ${url}`, 'rental', r.id);
  await textUser(env, owner, `Returned. How was ${firstName(renter.name)}? Rate them: ${url}`, 'rental', r.id);
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
  await textUser(env, to, `${firstName(from.name)}: ${body}`, 'rental', r.id);
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
      await textUser(env, owner, `${firstName(renter.name)} is still waiting on your ${listing.name} for ${fmtRange(r.start_day, r.end_day)} — reply YES or NO ${env.APP_URL}/r/${r.id}`, 'rental', r.id);
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
    await textUser(env, cu, `Before pickup: sign your promise to ${firstName(ow.name) || 'the owner'} (3 quick checks) ${env.APP_URL}/r/${r.id}`, 'rental');
    await env.DB.prepare('UPDATE rentals SET promise_nudged = promise_nudged + 1 WHERE id = ?').bind(r.id).run();
  }
}
