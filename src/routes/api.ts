// Public read API — agents welcome. No auth for reads; writes come later (keys + scopes).
import { Hono } from 'hono';
import type { Env, Listing, Vars } from '../lib/env';
import { firstPhotos, listingById, photosFor, reputation, userById } from '../lib/db';
import { emojiFor } from '../lib/emoji';
import { loadHoods, hoodAt } from '../lib/hoods';
import { CITIES, WANTED_ALL, short } from '../lib/places';
import { iconsDone } from '../lib/wanted-icons';

export const api = new Hono<{ Bindings: Env; Variables: Vars }>();

api.use('/api/*', async (c, next) => { await next(); c.header('access-control-allow-origin', '*'); c.header('cache-control', 'no-store'); });

api.get('/api/listings', async (c) => {
  const bbox = (c.req.query('bbox') || '').split(',').map(parseFloat);
  const q = (c.req.query('q') || '').trim().slice(0, 60);
  const hood = (c.req.query('hood') || '').trim().slice(0, 60);
  const near = (c.req.query('near') || '').split(',').map(parseFloat);
  const byDist = near.length === 2 && near.every(n => !isNaN(n));
  const limit = Math.min(1500, parseInt(c.req.query('limit') || '200', 10) || 200);
  const where = [`l.status = 'live'`];
  const args: (string | number)[] = [];
  if (bbox.length === 4 && bbox.every(n => !isNaN(n))) { where.push('l.lat BETWEEN ? AND ? AND l.lng BETWEEN ? AND ?'); args.push(bbox[1], bbox[3], bbox[0], bbox[2]); }
  if (q) { where.push('(l.name LIKE ? OR l.description LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  if (hood) { where.push('l.hood = ?'); args.push(hood); }
  const rows = await c.env.DB.prepare(`SELECT l.id, l.name, l.price_cents, l.week_cents, l.hood, l.lat, l.lng, l.owner_id, l.emoji, l.avatar_key, l.created_at,
      u.name owner_name, u.cross_streets owner_xs,
      (SELECT ROUND(AVG(renter_rating),1) FROM rentals r WHERE r.owner_id = l.owner_id AND renter_rating IS NOT NULL) owner_rating,
      (SELECT COUNT(*) FROM rentals r WHERE r.listing_id = l.id AND r.status IN ('confirmed','picked_up','returned','closed')) rentals
    FROM listings l JOIN users u ON u.id = l.owner_id WHERE ${where.join(' AND ')} ${byDist ? 'AND l.lat IS NOT NULL' : ''} ORDER BY ${byDist ? '((l.lat - ?) * (l.lat - ?) + (l.lng - ?) * (l.lng - ?) * 0.57)' : 'l.created_at DESC'} LIMIT ?`).bind(...args, ...(byDist ? [near[1], near[1], near[0], near[0]] : []), limit).all<Listing & { owner_name: string | null; owner_xs: string | null; owner_rating: number | null; rentals: number }>();
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

// Which neighborhood is the map centered on, and how many live listings it has. Falls back to nearest listing hood name.
api.get('/api/hood', async (c) => {
  const lat = parseFloat(c.req.query('lat') || ''), lng = parseFloat(c.req.query('lng') || '');
  if (isNaN(lat) || isNaN(lng)) return c.json({ error: 'lat,lng required' }, 400);
  let name: string | null = null, n = 0;
  try { const h = await hoodAt(c.env, lat, lng); if (h) { name = h.name; n = (await c.env.DB.prepare(`SELECT COUNT(*) n FROM listings WHERE status = 'live' AND hood_id = ?`).bind(h.id).first<{ n: number }>())?.n ?? 0; } } catch {}
  if (!name) {
    const near = await c.env.DB.prepare(`SELECT hood, COUNT(*) n FROM listings WHERE status = 'live' AND hood IS NOT NULL AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? GROUP BY hood ORDER BY n DESC LIMIT 1`).bind(lat - 0.008, lat + 0.008, lng - 0.01, lng + 0.01).first<{ hood: string; n: number }>();
    if (near) { name = near.hood; n = near.n; }
  }
  // fallback: nearest named hood center from the city directory (until hood polygons are seeded everywhere)
  const km = (aLat: number, aLng: number) => Math.hypot((aLat - lat) * 111, (aLng - lng) * 111 * Math.cos(lat * Math.PI / 180));
  const ct = CITIES.find(x => lng >= x.bbox[0] && lng <= x.bbox[2] && lat >= x.bbox[1] && lat <= x.bbox[3]) || null;
  if (!name && ct) {
    const best = ct.hoods.filter(h => h.lat !== ct.lat || h.lng !== ct.lng).map(h => ({ h, d: km(h.lat, h.lng) })).sort((x, y) => x.d - y.d)[0];
    if (best && best.d < 2.5) {
      name = best.h.name;
      const dLat = 0.9 / 111, dLng = 0.9 / (111 * Math.cos(best.h.lat * Math.PI / 180));
      n = (await c.env.DB.prepare(`SELECT COUNT(*) n FROM listings WHERE status = 'live' AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`).bind(best.h.lat - dLat, best.h.lat + dLat, best.h.lng - dLng, best.h.lng + dLng).first<{ n: number }>())?.n ?? 0;
    }
  }
  const cityN = ct ? (await c.env.DB.prepare(`SELECT COUNT(*) n FROM listings WHERE status = 'live' AND lng BETWEEN ? AND ? AND lat BETWEEN ? AND ?`).bind(ct.bbox[0], ct.bbox[2], ct.bbox[1], ct.bbox[3]).first<{ n: number }>())?.n ?? 0 : 0;
  return c.json({ hood: name, hood_short: name ? short(name) : null, hood_n: n, city: ct?.name || null, city_short: ct ? short(ct.name) : null, city_n: cityN });
});

// Directory for the hood/city picker: live counts per city (bbox) and per hood (~0.9 km radius around the center).
api.get('/api/places', async (c) => {
  const cacheKey = new Request(new URL('/api/places', c.env.APP_URL).toString());
  const hit = await caches.default.match(cacheKey); if (hit) return hit;
  const pts = (await c.env.DB.prepare(`SELECT lat, lng FROM listings WHERE status = 'live' AND lat IS NOT NULL`).all<{ lat: number; lng: number }>()).results;
  const offRow = await c.env.DB.prepare(`SELECT value FROM settings WHERE key = 'wanted_off'`).first<{ value: string }>();
  const off = new Set<string>(offRow ? JSON.parse(offRow.value) : []);
  const icons = await iconsDone(c.env);
  const cities = CITIES.map(ct => {
    const inCity = pts.filter(p => p.lng >= ct.bbox[0] && p.lng <= ct.bbox[2] && p.lat >= ct.bbox[1] && p.lat <= ct.bbox[3]);
    const hoods = ct.hoods.map(h => ({ ...h, n: inCity.filter(p => Math.hypot((p.lat - h.lat) * 111, (p.lng - h.lng) * 111 * Math.cos(h.lat * Math.PI / 180)) < 0.9).length }));
    return { id: ct.id, name: ct.name, short: short(ct.name), lat: ct.lat, lng: ct.lng, zoom: ct.zoom, n: inCity.length, live: inCity.length > 0, hoods };
  });
  const res = new Response(JSON.stringify({ cities, total: pts.length, wanted: WANTED_ALL.filter(w => !off.has(w.key)).map(w => ({ ...w, icon: icons.has(w.key) ? `/p/wanted/${w.key}.png` : null })) }), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=120' } });
  c.executionCtx.waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
});

// Leaderboard: top owners in a city (by live listings), for the places sheet
api.get('/api/places/owners', async (c) => {
  const ct = CITIES.find(x => x.id === c.req.query('city')); if (!ct) return c.json({ owners: [] });
  const rows = await c.env.DB.prepare(`SELECT u.id, u.name, u.hood, COUNT(*) n, (SELECT COUNT(*) FROM rentals r WHERE r.owner_id = u.id AND r.status IN ('confirmed','picked_up','returned','closed')) rentals
    FROM listings l JOIN users u ON u.id = l.owner_id WHERE l.status = 'live' AND l.lng BETWEEN ? AND ? AND l.lat BETWEEN ? AND ? GROUP BY u.id ORDER BY n DESC, rentals DESC LIMIT 30`).bind(ct.bbox[0], ct.bbox[2], ct.bbox[1], ct.bbox[3]).all();
  return c.json({ owners: rows.results }, 200, { 'cache-control': 'public, max-age=120' });
});

api.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }));
