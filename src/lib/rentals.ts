// Rental state transitions + the texts they trigger. Used by web routes, Stripe webhook, Blooio webhook and cron.
import type { Env, Rental, User } from './env';
import { addMessage, listingById, rentalById, setRentalStatus, userById } from './db';
import { textUser } from './blooio';
import { captureRental, releaseHold } from './stripe';
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
  await setRentalStatus(env.DB, r.id, 'held', { stripe_payment_intent: paymentIntent, stripe_checkout_id: checkoutId, expires_at: exp });
  const { owner, renter, listing } = await parties(env, r);
  const url = `${env.APP_URL}/r/${r.id}`;
  await addMessage(env, r.id, null, `${firstName(renter.name)} requested ${fmtRange(r.start_day, r.end_day)} · card held · waiting for ${firstName(owner.name)}`, 'system');
  await textUser(env, owner, `${firstName(renter.name)} wants your ${listing.name} ${fmtRange(r.start_day, r.end_day)}. You'd earn ${money(r.rent_cents)}. Reply YES to accept or NO to pass. ${url}`, 'rental', r.id);
  await textUser(env, renter, `Requested ${listing.name} from ${firstName(owner.name)} for ${fmtRange(r.start_day, r.end_day)}. Your card is held, not charged, until they say yes. We'll text you. ${url}`, 'rental', r.id);
}

export async function accept(env: Env, r: Rental): Promise<boolean> {
  if (r.status !== 'held') return false;
  const { owner, renter, listing } = await parties(env, r);
  try { await captureRental(env, r, owner); } catch (e) { console.error('capture failed', e); return false; }
  await setRentalStatus(env.DB, r.id, 'confirmed', { expires_at: null });
  const url = `${env.APP_URL}/r/${r.id}`;
  await addMessage(env, r.id, null, `${firstName(owner.name)} said yes · ${money(r.total_cents)} paid · set a pickup time`, 'system');
  const spot = owner.pickup_spots ? ` Meet: ${(JSON.parse(owner.pickup_spots) as string[]).join(' or ')}.` : '';
  await textUser(env, renter, `${firstName(owner.name)} said yes! Paid ${money(r.total_cents)}.${spot} Set a pickup time — reply here or tap: ${url}`, 'money', r.id);
  await textUser(env, owner, `Done. ${firstName(renter.name)} paid. Set a pickup time with them — reply here or tap: ${url}`, 'rental', r.id);
  if (!owner.stripe_account_id) {
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

export async function pickedUp(env: Env, r: Rental, photoKey: string | null) {
  if (r.status !== 'confirmed') return false;
  await setRentalStatus(env.DB, r.id, 'picked_up', { pickup_photo_key: photoKey });
  const { owner, renter, listing } = await parties(env, r);
  await addMessage(env, r.id, null, photoKey ? `${firstName(owner.name)} took the pickup photo · time-stamped, you both have it` : `Picked up`, 'system');
  await textUser(env, renter, `You've got the ${listing.name}. Return ${fmtRange(r.end_day, r.end_day)}. Running late? Reply LATE and we'll tell ${firstName(owner.name)}.`, 'pickup', r.id);
  if (owner.stripe_account_id) await textUser(env, owner, `${money(r.rent_cents)} is on its way to your account.`, 'money', r.id);
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

export async function expireHolds(env: Env) {
  const rows = await env.DB.prepare(`SELECT * FROM rentals WHERE status = 'held' AND expires_at IS NOT NULL AND expires_at < ?`).bind(now()).all<Rental>();
  for (const r of rows.results) await decline(env, r, 'expired');
  // abandoned checkouts
  await env.DB.prepare(`UPDATE rentals SET status = 'canceled', updated_at = ? WHERE status = 'requested' AND created_at < ?`).bind(now(), now() - 2 * 3600000).run();
  return rows.results.length;
}
