// Linq (iMessage → RCS → SMS) — replaces Blooio when LINQ_API_KEY is set. Docs: docs.linqapp.com/channel/imessage
import type { Env } from './env';

export const LINQ_BASE = 'https://api.linqapp.com/api/partner/v3';
export const linqOn = (env: Env) => !!env.LINQ_API_KEY;
const e164 = (p: string) => { const d = p.replace(/\D/g, ''); return d.length === 10 ? '+1' + d : '+' + d; };

/* send one text; Linq picks iMessage, else RCS, else SMS (its default fallback chain) */
export async function linqSend(env: Env, phone: string, text: string, idem: string): Promise<{ ok: boolean; message_id?: string; error?: string }> {
  const body: any = { to: [e164(phone)], message: { parts: [{ type: 'text', value: text }] } };
  if (env.LENDO_NUMBER) body.from = e164(env.LENDO_NUMBER);
  const r = await fetch(LINQ_BASE + '/messages', { method: 'POST', headers: { Authorization: `Bearer ${env.LINQ_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': idem }, body: JSON.stringify(body) });
  const t = await r.text().catch(() => '');
  if (!r.ok) return { ok: false, error: `linq ${r.status} ${t.slice(0, 300)}` };
  let j: any = {}; try { j = JSON.parse(t); } catch {}
  return { ok: true, message_id: j.id || j.message?.id || j.data?.id || j.data?.message?.id || j.message_id || undefined };
}

/* Standard Webhooks: base64 HMAC-SHA256 of "{webhook-id}.{webhook-timestamp}.{raw body}", key = base64-decoded secret after "whsec_" */
export async function linqVerify(secret: string, hdr: (k: string) => string | undefined, raw: string): Promise<boolean> {
  const wid = hdr('webhook-id') || '', ts = hdr('webhook-timestamp') || '', sig = hdr('webhook-signature') || '';
  if (!wid || !ts || !sig || Math.abs(Date.now() / 1000 - parseInt(ts, 10)) > 300) return false;
  const key = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), ch => ch.charCodeAt(0));
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${wid}.${ts}.${raw}`)));
  const want = btoa(String.fromCharCode(...mac));
  return sig.split(' ').some(s => { const v = s.replace(/^v1,/, ''); if (v.length !== want.length) return false; let d = 0; for (let i = 0; i < v.length; i++) d |= v.charCodeAt(i) ^ want.charCodeAt(i); return d === 0; });
}

/* both webhook versions (2026-02-03 and 2025-01-01) → one shape */
export function linqParse(j: any): { event: string; from: string; text: string; service?: string; mine: boolean } | null {
  const event = String(j?.event_type || j?.type || ''); const d = j?.data || {};
  const from = d.sender_handle?.handle || d.from || d.from_handle?.handle || '';
  const parts = d.parts || d.message?.parts || [];
  const text = parts.filter((p: any) => p?.type === 'text').map((p: any) => String(p.value || '')).join('\n').trim();
  const mine = d.direction ? d.direction !== 'inbound' : !!d.is_from_me;
  return { event, from, text, service: d.service || d.sender_handle?.service, mine };
}
