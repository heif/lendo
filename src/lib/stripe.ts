// Stripe: renter pays by card at request time (authorization hold, manual capture).
// Owner replies YES → capture. Owner declines / 24h timeout → cancel (hold released).
// Owners connect a Stripe Express account for payouts; captured rent is transferred to it.
import Stripe from 'stripe';
import type { Env, Listing, Rental, User } from './env';

export function stripe(env: Env): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  return new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
}

export function feeFor(env: Env, rentCents: number): number {
  const pct = parseFloat(env.FEE_PCT || '15');
  return Math.round(rentCents * pct / 100);
}

export async function createCheckout(env: Env, rental: Rental, listing: Listing, renter: User): Promise<string | null> {
  const s = stripe(env);
  if (!s) return null; // dev mode → caller fakes a hold
  // $5 promo credit: a one-off coupon on this session (Lendo absorbs it; the owner's rent is unchanged)
  const coupon = rental.credit_cents > 0 ? await s.coupons.create({ amount_off: rental.credit_cents, currency: 'usd', duration: 'once', name: '$5 off your first rental', max_redemptions: 1 }) : null;
  const session = await s.checkout.sessions.create({
    ...(coupon ? { discounts: [{ coupon: coupon.id }] } : {}),
    mode: 'payment',
    customer_email: undefined,
    client_reference_id: rental.id,
    line_items: [
      { quantity: 1, price_data: { currency: 'usd', unit_amount: rental.rent_cents, product_data: { name: `${listing.name} · ${rental.days} day${rental.days === 1 ? '' : 's'}` } } },
      { quantity: 1, price_data: { currency: 'usd', unit_amount: rental.fee_cents, product_data: { name: `Lendo fee (${env.FEE_PCT}% — will stay low)` } } },
    ],
    payment_intent_data: {
      capture_method: 'manual',
      metadata: { rental_id: rental.id, listing_id: listing.id, renter_id: renter.id },
      description: `Lendo rental ${rental.id}`,
    },
    metadata: { rental_id: rental.id },
    success_url: `${env.APP_URL}/r/${rental.id}?paid=1`,
    cancel_url: `${env.APP_URL}/i/${listing.id}?canceled=1`,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
  });
  return session.url;
}

// Owner said YES: charge what's due now (total_cents already reflects any discount and promo credit).
// Under Stripe's 50¢ minimum (free / near-free) → release the hold instead; Lendo covers the difference.
export async function captureRental(env: Env, rental: Rental): Promise<'captured' | 'released' | 'none'> {
  const s = stripe(env);
  if (!s || !rental.stripe_payment_intent) return 'none';
  if (rental.total_cents < 50) { await s.paymentIntents.cancel(rental.stripe_payment_intent); return 'released'; }
  await s.paymentIntents.capture(rental.stripe_payment_intent, { amount_to_capture: rental.total_cents });
  return 'captured';
}

// Owner gets paid at pickup (decision Nov 10). No connected account yet → paid when they connect (flushPendingPayouts).
export async function payoutRental(env: Env, rental: Rental, owner: User): Promise<boolean> {
  const s = stripe(env);
  if (!s || !owner.stripe_account_id || rental.paid_out || rental.rent_cents <= 0) return false;
  await s.transfers.create({ amount: rental.rent_cents, currency: 'usd', destination: owner.stripe_account_id, transfer_group: rental.id, metadata: { rental_id: rental.id } }, { idempotencyKey: `payout_${rental.id}` });
  await env.DB.prepare('UPDATE rentals SET paid_out = 1 WHERE id = ?').bind(rental.id).run();
  return true;
}

// partial refund of a captured rental (late cancel)
export async function refundPart(env: Env, rental: Rental, amountCents: number): Promise<boolean> {
  const s = stripe(env);
  if (!s || !rental.stripe_payment_intent || amountCents <= 0) return false;
  await s.refunds.create({ payment_intent: rental.stripe_payment_intent, amount: amountCents, metadata: { rental_id: rental.id, reason: 'late_cancel' } }, { idempotencyKey: `latecancel_${rental.id}` });
  return true;
}

export async function releaseHold(env: Env, rental: Rental): Promise<void> {
  const s = stripe(env);
  if (!s || !rental.stripe_payment_intent) return;
  try { await s.paymentIntents.cancel(rental.stripe_payment_intent); } catch (e) { console.error('cancel PI failed', e); }
}

export async function connectOnboardingUrl(env: Env, owner: User): Promise<{ url: string; accountId: string } | null> {
  const s = stripe(env);
  if (!s) return null;
  let acct = owner.stripe_account_id;
  if (!acct) {
    const a = await s.accounts.create({ type: 'express', country: 'US', capabilities: { transfers: { requested: true } }, business_type: 'individual', metadata: { user_id: owner.id } });
    acct = a.id;
    await env.DB.prepare('UPDATE users SET stripe_account_id = ? WHERE id = ?').bind(acct, owner.id).run();
  }
  const link = await s.accountLinks.create({ account: acct, type: 'account_onboarding', refresh_url: `${env.APP_URL}/payout`, return_url: `${env.APP_URL}/payout?done=1` });
  return { url: link.url, accountId: acct };
}

// pay out captured-but-untransferred rent once an owner connects
export async function flushPendingPayouts(env: Env, owner: User): Promise<number> {
  const s = stripe(env);
  if (!s || !owner.stripe_account_id) return 0;
  const rows = await env.DB.prepare(`SELECT * FROM rentals WHERE owner_id = ? AND status IN ('picked_up','returned','closed') AND stripe_payment_intent IS NOT NULL AND paid_out = 0 AND rent_cents > 0 UNION SELECT * FROM rentals WHERE owner_id = ? AND status = 'canceled' AND late_cancel = 1 AND paid_out = 0 AND rent_cents > 0`).bind(owner.id, owner.id).all<Rental>();
  let n = 0;
  for (const r of rows.results) {
    await s.transfers.create({ amount: r.rent_cents, currency: 'usd', destination: owner.stripe_account_id, transfer_group: r.id, metadata: { rental_id: r.id } }, { idempotencyKey: `payout_${r.id}` });
    await env.DB.prepare('UPDATE rentals SET paid_out = 1 WHERE id = ?').bind(r.id).run();
    n++;
  }
  // extra days from extensions (captured, not yet sent)
  const xs = await env.DB.prepare(`SELECT x.id, x.rental_id, x.rent_cents FROM rental_extensions x JOIN rentals r ON r.id = x.rental_id WHERE r.owner_id = ? AND x.status = 'confirmed' AND x.paid_out = 0 AND x.rent_cents > 0 AND x.total_cents >= 50 AND x.stripe_payment_intent IS NOT NULL`).bind(owner.id).all<{ id: string; rental_id: string; rent_cents: number }>().catch(() => ({ results: [] as { id: string; rental_id: string; rent_cents: number }[] }));
  for (const x of xs.results) {
    await s.transfers.create({ amount: x.rent_cents, currency: 'usd', destination: owner.stripe_account_id, transfer_group: x.rental_id, metadata: { rental_id: x.rental_id, ext_id: x.id } }, { idempotencyKey: `payout_${x.id}` });
    await env.DB.prepare('UPDATE rental_extensions SET paid_out = 1 WHERE id = ?').bind(x.id).run();
    n++;
  }
  return n;
}
