import { minPriceCents } from './identify';
import { logEvent } from './log';
// Plain-English texting: Claude turns a text into one of a few actions. Anything touching money or bookings
// is parked in pending_actions and only runs after the sender replies YES.
import type { Env, Listing, Rental, User } from './env';
import { localToday } from './util';
import { weekDefault } from './util';
import { itemLink } from './urls';
import { saveSearch, allowMore } from './alerts';
import { listingById, userById } from './db';
import { textUser } from './blooio';
import { customerCancel, relay } from './rentals';
import { money, now, firstName, addDays } from './util';
import { CITIES } from './places';

export type Intent =
  | { action: 'message'; text: string }
  | { action: 'find'; query: string; place?: string | null }
  | { action: 'change_price'; item: string | null; price_usd: number }
  | { action: 'cancel' }
  | { action: 'extend'; until: string | null }
  | { action: 'list' }
  | { action: 'ask_lendo'; answer: string; sure: boolean }
  | { action: 'help' };

const MODEL = 'claude-haiku-5-5';

const STATUS_WORDS: Record<string, string> = { inquiry: 'question thread, not requested yet', requested: 'requested, waiting for card', held: 'requested, waiting for the owner to say YES', confirmed: 'owner said YES and it is paid, not picked up yet', picked_up: 'picked up, not returned yet', returned: 'returned' };
export async function parseIntent(env: Env, user: User, text: string, ctx: { rental: Rental | null; role: 'owner' | 'customer' | null; item: string | null; other: string | null; otherTexts?: string | null; listings: { name: string; price_cents: number }[] }): Promise<Intent | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  const sys = `You route text messages sent to Lendo, a neighbor-to-neighbor rental service, into ONE action. Reply with JSON only, no prose.
Actions:
- {"action":"message","text":"..."}  — words written TO the other person in their active rental, as if talking to them (pickup times, "what time can I pick it up?", "running late", "thanks!"). Keep the text as written. If it talks ABOUT the other person (he / she / they / their name in the third person) or about the rental itself, it is NOT a message — it's ask_lendo.
- {"action":"find","query":"..."}  — they want to rent something ("need a ladder saturday", "anyone have a projector", "rent a speaker in nyc"). A text that starts with rent / need / looking for / anyone have is ALWAYS find, even with an active rental. query = the thing, 1-3 words. Add "place":"..." only if they name a city or neighborhood ("in iowa city", "near park slope").
- {"action":"change_price","item":"<one of their listing names or null>","price_usd":10}  — an owner changing a listing's daily price.
- {"action":"cancel"}  — the customer wants to cancel their rental or request.
- {"action":"extend","until":"YYYY-MM-DD or null"}  — the customer wants to keep the item longer.
- {"action":"list"}  — they want to list / rent out their own stuff.
- {"action":"ask_lendo","answer":"...","sure":true}  — a question for Lendo itself, not the other person: how holds, charges, refunds, payouts, fees, cancelling, safety, problems or the site work ("how do I know I'll get the money back", "when do I get paid", "what's this $150"). Answer it yourself in 1-2 short lines from LENDO FACTS only, plain words, no trailing period. If the facts don't cover it, "sure":false and answer "A person at Lendo will text you back". Also ask_lendo: status or "what's going on" questions about their rental or the other person, answered from RENTAL FACTS ("status of ladder", "where's my drill", "did Ken get my message", "why isn't he getting texts", "is she coming", "why no reply"). Questions the other person must answer (what time, where to meet, does it fit) are "message".
- {"action":"help"}  — anything else, or unclear.
LENDO FACTS
- Renting: the customer's card is held when they request; charged only when the owner says YES. NO or no answer in 24h = hold released, nothing charged
- Cancel before YES = free. After YES = half back
- $150 hold: only on items the owner says are worth over $150. A hold, not a charge: the bank reserves $150 from pickup day, Lendo releases it when the item is returned, and the bank drops it within a few days. Never charged automatically. Renewed every 6 days if the rental is longer
- If something goes wrong (damage, missing, not returned), a person at Lendo looks at it; flag it on the rental page
- Owners get the rent minus Lendo's 15% fee, paid after pickup via Stripe; set up at lendo.co/payout
- Payments run through Stripe; Lendo never sees full card numbers
- Customers pay rent + sales tax; owners can give a discount or lend free
- Messages between owner and customer go by text and also show on the rental page (lendo.co/r/…). If someone hasn't texted Lendo back in a while, Lendo holds further texts to them until they reply (a texting-service limit); they still see everything on the rental page
Today is ${localToday()}.`;
  const facts = [
    ctx.rental ? `RENTAL FACTS: they are the ${ctx.role} of "${ctx.item}" with ${ctx.other}, pickup ${ctx.rental.start_day}, due back ${addDays(ctx.rental.end_day, 1)} (a rental day is 24 hours), status ${STATUS_WORDS[ctx.rental.status] || ctx.rental.status}.${ctx.otherTexts ? ' ' + ctx.otherTexts : ''}` : 'No active rental.',
    ctx.listings.length ? `Their listings: ${ctx.listings.map(l => `${l.name} ($${l.price_cents / 100}/day)`).join('; ')}.` : 'They have no listings.',
  ].join('\n');
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 300, system: sys, messages: [{ role: 'user', content: `${facts}\n\nText: ${JSON.stringify(text.slice(0, 600))}` }] }),
    });
    if (!r.ok) { console.warn('intent http', r.status, await r.text()); return null; }
    const j: any = await r.json();
    const out = String(j.content?.[0]?.text || '');
    const m = out.match(/\{[\s\S]*\}/); if (!m) return null;
    const v = JSON.parse(m[0]);
    if (!v || typeof v.action !== 'string') return null;
    return v as Intent;
  } catch (e) { console.warn('intent failed', e); return null; }
}

