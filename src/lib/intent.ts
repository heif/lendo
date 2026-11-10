// Plain-English texting: Claude turns a text into one of a few actions. Anything touching money or bookings
// is parked in pending_actions and only runs after the sender replies YES.
import type { Env, Listing, Rental, User } from './env';
import { saveSearch, allowMore } from './alerts';
import { listingById, userById } from './db';
import { textUser } from './blooio';
import { customerCancel, relay } from './rentals';
import { money, now, firstName } from './util';

export type Intent =
  | { action: 'message'; text: string }
  | { action: 'find'; query: string }
  | { action: 'change_price'; item: string | null; price_usd: number }
  | { action: 'cancel' }
  | { action: 'extend'; until: string | null }
  | { action: 'list' }
  | { action: 'help' };

const MODEL = 'claude-haiku-5-5';

export async function parseIntent(env: Env, user: User, text: string, ctx: { rental: Rental | null; role: 'owner' | 'customer' | null; item: string | null; other: string | null; listings: { name: string; price_cents: number }[] }): Promise<Intent | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  const sys = `You route text messages sent to Lendo, a neighbor-to-neighbor rental service, into ONE action. Reply with JSON only, no prose.
Actions:
- {"action":"message","text":"..."}  — words meant for the other person in their active rental (pickup times, questions, "running late", thanks). Keep the text as written.
- {"action":"find","query":"..."}  — they want to rent something ("need a ladder saturday", "anyone have a projector"). query = the thing, 1-3 words.
- {"action":"change_price","item":"<one of their listing names or null>","price_usd":10}  — an owner changing a listing's daily price.
- {"action":"cancel"}  — the customer wants to cancel their rental or request.
- {"action":"extend","until":"YYYY-MM-DD or null"}  — the customer wants to keep the item longer.
- {"action":"list"}  — they want to list / rent out their own stuff.
- {"action":"help"}  — anything else, or unclear.
Today is ${new Date().toISOString().slice(0, 10)}.`;
  const facts = [
    ctx.rental ? `Active rental: they are the ${ctx.role} of "${ctx.item}" with ${ctx.other}, ${ctx.rental.start_day} to ${ctx.rental.end_day}, status ${ctx.rental.status}.` : 'No active rental.',
    ctx.listings.length ? `Their listings: ${ctx.listings.map(l => `${l.name} ($${l.price_cents / 100}/day)`).join('; ')}.` : 'They have no listings.',
  ].join('\n');
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 200, system: sys, messages: [{ role: 'user', content: `${facts}\n\nText: ${JSON.stringify(text.slice(0, 600))}` }] }),
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
    const week = Math.round(d.cents * 7 * 0.7);
    await env.DB.prepare('UPDATE listings SET price_cents = ?, week_cents = ? WHERE id = ?').bind(d.cents, week, it.id).run();
    await textUser(env, user, `${it.name} is now ${money(d.cents)}/day ${env.APP_URL}/i/${it.id}`, 'rental');
  } else if (p.kind === 'cancel') {
    const r = await env.DB.prepare('SELECT * FROM rentals WHERE id = ? AND renter_id = ?').bind(d.rid, user.id).first<Rental>();
    if (r) { const res = await customerCancel(env, r); if (!res) await textUser(env, user, `Couldn't cancel that one — open it here ${env.APP_URL}/r/${r.id}`, 'rental', r.id); else if (res === 'released') await textUser(env, user, `Canceled — nothing charged`, 'rental', r.id); }
  }
  return true;
}

// Act on an intent. Returns false when the caller should fall back to the old behavior.
export async function actOn(env: Env, user: User, it: Intent, ctx: { rental: Rental | null; role: 'owner' | 'customer' | null; listings: Listing[] }, raw: string): Promise<boolean> {
  const url = env.APP_URL;
  switch (it.action) {
    case 'message':
      if (!ctx.rental) return false;
      await relay(env, ctx.rental, user, (it.text || raw).slice(0, 500), 'text');
      return true;
    case 'find': {
      const q = (it.query || '').trim().slice(0, 40); if (!q) return false;
      const lat = user.lat ?? 40.7348, lng = user.lng ?? -73.9937, d = 0.05;
      const rows = (await env.DB.prepare(`SELECT id, name, price_cents, hood FROM listings WHERE status = 'live' AND name LIKE ? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? ORDER BY ((lat - ?) * (lat - ?) + (lng - ?) * (lng - ?)) LIMIT 3`)
        .bind(`%${q}%`, lat - d, lat + d, lng - d * 1.3, lng + d * 1.3, lat, lat, lng, lng).all<{ id: string; name: string; price_cents: number; hood: string | null }>()).results;
      if (rows.length) await textUser(env, user, `${q} near you:\n${rows.map(r => `${r.name} ${money(r.price_cents)}/day${r.hood ? ' · ' + r.hood : ''} ${url}/i/${r.id}`).join('\n')}`, 'rental');
      else await textUser(env, user, `No ${q} nearby yet — alert on, you'll get a text when one's listed. Know someone who might have one? ${url}/list`, 'rental');
      await saveSearch(env, user, q, lat, lng, user.hood);
      return true;
    }
    case 'change_price': {
      const cents = Math.round((it.price_usd || 0) * 100), min = parseInt(env.MIN_PRICE_CENTS || '800', 10);
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
  let role: 'owner' | 'customer' | null = null, item: string | null = null, other: string | null = null;
  if (rental) {
    role = rental.owner_id === user.id ? 'owner' : 'customer';
    item = (await listingById(env.DB, rental.listing_id))?.name || null;
    other = firstName((await userById(env.DB, role === 'owner' ? rental.renter_id : rental.owner_id))?.name || 'them');
  }
  return { rental, role, item, other, listings };
}
