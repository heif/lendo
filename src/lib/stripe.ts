// Stripe: renter pays by card at request time (authorization hold, manual capture).
// Owner replies YES → capture. Owner declines / 24h timeout → cancel (hold released).
// Owners connect a Stripe Express account for payouts; captured rent is transferred to it.
import Stripe from 'stripe';
import { logErr, logEvent } from './log';
import type { Claim, Env, Listing, Rental, User } from './env';
import { money } from './util';
import { payoutOf } from './money';

export function stripe(env: Env): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  return new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
}

export async function createCheckout(env: Env, rental: Rental, listing: Listing, renter: User): Promise<string | null> {
  const s = stripe(env);
  if (!s) return null; // dev mode → caller fakes a hold
  // promo credit: a one-off coupon on this session (Lendo absorbs it; the owner's payout is unchanged). Customer sees rent + sales tax − credit; Lendo's fee is on the owner's side
  const coupon = rental.credit_cents > 0 ? await s.coupons.create({ amount_off: rental.credit_cents, currency: 'usd', duration: 'once', name: 'Lendo credit', max_redemptions: 1 }) : null;
  const session = await s.checkout.sessions.create({
    ...(coupon ? { discounts: [{ coupon: coupon.id }] } : {}),
    mode: 'payment',
    customer_email: undefined,
    client_reference_id: rental.id,
    line_items: [
      { quantity: 1, price_data: { currency: 'usd', unit_amount: rental.rent_cents, product_data: { name: `${listing.name} · ${rental.days} day${rental.days === 1 ? '' : 's'}` } } },
      ...((rental.tax_cents || 0) > 0 ? [{ quantity: 1, price_data: { currency: 'usd', unit_amount: rental.tax_cents, product_data: { name: `Sales tax (${+(rental.tax_rate * 100).toFixed(3)}%)` } } }] : []),
    ],
    /* every rental has a deposit hold at pickup (the item's value): it needs the card again later, off-session → save it to a Stripe customer now.
       The customer sees and accepts the hold and how problems are decided before paying (also the record for a bank dispute) */
    customer_creation: 'always' as const,
    ...((rental.deposit_cents || 0) > 0 ? { custom_text: { submit: { message: `At pickup a ${money(rental.deposit_cents!)} hold (not a charge) goes on this card for the item's value, released after return. If there's a problem, Lendo's AI decides what's owed from the photos and what you each say, up to the hold` } } } : {}),
    payment_intent_data: {
      setup_future_usage: 'off_session' as const,
      capture_method: 'manual',
      metadata: { rental_id: rental.id, listing_id: listing.id, renter_id: renter.id },
      description: `Lendo rental ${rental.id}`,
    },
    metadata: { rental_id: rental.id },
    success_url: `${env.APP_URL}/r/${rental.id}?paid=1`,
    cancel_url: `${env.APP_URL}/i/${listing.id}?canceled=1`,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
  });
  await logEvent(env.DB, 'money.checkout', { rental: rental.id, user: renter.id, listing: listing.id, cents: rental.total_cents, data: { session: session.id, rent: rental.rent_cents, tax: rental.tax_cents, credit: rental.credit_cents } });
  return session.url;
}

// Owner said YES: charge what's due now (total_cents already reflects any discount and promo credit).
// Under Stripe's 50¢ minimum (free / near-free) → release the hold instead; Lendo covers the difference.
export async function captureRental(env: Env, rental: Rental): Promise<'captured' | 'released' | 'none'> {
  const s = stripe(env);
  if (!s || !rental.stripe_payment_intent) return 'none';
  if (rental.total_cents < 50) { await s.paymentIntents.cancel(rental.stripe_payment_intent); await logEvent(env.DB, 'money.release', { rental: rental.id, cents: 0, data: { pi: rental.stripe_payment_intent, why: 'under 50c' } }); return 'released'; }
  // look first: already captured (e.g. a retried YES) counts as captured; never ask for more than the hold
  const pi = await s.paymentIntents.retrieve(rental.stripe_payment_intent);
  if (pi.status === 'succeeded') { await logEvent(env.DB, 'money.capture', { rental: rental.id, cents: pi.amount_received, data: { pi: pi.id, already: true } }); return 'captured'; }
  if (pi.status !== 'requires_capture') throw new Error(`payment ${pi.id} is ${pi.status}, can't capture (hold ${pi.amount}, want ${rental.total_cents})`);
  const amt = Math.min(rental.total_cents, pi.amount_capturable);
  await s.paymentIntents.capture(pi.id, { amount_to_capture: amt });
  await logEvent(env.DB, 'money.capture', { rental: rental.id, cents: amt, data: { pi: pi.id, tax: rental.tax_cents, fee: rental.fee_cents, hold: pi.amount_capturable, wanted: rental.total_cents } });
  return 'captured';
}

