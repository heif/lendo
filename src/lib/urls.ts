// Readable URLs.
//   lendo.co/<handle>                    person (owner) page        lendo.co/heif
//   lendo.co/<handle>/<item>             item                       lendo.co/heif/pyle-bullhorn
//   lendo.co/<city>                      city map                   lendo.co/nyc, lendo.co/iowa-city
//   lendo.co/<city>/<hood>               neighborhood               lendo.co/nyc/tribeca
//   lendo.co/<city>/<thing>              things in the city         lendo.co/nyc/ladder
//   lendo.co/<city>/<hood>/<thing>       things in a neighborhood   lendo.co/nyc/tribeca/ladder
// Hood names win over thing names in the same city; handles can't be city/route words.
import type { Env } from './env';
import { CITIES } from './places';

export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export const citySlug = (c: { id: string; name: string }) => c.id === 'nyc' ? 'nyc' : slugify(c.name);
export const cityBySlug = (s: string) => CITIES.find(c => citySlug(c) === s || c.id === s) || null;
export const hoodBySlug = (cityId: string, s: string) => { const c = CITIES.find(x => x.id === cityId); return c ? c.hoods.find(h => slugify(h.name) === s) || null : null; };

const RESERVED = new Set(['i', 'u', 'p', 'r', 'api', 'admin', 'login', 'logout', 'list', 'listings', 'rentals', 'alerts', 'inbox', 'about', 'profile', 'webhooks', 'promo', 'help', 'terms', 'privacy', 'dev', 'cdn-cgi', 'static', 'app', 'me', 'settings', 'search', 'map', 'rent', 'lendo', 'support', 'blog', 'jobs', 'www']);
export const handleOk = (h: string) => /^[a-z0-9][a-z0-9-]{1,23}$/.test(h) && !RESERVED.has(h) && !cityBySlug(h) && !(h.length === 4 && /[2-9]/.test(h));

// first free handle: maya, maya-k, maya-k2…
export async function assignHandle(env: Env, uid: string, name: string | null): Promise<string | null> {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  const first = slugify(parts[0] || '') || 'neighbor', last = slugify(parts[1] || '').slice(0, 1);
  const tries = [first, last && `${first}-${last}`, ...Array.from({ length: 30 }, (_, i) => `${first}${last ? '-' + last : ''}${i + 2}`)].filter(Boolean) as string[];
  for (const h of tries) {
    if (!handleOk(h)) continue;
    const r = await env.DB.prepare('UPDATE users SET handle = ? WHERE id = ? AND handle IS NULL AND NOT EXISTS (SELECT 1 FROM users WHERE handle = ?)').bind(h, uid, h).run().catch(() => null);
    if (r?.meta.changes) return h;
  }
  return null;
}
export async function assignSlug(env: Env, lid: string, owner: string, name: string): Promise<string | null> {
  const base = slugify(name) || 'item';
  for (let i = 1; i < 30; i++) {
    const s = i === 1 ? base : `${base}-${i}`;
    const r = await env.DB.prepare('UPDATE listings SET slug = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM listings WHERE owner_id = ? AND slug = ?)').bind(s, lid, owner, s).run().catch(() => null);
    if (r?.meta.changes) return s;
  }
  return null;
}
// cron: give handles/slugs to anyone missing one (real users first)
export async function backfillUrls(env: Env, n = 100) {
  const us = (await env.DB.prepare('SELECT id, name FROM users WHERE handle IS NULL AND name IS NOT NULL ORDER BY demo, created_at LIMIT ?').bind(n).all<{ id: string; name: string }>()).results;
  for (const u of us) await assignHandle(env, u.id, u.name);
  const ls = (await env.DB.prepare(`SELECT id, owner_id, name FROM listings WHERE slug IS NULL AND status != 'removed' ORDER BY demo, created_at LIMIT ?`).bind(n).all<{ id: string; owner_id: string; name: string }>()).results;
  for (const l of ls) await assignSlug(env, l.id, l.owner_id, l.name);
  const cs = (await env.DB.prepare(`SELECT id FROM listings WHERE code IS NULL AND status != 'removed' ORDER BY demo, created_at LIMIT ?`).bind(n).all<{ id: string }>()).results;
  for (const l of cs) await assignCode(env, l.id);
  return us.length + ls.length;
}
export const itemPath = (handle: string | null | undefined, slug: string | null | undefined, id: string) => handle && slug ? `/${handle}/${slug}` : `/i/${id}`;

// short codes: 4 chars, no look-alikes (0/o, 1/l/i), always contain a digit so they never collide with handles or words
const ALPH = 'abcdefghjkmnpqrstuvwxyz23456789';
export const isCode = (s: string) => /^[a-hj-km-np-z2-9]{4}$/.test(s) && /[2-9]/.test(s);
export async function assignCode(env: Env, lid: string): Promise<string | null> {
  for (let t = 0; t < 12; t++) {
    let c = ''; for (let i = 0; i < 4; i++) c += ALPH[Math.floor(Math.random() * ALPH.length)];
    if (!/[2-9]/.test(c)) c = c.slice(0, 3) + '23456789'[Math.floor(Math.random() * 8)];
    const r = await env.DB.prepare('UPDATE listings SET code = ? WHERE id = ? AND code IS NULL AND NOT EXISTS (SELECT 1 FROM listings WHERE code = ?)').bind(c, lid, c).run().catch(() => null);
    if (r?.meta.changes) return c;
  }
  return null;
}
