import type { Env, Listing, Rental, User } from './env';
import { id, now } from './util';

export type PhotoRow = { id: string; listing_id: string; r2_key: string; pos: number };

export async function userByPhone(db: D1Database, phone: string) {
  return db.prepare('SELECT * FROM users WHERE phone = ?').bind(phone).first<User>();
}
export async function userById(db: D1Database, uid: string) {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(uid).first<User>();
}
export async function ensureUser(db: D1Database, phone: string): Promise<User> {
  const u = await userByPhone(db, phone);
  if (u) return u;
  const uid = id('u');
  await db.prepare('INSERT INTO users (id, phone, created_at) VALUES (?, ?, ?)').bind(uid, phone, now()).run();
  return (await userById(db, uid))!;
}

export async function listingById(db: D1Database, lid: string) {
  return db.prepare('SELECT * FROM listings WHERE id = ?').bind(lid).first<Listing>();
}
export async function photosFor(db: D1Database, lid: string) {
  const r = await db.prepare('SELECT * FROM photos WHERE listing_id = ? ORDER BY pos').bind(lid).all<PhotoRow>();
  return r.results;
}
export async function firstPhotos(db: D1Database, ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const out: Record<string, string> = {};
  // D1 allows 100 bound parameters per statement → chunk
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const q = `SELECT listing_id, r2_key FROM photos WHERE listing_id IN (${part.map(() => '?').join(',')}) ORDER BY pos`;
    const r = await db.prepare(q).bind(...part).all<{ listing_id: string; r2_key: string }>();
    for (const p of r.results) if (!out[p.listing_id]) out[p.listing_id] = p.r2_key;
  }
  return out;
}

export async function rentalById(db: D1Database, rid: string) {
  return db.prepare('SELECT * FROM rentals WHERE id = ?').bind(rid).first<Rental>();
}

// days a listing is unavailable in [from, to]
export async function busyDays(db: D1Database, lid: string, from: string, to: string): Promise<Set<string>> {
  const out = new Set<string>();
  const b = await db.prepare('SELECT day FROM blocked_days WHERE listing_id = ? AND day BETWEEN ? AND ?').bind(lid, from, to).all<{ day: string }>();
  for (const r of b.results) out.add(r.day);
  // buffer day: one free day on each side of every rental, so a return and the next pickup never land on the same day
  const shift = (day: string, n: number) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const rs = await db.prepare(`SELECT start_day, end_day FROM rentals WHERE listing_id = ? AND status IN ('held','confirmed','picked_up') AND end_day >= ? AND start_day <= ?`)
    .bind(lid, shift(from, -1), shift(to, 1)).all<{ start_day: string; end_day: string }>();
  for (const r of rs.results) {
    let d = new Date(shift(r.start_day, -1) + 'T00:00:00Z');
    const e = new Date(shift(r.end_day, 1) + 'T00:00:00Z');
    while (d <= e) { out.add(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  }
  // extra days someone is asking for (card held, waiting for the owner) count as taken too
  const xs = await db.prepare(`SELECT from_day, new_end FROM rental_extensions WHERE listing_id = ? AND status = 'held' AND new_end >= ? AND from_day <= ?`)
    .bind(lid, shift(from, -1), shift(to, 1)).all<{ from_day: string; new_end: string }>().catch(() => ({ results: [] as { from_day: string; new_end: string }[] }));
  for (const x of xs.results) {
    let d = new Date(x.from_day + 'T00:00:00Z'); const e = new Date(shift(x.new_end, 1) + 'T00:00:00Z');
    while (d <= e) { out.add(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  }
  for (const d of [...out]) if (d < from || d > to) out.delete(d);
  return out;
}

export type Rep = { as_owner_avg: number | null; as_owner_n: number; as_renter_avg: number | null; as_renter_n: number; listed: number; rentals: number };
export async function reputation(db: D1Database, uid: string): Promise<Rep> {
  const o = await db.prepare(`SELECT AVG(renter_rating) a, COUNT(renter_rating) n FROM rentals WHERE owner_id = ? AND renter_rating IS NOT NULL`).bind(uid).first<{ a: number | null; n: number }>();
  const r = await db.prepare(`SELECT AVG(owner_rating) a, COUNT(owner_rating) n FROM rentals WHERE renter_id = ? AND owner_rating IS NOT NULL`).bind(uid).first<{ a: number | null; n: number }>();
  const l = await db.prepare(`SELECT COUNT(*) n FROM listings WHERE owner_id = ? AND status != 'removed'`).bind(uid).first<{ n: number }>();
  const t = await db.prepare(`SELECT COUNT(*) n FROM rentals WHERE (owner_id = ? OR renter_id = ?) AND status IN ('confirmed','picked_up','returned','closed')`).bind(uid, uid).first<{ n: number }>();
  return { as_owner_avg: o?.a ?? null, as_owner_n: o?.n ?? 0, as_renter_avg: r?.a ?? null, as_renter_n: r?.n ?? 0, listed: l?.n ?? 0, rentals: t?.n ?? 0 };
}

export async function counts(db: D1Database, hood: string | null) {
  const g = await db.prepare(`SELECT COUNT(*) n FROM listings WHERE status = 'live'`).first<{ n: number }>();
  const h = hood ? await db.prepare(`SELECT COUNT(*) n FROM listings WHERE status = 'live' AND hood = ?`).bind(hood).first<{ n: number }>() : null;
  return { global: g?.n ?? 0, hood: h?.n ?? 0 };
}

export async function addMessage(env: Env, rentalId: string, senderId: string | null, body: string, via: 'web' | 'text' | 'system') {
  await env.DB.prepare('INSERT INTO messages (id, rental_id, sender_id, body, via, created_at) VALUES (?,?,?,?,?,?)')
    .bind(id('m'), rentalId, senderId, body, via, now()).run();
}

export async function setRentalStatus(db: D1Database, rid: string, status: Rental['status'], extra: Record<string, string | number | null> = {}) {
  const keys = Object.keys(extra);
  const sets = ['status = ?', 'updated_at = ?', ...keys.map(k => `${k} = ?`)].join(', ');
  await db.prepare(`UPDATE rentals SET ${sets} WHERE id = ?`).bind(status, now(), ...keys.map(k => extra[k]), rid).run();
}
