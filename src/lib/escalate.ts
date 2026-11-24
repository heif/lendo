// Never wait for someone to come to the site: a rental request the owner hasn't answered goes out again by email.
// One email per request. Sooner when pickup is today or tomorrow.
import type { Env, Rental } from './env';
import { emailUser } from './email';
import { userById, listingById } from './db';
import { addDays, firstName, fmtRange, localToday, money, now } from './util';
import { logEvent } from './log';
import { cutoutUrl } from './cutout';

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
    /* minimal card: photo, who + item, $ , dates; everything else is one tap away on the web */
    const ph = await env.DB.prepare('SELECT r2_key FROM photos WHERE listing_id = ? ORDER BY pos LIMIT 1').bind(it.id).first<{ r2_key: string }>().catch(() => null);
    const day = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    const title = `${who} wants your ${it.name}`;
    const res = await emailUser(env, owner, `${title} · ${fmtRange(r.start_day, r.end_day)}`,
      [`${who}${cust.hood ? ` (${cust.hood})` : ''} asked to rent your ${it.name}, ${fmtRange(r.start_day, r.end_day)}. You’d earn ${earn}`],
      [{ label: 'YES', url, pri: true }, { label: 'NO', url }], 'Sent by email because a text to you wasn’t answered', r.id,
      { title, money: earn, img: ph ? cutoutUrl(env, ph.r2_key, 160, 160) : null, sub: `${day(r.start_day)} → ${day(addDays(r.end_day, 1))}${cust.hood ? ` · ${who} is in ${cust.hood}` : ''}`, more: { label: `More about ${who} and the pickup`, url } });
    if (res.ok) n++;
  }
  return n;
}
