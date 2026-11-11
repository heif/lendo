// Item avatar for map pins, generated from the listing's first photo.
//  cutout: Cloudflare Images background removal (segment=foreground) → sticker-style PNG
//  ai:     Workers AI img2img → flat emoji-style redraw of the item
import type { Env } from './env';
import { artistPrompt, sameObject } from './vision';

const PROMPT = 'a single flat vector emoji icon of this object, Apple iOS emoji style, simple shapes, soft shading, thick clean edges, centered, isolated on plain white background, no text, no people, no hands';
const NEG = 'photo, realistic, photorealistic, background scene, room, floor, shadow on floor, text, watermark, blurry, multiple objects, person, hands';

export async function makeCutout(env: Env, photoKey: string, size = 320): Promise<ArrayBuffer | null> {
  // Images transformations run on the zone; this fetches our own /p/ URL through the resizer.
  const src = `${env.APP_URL}/p/${photoKey}`;
  const u = `${env.APP_URL}/cdn-cgi/image/segment=foreground,fit=contain,width=${size},height=${size},trim=auto,format=png/${src}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`cutout ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  if (!(r.headers.get('content-type') || '').includes('png')) throw new Error('cutout: not a png (transformations off?)');
  return r.arrayBuffer();
}

// Two-step: vision model describes the object → flux draws a flat emoji-style icon of it.
export async function describeItem(env: Env, photo: ArrayBuffer, name: string): Promise<string> {
  const r: any = await env.AI!.run('@cf/llava-hf/llava-1.5-7b-hf' as any, {
    prompt: `USER: The listing is called "${name}". Describe only this object for an icon artist in 12-20 words: exact type, color(s), material, base/legs/handles, and its most distinctive shape detail. No background, room, or people. Output just the phrase.\nASSISTANT:`,
    image: [...new Uint8Array(photo)], max_tokens: 60,
  } as any);
  return String(r?.response || r?.description || '').trim().replace(/^["']|["'.]$/g, '') || name;
}
export async function drawIcon(env: Env, desc: string): Promise<ArrayBuffer | null> {
  const r: any = await env.AI!.run('@cf/black-forest-labs/flux-1-schnell' as any, {
    prompt: `${desc}. Use exactly those colors for the object, matching the real item; do not recolor it. Rendered as a single glossy 3D product icon of that exact real-world object (not a symbol, not food, not a pun): faithful to the described shape and proportions, simple rounded forms, soft gradients, subtle shading, slight glossy 3D look, clean silhouette, centered, isolated on a pure solid white background, no text, no ground shadow.`,
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
// Retry listings whose sticker never landed (cutout failed at listing time, or icon never drawn). A few per cron tick.
export async function backfillAvatars(env: Env, limit = 3): Promise<number> {
  const rows = (await env.DB.prepare(`SELECT l.id, l.name, l.description, (SELECT r2_key FROM photos p WHERE p.listing_id = l.id ORDER BY pos LIMIT 1) k FROM listings l WHERE l.status = 'live' AND l.avatar_key IS NULL ORDER BY l.created_at DESC LIMIT ?`).bind(limit).all<{ id: string; name: string; description: string | null; k: string | null }>()).results;
  let n = 0;
  for (const r of rows) {
    try {
      const aiKey = `${r.id}/avatar-ai.png`;
      if (await env.PHOTOS.head(aiKey)) {
        const cut = await makeCutout(env, aiKey);
        if (cut) { await env.PHOTOS.put(`${r.id}/avatar.png`, cut, { httpMetadata: { contentType: 'image/png' } }); await env.DB.prepare('UPDATE listings SET avatar_key = ?, avatar_style = ? WHERE id = ? AND avatar_key IS NULL').bind(`${r.id}/avatar.png`, 'ai', r.id).run(); n++; }
      } else if (r.k) { await autoIcon(env, r.id, r.k, r.name, r.description); n++; }
    } catch (e) { console.warn('backfillAvatars', r.id, e); }
  }
  return n;
}

export async function autoIcon(env: Env, listingId: string, photoKey: string, name: string, description?: string | null): Promise<void> {
  try {
    const obj = await env.PHOTOS.get(photoKey);
    if (!obj || !env.AI) return;
    const photo = await obj.arrayBuffer();
    const desc = (await artistPrompt(env, photo, name)) || await describeItem(env, photo, name + (description ? ' — ' + description.slice(0, 120) : ''));
    // draw, then check it's the same kind of object as the photo; 2 tries
    let icon: ArrayBuffer | null = null;
    for (let t = 0; t < 2; t++) {
      const d = await drawIcon(env, t ? desc + ', the literal physical object exactly as in a product photo, same colors as the real item' : desc); if (!d) continue;
      const ok = await sameObject(env, photo, d, name);
      if (ok !== false) { icon = d; break; }
    }
    let stickerKey: string | null = null, style = 'ai';
    if (icon) {
      const aiKey = `${listingId}/avatar-ai.png`;
      await env.PHOTOS.put(aiKey, icon, { httpMetadata: { contentType: 'image/png' }, customMetadata: { desc } });
      try { const cut = await makeCutout(env, aiKey); if (cut) { stickerKey = `${listingId}/avatar.png`; await env.PHOTOS.put(stickerKey, cut, { httpMetadata: { contentType: 'image/png' } }); } } catch (e) { console.warn('cutout failed', e); }
    } else {
      // drawing kept coming out wrong → the real photo, cut out
      try { const cut = await makeCutout(env, photoKey); if (cut) { stickerKey = `${listingId}/avatar-cutout.png`; style = 'cutout'; await env.PHOTOS.put(stickerKey, cut, { httpMetadata: { contentType: 'image/png' } }); } } catch (e) { console.warn('photo cutout failed', e); }
    }
    if (stickerKey) await env.DB.prepare('UPDATE listings SET avatar_key = ?, avatar_style = ? WHERE id = ? AND avatar_key IS NULL').bind(stickerKey, style, listingId).run();
  } catch (e) { console.warn('autoIcon failed', e); }
}

// one pass over real listings' existing drawn icons: wrong kind of object → clear it so the backfill redraws (checked)
export async function auditAvatars(env: Env, limit = 4): Promise<number> {
  const r = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'avatar_audited_v3'`).first<{ value: string }>();
  const seen = new Set<string>(r ? JSON.parse(r.value) : []);
  const rows = (await env.DB.prepare(`SELECT l.id, l.name, (SELECT r2_key FROM photos p WHERE p.listing_id = l.id ORDER BY pos LIMIT 1) k FROM listings l WHERE l.demo = 0 AND l.avatar_style = 'ai' AND l.avatar_key IS NOT NULL ORDER BY l.created_at DESC LIMIT 200`).all<{ id: string; name: string; k: string | null }>()).results.filter(x => !seen.has(x.id) && x.k).slice(0, limit);
  let bad = 0;
  for (const x of rows) {
    const ph = await env.PHOTOS.get(x.k!), ic = await env.PHOTOS.get(`${x.id}/avatar-ai.png`);
    if (!ph || !ic) { seen.add(x.id); continue; }
    const ok = await sameObject(env, await ph.arrayBuffer(), await ic.arrayBuffer(), x.name);
    if (ok === null) break;
    seen.add(x.id);
    if (!ok) { bad++; await env.PHOTOS.delete(`${x.id}/avatar-ai.png`); await env.DB.prepare('UPDATE listings SET avatar_key = NULL, avatar_style = NULL WHERE id = ?').bind(x.id).run(); }
  }
  await env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('avatar_audited_v3', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify([...seen])).run();
  return bad;
}