// Owner gets paid at pickup (decision Nov 10). No connected account yet → paid when they connect (flushPendingPayouts).
export async function payoutRental(env: Env, rental: Rental, owner: User): Promise<boolean> {
  const s = stripe(env);
  if (!s || !owner.stripe_account_id || rental.paid_out || payoutOf(rental) <= 0) return false;
  await s.transfers.create({ amount: payoutOf(rental), currency: 'usd', destination: owner.stripe_account_id, transfer_group: rental.id, metadata: { rental_id: rental.id } }, { idempotencyKey: `payout_${rental.id}` });
  await env.DB.prepare('UPDATE rentals SET paid_out = 1 WHERE id = ?').bind(rental.id).run();
  await logEvent(env.DB, 'money.payout', { rental: rental.id, user: owner.id, cents: payoutOf(rental), data: { acct: owner.stripe_account_id } });
  return true;
}

// partial refund of a captured rental (late cancel)
export async function refundPart(env: Env, rental: Rental, amountCents: number): Promise<boolean> {
  const s = stripe(env);
  if (!s || !rental.stripe_payment_intent || amountCents <= 0) return false;
  await s.refunds.create({ payment_intent: rental.stripe_payment_intent, amount: amountCents, metadata: { rental_id: rental.id, reason: 'late_cancel' } }, { idempotencyKey: `latecancel_${rental.id}` });
  await logEvent(env.DB, 'money.refund', { rental: rental.id, cents: amountCents, data: { pi: rental.stripe_payment_intent, reason: 'late_cancel' } });
  return true;
}

export async function releaseHold(env: Env, rental: Rental): Promise<void> {
  const s = stripe(env);
  if (!s || !rental.stripe_payment_intent) return;
  try { await s.paymentIntents.cancel(rental.stripe_payment_intent); await logEvent(env.DB, 'money.release', { rental: rental.id, data: { pi: rental.stripe_payment_intent } }); } catch (e) { await logErr(env.DB, 'release hold', e, { rental: rental.id }); }
}

export async function connectOnboardingUrl(env: Env, owner: User): Promise<{ url: string; accountId: string } | null> {
  const s = stripe(env);
  if (!s) return null;
  let acct = owner.stripe_account_id;
  if (!acct) {
    const a = await s.accounts.create({ type: 'express', country: 'US', capabilities: { transfers: { requested: true } }, business_type: 'individual', metadata: { user_id: owner.id } });
    acct = a.id;
    await env.DB.prepare('UPDATE users SET stripe_account_id = ? WHERE id = ?').bind(acct, owner.id).run();
    await logEvent(env.DB, 'payout.account_created', { user: owner.id, data: { acct } });
  }
  const link = await s.accountLinks.create({ account: acct, type: 'account_onboarding', refresh_url: `${env.APP_URL}/payout`, return_url: `${env.APP_URL}/payout?done=1` });
  return { url: link.url, accountId: acct };
}

