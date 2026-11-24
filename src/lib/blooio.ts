import { emailFromText } from './email';
import { linqOn, linqSend } from './linq';
import { sendTwilioSms, twilioSmsOn } from './twiliosms';
// Blooio — iMessage (falls back to SMS on Blooio's side) for login codes and rental texts.
// Docs: https://docs.blooio.com  (POST {BASE}/chats/{phone}/messages  { text, attachments? })
import type { Env, User } from './env';
import { logEvent } from './log';
import { id, now } from './util';

export type TextCategory = 'login' | 'rental' | 'money' | 'pickup' | 'nudge' | 'milestone' | 'alert' | 'chat';
/* every text asks for a reply (Blooio pauses a conversation after 6 unanswered). Info-only texts end with a confirm ask; the reply is acked silently */
export const CONFIRM_ASK = 'Reply OK to confirm';
export const KEEP_ASK = '👍 this to keep updates coming';
const asksReply = (t: string) => /\breply\b|👍 this/i.test(t);
/* Lendo's own number as an sms: link (prefilled body); works on iPhone + Android */
/* Lendo's number for page markup that has no env (layout); set per request in loadUser */
export const site = { number: '', sms: '' }; /* sms = Android SMS number (10 digits) when Twilio SMS is on */
export const GIFT_TEXT = 'Free $5 gift card please';
export const smsHref = (env: Env, body: string) => `sms:+1${(env.LENDO_NUMBER || '').replace(/\D/g, '').slice(-10)}?&body=${encodeURIComponent(body)}`;

export async function sendRaw(env: Env, phone: string, text: string, attachments?: string[]): Promise<{ ok: boolean; message_id?: string; error?: string }> {
  if (linqOn(env)) return linqSend(env, phone, text, id('idem'));
  if (!env.BLOOIO_API_KEY) {
    console.log(`[blooio:dev] → ${phone}: ${text}${attachments?.length ? ' [+' + attachments.length + ' attachment]' : ''}`);
    return { ok: true, message_id: 'dev_' + id() };
  }
  const url = `${env.BLOOIO_API_BASE.replace(/\/$/, '')}/chats/${encodeURIComponent(phone)}/messages`;
  const body: Record<string, unknown> = { text };
  if (attachments?.length) body.attachments = attachments;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.BLOOIO_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': id('idem') },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.error('blooio send failed', res.status, t);
    return { ok: false, error: `${res.status} ${t}` };
  }
  const j = (await res.json().catch(() => ({}))) as any;
  return { ok: true, message_id: j.message_id || j.id || j.data?.message_id || j.data?.id || (j.messages?.[0]?.id) || undefined };
}

// texts actually sent to this user since their last text or tapback to Lendo (web inbox doesn't count)
export async function textStreak(env: Env, uid: string): Promise<number> {
  const r = await env.DB.prepare(`SELECT COUNT(*) n FROM outbound_texts WHERE user_id = ?1 AND provider_id IS NOT NULL AND created_at > COALESCE((SELECT MAX(created_at) FROM inbound_texts WHERE user_id = ?1 AND via IN ('text', 'tap')), 0)`).bind(uid).first<{ n: number }>().catch(() => null);
  return r?.n || 0;
}
/* how many texts in a row this person can get before they respond. Blooio's tiers (docs.blooio.com/guides/messaging-safety):
   new 3 · 1+ written reply 4 · 3+ replies on 2+ days 6 · 10+ replies on 3+ days in a thread 7+ days old 8. Linq has no hard cap; 6 keeps it polite */
