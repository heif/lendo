import { twilioSigOk } from '../lib/twiliosms';
import { answerPending, actOn, intentContext, parseIntent, statusBackstop } from '../lib/intent';
import { logErr, logEvent } from '../lib/log';
import { CONFIRM_ASK, KEEP_ASK } from '../lib/blooio';
import { acceptExt, declineExt, extById, extFromSession, heldExtForOwner, markExtHeld } from '../lib/extend';
import { turnOff } from '../lib/alerts';
import { Hono, type Context } from 'hono';
import type Stripe from 'stripe';
import type { Env, Rental, User, Vars } from '../lib/env';
import { cardFromSetup, rememberCard, stripe } from '../lib/stripe';
import { parseInbound, textUser } from '../lib/blooio';
import { linqParse, linqVerify } from '../lib/linq';
import { ensureUser, rentalById, unpauseTexted, userByPhone } from '../lib/db';
import { loginLink } from '../lib/auth';
import { accept, activeRentalFor, decline, holdDeposit, markHeld, relay } from '../lib/rentals';
import { hmacHex, normPhone, timingSafeEq, firstName } from '../lib/util';

export const webhooks = new Hono<{ Bindings: Env; Variables: Vars }>();

// ---------- Stripe ----------
webhooks.post('/webhooks/stripe', async (c) => {
  const s = stripe(c.env);
  if (!s || !c.env.STRIPE_WEBHOOK_SECRET) return c.text('stripe not configured', 501);
  const sig = c.req.header('stripe-signature') || '';
  const raw = await c.req.text();
  let ev: Stripe.Event;
  try { ev = await s.webhooks.constructEventAsync(raw, sig, c.env.STRIPE_WEBHOOK_SECRET); } catch (e) { await logEvent(c.env.DB, 'stripe.bad_signature', {}); return c.text('bad signature', 400); }
  { const o: any = ev.data.object; await logEvent(c.env.DB, 'stripe.' + ev.type, { rental: o?.metadata?.rental_id || o?.client_reference_id || null, cents: o?.amount_total ?? o?.amount ?? null, data: { id: ev.id, obj: o?.id, ext: o?.metadata?.ext_id ?? null } }); }
  if (ev.type === 'checkout.session.completed') {
    const cs = ev.data.object as Stripe.Checkout.Session;
    const xid = extFromSession(cs);
    const rid = xid ? null : cs.metadata?.rental_id || cs.client_reference_id;
    if (xid) await markExtHeld(c.env, xid, typeof cs.payment_intent === 'string' ? cs.payment_intent : cs.payment_intent?.id ?? null, cs.id);
    if (cs.mode === 'setup') { /* new card for a $150 hold that didn't take → save it, try again */
      const did = await cardFromSetup(c.env, cs); const r = did ? await rentalById(c.env.DB, did) : null;
      if (r && (r.status === 'confirmed' || r.status === 'picked_up') && r.deposit_status === 'due') await holdDeposit(c.env, r);
    } else if (rid) {
      const r = await rentalById(c.env.DB, rid);
      const pi = typeof cs.payment_intent === 'string' ? cs.payment_intent : cs.payment_intent?.id ?? null;
      if (r && (r.deposit_cents || 0) > 0) await rememberCard(c.env, r.id, pi);
      if (r) await markHeld(c.env, r, pi, cs.id);
    }
  } else if (ev.type === 'checkout.session.expired') {
    const cs = ev.data.object as Stripe.Checkout.Session;
    const rid = cs.metadata?.rental_id;
    const xid = extFromSession(cs);
    if (xid) { const x = await extById(c.env, xid); if (x && x.status === 'requested') await declineExt(c.env, x, 'canceled'); }
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
// Keywords: YES / NO (owner answers a held request), HERE, STOP, STOP NUDGES, START, LIST, HELP.
// Anything else relays to the other party of the sender's most recent active rental.
webhooks.post('/webhooks/blooio', async (c) => {
  try { return await blooioInbound(c); }
  catch (e: any) { await logErr(c.env.DB, 'blooio inbound', e); await c.env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('last_inbound_err', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(`${Date.now()} ${e?.stack || e}`.slice(0, 1500)).run(); return c.json({ ok: false }, 500); }
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
  if (ev && ev !== 'message.received') {
    /* delivery receipts (message.sent / delivered / failed / read …) → events 'text.status', matched to outbound_texts.provider_id in /admin/texts */
    if (ev.startsWith('message.')) { const d = j.data || j; await logEvent(c.env.DB, 'text.status', { data: { status: ev.slice(8), id: d.message_id || d.id || j.message_id || null, to: String(d.external_id || d.recipient || d.to || d.chat_id || '').slice(-4), err: d.error || d.error_message || d.reason || null, via: d.protocol || d.service || null } }); }
    return c.json({ ok: true, logged: ev });
  }
  const m = parseInbound(j);
  // debug breadcrumb: last inbound seen (event + sender suffix + time); no message text stored
  c.executionCtx.waitUntil(c.env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('last_inbound', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify({ t: Date.now(), ev, from: m ? String(m.from).slice(-4) : null })).run().then(() => {}));
  if (!m) return c.json({ ok: true, ignored: 'no sender' });
  return inboundText(c, normPhone(m.from) || m.from, m.text, false);
}
/* Linq: iMessage/RCS/SMS in one; same handling as Blooio. Subscribe message.received (+ delivery events) to https://lendo.co/webhooks/linq */
webhooks.post('/webhooks/linq', async (c) => {
  try {
    const raw = await c.req.text();
    if (c.env.LINQ_WEBHOOK_SECRET && !(await linqVerify(c.env.LINQ_WEBHOOK_SECRET, k => c.req.header(k), raw))) return c.text('bad signature', 401);
    let j: any; try { j = JSON.parse(raw); } catch { return c.text('bad json', 400); }
    const m = linqParse(j);
    if (!m) return c.json({ ok: true });
    /* at-least-once delivery: drop repeats by event id */
    const eid = String(j.event_id || ''); if (eid) { const seen = await c.env.DB.prepare('SELECT 1 FROM events WHERE kind = ? AND data = ? LIMIT 1').bind('linq.event', eid).first().catch(() => null); if (seen) return c.json({ ok: true, dup: true }); await logEvent(c.env.DB, 'linq.event', { data: eid }); }
    if (m.event !== 'message.received') {
      if (m.event.startsWith('message.')) { const d = j.data || {}; await logEvent(c.env.DB, 'text.status', { data: { status: m.event.slice(8), id: d.id || d.message_id || d.message?.id || null, err: d.error || d.error_message || d.reason || null, via: d.service || null } }); }
      return c.json({ ok: true, logged: m.event });
    }
    c.executionCtx.waitUntil(c.env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('last_inbound', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify({ t: Date.now(), ev: 'linq ' + m.event, from: String(m.from).slice(-4), via: m.service || null })).run().then(() => {}));
    if (m.mine || !m.from || !m.text) return c.json({ ok: true, ignored: true });
    return inboundText(c, normPhone(m.from) || m.from, m.text, /sms|rcs/i.test(m.service || ''));
  } catch (e: any) { await logErr(c.env.DB, 'linq inbound', e); return c.json({ ok: false }, 500); }
});
/* Android: texts to the Twilio SMS number (form-encoded), same handling as Blooio; replies go back by Twilio */
webhooks.post('/webhooks/twilio', async (c) => {
  const f = Object.fromEntries(Object.entries(await c.req.parseBody()).map(([k, v]) => [k, String(v)]));
  const url = c.env.APP_URL.replace(/\/$/, '') + '/webhooks/twilio';
  if (!(await twilioSigOk(c.env, url, f, c.req.header('x-twilio-signature') || ''))) return c.text('bad signature', 401);
  try { await inboundText(c, normPhone(f.From || '') || f.From || '', String(f.Body || ''), true); }
  catch (e: any) { await logErr(c.env.DB, 'twilio inbound', e); }
  return c.body('<Response></Response>', 200, { 'content-type': 'text/xml' });
});
async function inboundText(c: Context<{ Bindings: Env; Variables: Vars }>, phone: string, body: string, sms: boolean) {
  if (sms) { const u0 = await userByPhone(c.env.DB, phone); if (u0) await c.env.DB.prepare('UPDATE users SET android = 1 WHERE id = ?').bind(u0.id).run(); }
  const m = { text: body };
  const user = await userByPhone(c.env.DB, phone);
  const text = m.text.trim();
  const kw = text.toUpperCase().replace(/[^A-Z ]/g, '').trim();
  if (!user) {
    await logEvent(c.env.DB, 'text.in_unknown', { data: { from: phone, body: text.slice(0, 500) } });
    if (!/^\+1\d{10}$/.test(phone) || kw === 'STOP' || kw === 'HELP') return c.json({ ok: true, unknown: true });
    /* a new person texting first (gift card button, Text Lendo bar): they're in — account by phone, texted login link */
    const nu = await ensureUser(c.env.DB, phone);
    await c.env.DB.prepare('UPDATE users SET replied = 1, android = ? WHERE id = ?').bind(sms ? 1 : 0, nu.id).run(); await c.env.DB.prepare('UPDATE users SET sms_ok = 1 WHERE id = ?').bind(nu.id).run().catch(() => 0); await logEvent(c.env.DB, 'sms.optin', { user: nu.id, data: { via: 'texted Lendo first' } }); nu.replied = 1; if (sms) (nu as any).android = 1;
    await logEvent(c.env.DB, 'user.signup', { user: nu.id, data: { via: 'text' } });
    const gift = /\$5|gift/i.test(text), giftVar = /off rental/i.test(text) ? 'a' : 'b'; /* A/B: "$5 off rental" vs "$5 gift card" */
    if (gift) await logEvent(c.env.DB, 'ab.gift5', { user: nu.id, data: { ev: 'claim', var: giftVar, via: 'text' } });
    if (gift) await c.env.DB.prepare('UPDATE users SET promo_cents = 500, promo_claimed_at = ? WHERE id = ? AND promo_claimed_at IS NULL').bind(Date.now(), nu.id).run();
    const link = await loginLink(c.env, phone);
    await textUser(c.env, nu, gift
      ? `Welcome to Lendo! ${giftVar === 'a' ? '$5 off' : 'Your $5 gift card is on'} your first rental${giftVar === 'a' ? ' is on' : ''}. You're in: ${link} · Lendo texts cover logins, rentals and alerts you turn on · msg frequency varies · msg & data rates may apply · reply HELP for help, STOP to opt out`
      : `Welcome to Lendo! You're in: ${link} · Lendo texts cover logins, rentals and alerts you turn on · msg frequency varies · msg & data rates may apply · reply HELP for help, STOP to opt out`, 'login');
    if (gift) return c.json({ ok: true, welcomed: true });
    return handleText(c, nu, text, 'text'); /* "Hi! I need a ladder" → matches */
  }
  if (/\$5|gift card/i.test(text) && text.length < 40) { /* already a member, tapped the gift button again */
    if (!user.promo_claimed_at) await c.env.DB.prepare('UPDATE users SET promo_cents = 500, promo_claimed_at = ? WHERE id = ?').bind(Date.now(), user.id).run();
    await textUser(c.env, user, `${user.promo_claimed_at ? 'Your $5 gift card is already on this number' : 'Your $5 gift card is on your first rental'}: ${await loginLink(c.env, phone)} · Reply OK to confirm`, 'login');
    return c.json({ ok: true });
  }
  return handleText(c, user, text, 'text');
}

// One brain for everything a person sends Lendo — by text or typed in the web inbox.
const FIND_RE = /^\s*(i\s+)?(rent|need|looking for|anyone have|anybody have|does anyone have|who has|find|borrow|want to rent|wanna rent)\b/i;

export async function handleText(c: Context<{ Bindings: Env; Variables: Vars }>, user: User, text: string, via: 'text' | 'web') {
  const kw = text.toUpperCase().replace(/[^A-Z ]/g, '').trim();
  await c.env.DB.prepare('INSERT INTO inbound_texts (id, user_id, body, via, created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), user.id, text.slice(0, 500), via, Date.now()).run().catch(() => {});
  if (!user.replied && via === 'text') { await c.env.DB.prepare('UPDATE users SET replied = 1 WHERE id = ?').bind(user.id).run(); user.replied = 1; }
  if (via === 'text') await unpauseTexted(c.env.DB, user.id).catch(() => 0);
  /* texting Lendo turns rental texts on (documented opt-in method 2 at lendo.co/sms) — but never after STOP, which has its own START */
  if (via === 'text' && user.sms_ok === 0 && user.texts && !/^(STOP|UNSUBSCRIBE|CANCEL|END|QUIT|STOPALL)$/.test(kw)) { await c.env.DB.prepare('UPDATE users SET sms_ok = 1 WHERE id = ?').bind(user.id).run().catch(() => 0); user.sms_ok = 1; await logEvent(c.env.DB, 'sms.optin', { user: user.id, data: { via: 'texted Lendo', body: text.slice(0, 60) } }); }
  if (kw === 'OK' || kw === 'OKAY' || kw === 'K' || kw === 'GOT IT' || kw === 'THANKS' || kw === 'THANK YOU') {
    /* OK to a Lendo confirm ask = acknowledged; no reply (the inbound text already reset Blooio's count) */
    const last = await c.env.DB.prepare(`SELECT body FROM outbound_texts WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`).bind(user.id).first<{ body: string }>().catch(() => null);
    if (last && (last.body.endsWith(CONFIRM_ASK) || last.body.endsWith(KEEP_ASK) || last.body.includes('Reply OK to get links'))) { await logEvent(c.env.DB, 'text.ack', { user: user.id, data: { via } }); return c.json({ ok: true }); }
    const r0 = await activeRentalFor(c.env, user.id);
    if (!r0) { await textUser(c.env, user, `You're set. Rentals: ${c.env.APP_URL}/rentals · Map: ${c.env.APP_URL}/`, 'rental'); return c.json({ ok: true }); }
  }
  if (kw === 'STOP' || kw === 'UNSUBSCRIBE' || kw === 'CANCEL') {
    /* Twilio (SMS) sends its own STOP confirmation; the iMessage line needs one from Lendo */
    if (via === 'text' && !(user as any).android) await textUser(c.env, user, `Lendo: you're unsubscribed and won't get more texts. Reply START to resubscribe`, 'rental').catch(() => null);
    await c.env.DB.prepare('UPDATE users SET texts = 0, nudges = 0 WHERE id = ?').bind(user.id).run();
    return c.json({ ok: true });
  }
  if (kw === 'START' || kw === 'UNSTOP') {
    await c.env.DB.prepare('UPDATE users SET texts = 1 WHERE id = ?').bind(user.id).run();
    await textUser(c.env, { ...user, texts: 1 }, `Lendo: you're opted in to rental texts (logins, rental updates, alerts you turn on). Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out`, 'rental');
    return c.json({ ok: true });
  }
  if (kw === 'STOP NUDGES' || kw === 'NO NUDGES') {
    await c.env.DB.prepare('UPDATE users SET nudges = 0 WHERE id = ?').bind(user.id).run();
    await textUser(c.env, user, `Got it — no more listing tips. You'll still get rental and money texts.`, 'rental');
    return c.json({ ok: true });
  }
  if (kw === 'ALERTS OFF' || kw === 'STOP ALERTS' || kw === 'NO ALERTS') {
    await turnOff(c.env, user);
    await textUser(c.env, user, `Alerts off. Turn any back on at ${c.env.APP_URL}/alerts`, 'rental');
    return c.json({ ok: true });
  }
  if (kw === 'SKIP') { await textUser(c.env, user, `Ok — the customer can text you to set a time`, 'rental'); return c.json({ ok: true }); }
  if (kw === 'LIST') { await textUser(c.env, user, `Point, tap, done: ${c.env.APP_URL}/list`, 'nudge'); return c.json({ ok: true }); }
  if (kw === 'HELP') { await textUser(c.env, user, `Lendo: neighbor-to-neighbor rentals. Reply YES/NO to a request. Help: ${c.env.APP_URL}/terms · Your rentals: ${c.env.APP_URL}/rentals · Msg & data rates may apply · Reply STOP to opt out`, 'rental'); return c.json({ ok: true }); }

  // a parked plain-English action (price change, cancel) waiting for YES wins over an owner's pending request
  if ((kw === 'YES' || kw === 'Y' || kw === 'NO' || kw === 'N') && await answerPending(c.env, user, kw.startsWith('Y'))) return c.json({ ok: true });
  const coded = text.trim().match(/^(yes|y|no|n)\s+#?([a-z0-9]{4})$/i);
  if (coded || kw === 'YES' || kw === 'Y' || kw === 'ACCEPT' || kw === 'NO' || kw === 'N' || kw === 'PASS' || kw === 'DECLINE') {
    const kw2 = coded ? coded[1].toUpperCase() : kw; /* eslint-disable-line */
    const held = coded
      ? (await c.env.DB.prepare(`SELECT * FROM rentals WHERE owner_id = ? AND status = 'held' ORDER BY created_at DESC`).bind(user.id).all<Rental>()).results.find(x => x.id.slice(-4).toLowerCase() === coded[2].toLowerCase()) ?? null
      : await c.env.DB.prepare(`SELECT * FROM rentals WHERE owner_id = ? AND status = 'held' ORDER BY created_at DESC LIMIT 1`).bind(user.id).first<Rental>();
    if (held) {
      if (kw2.startsWith('Y') || kw2 === 'ACCEPT') { const ok = await accept(c.env, held); if (!ok) await textUser(c.env, user, `Couldn't confirm that one — open it here: ${c.env.APP_URL}/r/${held.id}`, 'rental', held.id); }
      else await decline(c.env, held, 'declined');
      return c.json({ ok: true });
    }
    // no pending rental request → an extension waiting for this owner?
    const hx = await heldExtForOwner(c.env, user.id);
    if (hx) { if (kw.startsWith('Y') || kw === 'ACCEPT') await acceptExt(c.env, hx); else await declineExt(c.env, hx, 'declined'); return c.json({ ok: true }); }
    // no pending request → fall through to relay
  }

  const r = await activeRentalFor(c.env, user.id);
  if (kw !== 'HERE' && kw !== 'IM HERE' && text.length > 1 && c.env.ANTHROPIC_API_KEY) {
    const ctx = await intentContext(c.env, user, r);
    /* "rent a speaker", "need a drill" = a search, never words for the other person in a rental */
    const looking = FIND_RE.test(text);
    const intent = await parseIntent(c.env, user, text, looking ? { ...ctx, rental: null, role: null, item: null, other: null } : ctx);
    if (intent && await actOn(c.env, user, intent, ctx, text)) return c.json({ ok: true });
  }
  // a newer pre-rental question thread wins for plain replies
  const q = await activeRentalFor(c.env, user.id, ['inquiry']);
  const tgt = q && (!r || q.updated_at > r.updated_at) ? q : r;
  if (!tgt) {
    await textUser(c.env, user, `No active rental on this number. Browse: ${c.env.APP_URL}/`, 'rental');
    return c.json({ ok: true });
  }
  if (r && (kw === 'HERE' || kw === 'IM HERE')) { await relay(c.env, r, user, "I'm here", 'text'); return c.json({ ok: true }); }
  if (tgt.status === 'inquiry') await c.env.DB.prepare('UPDATE rentals SET updated_at = ? WHERE id = ?').bind(Date.now(), tgt.id).run();
  if (text && tgt.id === r?.id && await statusBackstop(c.env, user, await intentContext(c.env, user, r), text)) return c.json({ ok: true });
  if (text) await relay(c.env, tgt, user, text.slice(0, 500), 'text');
  return c.json({ ok: true });
}
