import { answerPending, actOn, intentContext, parseIntent } from '../lib/intent';
import { Hono, type Context } from 'hono';
import type Stripe from 'stripe';
import type { Env, Rental, Vars } from '../lib/env';
import { stripe } from '../lib/stripe';
import { parseInbound, textUser } from '../lib/blooio';
import { rentalById, userByPhone } from '../lib/db';
import { accept, activeRentalFor, decline, markHeld, relay } from '../lib/rentals';
import { hmacHex, normPhone, timingSafeEq, firstName } from '../lib/util';

export const webhooks = new Hono<{ Bindings: Env; Variables: Vars }>();

// ---------- Stripe ----------
webhooks.post('/webhooks/stripe', async (c) => {
  const s = stripe(c.env);
  if (!s || !c.env.STRIPE_WEBHOOK_SECRET) return c.text('stripe not configured', 501);
  const sig = c.req.header('stripe-signature') || '';
  const raw = await c.req.text();
  let ev: Stripe.Event;
  try { ev = await s.webhooks.constructEventAsync(raw, sig, c.env.STRIPE_WEBHOOK_SECRET); } catch (e) { return c.text('bad signature', 400); }
  if (ev.type === 'checkout.session.completed') {
    const cs = ev.data.object as Stripe.Checkout.Session;
    const rid = cs.metadata?.rental_id || cs.client_reference_id;
    if (rid) {
      const r = await rentalById(c.env.DB, rid);
      if (r) await markHeld(c.env, r, typeof cs.payment_intent === 'string' ? cs.payment_intent : cs.payment_intent?.id ?? null, cs.id);
    }
  } else if (ev.type === 'checkout.session.expired') {
    const cs = ev.data.object as Stripe.Checkout.Session;
    const rid = cs.metadata?.rental_id;
    if (rid) { const r = await rentalById(c.env.DB, rid); if (r && r.status === 'requested') await decline(c.env, r, 'canceled'); }
  } else if (ev.type === 'payment_intent.canceled') {
    const pi = ev.data.object as Stripe.PaymentIntent;
    const r = await c.env.DB.prepare('SELECT * FROM rentals WHERE stripe_payment_intent = ?').bind(pi.id).first<Rental>();
    // a free / sub-50¢ rental is released on purpose at accept — not an expiry
    if (r && r.status === 'held' && r.total_cents >= 50) await decline(c.env, r, 'expired');
  }
  return c.json({ received: true });
});

