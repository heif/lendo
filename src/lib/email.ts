// Email = backup channel (texts first). Plain, like a text, with chunky buttons. Sent through Resend when RESEND_API_KEY is set.
import type { Env, Listing, Rental, User } from './env';
import { backDay, firstName, fmtDay, fmtRange } from './util';
import { logEvent } from './log';

export const emailOn = (env: Env) => !!env.RESEND_API_KEY;
export const validEmail = (e: string) => /^[^\s@]{1,64}@[^\s@]+\.[a-z]{2,}$/i.test(e) && e.length <= 120;
const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

export type Btn = { label: string; url: string; pri?: boolean; sub?: string };
export type Step = { t: string; d?: string; more?: string[]; state?: 'done' | 'now'; btns?: Btn[] };
export type Card = { title: string; img?: string | null; steps?: Step[]; sub?: string; more?: { label: string; url: string } };
/* plain (no box) so it fits any phone; fluid up to 480px. Same steps + timeline rail as the top of the rental page (Scott, 11/24) */
export function emailHtml(lines: string[], btns: Btn[], why: string, card?: Card): string {
  const F = 'Helvetica,Arial,sans-serif';
  const bRow = (bs: Btn[], top: number) => bs.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:${top}px"><tr>${bs.map((x, k) => `<td width="${Math.floor(100 / bs.length)}%" style="vertical-align:top;padding-${k ? 'left' : 'right'}:${bs.length > 1 ? 4 : 0}px"><a href="${esc(x.url)}" style="display:block;text-align:center;padding:11px 0;border-radius:14px;border:2.5px solid #1E3A2B;font:900 16px ${F};text-decoration:none;${x.pri ? 'background:#FF4F00;color:#ffffff' : 'background:#ffffff;color:#1E3A2B'}">${esc(x.label)}</a>${x.sub ? `<div style="text-align:center;font:700 12.5px ${F};color:#8A857B;margin-top:5px">${esc(x.sub)}</div>` : ''}</td>`).join('')}</tr></table>` : '';
  const c = card || { title: lines[0] || '', sub: lines.slice(1).join(' · ') };
  const img = c.img ? `<td width="66" style="padding-right:12px;vertical-align:middle"><img src="${esc(c.img)}" width="54" height="54" alt="" style="display:block;width:54px;height:54px;object-fit:contain;background:#F5F3EE;border-radius:12px"></td>` : '';
  const steps = c.steps?.length ? `<div style="margin:16px 0 0 5px;border-left:3px solid #E6E1D6">${c.steps.map(st => {
    const on = !!st.state, dot = st.state === 'now' ? '#FF4F00' : st.state === 'done' ? '#1E3A2B' : '#E6E1D6';
    return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-left:-7px"><tr><td width="21" style="vertical-align:top;padding-top:9px"><div style="width:11px;height:11px;border-radius:6px;background:${dot}"></div></td><td style="padding:5px 0;font:15px/1.3 ${F};color:${on ? '#1E3A2B' : '#9A958A'}"><b style="font-weight:800">${esc(st.t)}</b>${st.d ? ` <span style="font-size:13.5px;font-weight:700;color:${st.state === 'now' ? '#3d5446' : '#8A857B'}">${esc(st.d)}</span>` : ''}${(st.more || []).map(m => `<br><span style="font-size:13.5px;font-weight:700;color:#8A857B">${esc(m)}</span>`).join('')}${st.btns ? bRow(st.btns, 8) : ''}</td></tr></table>`;
  }).join('')}</div>` : '';
  const more = c.more ? `<div style="margin-top:14px"><a href="${esc(c.more.url)}" style="font:800 14px ${F};color:#1E3A2B">${esc(c.more.label)}</a></div>` : '';
  return `<div style="background:#ffffff;padding:8px 0"><div style="max-width:480px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>${img}<td style="vertical-align:middle;font:900 19px/1.2 ${F};color:#1E3A2B">${esc(c.title)}</td></tr></table>
${c.sub ? `<div style="font:14px/1.45 ${F};color:#3d5446;margin-top:12px">${esc(c.sub)}</div>` : ''}${steps}${c.steps?.length ? '' : bRow(btns, 16)}${more}
${why ? `<div style="font:12px ${F};color:#8A857B;margin-top:20px">${esc(why)}</div>` : ''}</div></div>`;
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
  return emailUser(env, user, title.slice(0, 90), [clean], btns, why, rentalId, { title, sub: rest.join(' · ') || undefined, more: { label: 'More', url } });
}

/* rental request → owner: emailed at the same time as the text, always (Scott, 11/24) */
export async function emailRequest(env: Env, r: Rental, owner: User, cust: User, it: Listing, earn: string, img: string | null) {
  if (!owner.email) return { ok: false };
  const who = firstName(cust.name || 'A neighbor'), url = `${env.APP_URL}/r/${r.id}`, dep = (it.deposit_cents || 0) > 0;
  const title = `${who} wants your ${it.name}`, md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
  return emailUser(env, owner, `${title} · ${fmtRange(r.start_day, backDay(r.end_day))}`, [`${title}, ${fmtRange(r.start_day, backDay(r.end_day))}. You’d earn ${earn}`],
    [{ label: 'YES', url, pri: true }, { label: 'NO', url }], '', r.id,
    { title, img, more: { label: 'More', url }, steps: [
      { t: `${who} asked for ${fmtRange(r.start_day, backDay(r.end_day))}`, state: 'done' },
      { t: 'Your answer', state: 'now', btns: [{ label: 'YES', sub: `${who} charged`, url, pri: true }, { label: 'NO', url }] },
      { t: `Pickup ${md(r.start_day)}`, d: `· you get ${earn}`, more: dep ? [`Deposit hold on ${who}’s card`] : undefined },
      { t: `Return ${md(backDay(r.end_day))}`, more: dep ? ['Deposit hold released'] : undefined }] });
}
