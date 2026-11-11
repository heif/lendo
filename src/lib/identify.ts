// Visual identification of a snapped item → name, description, category, retail estimate → suggested price.
import type { Env } from './env';

export type Ident = { name: string; description: string; category: string; retail_usd: number | null; confidence: 'high' | 'medium' | 'low'; brand?: string | null; model?: string | null; ask_label?: boolean };
export type PriceRule = { category: string; label: string; day_cents: number; rate_pct: number; week_pct: number };

let rulesCache: { at: number; rules: PriceRule[]; settings: Record<string, string> } | null = null;
export async function loadPricing(env: Env, force = false) {
  if (!force && rulesCache && Date.now() - rulesCache.at < 60000) return rulesCache;
  const r = await env.DB.prepare('SELECT * FROM price_rules ORDER BY label').all<PriceRule>();
  const s = await env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const settings: Record<string, string> = {}; for (const x of s.results) settings[x.key] = x.value;
  rulesCache = { at: Date.now(), rules: r.results, settings };
  return rulesCache;
}

export function suggestPrice(rules: PriceRule[], settings: Record<string, string>, category: string, retailUsd: number | null): { day_cents: number; week_cents: number; rule: PriceRule; basis: string } {
  const rule = rules.find(r => r.category === category) || rules.find(r => r.category === 'other') || { category: 'other', label: 'Other', day_cents: 1000, rate_pct: 3, week_pct: 70 };
  const min = parseInt(settings.price_min_cents || '800', 10), max = parseInt(settings.price_max_cents || '15000', 10), round = parseInt(settings.price_round_to || '100', 10);
  let day: number, basis: string;
  if (retailUsd && retailUsd > 20) { day = Math.round(retailUsd * 100 * rule.rate_pct / 100); basis = `${rule.rate_pct}% of ~$${Math.round(retailUsd)} retail`; }
  else { day = rule.day_cents; basis = `typical for ${rule.label.toLowerCase()}`; }
  day = Math.min(max, Math.max(min, Math.round(day / round) * round));
  const week = Math.round(day * 7 * rule.week_pct / 100 / 100) * 100;
  return { day_cents: day, week_cents: week, rule, basis };
}

const CATS = ['power_tools', 'hand_tools', 'ladders', 'cleaning', 'camping', 'sports', 'bikes', 'water', 'winter', 'av', 'cameras', 'gaming', 'music', 'kitchen', 'party', 'furniture', 'baby', 'luggage', 'fashion', 'pets', 'garden', 'electronics', 'mobility', 'other'];

export let lastRaw = '';
export let lastClaude = ''; // Claude's own result/error, kept even when the fallback model runs
// Brand rules: name the brand when it changes what a customer expects (quality, compatibility, price) — Dyson,
// DeWalt (battery platform), Canon (lens mount), Pyle vs. a toy megaphone, Vitamix, Peloton, Patagonia, Thule,
// Nintendo. Skip it for commodity items where brand doesn't matter (folding chairs, ladders, a hammer, a sled).
// Only a brand actually visible (logo, label, distinctive design) — never guessed.
const BRAND_RULES = `Brand: include the brand (and model if readable) in the name ONLY when it is visible in the photo AND it matters to a renter — electronics, cameras/lenses, power tools (battery platform), appliances, audio, bikes/e-bikes, fitness machines, strollers/car seats, designer fashion, outdoor gear brands. Leave the brand out for commodity items (folding chairs, basic ladders, hand tools like a hammer, sleds, generic luggage) even if a logo shows. Never guess a brand you can't see.`;
const DESC_RULES = `Description: 1-2 short lines, facts a renter checks before renting — brand/model and one key spec if known (watts, size, battery, capacity), what's visibly included (case, strap, charger, batteries), and condition only if visible. No filler like "for use in outdoor activities", no restating the photo's colors unless they identify it, no marketing words, no trailing period.`;

const img = (photo: ArrayBuffer) => { const b = new Uint8Array(photo); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return { type: 'image', source: { type: 'base64', media_type: b[0] === 0x89 ? 'image/png' : b[0] === 0x52 ? 'image/webp' : 'image/jpeg', data: btoa(bin) } }; };

