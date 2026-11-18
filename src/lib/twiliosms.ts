// Android path: a registered Twilio SMS number (10DLC). Android RCS/SMS texts don't reach the Blooio iMessage line,
// so Android users text this number and get Lendo's texts from it. Off until TWILIO_SMS_FROM is set.
import type { Env } from './env';
import { twilioBasic } from './auth';

export const smsFrom = (env: Env) => (env.TWILIO_SMS_FROM || '').replace(/[^\d+]/g, '');
export const twilioSmsOn = (env: Env) => !!(smsFrom(env) && twilioBasic(env) && (env.TWILIO_ACCOUNT_SID || '').trim());
/* 10 digits for sms: links, or '' when off */
export const smsDigits = (env: Env) => (twilioSmsOn(env) ? smsFrom(env).replace(/\D/g, '').slice(-10) : '');

export async function sendTwilioSms(env: Env, to: string, text: string): Promise<{ ok: boolean; message_id?: string; error?: string }> {
  const sid = (env.TWILIO_ACCOUNT_SID || '').trim();
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST', headers: { authorization: twilioBasic(env)!, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: smsFrom(env), Body: text.slice(0, 1500) }).toString(),
  });
  const j: any = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, message_id: j.sid } : { ok: false, error: `twilio ${r.status} ${j?.message || ''}`.trim() };
}

/* X-Twilio-Signature: base64 HMAC-SHA1(auth token, full URL + sorted POST params key+value) */
export async function twilioSigOk(env: Env, url: string, params: Record<string, string>, sig: string): Promise<boolean> {
  const tok = (env.TWILIO_AUTH_TOKEN || '').trim(); if (!tok) return false;
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(tok), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)))));
  if (mac.length !== sig.length) return false;
  let d = 0; for (let i = 0; i < mac.length; i++) d |= mac.charCodeAt(i) ^ sig.charCodeAt(i); return d === 0;
}
