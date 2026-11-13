// Blooio — iMessage (falls back to SMS on Blooio's side) for login codes and rental texts.
// Docs: https://docs.blooio.com  (POST {BASE}/chats/{phone}/messages  { text, attachments? })
import type { Env, User } from './env';
import { logEvent } from './log';
import { id, now } from './util';

export type TextCategory = 'login' | 'rental' | 'money' | 'pickup' | 'nudge' | 'milestone' | 'alert';

export async function sendRaw(env: Env, phone: string, text: string, attachments?: string[]): Promise<{ ok: boolean; message_id?: string; error?: string }> {
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

// Text a user and log it so the Inbox page shows "what we text you".
export async function textUser(env: Env, user: User, text: string, category: TextCategory, rentalId?: string) {
  // eslint-disable-next-line no-param-reassign
  if ((category === 'nudge' && !user.nudges) || (!user.texts && category !== 'login')) { await logEvent(env.DB, 'text.suppressed', { user: user.id, rental: rentalId, data: { category, why: !user.texts ? 'STOP' : 'nudges off', body: text.slice(0, 300) } }); return; }
  // Until they've texted us once, iOS tends to spam-filter messages with links from an unknown number,
  // and Blooio allows only 3 outbound on a new conversation. So: no links, and ask for a reply.
  if (!user.replied) text = text.replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim() + ' (Reply OK to get links + updates here.)';
  const r = await sendRaw(env, user.phone, text);
  if (!r.ok) { console.warn('text not sent', user.id, category, r.error); await logEvent(env.DB, 'text.failed', { user: user.id, rental: rentalId, data: { category, err: String(r.error).slice(0, 300), body: text.slice(0, 300) } }); }
  await env.DB.prepare('INSERT INTO outbound_texts (id, user_id, body, category, rental_id, provider_id, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(id('t'), user.id, text, category, rentalId ?? null, r.message_id ?? null, now()).run();
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