// pay out captured-but-untransferred payouts (rent − Lendo fee; old rows: rent) once an owner connects
export async function flushPendingPayouts(env: Env, owner: User): Promise<number> {
  const s = stripe(env);
  if (!s || !owner.stripe_account_id) return 0;
  const rows = await env.DB.prepare(`SELECT * FROM rentals WHERE owner_id = ? AND status IN ('picked_up','returned','closed') AND stripe_payment_intent IS NOT NULL AND paid_out = 0 AND rent_cents > 0 UNION SELECT * FROM rentals WHERE owner_id = ? AND status = 'canceled' AND late_cancel = 1 AND paid_out = 0 AND rent_cents > 0`).bind(owner.id, owner.id).all<Rental>();
  let n = 0;
  for (const r of rows.results) {
    if (payoutOf(r) <= 0) continue;
    await s.transfers.create({ amount: payoutOf(r), currency: 'usd', destination: owner.stripe_account_id, transfer_group: r.id, metadata: { rental_id: r.id } }, { idempotencyKey: `payout_${r.id}` });
    await env.DB.prepare('UPDATE rentals SET paid_out = 1 WHERE id = ?').bind(r.id).run();
    await logEvent(env.DB, 'money.payout', { rental: r.id, user: owner.id, cents: payoutOf(r), data: { acct: owner.stripe_account_id, late: true } });
    n++;
  }
  // extra days from extensions (captured, not yet sent)
  const xs = await env.DB.prepare(`SELECT x.id, x.rental_id, COALESCE(x.payout_cents, x.rent_cents) rent_cents FROM rental_extensions x JOIN rentals r ON r.id = x.rental_id WHERE r.owner_id = ? AND x.status = 'confirmed' AND x.paid_out = 0 AND x.rent_cents > 0 AND x.total_cents >= 50 AND x.stripe_payment_intent IS NOT NULL`).bind(owner.id).all<{ id: string; rental_id: string; rent_cents: number }>().catch(() => ({ results: [] as { id: string; rental_id: string; rent_cents: number }[] }));
  for (const x of xs.results) {
    await s.transfers.create({ amount: x.rent_cents, currency: 'usd', destination: owner.stripe_account_id, transfer_group: x.rental_id, metadata: { rental_id: x.rental_id, ext_id: x.id } }, { idempotencyKey: `payout_${x.id}` });
    await env.DB.prepare('UPDATE rental_extensions SET paid_out = 1 WHERE id = ?').bind(x.id).run();
    await logEvent(env.DB, 'money.payout', { rental: x.rental_id, user: owner.id, cents: x.rent_cents, data: { ext: x.id, late: true } });
    n++;
  }
  /* settled claims owed to this owner */
  const cs = await env.DB.prepare(`SELECT * FROM claims WHERE owner_id = ? AND settled_at IS NOT NULL AND owner_due_cents > 0 AND paid_out = 0 AND payout_ok = 1`).bind(owner.id).all<Claim>().catch(() => ({ results: [] as Claim[] }));
  for (const cl of cs.results) { try { if (await payClaim(env, cl, owner)) n++; } catch (e) { await logErr(env.DB, 'claim payout', e, { rental: cl.rental_id }); } }
  return n;
}

// ---------- Deposit hold: every rental, for the item's value (set by AI, src/lib/value.ts) ----------
// Placed on pickup day (rental page / cron / Handed over). Released when the owner says all good, 24h after return, or at cancel.
// Captured only by a final AI ruling on a claim (collectAward, src/lib/claims.ts). Card authorizations last ~7 days → renewed while
// the item is out or a claim is open.

// the rental's checkout saved the card: remember customer + card on the rental (webhook, after markHeld)
export async function rememberCard(env: Env, rentalId: string, piId: string | null): Promise<void> {
  const s = stripe(env); if (!s || !piId) return;
  try {
    const pi = await s.paymentIntents.retrieve(piId);
    const cust = typeof pi.customer === 'string' ? pi.customer : pi.customer?.id ?? null, pm = typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id ?? null;
    if (cust && pm) await env.DB.prepare('UPDATE rentals SET stripe_customer = ?, stripe_pm = ? WHERE id = ?').bind(cust, pm, rentalId).run();
  } catch (e) { await logErr(env.DB, 'remember card', e, { rental: rentalId }); }
}