async function park(env: Env, uid: string, kind: string, payload: unknown) {
  await env.DB.prepare('INSERT INTO pending_actions (user_id, kind, payload, expires_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET kind = excluded.kind, payload = excluded.payload, expires_at = excluded.expires_at')
    .bind(uid, kind, JSON.stringify(payload), now() + 15 * 60000).run();
}

// YES / NO to a parked action. Returns true if there was one.
export async function answerPending(env: Env, user: User, yes: boolean): Promise<boolean> {
  const p = await env.DB.prepare('SELECT * FROM pending_actions WHERE user_id = ? AND expires_at > ?').bind(user.id, now()).first<{ kind: string; payload: string }>();
  if (!p) return false;
  if (p.kind === 'alerts_more') {
    // an owner's YES to a waiting request always wins over "more alerts"
    const held = await env.DB.prepare(`SELECT 1 FROM rentals WHERE owner_id = ? AND status = 'held' LIMIT 1`).bind(user.id).first();
    if (held) return false;
    await env.DB.prepare('DELETE FROM pending_actions WHERE user_id = ?').bind(user.id).run();
    if (yes) await allowMore(env, user); else await textUser(env, user, `Ok, 1 alert a day`, 'alert');
    return true;
  }
  await env.DB.prepare('DELETE FROM pending_actions WHERE user_id = ?').bind(user.id).run();
  if (!yes) { await textUser(env, user, `Skipped — nothing changed`, 'rental'); return true; }
  const d = JSON.parse(p.payload);
  if (p.kind === 'change_price') {
    const it = await listingById(env.DB, d.lid);
    if (!it || it.owner_id !== user.id) return true;
    const week = weekDefault(d.cents);
    await env.DB.prepare('UPDATE listings SET price_cents = ?, week_cents = ? WHERE id = ?').bind(d.cents, week, it.id).run();
    await textUser(env, user, `${it.name} is now ${money(d.cents)}/day ${await itemLink(env, it.id)}`, 'rental');
  } else if (p.kind === 'cancel') {
    const r = await env.DB.prepare('SELECT * FROM rentals WHERE id = ? AND renter_id = ?').bind(d.rid, user.id).first<Rental>();
    if (r) { const res = await customerCancel(env, r); if (!res) await textUser(env, user, `Couldn't cancel that one — open it here ${env.APP_URL}/r/${r.id}`, 'rental', r.id); else if (res === 'released') await textUser(env, user, `Canceled — nothing charged`, 'rental', r.id); }
  }
  return true;
}

