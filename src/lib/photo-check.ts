// Photo safety filter: every new listing's first photo gets a quick Claude look.
// Flagged → status 'review' (hidden from map/search/alerts) until an admin OKs it at /admin/review.
import type { Env } from './env';

const b64 = (buf: ArrayBuffer) => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

export async function photoOk(env: Env, key: string): Promise<{ ok: boolean; reason: string }> {
  if (!env.ANTHROPIC_API_KEY) return { ok: true, reason: 'no key' };
  const obj = await env.PHOTOS.get(key); if (!obj) return { ok: true, reason: 'no photo' };
  const type = obj.httpMetadata?.contentType || 'image/jpeg';
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 80, messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: /png|webp|gif/.test(type) ? type : 'image/jpeg', data: b64(await obj.arrayBuffer()) } },
        { type: 'text', text: `This photo was posted on a public neighborhood rental site where people list everyday things to rent (tools, cameras, gear). Should it be held for a human check before it shows publicly?
Hold it if it shows: nudity or sexual content; gore or injury; guns or weapons; drugs or drug gear; a person (or animal) being offered as the thing; hate symbols; ID cards, credit cards or other documents with personal info; or nothing that could be rented (a screenshot, meme, blank photo).
People merely visible in the background, or someone holding the item, is fine.
Reply with JSON only: {"hold":true|false,"reason":"<3-8 words>"}` }] }] }) });
    if (!r.ok) return { ok: true, reason: 'check failed ' + r.status };
    const j: any = await r.json(); const m = String(j?.content?.[0]?.text || '').match(/\{[\s\S]*\}/);
    const v = m ? JSON.parse(m[0]) : null;
    return { ok: !v?.hold, reason: String(v?.reason || '').slice(0, 80) };
  } catch (e: any) { return { ok: true, reason: 'check error ' + (e?.message || e) }; }
}

// Returns true when the listing stays live.
export async function checkListingPhoto(env: Env, lid: string, key: string) {
  const v = await photoOk(env, key);
  if (v.ok) return true;
  await env.DB.prepare(`UPDATE listings SET status = 'review' WHERE id = ? AND status = 'live'`).bind(lid).run();
  await env.DB.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind('flag_' + lid, v.reason || 'flagged').run();
  return false;
}