// 'held' | 'failed' | 'skip' (no hold on this rental, or already held/released)
export async function placeDeposit(env: Env, r: Rental, renew = false): Promise<'held' | 'failed' | 'skip'> {
  if (!(r.deposit_cents! > 0)) return 'skip';
  if (!renew && (r.deposit_status === 'held' || r.deposit_status === 'released')) return 'skip';
  const s = stripe(env);
  if (!s) { /* dev: pretend */ await env.DB.prepare(`UPDATE rentals SET deposit_status = 'held', deposit_at = ? WHERE id = ?`).bind(Date.now(), r.id).run(); return 'held'; }
  if (!r.stripe_customer || !r.stripe_pm) { await env.DB.prepare(`UPDATE rentals SET deposit_status = 'failed' WHERE id = ?`).bind(r.id).run(); await logEvent(env.DB, 'money.deposit_failed', { rental: r.id, user: r.renter_id, cents: r.deposit_cents, data: { why: 'no saved card' } }); return 'failed'; }
  try {
    const pi = await s.paymentIntents.create({ amount: r.deposit_cents!, currency: 'usd', customer: r.stripe_customer, payment_method: r.stripe_pm, off_session: true, confirm: true, capture_method: 'manual',
      description: `Lendo deposit hold · rental ${r.id}`, metadata: { rental_id: r.id, kind: 'deposit' } },
      { idempotencyKey: `dep_${r.id}_${r.stripe_pm}_${renew ? 'r' + Math.floor(Date.now() / 86400000) : Math.floor(Date.now() / 60000)}` }); /* per minute: a retry after a decline isn't replayed; cron + page in the same minute share one hold */
    if (pi.status !== 'requires_capture') throw new Error(`deposit ${pi.id} is ${pi.status}`);
    if (renew && r.deposit_pi && r.deposit_pi !== pi.id) { try { await s.paymentIntents.cancel(r.deposit_pi); } catch { /* old one may have lapsed */ } }
    await env.DB.prepare(`UPDATE rentals SET deposit_pi = ?, deposit_status = 'held', deposit_at = ? WHERE id = ?`).bind(pi.id, Date.now(), r.id).run();
    await logEvent(env.DB, renew ? 'money.deposit_renewed' : 'money.deposit_held', { rental: r.id, user: r.renter_id, cents: r.deposit_cents, data: { pi: pi.id } });
    return 'held';
  } catch (e) {
    if (renew) { await logErr(env.DB, 'deposit renew failed', e, { rental: r.id }); return 'failed'; } /* keep the old hold while it lasts */
    await env.DB.prepare(`UPDATE rentals SET deposit_status = 'failed' WHERE id = ?`).bind(r.id).run();
    await logEvent(env.DB, 'money.deposit_failed', { rental: r.id, user: r.renter_id, cents: r.deposit_cents, data: { err: String((e as Error)?.message || e).slice(0, 300) } });
    return 'failed';
  }
}

export async function releaseDeposit(env: Env, r: Rental): Promise<void> {
  if (r.deposit_status !== 'held') return;
  const s = stripe(env);
  if (s && r.deposit_pi) { try { await s.paymentIntents.cancel(r.deposit_pi); } catch (e) { await logErr(env.DB, 'release deposit', e, { rental: r.id }); } }
  await env.DB.prepare(`UPDATE rentals SET deposit_status = 'released' WHERE id = ?`).bind(r.id).run();
  await logEvent(env.DB, 'money.deposit_released', { rental: r.id, user: r.renter_id, cents: r.deposit_cents, data: { pi: r.deposit_pi } });
}

