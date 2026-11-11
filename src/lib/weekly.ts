// Weekly owner text (Mondays ~10am ET): "From Lendo: 523 items added nearby this week lendo.co/nyc/tribeca"
import type { Env, User } from './env';
import { textUser } from './blooio';
import { CITIES } from './places';
import { citySlug, slugify } from './urls';

export function nearestHood(lat: number, lng: number) {
  let best: { city: (typeof CITIES)[number]; hood: { name: string; lat: number; lng: number } } | null = null, bd = 1e9;
  for (const c of CITIES) for (const h of c.hoods) { const d = Math.hypot(h.lat - lat, (h.lng - lng) * 0.76); if (d < bd) { bd = d; best = { city: c, hood: h }; } }
  return bd < 0.08 ? best : null;
}

export async function weeklyOwnerText(env: Env, force = false) {
  const now = new Date(), week = now.toISOString().slice(0, 10);
  if (!force) {
    const last = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'weekly_sent'`).first<{ value: string }>();
    if (last && Date.now() - new Date(last.value).getTime() < 6 * 86400e3) return 0;
    await env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('weekly_sent', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(week).run();
  }
  const owners = (await env.DB.prepare(`SELECT DISTINCT u.* FROM users u JOIN listings l ON l.owner_id = u.id WHERE l.status = 'live' AND u.demo = 0 AND u.lat IS NOT NULL`).all<User>()).results;
  const since = Date.now() - 7 * 86400e3, D = 0.02;
  let n = 0;
  for (const u of owners) {
    const c = await env.DB.prepare(`SELECT COUNT(*) n FROM listings WHERE status = 'live' AND demo = 0 AND created_at > ? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`)
      .bind(since, u.lat! - D, u.lat! + D, u.lng! - D * 1.3, u.lng! + D * 1.3).first<{ n: number }>();
    if (!c?.n) continue;
    const near = nearestHood(u.lat!, u.lng!);
    const link = env.APP_URL + (near ? `/${citySlug(near.city)}/${slugify(near.hood.name)}` : '/');
    await textUser(env, u, `From Lendo: ${c.n.toLocaleString('en-US')} item${c.n === 1 ? '' : 's'} added nearby this week ${link}`, 'nudge');
    n++;
  }
  return n;
}
