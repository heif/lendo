// Readable URLs (see src/lib/urls.ts). Registered last, so every real route wins.
import { Hono } from 'hono';
import type { Env, Vars } from '../lib/env';
import { cityBySlug, hoodBySlug, isCode } from '../lib/urls';
import { homePage, itemPage, personPage } from './browse';

export const pretty = new Hono<{ Bindings: Env; Variables: Vars }>();
const thing = (s: string) => s.replace(/-/g, ' ').replace(/s$/, ''); // "ladders" → "ladder" search

pretty.get('/:a{[a-z0-9][a-z0-9-]{0,39}}', async (c) => {
  const a = c.req.param('a');
  if (isCode(a)) {
    const l = await c.env.DB.prepare('SELECT l.id, l.slug, u.handle FROM listings l JOIN users u ON u.id = l.owner_id WHERE l.code = ?').bind(a).first<{ id: string; slug: string | null; handle: string | null }>().catch(() => null);
    if (l) return c.redirect(l.slug && l.handle ? `/${l.handle}/${l.slug}` : `/i/${l.id}`, 302);
  }
  const city = cityBySlug(a);
  if (city) return homePage(c, { center: [city.lng, city.lat], zoom: city.id === 'nyc' ? 12 : 13 });
  const u = await c.env.DB.prepare('SELECT id FROM users WHERE handle = ?').bind(a).first<{ id: string }>().catch(() => null);
  return u ? personPage(c, u.id) : c.notFound();
});

pretty.get('/:a{[a-z0-9][a-z0-9-]{0,39}}/:b{[a-z0-9][a-z0-9-]{0,59}}', async (c) => {
  const a = c.req.param('a'), b = c.req.param('b');
  const city = cityBySlug(a);
  if (city) {
    const h = hoodBySlug(city.id, b);
    if (h) return homePage(c, { center: [h.lng, h.lat], zoom: 14.5 });
    return homePage(c, { center: [city.lng, city.lat], zoom: city.id === 'nyc' ? 12.5 : 13, q: thing(b) });
  }
  const r = await c.env.DB.prepare(`SELECT l.id FROM listings l JOIN users u ON u.id = l.owner_id WHERE u.handle = ? AND l.slug = ? AND l.status != 'removed'`).bind(a, b).first<{ id: string }>().catch(() => null);
  return r ? itemPage(c, r.id, true) : c.notFound();
});

pretty.get('/:a{[a-z0-9][a-z0-9-]{0,39}}/:b{[a-z0-9][a-z0-9-]{0,59}}/:t{[a-z0-9][a-z0-9-]{0,59}}', async (c) => {
  const city = cityBySlug(c.req.param('a')); if (!city) return c.notFound();
  const h = hoodBySlug(city.id, c.req.param('b')); if (!h) return c.notFound();
  return homePage(c, { center: [h.lng, h.lat], zoom: 14.5, q: thing(c.req.param('t')) });
});
