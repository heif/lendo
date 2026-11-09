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
  const session = await s.checkout.sessions.create({
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

export async function captureRental(env: Env, rental: Rental, owner: User): Promise<void> {
  const s = stripe(env);
  if (!s || !rental.stripe_payment_intent) return;
  await s.paymentIntents.capture(rental.stripe_payment_intent);
  if (owner.stripe_account_id) {
    await s.transfers.create({
      amount: rental.rent_cents, currency: 'usd', destination: owner.stripe_account_id,
      transfer_group: rental.id, metadata: { rental_id: rental.id },
    });
    await env.DB.prepare('UPDATE rentals SET paid_out = 1 WHERE id = ?').bind(rental.id).run();
  }
  // else: rent sits in the platform balance; owner is texted a /payout link and the transfer happens when they connect.
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
  const rows = await env.DB.prepare(`SELECT * FROM rentals WHERE owner_id = ? AND status IN ('confirmed','picked_up','returned','closed') AND stripe_payment_intent IS NOT NULL AND paid_out = 0`).bind(owner.id).all<Rental>();
  let n = 0;
  for (const r of rows.results) {
    await s.transfers.create({ amount: r.rent_cents, currency: 'usd', destination: owner.stripe_account_id, transfer_group: r.id, metadata: { rental_id: r.id } }, { idempotencyKey: `payout_${r.id}` });
    await env.DB.prepare('UPDATE rentals SET paid_out = 1 WHERE id = ?').bind(r.id).run();
    n++;
  }
  return n;
}
