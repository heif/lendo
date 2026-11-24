// Never wait for someone to come to the site: a rental request the owner hasn't answered goes out again by email.
// One email per request. Sooner when pickup is today or tomorrow.
import type { Env, Rental } from './env';
import { emailUser } from './email';
import { userById, listingById } from './db';
import { addDays, firstName, fmtRange, localToday, money, now } from './util';
import { logEvent } from './log';

export async function escalateHolds(env: Env): Promise<number> {
  const rows = (await env.DB.prepare(`SELECT * FROM rentals WHERE status = 'held' AND held_at IS NOT NULL AND held_at < ?`).bind(now() - 15 * 60e3).all<Rental>()).results;
  let n = 0;
  for (const r of rows) {
    const it = await listingById(env.DB, r.listing_id); if (!it) continue;
    const soon = r.start_day <= addDays(localToday(it.lng), 1);
    if (now() - (r.held_at || now()) < (soon ? 15 : 120) * 60e3) continue;
    if (await env.DB.prepare(`SELECT 1 FROM events WHERE kind = 'escalate.email' AND rental = ? LIMIT 1`).bind(r.id).first()) continue;
    const owner = await userById(env.DB, r.owner_id), cust = await userById(env.DB, r.renter_id); if (!owner || !cust) continue;
    await logEvent(env.DB, 'escalate.email', { user: owner.id, rental: r.id, data: { soon, has_email: !!owner.email } }); /* claim first: one try per request */
    if (!owner.email) continue;
    const who = firstName(cust.name || 'A neighbor'), url = `${env.APP_URL}/r/${r.id}`;
    const earn = money((r as any).payout_cents ?? r.rent_cents);
    const res = await emailUser(env, owner, `${who} wants your ${it.name} · ${fmtRange(r.start_day, r.end_day)}`,
      [`${who}${cust.hood ? ` (${cust.hood})` : ''} asked to rent your ${it.name}, ${fmtRange(r.start_day, r.end_day)}. You’d earn ${earn}`],
      [{ label: 'YES', url, pri: true }, { label: 'NO', url }], 'Sent by email because a text to you wasn’t answered', r.id);
    if (res.ok) n++;
  }
  return n;
}
