// Claude (Haiku, vision) helpers for icons: describe a photo for the artist, and check a drawn icon is the same
// kind of object. Flux takes words literally ("bullhorn" → bull horns), so the prompt names the object
// unambiguously and every drawn icon is checked before it goes on the map.
import type { Env } from './env';

const b64 = (buf: ArrayBuffer) => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const mime = (buf: ArrayBuffer) => { const b = new Uint8Array(buf, 0, 4); return b[0] === 0x89 ? 'image/png' : b[0] === 0x52 ? 'image/webp' : 'image/jpeg'; };

async function ask(env: Env, images: ArrayBuffer[], text: string, max = 80): Promise<string | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: max, messages: [{ role: 'user', content: [
        ...images.map(im => ({ type: 'image', source: { type: 'base64', media_type: mime(im), data: b64(im) } })), { type: 'text', text }] }] }) });
    if (!r.ok) { console.warn('vision', r.status); return null; }
    const j: any = await r.json(); return String(j?.content?.[0]?.text || '').trim() || null;
  } catch (e) { console.warn('vision', e); return null; }
}

// "bullhorn" → "a handheld electric megaphone with a pistol grip, red and white body, wide flared white horn"
export async function artistPrompt(env: Env, photo: ArrayBuffer, name: string): Promise<string | null> {
  const t = await ask(env, [photo], `This is a photo of an item listed for rent as "${name}". Write a 15-25 word description of the physical object for an illustrator who has never seen it. Name the object unambiguously by what it physically is (e.g. "electric megaphone", never words that could be read as something else like "bullhorn" → bull horns). Include color(s), material and its most distinctive shape. No background, no people. Output only the description.`, 90);
  return t ? t.replace(/^["']|["'.]$/g, '') : null;
}

// true = same kind of object, false = wrong, null = couldn't check
export async function sameObject(env: Env, photo: ArrayBuffer, icon: ArrayBuffer, name: string): Promise<boolean | null> {
  const t = await ask(env, [photo, icon], `Image 1 is a photo of "${name}". Image 2 is an icon drawn to represent it on a map. Is image 2 clearly the same kind of physical object (not a pun, symbol, animal, food or a different object), with no person in it? Answer only YES or NO.`, 5);
  return t == null ? null : /^\s*YES/i.test(t);
}
