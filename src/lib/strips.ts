// Message strips above the ticker (Scott, 11/27). Admin sets them at /admin/strips: on/off, message, link,
// who (logged in/out, owner/customer/neither), cities, hoods, device, dates, style. One shows at a time
// (lowest sort first, then newest). ✕ hides one for that person for 7 days (cookie). Taps go through /s/:id and are logged.
import type { Env, User } from './env';
import { CITIES } from './places';
import { localToday } from './util';

export type Strip = {
  id: string; on_: number; msg: string; link: string | null; who: string; cities: string; hoods: string;
  device: string; start_day: string | null; end_day: string | null; style: string; sort: number; created_at: number;
};
export const STYLES = ['orange', 'cream', 'ticker', 'ink'] as const;
export const WHO = [['in', 'Logged in'], ['out', 'Logged out'], ['owner', 'Owners'], ['customer', 'Customers'], ['neither', 'Neither']] as const;

const list = (s: string) => s.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);

export async function tickerOn(env: Env): Promise<boolean> {
  const r = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'ticker_on'`).first<{ value: string }>().catch(() => null);
  return r?.value !== '0';
}

export function cityAt(lng: number, lat: number): string | null {
  const c = CITIES.find(ct => lng >= ct.bbox[0] && lng <= ct.bbox[2] && lat >= ct.bbox[1] && lat <= ct.bbox[3]);
  return c ? c.id : null;
}

/** the strip for this viewer, with {hood} {city} {n} filled in, or null */
export async function pickStrip(env: Env, u: User | null | undefined, o: { city: string | null; ua: string; cookie: string }): Promise<Strip | null> {
  const rows = await env.DB.prepare('SELECT * FROM strips WHERE on_ = 1 ORDER BY sort, created_at DESC').all<Strip>().then(r => r.results).catch(() => [] as Strip[]);
  if (!rows.length) return null;
  const phone = /Mobi|Android|iPhone/i.test(o.ua), today = localToday();
  let role: 'owner' | 'customer' | 'neither' | null = null;
  const roleOf = async () => {
    if (role || !u) return role || 'neither';
    const [l, r] = await Promise.all([
      env.DB.prepare('SELECT 1 FROM listings WHERE owner_id = ? LIMIT 1').bind(u.id).first(),
      env.DB.prepare('SELECT 1 FROM rentals WHERE renter_id = ? LIMIT 1').bind(u.id).first(),
    ]);
    return (role = l ? 'owner' : r ? 'customer' : 'neither');
  };
  const hood = (u?.hood || '').toLowerCase();
  for (const s of rows) {
    if (o.cookie.includes('sx_' + s.id + '=')) continue;
    if (s.device === 'phone' && !phone || s.device === 'computer' && phone) continue;
    if (s.start_day && today < s.start_day || s.end_day && today > s.end_day) continue;
    const cs = list(s.cities); if (cs.length && !(o.city && cs.includes(o.city))) continue;
    const hs = list(s.hoods); if (hs.length && !(hood && hs.includes(hood))) continue;
    const w = list(s.who);
    if (w.length) {
      const login = u ? 'in' : 'out';
      const logins = w.filter(x => x === 'in' || x === 'out'), roles = w.filter(x => x !== 'in' && x !== 'out');
      if (logins.length && !logins.includes(login)) continue;
      if (roles.length && !roles.includes(await roleOf())) continue;
    }
    let msg = s.msg.replace(/\{hood\}/g, u?.hood || '').replace(/\{city\}/g, CITIES.find(c => c.id === o.city)?.name || '');
    if (msg.includes('{n}')) {
      const r = await env.DB.prepare(`SELECT COUNT(*) n FROM listings WHERE status = 'live' AND created_at > ?${u?.hood ? ' AND hood = ?' : ''}`)
        .bind(...[Date.now() - 7 * 864e5, ...(u?.hood ? [u.hood] : [])]).first<{ n: number }>().catch(() => null);
      msg = msg.replace(/\{n\}/g, String(r?.n || 0));
    }
    return { ...s, msg: msg.replace(/\s{2,}/g, ' ').trim() };
  }
  return null;
}