export async function textAllowance(env: Env, uid: string): Promise<number> {
  const r = await env.DB.prepare(`SELECT COUNT(*) n, COUNT(DISTINCT date(created_at / 1000, 'unixepoch')) d, MIN(created_at) first FROM inbound_texts WHERE user_id = ? AND via = 'text'`).bind(uid).first<{ n: number; d: number; first: number | null }>().catch(() => null);
  const n = r?.n || 0, d = r?.d || 0;
  if (linqOn(env)) return n ? 6 : 3;
  return n >= 10 && d >= 3 && now() - (r?.first || now()) >= 7 * 86400e3 ? 8 : n >= 3 && d >= 2 ? 6 : n >= 1 ? 4 : 3;
}
export async function textsPaused(env: Env, user: User): Promise<boolean> {
  return user.sms_ok === 0 || (await textStreak(env, user.id)) >= (await textAllowance(env, user.id));
}
/* a tapback (👍 on a Lendo text) counts as a response: it resets the run of unanswered texts */
export async function recordTap(env: Env, uid: string, what: string) {
  await env.DB.prepare('INSERT INTO inbound_texts (id, user_id, body, via, created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), uid, what.slice(0, 80), 'tap', now()).run().catch(() => 0);
}
export const TAP_RE = /^(Liked|Loved|Emphasized|Laughed at|Disliked|Questioned|Reacted\s.+\sto)\s[“"]/i;

const WORTH = new Set<TextCategory>(['rental', 'money', 'pickup', 'chat']); /* worth a second channel; nudges/alerts/milestones never chase */
const row = (env: Env, user: User, text: string, category: TextCategory, rentalId: string | undefined, pid: string | null) =>
  env.DB.prepare('INSERT INTO outbound_texts (id, user_id, body, category, rental_id, provider_id, created_at) VALUES (?,?,?,?,?,?,?)').bind(id('t'), user.id, text, category, rentalId ?? null, pid, now()).run();

// Text a user and log it so the Inbox page shows "what we text you".
export async function textUser(env: Env, user: User, text: string, category: TextCategory, rentalId?: string) {
  if ((category === 'nudge' && !user.nudges) || (!user.texts && category !== 'login')) { await logEvent(env.DB, 'text.suppressed', { user: user.id, rental: rentalId, data: { category, why: !user.texts ? 'STOP' : 'nudges off', body: text.slice(0, 300) } }); return; }
  /* left the optional rental-texts box unchecked: only login codes by text; what matters goes by email, all of it shows in the web inbox */
  if (user.sms_ok === 0 && category !== 'login') {
    await logEvent(env.DB, 'text.suppressed', { user: user.id, rental: rentalId, data: { category, why: 'no text opt-in', body: text.slice(0, 300) } });
    await row(env, user, text, category, rentalId, null);
    if (WORTH.has(category)) await emailFromText(env, user, text, rentalId, 'Sent by email because rental texts are off for your number · turn them on by texting OK to Lendo');
    return { ok: false, error: 'optout' };
  }
  if ((user as any).android && twilioSmsOn(env) && !linqOn(env)) { /* Linq does its own SMS fallback */
    const r2 = await sendTwilioSms(env, user.phone, text);
    if (!r2.ok) await logEvent(env.DB, 'text.failed', { user: user.id, rental: rentalId, data: { category, via: 'twilio', err: String(r2.error).slice(0, 300), body: text.slice(0, 300) } });
    await row(env, user, text, category, rentalId, r2.message_id ?? null);
    return r2;
  }
  const streak = await textStreak(env, user.id), allow = await textAllowance(env, user.id), left = allow - streak;
  /* allowance used: never just hold. What matters goes out another way right now (SMS line if there is one, else email); the rest waits in the web inbox */
  if (left <= 0 && category !== 'login') {
    let via = 'held', pid: string | null = null;
    if (WORTH.has(category)) {
      if (twilioSmsOn(env) && !linqOn(env)) { const r2 = await sendTwilioSms(env, user.phone, text + ' · Text OK to Lendo to get these by iMessage'); if (r2.ok) { via = 'sms'; pid = null; } }
      if (via === 'held' && user.email) { const e = await emailFromText(env, user, text, rentalId, 'Sent by email because texts to you are waiting on a reply · text OK to Lendo to get them again'); if (e.ok) via = 'email'; }
    }
    await logEvent(env.DB, 'text.suppressed', { user: user.id, rental: rentalId, data: { category, why: `waiting for a response (${streak} of ${allow} unanswered)`, went: via, body: text.slice(0, 300) } });
    await row(env, user, text, category, rentalId, pid); /* still shows in the web inbox */
    return { ok: false, error: 'streak', via };
  }
  /* ask for a response only when it's needed: the last text they can get asks for a 👍 (one tap resets the count). Decisions already say "reply YES or NO" */
  if (!user.replied) text = text.replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim() + (asksReply(text) ? '' : ' (Reply OK to get links + updates here.)'); /* links unlock after a written reply */
  else if (left <= 1 && category !== 'login' && !asksReply(text)) text = text + ' · ' + KEEP_ASK;
  const r = await sendRaw(env, user.phone, text);
  if (!r.ok) { console.warn('text not sent', user.id, category, r.error); await logEvent(env.DB, 'text.failed', { user: user.id, rental: rentalId, data: { category, err: String(r.error).slice(0, 300), body: text.slice(0, 300) } });
    /* the provider refused (its own count can differ from ours): same fallback */
    if (WORTH.has(category) && user.email && /429|awaiting|streak|inactive|restricted/i.test(String(r.error))) await emailFromText(env, user, text, rentalId, 'Sent by email because a text to you didn’t go through · text OK to Lendo to get them again'); }
  await row(env, user, text, category, rentalId, r.message_id ?? null);
  return r;
}

// Inbound webhook payload shapes seen in Blooio docs differ by version; normalize both.
export function parseInbound(j: any): { event: string; from: string; text: string; messageId?: string } | null {
  if (!j) return null;
  const event = j.event || j.type || j.data?.type || '';
  const d = j.data || j;
  if (d.direction && d.direction !== 'inbound') return null;
  const from = d.sender || d.external_id || d.from || d.contact?.identifier || d.handle || '';
  const text = d.text || d.body || '';
  if (!from) return null;
  return { event, from: String(from), text: String(text || ''), messageId: d.message_id || j.message_id };
}
