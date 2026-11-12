export const now = () => Date.now();

export function id(prefix = ''): string {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  const s = btoa(String.fromCharCode(...b)).replace(/\+/g, 'a').replace(/\//g, 'b').replace(/=+$/, '');
  return prefix ? `${prefix}_${s}` : s;
}

export function money(cents: number): string {
  const d = cents / 100;
  return Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
}

export function normPhone(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  if (raw.trim().startsWith('+') && d.length >= 8 && d.length <= 15) return `+${d}`;
  return null;
}

export function prettyPhone(p: string): string {
  const m = p.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p;
}

export function dayStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(day: string, n: number): string {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return dayStr(d);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) + 1;
}
export function fmtDay(day: string): string {
  const d = new Date(day + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
export function fmtRange(a: string, b: string): string {
  return a === b ? fmtDay(a) : `${fmtDay(a)} → ${fmtDay(b)}`;
}

// ~100 m fuzz so the map never shows a doorstep
export function fuzz(lat: number, lng: number): [number, number] {
  const r = 0.0009, a = Math.random() * Math.PI * 2, d = Math.random() * r;
  return [lat + Math.cos(a) * d, lng + Math.sin(a) * d / Math.cos(lat * Math.PI / 180)];
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export function firstName(name: string | null, fallback = 'Neighbor'): string {
  return (name || '').trim().split(/\s+/)[0] || fallback;
}

// rent for n days; a week price caps each (partial) week. Mirrored in the item page JS.
export function rentFor(n: number, dayCents: number, weekCents: number | null): number {
  if (!weekCents) return n * dayCents;
  const r = Math.floor(n / 7) * weekCents + (n % 7) * dayCents;
  return Math.min(r, Math.ceil(n / 7) * weekCents);
}

export function weekDefault(priceCents: number): number {
  return Math.round(priceCents * 7 * 0.7 / 100) * 100; // 30% off, whole dollars
}

export async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Ratings: people give a thumbs up (stored 5) or down (stored 1); we show whole stars only — no decimals
export function wholeStars(avg: number | null | undefined): number {
  if (avg == null) return 0;
  const up = (avg - 1) / 4; // share of thumbs up
  return up >= 0.9 ? 5 : up >= 0.75 ? 4 : up >= 0.55 ? 3 : up >= 0.35 ? 2 : 1;
}
export const starStr = (avg: number | null | undefined) => { const n = wholeStars(avg); return n ? '★'.repeat(n) : ''; };

// Naming (decided 2026-11-12): first name on map cards, item titles and texts; first + last initial on owner strips; full name on the profile
export function shortName(name: string | null, fallback = 'Neighbor'): string {
  const p = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return fallback;
  return p.length > 1 ? `${p[0]} ${p[p.length - 1].charAt(0).toUpperCase()}.` : p[0];
}
