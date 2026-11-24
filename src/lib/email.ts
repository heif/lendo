// Email = backup channel (texts first). Plain, like a text, with chunky buttons. Sent through Resend when RESEND_API_KEY is set.
import type { Env, User } from './env';
import { logEvent } from './log';

export const emailOn = (env: Env) => !!env.RESEND_API_KEY;
export const validEmail = (e: string) => /^[^\s@]{1,64}@[^\s@]+\.[a-z]{2,}$/i.test(e) && e.length <= 120;
const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

export type Btn = { label: string; url: string; pri?: boolean };
export type Card = { title: string; sub?: string; money?: string; img?: string | null; more?: { label: string; url: string } };
/* card style (Scott, 11/24): cream card, item photo + headline + $ tag, one detail line, chunky buttons, "more on the web" link. Max 480px wide, so it looks the same on phones and computers */
export function emailHtml(lines: string[], btns: Btn[], why: string, card?: Card): string {
  const F = 'Helvetica,Arial,sans-serif';
  const b = btns.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px"><tr>${btns.map((x, k) => `<td width="${Math.floor(100 / btns.length)}%" style="padding-${k ? 'left' : 'right'}:${btns.length > 1 ? 4 : 0}px"><a href="${esc(x.url)}" style="display:block;text-align:center;padding:13px 0;border-radius:14px;border:2.5px solid #1E3A2B;font:900 16px ${F};text-decoration:none;${x.pri ? 'background:#FF4F00;color:#ffffff' : 'background:#ffffff;color:#1E3A2B'}">${esc(x.label)}</a></td>`).join('')}</tr></table>` : '';
  const c = card || { title: lines[0] || '', sub: lines.slice(1).join(' · ') };
  const img = c.img ? `<td width="72" style="padding-right:14px;vertical-align:middle"><img src="${esc(c.img)}" width="64" height="64" alt="" style="display:block;width:64px;height:64px;object-fit:contain;background:#ffffff;border-radius:12px"></td>` : '';
  const money = c.money ? `<div style="margin-top:6px;font:15px ${F};color:#1E3A2B">you earn <span style="display:inline-block;background:#FF4F00;color:#ffffff;font-weight:900;border:2px solid #1E3A2B;border-radius:8px;padding:2px 8px">${esc(c.money)}</span></div>` : '';
  const more = c.more ? `<div style="text-align:center;margin-top:14px"><a href="${esc(c.more.url)}" style="font:800 14px ${F};color:#1E3A2B">${esc(c.more.label)}</a></div>` : '';
  return `<div style="background:#ffffff;padding:16px 8px"><div style="max-width:480px;margin:0 auto">
<div style="background:#F5F3EE;border:2.5px solid #1E3A2B;border-radius:18px;padding:18px">
<div style="font:900 15px ${F};color:#1E3A2B;margin-bottom:12px">👋 Lendo</div>
<table role="presentation" cellpadding="0" cellspacing="0"><tr>${img}<td style="vertical-align:middle"><div style="font:900 19px/1.2 ${F};color:#1E3A2B">${esc(c.title)}</div>${money}</td></tr></table>
${c.sub ? `<div style="font:14px/1.45 ${F};color:#3d5446;margin-top:12px">${esc(c.sub)}</div>` : ''}${b}${more}</div>
<div style="text-align:center;font:12px ${F};color:#8A857B;margin-top:12px">${esc(why)}</div></div></div>`;
}

export async function emailUser(env: Env, user: User, subject: string, lines: string[], btns: Btn[], why: string, rentalId?: string, card?: Card): Promise<{ ok: boolean; error?: string }> {
  if (!user.email) return { ok: false, error: 'no email' };
  const text = lines.join('\n\n') + (btns.length ? '\n\n' + btns.map(b => `${b.label}: ${b.url}`).join('\n') : '') + '\n\n' + why;
  let res: { ok: boolean; error?: string; id?: string };
  if (!emailOn(env)) { console.log(`[email:dev] → ${user.email}: ${subject}\n${text}`); res = { ok: true, id: 'dev' }; }
  else {
    try {
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.EMAIL_FROM || 'Lendo <hi@lendo.co>', to: [user.email], subject: subject.slice(0, 120), text, html: emailHtml(lines, btns, why, card) }) });
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
  const clean = body.replace(/ · reply YES or NO/i, '').replace(/ — reply YES or NO/i, '');
  const [title, ...rest] = clean.split(' · ');
  return emailUser(env, user, title.slice(0, 90), [clean], btns, why, rentalId, { title, sub: rest.join(' · ') || undefined, more: { label: 'See details on Lendo', url } });
}