// Act on an intent. Returns false when the caller should fall back to the old behavior.
/* backstop: a status question about the rental / the other person never goes to them, even if the AI said "message" or is down */
export async function statusBackstop(env: Env, user: User, ctx: { rental: Rental | null; item?: string | null; otherTexts?: string | null }, raw: string): Promise<boolean> {
  const t = raw.replace(/[\u2018\u2019]/g, "'");
  if (!ctx.rental || !ABOUT_RE.test(t) || /\byou\b/i.test(t)) return false;
  const st = STATUS_WORDS[ctx.rental.status] || ctx.rental.status;
  await textUser(env, user, `Lendo: ${ctx.item || 'Your rental'} · ${st}${ctx.otherTexts ? ' · ' + ctx.otherTexts.replace(/\.$/, '') : ''} ${env.APP_URL}/r/${ctx.rental.id}`, 'rental', ctx.rental.id);
  await logEvent(env.DB, 'text.ask_lendo', { user: user.id, rental: ctx.rental.id, data: { q: raw.slice(0, 300), a: 'status backstop', sure: true } });
  return true;
}
const ABOUT_RE = /^\s*(status\b|update\b|what'?s (going on|happening|the status)|why (isn'?t|hasn'?t|won'?t|doesn'?t|is ?n'?t|no)|did (he|she|they|\w+) (get|see|reply|answer)|is (he|she|they) (coming|getting|there|ok)|where'?s my|has (he|she|they)\b)/i;
export async function actOn(env: Env, user: User, it: Intent, ctx: { rental: Rental | null; role: 'owner' | 'customer' | null; item?: string | null; otherTexts?: string | null; listings: Listing[] }, raw: string): Promise<boolean> {
  const url = env.APP_URL;
  switch (it.action) {
    case 'message':
      if (!ctx.rental) return false;
      if (await statusBackstop(env, user, ctx, raw)) return true;
      await relay(env, ctx.rental, user, (it.text || raw).slice(0, 500), 'text');
      return true;
    case 'find': {
      const q = (it.query || '').trim().slice(0, 40); if (!q) return false;
      let lat = user.lat ?? 40.7348, lng = user.lng ?? -73.9937, d = 0.05, z = 13, where = user.hood || null;
      const pl = placeFor(it.place); if (pl) { lat = pl.lat; lng = pl.lng; d = pl.d; z = pl.z; where = pl.name; }
      const box = [`%${q}%`, lat - d, lat + d, lng - d * 1.3, lng + d * 1.3];
      const hit = await env.DB.prepare(`SELECT COUNT(*) n, MIN(price_cents) lo FROM listings WHERE status = 'live' AND name LIKE ? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`).bind(...box).first<{ n: number; lo: number | null }>();
      const n = hit?.n || 0, near = where ? 'near ' + where : 'nearby';
      /* link to the map search, not one item: customer sees every match + can narrow */
      const link = `${url}/?q=${encodeURIComponent(q)}&c=${lng.toFixed(4)},${lat.toFixed(4)}&z=${z}`;
      const many = n === 1 ? q : /s$/i.test(q) ? q : q + 's';
      if (n) await textUser(env, user, `${n} ${many} for rent ${near}, from ${money(hit!.lo || 0)}/day ${link} · Reply with anything else you need`, 'rental');
      else await textUser(env, user, `No ${q} for rent ${near} yet — alert on, you'll get a text when one's listed. Know someone who might have one? ${url}/list`, 'rental');
      await saveSearch(env, user, q, lat, lng, where);
      return true;
    }
    case 'change_price': {
      const cents = Math.round((it.price_usd || 0) * 100), min = await minPriceCents(env);
      if (!ctx.listings.length) { await textUser(env, user, `No listings on this number yet. List something ${url}/list`, 'rental'); return true; }
      const name = (it.item || '').toLowerCase();
      const match = ctx.listings.length === 1 ? ctx.listings[0] : ctx.listings.find(l => name && (l.name.toLowerCase().includes(name) || name.includes(l.name.toLowerCase())));
      if (!match) { await textUser(env, user, `Which one? ${ctx.listings.map(l => l.name).slice(0, 6).join(', ')} — or change it here ${url}/listings`, 'rental'); return true; }
      if (cents < min) { await textUser(env, user, `Lowest is ${money(min)}/day. To lend it free, accept a request and tap Give a discount`, 'rental'); return true; }
      await park(env, user.id, 'change_price', { lid: match.id, cents });
      await textUser(env, user, `Change ${match.name} from ${money(match.price_cents)} to ${money(cents)}/day? Reply YES`, 'rental');
      return true;
    }
    case 'cancel': {
      const r = ctx.rental && ctx.role === 'customer' && (ctx.rental.status === 'held' || ctx.rental.status === 'confirmed') ? ctx.rental : null;
      if (!r) return false;
      const item = await listingById(env.DB, r.listing_id);
      await park(env, user.id, 'cancel', { rid: r.id });
      await textUser(env, user, r.status === 'held' ? `Cancel your request for ${item?.name}? Nothing gets charged. Reply YES` : `Cancel ${item?.name}? The owner already said yes, so ${money(Math.round(r.total_cents / 2))} comes back (half). Reply YES`, 'rental', r.id);
      return true;
    }
    case 'extend': {
      if (!ctx.rental || ctx.role !== 'customer') return false;
      await textUser(env, user, `Pick a new return date here ${url}/r/${ctx.rental.id}`, 'rental', ctx.rental.id);
      return true;
    }
    case 'ask_lendo': {
      const a = String(it.answer || '').replace(/\.\s*$/, '').slice(0, 320); if (!a) return false;
      await textUser(env, user, `Lendo: ${a}${ctx.rental ? ` ${url}/r/${ctx.rental.id}` : ''}`, 'rental', ctx.rental?.id);
      await logEvent(env.DB, 'text.ask_lendo', { user: user.id, rental: ctx.rental?.id ?? null, data: { q: raw.slice(0, 300), a, sure: it.sure !== false } });
      return true;
    }
    case 'list':
      await textUser(env, user, `Snap it, price it, done ${url}/list`, 'nudge');
      return true;
    default:
      await textUser(env, user, `Text what you need: "need a ladder saturday", "drill $10", "cancel", or a message for the other person. Reply STOP to stop texts`, 'rental');
      return true;
  }
}

