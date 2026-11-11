// Saved-search alerts. Every search (map or text) is saved automatically; Turn off on /alerts or text ALERTS OFF.
// Delivery: 1 text per day; the first one asks "Want more alerts today? Reply YES" (then up to 5/day).
// Anything held back goes out as one morning bundle (cron, ~8am ET).
import type { Env, User } from './env';
import { itemLink } from './urls';
import { id, now, money } from './util';
import { textUser } from './blooio';

const NEAR = 0.03; // ~3 km box around where they searched
const MORE_CAP = 5;
const etDay = (t = Date.now()) => new Date(t - 5 * 3600e3).toISOString().slice(0, 10);

export async function saveSearch(env: Env, u: User, q0: string, lat: number | null, lng: number | null, hood: string | null): Promise<string | null> {
  const q = q0.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
  if (q.length < 3 || lat == null || lng == null) return null;
  const sid = id('ss');
  await env.DB.prepare(`INSERT INTO saved_searches (id, user_id, query, lat, lng, hood, active, created_at) VALUES (?,?,?,?,?,?,1,?)
    ON CONFLICT(user_id, query) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, hood = excluded.hood, active = 1`).bind(sid, u.id, q, lat, lng, hood, now()).run();
  const r = await env.DB.prepare('SELECT id FROM saved_searches WHERE user_id = ? AND query = ?').bind(u.id, q).first<{ id: string }>();
  return r?.id ?? null;
}

export async function turnOff(env: Env, u: User, sid?: string) {
  if (sid) await env.DB.prepare('UPDATE saved_searches SET active = 0 WHERE id = ? AND user_id = ?').bind(sid, u.id).run();
  else await env.DB.prepare('UPDATE saved_searches SET active = 0 WHERE user_id = ?').bind(u.id).run();
}

// New live listing → queue it for every matching active search nearby, then try to deliver.
export async function matchListing(env: Env, lid: string) {
  const l = await env.DB.prepare('SELECT id, owner_id, name, description, lat, lng, demo FROM listings WHERE id = ? AND status = ?').bind(lid, 'live').first<{ id: string; owner_id: string; name: string; description: string | null; lat: number | null; lng: number | null; demo: number }>();
  if (!l || l.lat == null || l.lng == null || l.demo) return 0;
  const text = `${l.name} ${l.description || ''}`.toLowerCase();
  const subs = (await env.DB.prepare(`SELECT id, user_id, query FROM saved_searches WHERE active = 1 AND user_id != ? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`)
    .bind(l.owner_id, l.lat - NEAR, l.lat + NEAR, l.lng - NEAR * 1.3, l.lng + NEAR * 1.3).all<{ id: string; user_id: string; query: string }>()).results
    .filter(s => s.query.split(' ').every(w => text.includes(w)));
  const users = new Set<string>();
  for (const s of subs) {
    const r = await env.DB.prepare('INSERT OR IGNORE INTO alert_queue (id, user_id, search_id, listing_id, created_at) VALUES (?,?,?,?,?)').bind(id('aq'), s.user_id, s.id, l.id, now()).run();
    if (r.meta.changes) users.add(s.user_id);
  }
  for (const uid of users) { const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(uid).first<User>(); if (u) await deliver(env, u); }
  return users.size;
}

type Q = { qid: string; lid: string; name: string; price_cents: number; hood: string | null };
async function queued(env: Env, uid: string): Promise<Q[]> {
  return (await env.DB.prepare(`SELECT q.id qid, l.id lid, l.name, l.price_cents, l.hood FROM alert_queue q JOIN listings l ON l.id = q.listing_id
    WHERE q.user_id = ? AND q.sent_at IS NULL AND l.status = 'live' ORDER BY q.created_at`).bind(uid).all<Q>()).results;
}

// Send now if today's allowance isn't used up; otherwise it waits for the morning bundle.
export async function deliver(env: Env, u: User) {
  const day = etDay(); let sent = u.alert_day === day ? (u.alert_sent || 0) : 0, more = u.alert_day === day ? (u.alert_more || 0) : 0;
  const cap = more ? MORE_CAP : 1;
  const items = await queued(env, u.id); if (!items.length || sent >= cap) return;
  const it = items[0];
  let body = `${it.name} just listed${it.hood ? ' in ' + it.hood : ' near you'} · ${money(it.price_cents)}/day ${await itemLink(env, it.lid)}`;
  if (sent === 0 && !more) {
    body += `\nWant more alerts today? Reply YES`;
    // park the YES only if nothing else is waiting on one (price change, cancel…)
    await env.DB.prepare(`INSERT INTO pending_actions (user_id, kind, payload, expires_at) VALUES (?, 'alerts_more', '{}', ?)
      ON CONFLICT(user_id) DO UPDATE SET kind = excluded.kind, payload = excluded.payload, expires_at = excluded.expires_at WHERE pending_actions.expires_at < ?`)
      .bind(u.id, now() + 12 * 3600e3, now()).run();
  }
  await textUser(env, u, body, 'alert');
  await env.DB.prepare('UPDATE alert_queue SET sent_at = ? WHERE id = ?').bind(now(), it.qid).run();
  await env.DB.prepare('UPDATE users SET alert_day = ?, alert_sent = ?, alert_more = ? WHERE id = ?').bind(day, sent + 1, more, u.id).run();
}

// Reply YES to "Want more alerts today?"
export async function allowMore(env: Env, u: User) {
  const day = etDay();
  await env.DB.prepare('UPDATE users SET alert_day = ?, alert_more = 1, alert_sent = CASE WHEN alert_day = ? THEN alert_sent ELSE 0 END WHERE id = ?').bind(day, day, u.id).run();
  const fresh = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first<User>();
  if (fresh && (await queued(env, u.id)).length) { await deliver(env, fresh); }
  else await textUser(env, u, `Done — up to ${MORE_CAP} alerts today`, 'alert');
}

// ~8am ET: one text with everything held back yesterday
export async function morningBundle(env: Env) {
  const uids = (await env.DB.prepare('SELECT DISTINCT user_id FROM alert_queue WHERE sent_at IS NULL').all<{ user_id: string }>()).results;
  let n = 0;
  for (const { user_id } of uids) {
    const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user_id).first<User>(); if (!u) continue;
    const items = await queued(env, u.id);
    if (items.length) {
      const top = items.slice(0, 5);
      const lines = await Promise.all(top.map(async i => `${i.name} ${money(i.price_cents)}/day${i.hood ? ' · ' + i.hood : ''} ${await itemLink(env, i.lid)}`));
      await textUser(env, u, `New since yesterday, matching your searches:\n${lines.join('\n')}${items.length > 5 ? `\n+${items.length - 5} more ${env.APP_URL}/alerts` : ''}\nTurn off: ${env.APP_URL}/alerts`, 'alert');
      n++;
    }
    await env.DB.prepare('UPDATE alert_queue SET sent_at = ? WHERE user_id = ? AND sent_at IS NULL').bind(now(), u.id).run();
    await env.DB.prepare('UPDATE users SET alert_day = ?, alert_sent = 0, alert_more = 0 WHERE id = ?').bind(etDay(), u.id).run();
  }
  return n;
}