// ---------- Blooio inbound texts ----------
// Keywords: YES / NO (owner answers a held request), LATE, HERE, STOP, STOP NUDGES, START, LIST, HELP.
// Anything else relays to the other party of the sender's most recent active rental.
webhooks.post('/webhooks/blooio', async (c) => {
  try { return await blooioInbound(c); }
  catch (e: any) { await c.env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('last_inbound_err', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(`${Date.now()} ${e?.stack || e}`.slice(0, 1500)).run(); return c.json({ ok: false }, 500); }
});
async function blooioInbound(c: Context<{ Bindings: Env; Variables: Vars }>) {
  const raw = await c.req.text();
  if (c.env.BLOOIO_WEBHOOK_SECRET) {
    // v4: X-Blooio-Signature: t=<unix>,v1=<hex hmac-sha256 of "<t>.<raw body>">; also accept a bare hex (older docs)
    const hdr = c.req.header('x-blooio-signature') || '';
    const parts = Object.fromEntries(hdr.split(',').map(kv => kv.split('=').map(s => s.trim())).filter(a => a.length === 2));
    let ok = false;
    if (parts.t && parts.v1) {
      const want = await hmacHex(c.env.BLOOIO_WEBHOOK_SECRET, `${parts.t}.${raw}`);
      ok = timingSafeEq(parts.v1, want) && Math.abs(Date.now() / 1000 - parseInt(parts.t, 10) / (parts.t.length > 10 ? 1000 : 1)) < 600;
    } else if (hdr) {
      ok = timingSafeEq(hdr.replace(/^sha256=/, ''), await hmacHex(c.env.BLOOIO_WEBHOOK_SECRET, raw));
    }
    if (!ok) return c.text('bad signature', 401);
  }
  let j: any; try { j = JSON.parse(raw); } catch { return c.text('bad json', 400); }
  const ev = (c.req.header('x-blooio-event') || j.event || j.type || '').toString();
  if (ev && ev !== 'message.received') return c.json({ ok: true, ignored: ev });
  const m = parseInbound(j);
  // debug breadcrumb: last inbound seen (event + sender suffix + time); no message text stored
  c.executionCtx.waitUntil(c.env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('last_inbound', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify({ t: Date.now(), ev, from: m ? String(m.from).slice(-4) : null })).run().then(() => {}));
  if (!m) return c.json({ ok: true, ignored: 'no sender' });
  const phone = normPhone(m.from) || m.from;
  const user = await userByPhone(c.env.DB, phone);
  const text = m.text.trim();
  const kw = text.toUpperCase().replace(/[^A-Z ]/g, '').trim();
  if (!user) {
    // unknown number: invite them in
    return c.json({ ok: true, unknown: true });
  }
  if (!user.replied) { await c.env.DB.prepare('UPDATE users SET replied = 1 WHERE id = ?').bind(user.id).run(); user.replied = 1; }
  if (kw === 'OK' || kw === 'OKAY' || kw === 'K') {
    const r0 = await activeRentalFor(c.env, user.id);
    if (!r0) { await textUser(c.env, user, `You're set. Rentals: ${c.env.APP_URL}/rentals · Map: ${c.env.APP_URL}/`, 'rental'); return c.json({ ok: true }); }
  }
  if (kw === 'STOP' || kw === 'UNSUBSCRIBE' || kw === 'CANCEL') {
    await c.env.DB.prepare('UPDATE users SET texts = 0, nudges = 0 WHERE id = ?').bind(user.id).run();
    return c.json({ ok: true });
  }
  if (kw === 'START' || kw === 'UNSTOP') {
    await c.env.DB.prepare('UPDATE users SET texts = 1 WHERE id = ?').bind(user.id).run();
    await textUser(c.env, { ...user, texts: 1 }, `You're back on. We'll text you about your rentals.`, 'rental');
    return c.json({ ok: true });
  }
  if (kw === 'STOP NUDGES' || kw === 'NO NUDGES') {
    await c.env.DB.prepare('UPDATE users SET nudges = 0 WHERE id = ?').bind(user.id).run();
    await textUser(c.env, user, `Got it — no more listing tips. You'll still get rental and money texts.`, 'rental');
    return c.json({ ok: true });
  }
  if (kw === 'LIST') { await textUser(c.env, user, `Point, tap, done: ${c.env.APP_URL}/list`, 'nudge'); return c.json({ ok: true }); }
  if (kw === 'HELP') { await textUser(c.env, user, `Lendo: reply YES/NO to a request, LATE if you're running late, STOP to stop texts. Your rentals: ${c.env.APP_URL}/rentals`, 'rental'); return c.json({ ok: true }); }

  // a parked plain-English action (price change, cancel) waiting for YES wins over an owner's pending request
  if ((kw === 'YES' || kw === 'Y' || kw === 'NO' || kw === 'N') && await answerPending(c.env, user, kw.startsWith('Y'))) return c.json({ ok: true });
  if (kw === 'YES' || kw === 'Y' || kw === 'ACCEPT' || kw === 'NO' || kw === 'N' || kw === 'PASS' || kw === 'DECLINE') {
    const held = await c.env.DB.prepare(`SELECT * FROM rentals WHERE owner_id = ? AND status = 'held' ORDER BY created_at DESC LIMIT 1`).bind(user.id).first<Rental>();
    if (held) {
      if (kw.startsWith('Y') || kw === 'ACCEPT') { const ok = await accept(c.env, held); if (!ok) await textUser(c.env, user, `Couldn't confirm that one — open it here: ${c.env.APP_URL}/r/${held.id}`, 'rental', held.id); }
      else await decline(c.env, held, 'declined');
      return c.json({ ok: true });
    }
    // no pending request → fall through to relay
  }

  const r = await activeRentalFor(c.env, user.id);
  if (kw !== 'LATE' && kw !== 'HERE' && kw !== 'IM HERE' && text.length > 1 && c.env.ANTHROPIC_API_KEY) {
    const ctx = await intentContext(c.env, user, r);
    const intent = await parseIntent(c.env, user, text, ctx);
    if (intent && await actOn(c.env, user, intent, ctx, text)) return c.json({ ok: true });
  }
  if (!r) {
    await textUser(c.env, user, `No active rental on this number. Browse: ${c.env.APP_URL}/`, 'rental');
    return c.json({ ok: true });
  }
  if (kw === 'LATE') { await relay(c.env, r, user, 'Running ~10 min late', 'text'); return c.json({ ok: true }); }
  if (kw === 'HERE' || kw === 'IM HERE') { await relay(c.env, r, user, "I'm here", 'text'); return c.json({ ok: true }); }
  if (text) await relay(c.env, r, user, text.slice(0, 500), 'text');
  return c.json({ ok: true });
}
