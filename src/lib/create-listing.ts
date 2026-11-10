// One place that turns (name, price, photos, maybe GPS) into a live listing: location fallback chain, hood, emoji, icon job.
import type { Env, User } from './env';
import { assignSlug, assignHandle, assignCode } from './urls';
import { id, now, fuzz, weekDefault } from './util';
import { hoodFor, geocodePlace } from './geo';
import { emojiFor } from './emoji';
import { assignHood } from './hoods';
import { autoIcon } from './avatar';
import { matchListing } from './alerts';

export type NewListing = { name: string; priceCents: number; weekCents?: number | null; description?: string | null; lat?: number | null; lng?: number | null; photos: { bytes: ArrayBuffer; type: string }[] };

export async function createListing(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, u: User, n: NewListing): Promise<string> {
  const minP = parseInt(env.MIN_PRICE_CENTS, 10);
  const price = Math.max(minP, Math.round(n.priceCents));
  const week = n.weekCents && n.weekCents > 0 ? Math.round(n.weekCents) : weekDefault(price);
  let lat = n.lat ?? NaN, lng = n.lng ?? NaN, hood = u.hood;
  const fromGps = !isNaN(lat) && !isNaN(lng);
  if (!fromGps) { lat = u.lat ?? NaN; lng = u.lng ?? NaN; }
  let mbId: string | null = fromGps ? null : u.mapbox_id, geoAt: number | null = fromGps ? null : u.geocoded_at;
  if (isNaN(lat) && (u.address || u.cross_streets || u.hood)) {
    const q0 = u.address || (u.cross_streets ? u.cross_streets + (u.hood ? ', ' + u.hood : '') : u.hood!);
    const g = await geocodePlace(env, q0);
    if (g) { lat = g.lat; lng = g.lng; mbId = g.mapbox_id; geoAt = g.mapbox_id ? Date.now() : null; await env.DB.prepare('UPDATE users SET lat = COALESCE(lat, ?), lng = COALESCE(lng, ?), mapbox_id = COALESCE(mapbox_id, ?), geocoded_at = COALESCE(geocoded_at, ?) WHERE id = ?').bind(g.lat, g.lng, mbId, geoAt, u.id).run(); }
  }
  if (fromGps) {
    const g = await hoodFor(lat, lng);
    if (g.hood) hood = g.hood;
    if (!u.lat) await env.DB.prepare('UPDATE users SET lat = ?, lng = ?, hood = COALESCE(hood, ?) WHERE id = ?').bind(lat, lng, g.hood, u.id).run();
  }
  const lid = id('l');
  const [flat, flng] = !isNaN(lat) ? fuzz(lat, lng) : [null, null];
  const desc = (n.description || '').trim().slice(0, 600) || null;
  const name = n.name.trim().slice(0, 80);
  await env.DB.prepare('INSERT INTO listings (id, owner_id, name, description, price_cents, week_cents, status, hood, lat, lng, emoji, mapbox_id, geocoded_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(lid, u.id, name, desc, price, week, 'live', hood, flat, flng, emojiFor(name, desc), mbId, geoAt, now()).run();
  if (flat != null) { try { await assignHood(env, 'listings', lid, lat, lng); if (!u.hood_id) await assignHood(env, 'users', u.id, lat, lng); } catch (e) { console.warn('hood assign', e); } }
  let pos = 0, firstKey: string | null = null;
  for (const p of n.photos.slice(0, 6)) {
    const key = `${lid}/${id()}.jpg`;
    await env.PHOTOS.put(key, p.bytes, { httpMetadata: { contentType: p.type || 'image/jpeg' } });
    await env.DB.prepare('INSERT INTO photos (id, listing_id, r2_key, pos) VALUES (?,?,?,?)').bind(id('ph'), lid, key, pos++).run();
    if (!firstKey) firstKey = key;
  }
  if (firstKey) ctx.waitUntil(autoIcon(env, lid, firstKey, name, desc));
  ctx.waitUntil(matchListing(env, lid).catch(e => console.warn('alerts', e)));
  ctx.waitUntil((async () => { await assignSlug(env, lid, u.id, name); await assignCode(env, lid); if (!(u as any).handle) await assignHandle(env, u.id, u.name); })().catch(() => {}));
  return lid;
}
