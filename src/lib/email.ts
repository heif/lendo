// Email = backup channel (texts first). Plain, like a text, with chunky buttons. Sent through Resend when RESEND_API_KEY is set.
import type { Env, User } from './env';
import { logEvent } from './log';

export const emailOn = (env: Env) => !!env.RESEND_API_KEY;
export const validEmail = (e: string) => /^[^\s@]{1,64}@[^\s@]+\.[a-z]{2,}$/i.test(e) && e.length <= 120;
const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

export type Btn = { label: string; url: string; pri?: boolean };
/* plain text first (so it reads like a note and lands in Primary), buttons under it, one grey line saying why they got it */
export function emailHtml(lines: string[], btns: Btn[], why: string): string {
  const b = btns.map(x => `<a href="${esc(x.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:13px 26px;border-radius:14px;border:2.5px solid #1E3A2B;font:900 16px Helvetica,Arial,sans-serif;text-decoration:none;${x.pri ? 'background:#FF4F00;color:#ffffff' : 'background:#ffffff;color:#1E3A2B'}">${esc(x.label)}</a>`).join('');
  return `<div style="font:16px/1.5 Helvetica,Arial,sans-serif;color:#1E3A2B;max-width:520px">${lines.map(l => `<p style="margin:0 0 12px">${esc(l)}</p>`).join('')}${b ? `<div style="margin:16px 0 8px">${b}</div>` : ''}<p style="margin:14px 0 0;font-size:12.5px;color:#8A857B">${esc(why)}</p></div>`;
}

export async function emailUser(env: Env, user: User, subject: string, lines: string[], btns: Btn[], why: string, rentalId?: string): Promise<{ ok: boolean; error?: string }> {
  if (!user.email) return { ok: false, error: 'no email' };
  const text = lines.join('\n\n') + (btns.length ? '\n\n' + btns.map(b => `${b.label}: ${b.url}`).join('\n') : '') + '\n\n' + why;
  let res: { ok: boolean; error?: string; id?: string };
  if (!emailOn(env)) { console.log(`[email:dev] → ${user.email}: ${subject}\n${text}`); res = { ok: true, id: 'dev' }; }
  else {
    try {
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.EMAIL_FROM || 'Lendo <hi@lendo.co>', to: [user.email], subject: subject.slice(0, 120), text, html: emailHtml(lines, btns, why) }) });
      const j: any = await r.json().catch(() => ({}));
      res = r.ok ? { ok: true, id: j.id } : { ok: false, error: `resend ${r.status} ${JSON.stringify(j).slice(0, 200)}` };
    } catch (e: any) { res = { ok: false, error: String(e?.message || e) }; }
  }
  await logEvent(env.DB, res.ok ? 'email.sent' : 'email.failed', { user: user.id, rental: rentalId, data: { subject: subject.slice(0, 120), id: res.id ?? null, err: res.error ?? null } });
  return res;
}

/* a text that couldn't go out (allowance used / texts off) or went unanswered → the same words by email */
export async function emailFromText(env: Env, user: User, text: string, rentalId: string | undefined, why: string) {
  const body = text.replace(/\s*https?:\/\/\S+/g, '').replace(/ · (Reply OK[^·]*|👍 this[^·]*)$/i, '').replace(/^Lendo:\s*/, '').trim();
  const asks = /reply YES or NO/i.test(text);
  const url = rentalId ? `${env.APP_URL}/r/${rentalId}` : (text.match(/https?:\/\/\S+/)?.[0] || env.APP_URL);
  const btns: Btn[] = asks ? [{ label: 'YES', url, pri: true }, { label: 'NO', url }] : [{ label: 'OPEN LENDO', url, pri: true }];
  return emailUser(env, user, body.split(' · ')[0].slice(0, 90), [body.replace(/ · reply YES or NO/i, '').replace(/ — reply YES or NO/i, '')], btns, why, rentalId);
}