// card didn't take the hold → customer adds a card (Checkout, setup mode); webhook saves it and retries
export async function cardSetupUrl(env: Env, r: Rental): Promise<string | null> {
  const s = stripe(env); if (!s) return null;
  const session = await s.checkout.sessions.create({ mode: 'setup', currency: 'usd', ...(r.stripe_customer ? { customer: r.stripe_customer } : { customer_creation: 'always' as const }),
    metadata: { deposit_for: r.id }, success_url: `${env.APP_URL}/r/${r.id}?card=1`, cancel_url: `${env.APP_URL}/r/${r.id}` });
  return session.url;
}
export async function cardFromSetup(env: Env, cs: Stripe.Checkout.Session): Promise<string | null> {
  const s = stripe(env); const rid = cs.metadata?.deposit_for; if (!s || !rid || !cs.setup_intent) return null;
  const si = await s.setupIntents.retrieve(typeof cs.setup_intent === 'string' ? cs.setup_intent : cs.setup_intent.id);
  const pm = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id ?? null, cust = typeof si.customer === 'string' ? si.customer : si.customer?.id ?? (typeof cs.customer === 'string' ? cs.customer : null);
  if (pm && cust) await env.DB.prepare(`UPDATE rentals SET stripe_customer = ?, stripe_pm = ?, deposit_status = CASE WHEN deposit_status = 'failed' THEN 'due' ELSE deposit_status END WHERE id = ?`).bind(cust, pm, rid).run();
  return rid;
}

// ---------- Claims: a final AI ruling says the customer owes `cents` (≤ the deposit) ----------
// Capture it from the hold (the rest of the hold is released by Stripe); if the hold lapsed, charge the saved card.
// Safe to run again for the same claim (settle retries a few times before Lendo covers it): a capture or charge that already
// went through is found and counted, never taken twice. Returns what was actually collected.
export async function collectAward(env: Env, r: Rental, cents: number, claimId: string, attempt = 0): Promise<{ cents: number; how: 'hold' | 'card' | 'none'; pi: string | null }> {
  const s = stripe(env);
  const mark = () => env.DB.prepare(`UPDATE rentals SET deposit_status = 'captured' WHERE id = ?`).bind(r.id).run();
  if (cents < 50) return { cents: 0, how: 'none', pi: null };
  if (!s) { await mark(); await logEvent(env.DB, 'money.claim_collected', { rental: r.id, user: r.renter_id, cents, data: { dev: true, claim: claimId } }); return { cents, how: 'hold', pi: null }; }
  if (r.deposit_pi && (r.deposit_status === 'held' || r.deposit_status === 'captured')) {
    try {
      const pi = await s.paymentIntents.retrieve(r.deposit_pi);
      if (pi.status === 'succeeded') { await mark(); return { cents: pi.amount_received, how: 'hold', pi: pi.id }; } /* a retry after the capture went through */
      if (pi.status === 'requires_capture') {
        const amt = Math.min(cents, pi.amount_capturable);
        await s.paymentIntents.capture(pi.id, { amount_to_capture: amt }); /* a PaymentIntent can only be captured once; the status check above covers a repeat */
        await mark();
        await logEvent(env.DB, 'money.claim_collected', { rental: r.id, user: r.renter_id, cents: amt, data: { pi: pi.id, how: 'hold', hold: pi.amount_capturable, claim: claimId } });
        return { cents: amt, how: 'hold', pi: pi.id };
      }
    } catch (e) { await logErr(env.DB, 'claim capture', e, { rental: r.id }); }
  }
  if (r.stripe_customer && r.stripe_pm) {
    try {
      /* an earlier attempt may have charged the card even though its answer never arrived: look before charging again */
      const prior = (await s.paymentIntents.list({ customer: r.stripe_customer, limit: 30 })).data.find(x => x.metadata?.claim_id === claimId && x.status === 'succeeded');
      if (prior) { await mark(); return { cents: prior.amount_received, how: 'card', pi: prior.id }; }
      const pi = await s.paymentIntents.create({ amount: cents, currency: 'usd', customer: r.stripe_customer, payment_method: r.stripe_pm, off_session: true, confirm: true,
        description: `Lendo claim · rental ${r.id}`, metadata: { rental_id: r.id, kind: 'claim', claim_id: claimId } }, { idempotencyKey: `claimchg_${claimId}_${attempt}` });
      if (pi.status === 'succeeded') {
        await mark();
        await logEvent(env.DB, 'money.claim_collected', { rental: r.id, user: r.renter_id, cents, data: { pi: pi.id, how: 'card', claim: claimId } });
        return { cents, how: 'card', pi: pi.id };
      }
    } catch (e) { await logErr(env.DB, 'claim charge', e, { rental: r.id }); }
  }
  await logEvent(env.DB, 'money.claim_uncollected', { rental: r.id, user: r.renter_id, cents, data: { claim: claimId } });
  return { cents: 0, how: 'none', pi: null };
}

