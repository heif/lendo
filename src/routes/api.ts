// Public read API — agents welcome. No auth for reads; writes come later (keys + scopes).
import { Hono } from 'hono';
import type { Env, Listing, Vars } from '../lib/env';
import { firstPhotos, listingById, photosFor, reputation, userById } from '../lib/db';
import { emojiFor } from '../lib/emoji';

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
  const rows = await c.env.DB.prepare(`SELECT id, name, price_cents, week_cents, hood, lat, lng, owner_id, emoji, created_at FROM listings WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`).bind(...args, limit).all<Listing>();
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

api.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }));
