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
    if (row) { row.admin = (c.env.ADMIN_PHONES || '').split(',').map(s => s.trim()).includes(row.phone); c.set('user', row); }
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

export async function startLogin(env: Env, phone: string): Promise<{ ok: boolean; devCode?: string; error?: string }> {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await env.DB.prepare('INSERT OR REPLACE INTO otp_codes (phone, code, expires_at, attempts) VALUES (?,?,?,0)')
    .bind(phone, code, now() + 10 * 60 * 1000).run();
  const r = await sendRaw(env, phone, `${code} is your Lendo code. Save contact + reply OK so rental texts reach you`);
  if (!r.ok) {
    if ((r.error || '').includes('conversation_awaiting_reply')) return { ok: false, error: `We've texted you before and need a reply first. Find the thread from ${env.LENDO_NUMBER} (check Spam / Unknown Senders), reply OK, then try again.` };
    return { ok: false, error: r.error };
  }
  return { ok: true, devCode: env.BLOOIO_API_KEY ? undefined : code };
}

export async function finishLogin(c: Context<{ Bindings: Env; Variables: Vars }>, phone: string, code: string): Promise<User | null> {
  const row = await c.env.DB.prepare('SELECT * FROM otp_codes WHERE phone = ?').bind(phone).first<{ code: string; expires_at: number; attempts: number }>();
  if (!row || row.expires_at < now() || row.attempts >= 5) return null;
  if (row.code !== code.trim()) {
    await c.env.DB.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = ?').bind(phone).run();
    return null;
  }
  await c.env.DB.prepare('DELETE FROM otp_codes WHERE phone = ?').bind(phone).run();
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
