import type { Env, User } from './env';
import { geocodePlace } from './geo';
import { assignHood } from './hoods';
import { fuzz } from './util';
import { logEvent } from './log';

import { hoodAt } from './hoods';

/* ---- Home location, one way everywhere (Scott, 11/25) ----
   The person gives ONE thing (an address, cross streets, a ZIP, or "use my location"). Lendo works out the rest:
   the map spot, the neighborhood (from the map, never typed) and the public cross streets in one uniform style ("W 22nd St & 9th Ave").
   A street address is private and is never shown or stored as the public cross streets. */
const ABBR: [RegExp, string][] = [[/\bstreet\b/gi, 'St'], [/\bavenue\b/gi, 'Ave'], [/\bboulevard\b/gi, 'Blvd'], [/\bplace\b/gi, 'Pl'], [/\broad\b/gi, 'Rd'], [/\bdrive\b/gi, 'Dr'], [/\bcourt\b/gi, 'Ct'], [/\blane\b/gi, 'Ln'], [/\bparkway\b/gi, 'Pkwy'], [/\bterrace\b/gi, 'Ter'], [/\bsquare\b/gi, 'Sq'], [/\bhighway\b/gi, 'Hwy'], [/\bexpressway\b/gi, 'Expy'],
  [/^west\b/i, 'W'], [/^east\b/i, 'E'], [/^north\b/i, 'N'], [/^south\b/i, 'S']];
