// Item avatar for map pins, generated from the listing's first photo.
//  cutout: Cloudflare Images background removal (segment=foreground) → sticker-style PNG
//  ai:     Workers AI img2img → flat emoji-style redraw of the item
import type { Env } from './env';

const PROMPT = 'a single flat vector emoji icon of this object, Apple iOS emoji style, simple shapes, soft shading, thick clean edges, centered, isolated on plain white background, no text, no people, no hands';
const NEG = 'photo, realistic, photorealistic, background scene, room, floor, shadow on floor, text, watermark, blurry, multiple objects, person, hands';

export async function makeCutout(env: Env, photoKey: string): Promise<ArrayBuffer | null> {
  // Images transformations run on the zone; this fetches our own /p/ URL through the resizer.
  const src = `${env.APP_URL}/p/${photoKey}`;
  const u = `${env.APP_URL}/cdn-cgi/image/segment=foreground,fit=contain,width=320,height=320,trim=auto,format=png/${src}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`cutout ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  if (!(r.headers.get('content-type') || '').includes('png')) throw new Error('cutout: not a png (transformations off?)');
  return r.arrayBuffer();
}

// Two-step: vision model describes the object → flux draws a flat emoji-style icon of it.
export async function describeItem(env: Env, photo: ArrayBuffer, name: string): Promise<string> {
  const r: any = await env.AI!.run('@cf/llava-hf/llava-1.5-7b-hf' as any, {
    prompt: `The listing is called "${name}". In 8-14 words, describe only the main object for an icon artist: type, color, material, distinctive shape. No background, no room, no people. Output just the phrase.`,
    image: [...new Uint8Array(photo)], max_tokens: 60,
  } as any);
  return String(r?.response || r?.description || '').trim().replace(/^["']|["'.]$/g, '') || name;
}
export async function drawIcon(env: Env, desc: string): Promise<ArrayBuffer | null> {
  const r: any = await env.AI!.run('@cf/black-forest-labs/flux-1-schnell' as any, {
    prompt: `${desc}. A single flat emoji icon in the style of Apple iOS emoji: simple rounded shapes, soft gradients, subtle shading, slight 3D glossy look, thick clean silhouette, centered, isolated on a pure solid white background, no text, no shadow on ground.`,
    steps: 6,
  } as any);
  if (r?.image) return Uint8Array.from(atob(r.image), ch => ch.charCodeAt(0)).buffer;
  if (r instanceof ReadableStream) return new Response(r).arrayBuffer();
  return null;
}

export const AI_MODELS = ['@cf/lykon/dreamshaper-8-lcm', '@cf/stabilityai/stable-diffusion-xl-base-1.0', '@cf/bytedance/stable-diffusion-xl-lightning'];
export async function makeAiIcon(env: Env, photo: ArrayBuffer, model = AI_MODELS[0]): Promise<ArrayBuffer | null> {
  if (!env.AI) return null;
  try {
    const out: any = await env.AI.run(model as any, {
      prompt: PROMPT, negative_prompt: NEG, image: [...new Uint8Array(photo)], strength: 0.7, guidance: 7.5, num_steps: model.includes('lcm') ? 8 : 20,
    } as any);
    if (out instanceof ReadableStream) return new Response(out).arrayBuffer();
    if (out instanceof ArrayBuffer) return out;
    if (out && (out as any).image) return Uint8Array.from(atob((out as any).image), ch => ch.charCodeAt(0)).buffer;
    return null;
  } catch (e: any) { throw new Error('ai: ' + (e?.message || String(e)).slice(0, 300)); }
}

// Generate one (or both) and store under the listing. Returns stored keys.
export async function buildAvatars(env: Env, listingId: string, photoKey: string, styles: ('cutout' | 'ai')[], errors: string[] = [], model?: string, name = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const obj = await env.PHOTOS.get(photoKey);
  if (!obj) { errors.push('photo missing'); return out; }
  const photo = await obj.arrayBuffer();
  for (const s of styles) {
    let buf: ArrayBuffer | null = null;
    try {
      if (s === 'cutout') buf = await makeCutout(env, photoKey);
      else if (model) buf = await makeAiIcon(env, photo, model);
      else { const desc = await describeItem(env, photo, name); errors.push('desc: ' + desc); buf = await drawIcon(env, desc); }
    } catch (e: any) { errors.push((e?.message || String(e)).slice(0, 300)); }
    if (!buf) { if (!errors.some(x => x.startsWith(s))) errors.push(s + ': empty result'); continue; }
    const key = `${listingId}/avatar-${s}.png`;
    await env.PHOTOS.put(key, buf, { httpMetadata: { contentType: 'image/png' } });
    out[s] = key;
  }
  return out;
}

// Auto pipeline for new listings (runs in waitUntil): draw the emoji-style icon from the first photo, then try to make it a
// transparent sticker via Cloudflare Images background removal. The map pin switches to the icon ONLY when the transparent
// version exists (until Images is enabled on the zone, pins keep the round photo sticker).
export async function autoIcon(env: Env, listingId: string, photoKey: string, name: string, description?: string | null): Promise<void> {
  try {
    const obj = await env.PHOTOS.get(photoKey);
    if (!obj || !env.AI) return;
    const photo = await obj.arrayBuffer();
    const desc = await describeItem(env, photo, name + (description ? ' — ' + description.slice(0, 120) : ''));
    const icon = await drawIcon(env, desc);
    if (!icon) return;
    const aiKey = `${listingId}/avatar-ai.png`;
    await env.PHOTOS.put(aiKey, icon, { httpMetadata: { contentType: 'image/png' }, customMetadata: { desc } });
    // transparent sticker (needs Images transformations on the zone)
    let stickerKey: string | null = null;
    try { const cut = await makeCutout(env, aiKey); if (cut) { stickerKey = `${listingId}/avatar.png`; await env.PHOTOS.put(stickerKey, cut, { httpMetadata: { contentType: 'image/png' } }); } } catch (e) { console.warn('cutout unavailable', (e as any)?.message); }
    if (stickerKey) await env.DB.prepare('UPDATE listings SET avatar_key = ?, avatar_style = ? WHERE id = ? AND avatar_key IS NULL').bind(stickerKey, 'ai', listingId).run();
  } catch (e) { console.warn('autoIcon failed', e); }
}
