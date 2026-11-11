import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env, User, Vars } from './env';
import { ensureUser } from './db';
import { sendRaw } from './blooio';
import { id, now } from './util';

const SESSION_DAYS = 90;
const COOKIE = 'lendo_s';

export const loadUser: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
  c.set('user', null);
  const sid = getCookie(c, COOKIE);
  if (sid) {
    const row = await c.env.DB.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?')
      .bind(sid, now()).first<User>();
    if (row) {
      row.admin = (c.env.ADMIN_PHONES || '').split(',').map(s => s.trim()).includes(row.phone);
      const n = await c.env.DB.prepare(`SELECT
          (SELECT COUNT(*) FROM messages m JOIN rentals r ON r.id = m.rental_id LEFT JOIN thread_reads t ON t.rental_id = r.id AND t.user_id = ?1
            WHERE (r.owner_id = ?1 OR r.renter_id = ?1) AND m.sender_id IS NOT NULL AND m.sender_id != ?1 AND m.created_at > COALESCE(t.seen_at, 0))
        + (SELECT COUNT(*) FROM rentals WHERE owner_id = ?1 AND status = 'held') n`).bind(row.id).first<{ n: number }>().catch(() => null);
      row.unread = n?.n || 0;
      c.set('user', row);
    }
  }
  await next();
};

export const requireUser: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
  if (!c.get('user')) {
    const nextUrl = c.req.path + (c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '');
    return c.redirect('/login?next=' + encodeURIComponent(nextUrl));
  }
  await next();
};

