import type { Env, User } from './env';
import { geocodePlace } from './geo';
import { assignHood } from './hoods';
import { fuzz } from './util';
import { logEvent } from './log';

/* set where a user's things are from cross streets / ZIP / address ("29th & 9th Ave"), then put any of their
   listings that have no map spot onto the map (fuzzed, like every listing). Returns null if it can't be found */
export async function setUserWhere(env: Env, u: User, place: string, by: string): Promise<{ lat: number; lng: number; hood: string | null; fixed: number } | null> {
  const p = place.replace(/\s+/g, ' ').trim().slice(0, 120); if (p.length < 2) return null;
  const g = await geocodePlace(env, p); if (!g) return null;
  const xs = /\d/.test(p) && !/^\d{5}$/.test(p) ? p.slice(0, 80) : null; /* "29th & 9th Ave" shows as the public cross streets; a bare ZIP doesn't */
  await env.DB.prepare('UPDATE users SET lat = ?, lng = ?, cross_streets = COALESCE(cross_streets, ?), mapbox_id = ?, geocoded_at = ? WHERE id = ?')
    .bind(g.lat, g.lng, xs, g.mapbox_id, g.mapbox_id ? Date.now() : null, u.id).run();
  try { await assignHood(env, 'users', u.id, g.lat, g.lng); } catch {}
  const me = await env.DB.prepare('SELECT hood FROM users WHERE id = ?').bind(u.id).first<{ hood: string | null }>();
  const orphans = await env.DB.prepare('SELECT id FROM listings WHERE owner_id = ? AND lat IS NULL').bind(u.id).all<{ id: string }>();
  for (const o of orphans.results) { const [fl, fg] = fuzz(g.lat, g.lng); await env.DB.prepare('UPDATE listings SET lat = ?, lng = ?, hood = COALESCE(hood, ?) WHERE id = ?').bind(fl, fg, me?.hood || null, o.id).run(); try { await assignHood(env, 'listings', o.id, fl, fg); } catch {} }
  await logEvent(env.DB, 'profile.where', { user: u.id, data: { place: p, by, lat: g.lat, lng: g.lng, hood: me?.hood || null, fixed: orphans.results.length } });
  return { lat: g.lat, lng: g.lng, hood: me?.hood || null, fixed: orphans.results.length };
}
