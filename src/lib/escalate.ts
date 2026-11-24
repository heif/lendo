// Requests are emailed with the text (rentals.ts hold). This is the safety net: a held request with no email sent yet gets one.
// One email per request. Sooner when pickup is today or tomorrow.
import type { Env, Rental } from './env';
import { emailRequest } from './email';
import { userById, listingById } from './db';
import { addDays, localToday, money, now } from './util';
import { logEvent } from './log';
import { cutoutUrl } from './cutout';

export async function escalateHolds(env: Env): Promise<number> {
  const rows = (await env.DB.prepare(`SELECT * FROM rentals WHERE status = 'held' AND held_at IS NOT NULL AND held_at < ?`).bind(now() - 15 * 60e3).all<Rental>()).results;
  let n = 0;
  for (const r of rows) {
    const it = await listingById(env.DB, r.listing_id); if (!it) continue;
    const soon = r.start_day <= addDays(localToday(it.lng), 1);
    if (now() - (r.held_at || now()) < (soon ? 15 : 120) * 60e3) continue;
    if (await env.DB.prepare(`SELECT 1 FROM events WHERE kind = 'escalate.email' AND rental_id = ? LIMIT 1`).bind(r.id).first()) continue;
    const owner = await userById(env.DB, r.owner_id), cust = await userById(env.DB, r.renter_id); if (!owner || !cust) continue;
    await logEvent(env.DB, 'escalate.email', { user: owner.id, rental: r.id, data: { soon, has_email: !!owner.email } }); /* claim first: one try per request */
    if (!owner.email) continue;
    if (await env.DB.prepare(`SELECT 1 FROM events WHERE kind = 'email.sent' AND rental_id = ? LIMIT 1`).bind(r.id).first()) continue; /* already emailed with the request */
    const ph = await env.DB.prepare('SELECT r2_key FROM photos WHERE listing_id = ? ORDER BY pos LIMIT 1').bind(it.id).first<{ r2_key: string }>().catch(() => null);
    const res = await emailRequest(env, r, owner, cust, it, money((r as any).payout_cents ?? r.rent_cents), ph ? cutoutUrl(env, ph.r2_key, 160, 160) : null);
    if (res.ok) n++;
  }
  return n;
}