// Twilio Verify sends + checks the code itself (SMS to any phone; no 10DLC registration needed)
const clean = (v?: string) => (v || '').replace(/^[\s"'`]+|[\s"'`]+$/g, '');  // pasted values sometimes keep quotes or spaces
export const twilioBasic = (env: Env): string | null => {
  const key = clean(env.TWILIO_API_KEY_SID), sec = clean(env.TWILIO_API_KEY_SECRET);
  if (key && sec) return 'Basic ' + btoa(`${key}:${sec}`);
  const sid = clean(env.TWILIO_ACCOUNT_SID), tok = clean(env.TWILIO_AUTH_TOKEN);
  return sid && tok ? 'Basic ' + btoa(`${sid}:${tok}`) : null;
};
const twilioOn = (env: Env) => !!(twilioBasic(env) && (env.TWILIO_VERIFY_SID || '').trim());
async function twilio(env: Env, path: string, body: Record<string, string>): Promise<any> {
  const r = await fetch(`https://verify.twilio.com/v2/Services/${(env.TWILIO_VERIFY_SID || '').trim()}/${path}`, { method: 'POST',
    headers: { authorization: twilioBasic(env)!, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString() });
  const j: any = await r.json().catch(() => ({}));
  return r.ok ? j : { error: j?.message || `twilio ${r.status}` };
}

// last 20 failed code sends (admin /admin/debug)
async function logFail(env: Env, phone: string, via: string, err: string) {
  try {
    const r = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'login_fails'`).first<{ value: string }>();
    const list = r ? JSON.parse(r.value) : []; list.unshift({ t: new Date().toISOString(), phone: phone.slice(0, -4) + '••••', via, err: String(err).slice(0, 200) });
    await env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('login_fails', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify(list.slice(0, 20))).run();
  } catch {}
}
async function viaTwilio(env: Env, phone: string): Promise<{ ok: boolean; error?: string }> {
  const j = await twilio(env, 'Verifications', { To: phone, Channel: 'sms' });
  if (j.error) { await logFail(env, phone, 'twilio', j.error); return { ok: false, error: j.error }; }
  // keep any Blooio code valid too (moved to prev:)
  const old = await env.DB.prepare('SELECT code, expires_at FROM otp_codes WHERE phone = ?').bind(phone).first<{ code: string; expires_at: number }>();
  if (old && old.code !== 'twilio' && old.expires_at > now()) await env.DB.prepare('INSERT OR REPLACE INTO otp_codes (phone, code, expires_at, attempts) VALUES (?,?,?,0)').bind('prev:' + phone, old.code, old.expires_at).run();
  await env.DB.prepare('INSERT OR REPLACE INTO otp_codes (phone, code, expires_at, attempts) VALUES (?,?,?,0)').bind(phone, 'twilio', now() + 10 * 60 * 1000).run();
  return { ok: true };
}
export const smsFallback = twilioOn;

// Blooio (iMessage) first; Twilio SMS when Blooio refuses, or when the person asks for SMS ("didn't get it")
export async function startLogin(env: Env, phone: string, via: 'auto' | 'sms' = 'auto'): Promise<{ ok: boolean; devCode?: string; error?: string; note?: string }> {
  // SMS asked for: if Twilio can't send, keep them on the code screen (the iMessage code still works)
  if (via === 'sms' && twilioOn(env)) { const t = await viaTwilio(env, phone); return t.ok ? t : { ok: true, note: 'SMS isn’t available right now — use the code from your iMessage text' }; }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  // the previous unexpired code stays valid (resend + autofill of the first text): kept as a 'prev:' row
  const old = await env.DB.prepare('SELECT code, expires_at FROM otp_codes WHERE phone = ?').bind(phone).first<{ code: string; expires_at: number }>();
  if (old && old.code !== 'twilio' && old.expires_at > now()) await env.DB.prepare('INSERT OR REPLACE INTO otp_codes (phone, code, expires_at, attempts) VALUES (?,?,?,0)').bind('prev:' + phone, old.code, old.expires_at).run();
  await env.DB.prepare('INSERT OR REPLACE INTO otp_codes (phone, code, expires_at, attempts) VALUES (?,?,?,0)')
    .bind(phone, code, now() + 15 * 60 * 1000).run();
  const r = await sendRaw(env, phone, `${code} is your Lendo code. Save contact + reply OK so rental texts reach you`);
  if (!r.ok) {
    await logFail(env, phone, 'blooio', r.error || 'unknown');
    // Blooio sometimes reports an error but delivers anyway: try SMS, and either way show the code screen
    if (twilioOn(env)) { const t = await viaTwilio(env, phone); if (t.ok) return t; }
    if (!(r.error || '').includes('conversation_awaiting_reply')) return { ok: true, note: 'If no text arrives in a minute, tap “Text me a new code”' };
    if ((r.error || '').includes('conversation_awaiting_reply')) return { ok: false, error: `Texts to this number are paused until you reply. Find the thread from ${env.LENDO_NUMBER} (check Unknown Senders), reply OK, then try again` };
    return { ok: false, error: r.error };
  }
  return { ok: true, devCode: env.BLOOIO_API_KEY ? undefined : code };
}

export async function finishLogin(c: Context<{ Bindings: Env; Variables: Vars }>, phone: string, code: string): Promise<User | null> {
  const row = await c.env.DB.prepare('SELECT * FROM otp_codes WHERE phone = ?').bind(phone).first<{ code: string; expires_at: number; attempts: number }>();
  if (!row || row.expires_at < now() || row.attempts >= 8) return null;
  const prev = await c.env.DB.prepare('SELECT code, expires_at FROM otp_codes WHERE phone = ?').bind('prev:' + phone).first<{ code: string; expires_at: number }>();
  const typed = code.replace(/\D/g, '');
  const prevOk = !!(prev && prev.expires_at > now() && typed === prev.code);
  const ok = prevOk || (row.code === 'twilio' && twilioOn(c.env)
    ? (await twilio(c.env, 'VerificationCheck', { To: phone, Code: typed })).status === 'approved'
    : typed === row.code);
  if (!ok) {
    await c.env.DB.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = ?').bind(phone).run();
    return null;
  }
  await c.env.DB.prepare('DELETE FROM otp_codes WHERE phone IN (?, ?)').bind(phone, 'prev:' + phone).run();
  const user = await ensureUser(c.env.DB, phone);
  const sid = id('s');
  const exp = now() + SESSION_DAYS * 86400000;
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)').bind(sid, user.id, exp).run();
  setCookie(c, COOKIE, sid, { path: '/', httpOnly: true, sameSite: 'Lax', secure: c.env.APP_URL.startsWith('https'), maxAge: SESSION_DAYS * 86400 });
  return user;
}

export async function logout(c: Context<{ Bindings: Env; Variables: Vars }>) {
  const sid = getCookie(c, COOKIE);
  if (sid) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
  deleteCookie(c, COOKIE, { path: '/' });
}
