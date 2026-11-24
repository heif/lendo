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
    /* enough to decide without opening anything: who they are on Lendo, when, where, and a way to ask first */
    const st = await env.DB.prepare(`SELECT COUNT(*) n, AVG(renter_rating) avg FROM rentals WHERE renter_id = ? AND status = 'returned'`).bind(cust.id).first<{ n: number; avg: number | null }>().catch(() => null);
    const since = new Date(cust.created_at || now()).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'America/New_York' });
    const done = st?.n ? `${st.n} rental${st.n === 1 ? '' : 's'} returned${st.avg ? ` · ${(Math.round(st.avg * 10) / 10)}★ from owners` : ''}` : 'first rental on Lendo';
    const back = new Date(addDays(r.end_day, 1) + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    const pick = new Date(r.start_day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    const res = await emailUser(env, owner, `${who} wants your ${it.name} · ${fmtRange(r.start_day, r.end_day)}`,
      [`${who}${cust.hood ? ` (${cust.hood})` : ''} asked to rent your ${it.name}. You’d earn ${earn}`,
       `Pickup ${pick} · back ${back}${r.meet_spot ? ` · ${r.meet_spot}` : ''}`,
       `${who}: on Lendo since ${since} · ${done}${r.promise_at ? ' · signed the 3-point promise' : ''}`,
       'Not sure yet? Ask a question first, then decide'],
      [{ label: 'YES', url, pri: true }, { label: 'NO', url }, { label: `ASK ${who.toUpperCase()}`, url: url + '#compose' }], 'Sent by email because a text to you wasn’t answered', r.id);
    if (res.ok) n++;
  }
  return n;
}
