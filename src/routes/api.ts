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
  const where = [`l.status = 'live'`];
  const args: (string | number)[] = [];
  if (bbox.length === 4 && bbox.every(n => !isNaN(n))) { where.push('l.lat BETWEEN ? AND ? AND l.lng BETWEEN ? AND ?'); args.push(bbox[1], bbox[3], bbox[0], bbox[2]); }
  if (q) { where.push('(l.name LIKE ? OR l.description LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  if (hood) { where.push('l.hood = ?'); args.push(hood); }
  const rows = await c.env.DB.prepare(`SELECT l.id, l.name, l.price_cents, l.week_cents, l.hood, l.lat, l.lng, l.owner_id, l.emoji, l.avatar_key, l.created_at,
      u.name owner_name, u.cross_streets owner_xs,
      (SELECT ROUND(AVG(renter_rating),1) FROM rentals r WHERE r.owner_id = l.owner_id AND renter_rating IS NOT NULL) owner_rating,
      (SELECT COUNT(*) FROM rentals r WHERE r.listing_id = l.id AND r.status IN ('confirmed','picked_up','returned','closed')) rentals
    FROM listings l JOIN users u ON u.id = l.owner_id WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC LIMIT ?`).bind(...args, limit).all<Listing & { owner_name: string | null; owner_xs: string | null; owner_rating: number | null; rentals: number }>();
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

// Cost guard: one beacon per Mapbox map init → map_loads_daily (compare with the 50k/month free tier).
api.post('/api/map-load', async (c) => {
  const day = new Date().toISOString().slice(0, 10);
  c.executionCtx.waitUntil(c.env.DB.prepare('INSERT INTO map_loads_daily (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1').bind(day).run());
  return c.body(null, 204);
});
api.get('/api/map-loads', async (c) => {
  const rows = await c.env.DB.prepare('SELECT day, n FROM map_loads_daily ORDER BY day DESC LIMIT 60').all<{ day: string; n: number }>();
  const month = rows.results.filter(r => r.day.startsWith(new Date().toISOString().slice(0, 7))).reduce((a, r) => a + r.n, 0);
  return c.json({ this_month: month, free_tier: 50000, days: rows.results });
});

api.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }));