export async function intentContext(env: Env, user: User, rental: Rental | null) {
  const listings = (await env.DB.prepare(`SELECT * FROM listings WHERE owner_id = ? AND status = 'live' ORDER BY created_at DESC LIMIT 20`).bind(user.id).all<Listing>()).results;
  let role: 'owner' | 'customer' | null = null, item: string | null = null, other: string | null = null, otherTexts: string | null = null;
  if (rental) {
    role = rental.owner_id === user.id ? 'owner' : 'customer';
    item = (await listingById(env.DB, rental.listing_id))?.name || null;
    const o = await userById(env.DB, role === 'owner' ? rental.renter_id : rental.owner_id);
    other = firstName(o?.name || 'them');
    if (o) {
      /* what Lendo knows about texts reaching the other person: held (texting-service limit), STOP, last time they texted in */
      const held = (await env.DB.prepare(`SELECT COUNT(*) n FROM outbound_texts WHERE user_id = ? AND provider_id IS NULL AND created_at > ?`).bind(o.id, now() - 3 * 86400e3).first<{ n: number }>())?.n || 0;
      const lastIn = (await env.DB.prepare(`SELECT MAX(created_at) t FROM inbound_texts WHERE user_id = ? AND via = 'text'`).bind(o.id).first<{ t: number | null }>())?.t || null;
      const ago = (t: number) => { const h = Math.round((now() - t) / 3600e3); return h < 1 ? 'within the hour' : h < 48 ? `${h}h ago` : `${Math.round(h / 24)} days ago`; };
      otherTexts = [
        !o.texts ? `${other} turned texts off (STOP), so they only see messages on the rental page.` : held ? `${held} recent text${held === 1 ? '' : 's'} to ${other} are on hold until ${other} texts Lendo back (texting-service limit); they still show on ${other}'s rental page.` : `Texts to ${other} are going through.`,
        lastIn ? `${other} last texted Lendo ${ago(lastIn)}.` : `${other} has never texted Lendo.`,
      ].join(' ');
    }
  }
  return { rental, role, item, other, otherTexts, listings };
}

// "in iowa city" / "near park slope" → that city or hood instead of the sender's home
function placeFor(p0?: string | null): { name: string; lat: number; lng: number; d: number; z: number } | null {
  const p = (p0 || '').toLowerCase().replace(/[^a-z ]/g, '').trim(); if (p.length < 2) return null;
  for (const c of CITIES) for (const h of c.hoods) if (h.name.toLowerCase() === p) return { name: h.name, lat: h.lat, lng: h.lng, d: h.r ? h.r / 111 : 0.03, z: h.z || 14 };
  for (const c of CITIES) { const n = c.name.toLowerCase(); if (n === p || n.includes(p) || p.includes(n) || (c as any).short?.toLowerCase() === p) return { name: c.name, lat: c.lat, lng: c.lng, d: 0.12, z: (c as any).zoom || 11 }; }
  return null;
}