// Owners' name fixes (AI guess → what they listed it as), newest first; fed back as examples
export async function recordCorrection(env: Env, ai: string, final: string) {
  const a = ai.trim(), f = final.trim(); if (!a || !f || a.toLowerCase() === f.toLowerCase()) return;
  const r = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'id_corrections'`).first<{ value: string }>();
  const list: [string, string][] = r ? JSON.parse(r.value) : [];
  list.unshift([a.slice(0, 60), f.slice(0, 60)]);
  await env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('id_corrections', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify(list.slice(0, 40))).run();
}
async function corrections(env: Env): Promise<string> {
  const r = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'id_corrections'`).first<{ value: string }>().catch(() => null);
  const list: [string, string][] = r ? JSON.parse(r.value) : [];
  return list.length ? `\nRecent owner corrections of earlier guesses (guess → what it really was); learn from these mistakes:\n${list.slice(0, 15).map(([a, f]) => `- "${a}" → "${f}"`).join('\n')}` : '';
}

async function identifyClaude(env: Env, photos: ArrayBuffer[], hint?: string | null, model = 'claude-haiku-5-5', fixes = ''): Promise<any | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 300, messages: [{ role: 'user', content: [
        ...photos.map(img),
        { type: 'text', text: `A neighbor is listing this item for rent${photos.length > 1 ? ' (photo 2 is a close-up of its label/logo)' : ''}${hint ? ` (their hint: "${hint}"; trust what you see)` : ''}.
Name: 1-4 words, what a renter would search for, Title Case first word only (e.g. "Pyle bullhorn", "DeWalt cordless drill", "Folding chairs", "Canon EOS R6 camera").
${BRAND_RULES}
${DESC_RULES}
Look-alikes: tell similar products apart by concrete details (e.g. AirPods Max = mesh canopy headband + aluminum cups + Digital Crown; Beats = plastic band with "b" logo). If you can't tell which of two, set "confidence":"low", leave brand/model null and use the generic name ("Over-ear headphones") — a wrong brand is worse than none.
brand_matters: true if the brand/model changes what a renter expects for this kind of item (per the brand rule), else false.${fixes}
Reply with JSON only: {"name":"","brand":"<visible brand or null>","model":"<visible model or null>","brand_matters":true,"description":"","category":"<one of: ${CATS.join(', ')}>","retail_usd":<new retail price of this brand/model in USD>,"confidence":"high|medium|low"}` }] }] }) });
    if (!r.ok) { lastClaude = lastRaw = 'claude ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 300); return null; }
    const j: any = await r.json(); const t = String(j?.content?.[0]?.text || ''); lastClaude = lastRaw = t;
    const m = t.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null;
  } catch (e: any) { lastClaude = lastRaw = 'claude ERR ' + (e?.message || e); return null; }
}

// second look: does the name actually fit what's in the photo? (catches a teddy bear named "Mickey Mouse", a wrong brand)
async function nameFits(env: Env, photos: ArrayBuffer[], name: string, brand: string | null): Promise<boolean> {
  if (!env.ANTHROPIC_API_KEY) return true;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 5, messages: [{ role: 'user', content: [...photos.map(img),
        { type: 'text', text: `Someone labeled the item in this photo "${name}"${brand ? ` (brand: ${brand})` : ''}. Check it strictly against what is actually visible: is it the right kind of object, and is any named brand, character or product line clearly shown (logo, printed text, unmistakable design)? A plain teddy bear is not "Mickey Mouse"; unbranded headphones are not "Beats". Answer only YES if the label is accurate, or NO.` }] }] }) });
    if (!r.ok) return true;
    const j: any = await r.json(); return !/^\s*NO/i.test(String(j?.content?.[0]?.text || ''));
  } catch { return true; }
}