const ord = (n: string) => { const k = +n % 100, j = +n % 10; return n + (k >= 11 && k <= 13 ? 'th' : j === 1 ? 'st' : j === 2 ? 'nd' : j === 3 ? 'rd' : 'th'); };
export function tidyStreet(raw: string): string {
  let t = raw.replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim(); if (!t) return '';
  t = t.split(' ').map(w => /^\d+(st|nd|rd|th)$/i.test(w) ? w.toLowerCase() : /^[a-z]/.test(w) || /^[A-Z]{3,}$/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
  for (const [re, to] of ABBR) t = t.replace(re, to);
  t = t.replace(/^([WENS]) (\d+)$/, (_m, d, n) => `${d} ${ord(n)} St`).replace(/^(\d+)$/, (_m, n) => ord(n)).replace(/^([WENS] )?(\d+) (St|Ave|Pl|Rd|Dr)$/, (_m, d, n, k) => `${d || ''}${ord(n)} ${k}`);
  return t;
}
/* "29th and 9th ave" / "w 22 st @ 9 av" → "29th & 9th Ave" style; null when it isn't two streets */
export function tidyCross(raw: string): string | null {
  const parts = raw.replace(/\s+/g, ' ').trim().split(/\s*(?:&|\+|@|\/|\band\b|\bat\b|\bx\b)\s*/i).map(x => x.replace(/\bav\b/gi, 'Avenue').replace(/\bst\b/gi, 'Street')).map(tidyStreet).filter(Boolean);
  if (parts.length !== 2 || parts.some(x => x.length > 40)) return null;
  return `${parts[0]} & ${parts[1]}`.slice(0, 80);
}
export const looksLikeAddress = (p: string) => /^\s*\d+[a-z]?\s+\S/i.test(p) && !/&|\+|@|\band\b|\bat\b/i.test(p) && !/^\s*\d+(st|nd|rd|th)\b/i.test(p);

/* nearest corner to a point: the street it's on + the closest street that crosses it. One Mapbox call (roads near the point).
   A cross street's nearest point lies along the home street; a parallel street's lies straight across it — that's how they're told apart */
export async function crossAt(env: Env, lat: number, lng: number): Promise<string | null> {
  if (!env.MAPBOX_SECRET_TOKEN) return null;
  try {
    const r = await fetch(`https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${lng},${lat}.json?radius=320&limit=50&layers=road&geometry=linestring&dedupe=true&access_token=${encodeURIComponent(env.MAPBOX_SECRET_TOKEN)}`);
    if (!r.ok) return null;
    const fs = (((await r.json()) as any).features || []) as any[];
    const k = Math.cos(lat * Math.PI / 180), seen = new Map<string, { n: string; d: number; x: number; y: number }>();
    for (const f of fs) {
      const p = f.properties || {}, n = String(p.name || '').trim(), cls = String(p.class || '');
      if (!n || /^(path|pedestrian|track|service|ferry|aerialway|golf|major_rail|minor_rail|service_rail)$/.test(cls) || /^(footway|steps|cycleway|sidewalk|crossing)$/.test(String(p.type || ''))) continue;
      const d = +(p.tilequery?.distance ?? 1e9), c = f.geometry?.coordinates || [lng, lat];
      const cur = seen.get(n); if (!cur || d < cur.d) seen.set(n, { n, d, x: (c[0] - lng) * k, y: c[1] - lat });
    }
    const roads = [...seen.values()].sort((a, b) => a.d - b.d); if (roads.length < 2) return null;
    const home = roads[0], rest = roads.slice(1);
    let cross = rest[0];
    const hl = Math.hypot(home.x, home.y);
    if (home.d >= 4 && hl > 0) { /* the point sits off the centerline: that offset is square to the home street */
      const along = rest.filter(o => { const ol = Math.hypot(o.x, o.y); return ol > 0 && Math.abs((o.x * home.x + o.y * home.y) / (ol * hl)) < 0.6; });
      if (along.length) cross = along[0];
    } else if (rest.length >= 2) { /* on the centerline: of the nearby streets, the first one not lined up with the nearest other is the cross street */
      const a = rest[0], al = Math.hypot(a.x, a.y);
      const turn = rest.slice(1).find(o => { const ol = Math.hypot(o.x, o.y); return al > 0 && ol > 0 && Math.abs((o.x * a.x + o.y * a.y) / (ol * al)) < 0.6; });
      if (turn && turn.d < a.d * 0.9) cross = turn;
    }
    return `${tidyStreet(home.n)} & ${tidyStreet(cross.n)}`.slice(0, 80);
  } catch { return null; }
}

export type Where = { lat: number; lng: number; cross: string | null; hood: string | null; address: string | null; mapbox_id: string | null };
/* one place to turn what the person gave (text or a GPS point) into everything Lendo needs. Nothing is saved here */
export async function resolveWhere(env: Env, inp: { place?: string; lat?: number; lng?: number }): Promise<Where | null> {
  let lat = inp.lat, lng = inp.lng, mapbox_id: string | null = null, address: string | null = null, cross: string | null = null, hint: string | null = null;
  const p = (inp.place || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (p) {
    const typed = tidyCross(p);
    const g = await geocodePlace(env, typed ? typed.replace(' & ', ' and ') : p); if (!g) return null;
    lat = g.lat; lng = g.lng; mapbox_id = g.mapbox_id; hint = g.hood_hint;
    if (typed) cross = typed; else if (looksLikeAddress(p)) address = g.full_address || p;
  }
  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return null;
  if (!cross && !/^\d{5}$/.test(p)) cross = await crossAt(env, lat, lng); /* a bare ZIP is an area, not a corner */
  const h = await hoodAt(env, lat, lng).catch(() => null);
  return { lat, lng, cross, hood: h?.name || hint || null, address, mapbox_id };
}

/* set where a user's things are from cross streets / ZIP / address ("29th & 9th Ave"), then put any of their
   listings that have no map spot onto the map (fuzzed, like every listing). Returns null if it can't be found */
export async function setUserWhere(env: Env, u: User, place: string, by: string, pt?: { lat: number; lng: number }): Promise<{ lat: number; lng: number; hood: string | null; cross: string | null; fixed: number } | null> {
  const p = place.replace(/\s+/g, ' ').trim().slice(0, 160); if (p.length < 2 && !pt) return null;
  const g = await resolveWhere(env, pt ? pt : { place: p }); if (!g) return null;
  await env.DB.prepare('UPDATE users SET lat = ?, lng = ?, cross_streets = COALESCE(?, cross_streets), address = COALESCE(?, address), mapbox_id = ?, geocoded_at = ? WHERE id = ?')
    .bind(g.lat, g.lng, g.cross, g.address, g.mapbox_id, g.mapbox_id ? Date.now() : null, u.id).run();
  try { await assignHood(env, 'users', u.id, g.lat, g.lng); } catch {}
  const me = await env.DB.prepare('SELECT hood FROM users WHERE id = ?').bind(u.id).first<{ hood: string | null }>();
  const orphans = await env.DB.prepare('SELECT id FROM listings WHERE owner_id = ? AND lat IS NULL').bind(u.id).all<{ id: string }>();
  for (const o of orphans.results) { const [fl, fg] = fuzz(g.lat, g.lng); await env.DB.prepare('UPDATE listings SET lat = ?, lng = ?, hood = COALESCE(hood, ?) WHERE id = ?').bind(fl, fg, me?.hood || null, o.id).run(); try { await assignHood(env, 'listings', o.id, fl, fg); } catch {} }
  await logEvent(env.DB, 'profile.where', { user: u.id, data: { place: p, by, lat: g.lat, lng: g.lng, hood: me?.hood || null, fixed: orphans.results.length } });
  return { lat: g.lat, lng: g.lng, hood: me?.hood || g.hood || null, cross: g.cross, fixed: orphans.results.length };
}
