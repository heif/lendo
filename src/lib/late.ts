// Late returns (Scott, 11/27): one day's rent per started late day, from the hold — but only if the OWNER confirms.
// The owner's choice is private: the customer only ever sees the rule ("late returns are 1 day's rent per late day"),
// never that the owner could have let it go.
import type { Env, Listing, Rental } from './env';
import { backDay, tzFor } from './util';

const GRACE_MS = 60 * 60 * 1000; /* an hour of slack before a return counts as late */

/* "YYYY-MM-DD" + "HH:MM" in a time zone → epoch ms */
export function zonedMs(day: string, hm: string, tz: string): number {
  const [y, mo, d] = day.split('-').map(Number), [h, mi] = hm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date(guess));
  const g = (k: string) => Number(p.find(x => x.type === k)?.value || 0);
  const asLocal = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'));
  return guess - (asLocal - guess);
}

/** how late the item came back, and what that costs (capped at the hold); null if on time or not returned */
export function lateInfo(r: Rental, it: Pick<Listing, 'lng' | 'price_cents'>): { days: number; cents: number; dueMs: number } | null {
  if (!(r.status === 'returned' || r.status === 'closed') || !r.returned_at || it.price_cents <= 0) return null;
  const dueMs = zonedMs(backDay(r.end_day), r.return_time || r.pickup_time || '23:59', tzFor(it.lng));
  const over = r.returned_at - dueMs - GRACE_MS;
  if (over <= 0) return null;
  const days = Math.ceil(over / 864e5);
  return { days, cents: Math.min(days * it.price_cents, r.deposit_cents || 0), dueMs };
}

export const lateWaived = async (env: Env, rid: string) =>
  !!(await env.DB.prepare(`SELECT 1 FROM events WHERE kind = 'rental.late_waived' AND rental_id = ? LIMIT 1`).bind(rid).first().catch(() => null));