// Pay the owner what a settled claim owes them (claims.owner_due_cents; no Lendo fee on it). For now every claim payout is
// released by a person after a FaceTime call with the owner (claims.payout_ok, /admin/claims; Scott, 11/24). No connected
// account yet → paid when they connect (flushPendingPayouts).
export async function payClaim(env: Env, cl: Claim, owner: User): Promise<boolean> {
  const s = stripe(env);
  if (cl.paid_out || cl.owner_due_cents <= 0 || !cl.payout_ok) return false;
  if (!s) { await env.DB.prepare('UPDATE claims SET paid_out = 1 WHERE id = ?').bind(cl.id).run(); await logEvent(env.DB, 'money.claim_payout', { rental: cl.rental_id, user: owner.id, cents: cl.owner_due_cents, data: { dev: true, claim: cl.id } }); return true; }
  if (!owner.stripe_account_id) return false;
  /* pay out of the collected charge itself when it covers it (no wait for the balance to clear) */
  let src: string | undefined;
  if (cl.collect_pi && cl.collected_cents >= cl.owner_due_cents) { try { const pi = await s.paymentIntents.retrieve(cl.collect_pi); src = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id; } catch { /* falls back to the balance */ } }
  await s.transfers.create({ amount: cl.owner_due_cents, currency: 'usd', destination: owner.stripe_account_id, transfer_group: cl.rental_id, ...(src ? { source_transaction: src } : {}), metadata: { rental_id: cl.rental_id, claim_id: cl.id } }, { idempotencyKey: `claimpay_${cl.id}` });
  await env.DB.prepare('UPDATE claims SET paid_out = 1 WHERE id = ?').bind(cl.id).run();
  await logEvent(env.DB, 'money.claim_payout', { rental: cl.rental_id, user: owner.id, cents: cl.owner_due_cents, data: { acct: owner.stripe_account_id, claim: cl.id, from_charge: !!src } });
  return true;
}

// Bank dispute (chargeback) on a Lendo charge: put the evidence file on it. submit=false leaves it as a draft in the
// Stripe dashboard for a person to send; submit=true sends it (final, can't be changed after).
export async function disputeEvidence(env: Env, disputeId: string, ev: { text: string; product: string; name?: string | null; email?: string | null; serviceDate?: string | null; disclosure: string; files: { key: string; as: 'customer_signature' | 'service_documentation' | 'uncategorized_file' }[] }, submit: boolean): Promise<boolean> {
  const s = stripe(env); if (!s) return false;
  const evidence: Stripe.DisputeUpdateParams.Evidence = { product_description: ev.product.slice(0, 1000), uncategorized_text: ev.text.slice(0, 19000), cancellation_policy_disclosure: ev.disclosure.slice(0, 1000),
    ...(ev.name ? { customer_name: ev.name } : {}), ...(ev.email ? { customer_email_address: ev.email } : {}), ...(ev.serviceDate ? { service_date: ev.serviceDate } : {}) };
  for (const f of ev.files) {
    try {
      const o = await env.PHOTOS.get(f.key); if (!o || o.size > 4_000_000) continue;
      const up = await s.files.create({ purpose: 'dispute_evidence', file: { data: new Uint8Array(await o.arrayBuffer()), name: f.key.split('/').pop() || 'photo.jpg', type: 'application/octet-stream' } as any });
      (evidence as any)[f.as] = up.id;
    } catch (e) { await logErr(env.DB, `dispute file ${disputeId} ${f.key}`, e); }
  }
  await s.disputes.update(disputeId, { evidence, submit });
  return true;
}