export async function identifyItem(env: Env, photo: ArrayBuffer, hint?: string | null, label?: ArrayBuffer | null): Promise<Ident> {
  const photos = label ? [photo, label] : [photo], fixes = await corrections(env);
  let cj = await identifyClaude(env, photos, hint, 'claude-haiku-5-5', fixes);
  // unsure → a stronger model looks again (brand/model mistakes cost trust; ~2-3¢ only on these)
  // confident → a quick second look checks the name against the photo; mismatch → Sonnet, told what was wrong
  let wrong = '';
  if (cj && cj.name && cj.confidence === 'high' && !(await nameFits(env, photos, String(cj.name), cj.brand || null))) wrong = `\nA first guess, "${cj.name}", was checked and does NOT match the photo. Don't repeat it; name only what is visible.`;
  if (cj && (cj.confidence !== 'high' || wrong)) { const cj2 = await identifyClaude(env, photos, hint, 'claude-sonnet-5-5', fixes + wrong); if (cj2 && cj2.name) cj = cj2; }
  if (cj && cj.name) {
    const cat = CATS.includes(String(cj.category || '').trim()) ? String(cj.category).trim() : guessCategory(String(cj.name));
    const retail = typeof cj.retail_usd === 'number' ? cj.retail_usd : parseFloat(String(cj.retail_usd || '').replace(/[^0-9.]/g, '')) || null;
    return { name: String(cj.name).replace(/^["']|["'.]$/g, '').slice(0, 60), description: String(cj.description || '').replace(/\.$/, '').slice(0, 240), category: cat, retail_usd: retail,
      confidence: ['high', 'medium', 'low'].includes(cj.confidence) ? cj.confidence : 'medium', brand: cj.brand || null, model: cj.model || null,
      // brand matters but we couldn't read it → ask for a close-up of the label (not again once they sent one)
      ask_label: !label && cj.brand_matters !== false && (!cj.brand || cj.confidence === 'low') };
  }
  const { settings } = await loadPricing(env);
  const model = settings.vision_model || '@cf/llava-hf/llava-1.5-7b-hf';
  const prompt = `USER: You are cataloguing an item a neighbor wants to rent out. Look at the photo${hint ? ` (the owner's hint: "${hint}", but trust what you see)` : ''}. Answer ONLY with JSON:
{"name": "<2-5 word product name, brand if visible>", "description": "<one plain sentence a renter would want: what it is, notable features/condition>", "category": "<one of: ${CATS.join(', ')}>", "retail_usd": <estimated new retail price in USD as a number>, "confidence": "<high|medium|low>"}
ASSISTANT:`;
  let text = '';
  try {
    const r: any = await env.AI!.run(model as any, { prompt, image: [...new Uint8Array(photo)], max_tokens: 160 } as any);
    text = String(r?.response || r?.description || JSON.stringify(r));
    lastRaw = text;
  } catch (e: any) { console.warn('identify failed', e); lastRaw = 'ERR ' + (e?.message || e); }
  const m = text.replace(/\\_/g, '_').replace(/[“”]/g, '"').match(/\{[\s\S]*?\}/);
  let j: any = {};
  if (m) { try { j = JSON.parse(m[0].replace(/,\s*\}/, '}')); } catch (e) { console.warn('identify json', m[0].slice(0, 200)); } }
  const cat = CATS.includes(String(j.category || '').trim()) ? String(j.category).trim() : guessCategory(String(j.name || hint || ''));
  const retail = typeof j.retail_usd === 'number' ? j.retail_usd : parseFloat(String(j.retail_usd || '').replace(/[^0-9.]/g, '')) || null;
  return {
    name: String(j.name || hint || 'Item').replace(/^["']|["'.]$/g, '').slice(0, 60),
    description: String(j.description || '').slice(0, 240),
    category: cat, retail_usd: retail, confidence: ['high', 'medium', 'low'].includes(j.confidence) ? j.confidence : 'low',
  };
}

export function guessCategory(name: string): string {
  const n = name.toLowerCase();
  const T: [RegExp, string][] = [[/drill|saw|sander|grinder|nail|impact/, 'power_tools'], [/wrench|tool ?kit|toolbox|hammer|screwdriver/, 'hand_tools'], [/ladder|stool/, 'ladders'], [/pressure|vacuum|steam|carpet/, 'cleaning'],
    [/tent|sleeping|camp|cooler|lantern|backpack/, 'camping'], [/tennis|pickle|golf|weights|yoga|racket|skate/, 'sports'], [/bike|scooter|bicycle/, 'bikes'], [/kayak|paddle|surf|canoe/, 'water'], [/ski|snowboard|sled/, 'winter'],
    [/projector|speaker|soundbar|mic|karaoke|tv/, 'av'], [/camera|lens|gopro|tripod/, 'cameras'], [/nintendo|switch|xbox|playstation|vr|game/, 'gaming'], [/guitar|piano|keyboard|drum|violin|amp/, 'music'],
    [/mixer|blender|espresso|coffee|grill|oven|pot|pan|waffle|fondue/, 'kitchen'], [/party|balloon|bounce|popcorn|cotton|disco/, 'party'], [/chair|table|desk|sofa|couch|shelf|lamp/, 'furniture'], [/stroller|crib|car seat|baby|kid/, 'baby'],
    [/suitcase|luggage|duffel|carry/, 'luggage'], [/dress|suit|jacket|coat|gown|tux|bag|shoes/, 'fashion'], [/dog|cat|pet|crate|leash/, 'pets'], [/mower|hedge|blower|garden|hose/, 'garden'], [/monitor|printer|laptop|tablet|phone|charger/, 'electronics'], [/wheelchair|crutch|walker|boot/, 'mobility']];
  for (const [re, c] of T) if (re.test(n)) return c;
  return 'other';
}
