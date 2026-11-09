// Public read API — agents welcome. No auth for reads; writes come later (keys + scopes).
import { Hono } from 'hono';
import type { Env, Listing, Vars } from '../lib/env';
import { firstPhotos, listingById, photosFor, reputation, userById } from '../lib/db';
import { emojiFor } from '../lib/emoji';
import { loadHoods } from '../lib/hoods';

export const api = new Hono<{ Bindings: Env; Variables: Vars }>();

api.use('/api/*', async (c, next) => { await next(); c.header('access-control-allow-origin', '*'); c.header('cache-control', 'no-store'); });

api.get('/api/listings', async (c) => {
  const bbox = (c.req.query('bbox') || '').split(',').map(parseFloat);
  const q = (c.req.query('q') || '').trim().slice(0, 60);
  const hood = (c.req.query('hood') || '').trim().slice(0, 60);
  const limit = Math.min(300, parseInt(c.req.query('limit') || '200', 10) || 200);
  const where = [`status = 'live'`];
  const args: (string | number)[] = [];
  if (bbox.length === 4 && bbox.every(n => !isNaN(n))) { where.push('lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?'); args.push(bbox[1], bbox[3], bbox[0], bbox[2]); }
  if (q) { where.push('(name LIKE ? OR description LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  if (hood) { where.push('hood = ?'); args.push(hood); }
  const rows = await c.env.DB.prepare(`SELECT id, name, price_cents, week_cents, hood, lat, lng, owner_id, emoji, avatar_key, created_at FROM listings WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`).bind(...args, limit).all<Listing>();
  const ph = await firstPhotos(c.env.DB, rows.results.map(r => r.id));
  const g = await c.env.DB.prepare(`SELECT COUNT(*) n FROM listings WHERE status = 'live'`).first<{ n: number }>();
  return c.json({
    listings: rows.results.map(r => ({ ...r, emoji: r.emoji || emojiFor(r.name), photo: ph[r.id] || null, url: `${c.env.APP_URL}/i/${r.id}` })),
    counts: { view: rows.results.length, global: g?.n ?? 0 },
    fee_pct: parseFloat(c.env.FEE_PCT),
  });
});

api.get('/api/listings/:id', async (c) => {
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.status === 'removed') return c.json({ error: 'not found' }, 404);
  const owner = (await userById(c.env.DB, it.owner_id))!;
  const rep = await reputation(c.env.DB, owner.id);
  const photos = await photosFor(c.env.DB, it.id);
  return c.json({
    id: it.id, name: it.name, description: it.description, price_cents: it.price_cents, week_cents: it.week_cents, status: it.status, hood: it.hood, lat: it.lat, lng: it.lng,
    photos: photos.map(p => `${c.env.APP_URL}/p/${p.r2_key}`), url: `${c.env.APP_URL}/i/${it.id}`,
    owner: { id: owner.id, name: owner.name, hood: owner.hood, cross_streets: owner.cross_streets, since: owner.created_at, rating_as_owner: rep.as_owner_avg, ratings_as_owner: rep.as_owner_n, items_listed: rep.listed },
    fee_pct: parseFloat(c.env.FEE_PCT),
  });
});

// Neighborhood outlines + live listing counts (for the faint hood layer). Cached 10 min at the edge.
api.get('/api/hoods.geojson', async (c) => {
  const cacheKey = new Request(new URL('/api/hoods.geojson', c.env.APP_URL).toString());
  const hit = await caches.default.match(cacheKey);
  if (hit) return hit;
  const hoods = await loadHoods(c.env);
  const counts = await c.env.DB.prepare(`SELECT hood_id, COUNT(*) n FROM listings WHERE status = 'live' AND hood_id IS NOT NULL GROUP BY hood_id`).all<{ hood_id: string; n: number }>();
  const n: Record<string, number> = {}; for (const r of counts.results) n[r.hood_id] = r.n;
  const fc = { type: 'FeatureCollection', features: hoods.map(h => ({ type: 'Feature', id: h.id, properties: { id: h.id, name: h.name, borough: h.borough, n: n[h.id] || 0 }, geometry: h.geometry })) };
  const res = new Response(JSON.stringify(fc), { headers: { 'content-type': 'application/geo+json', 'cache-control': 'public, max-age=600', 'access-control-allow-origin': '*' } });
  c.executionCtx.waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
});

api.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }));
