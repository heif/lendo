// Visual identification of a snapped item → name, description, category, retail estimate → suggested price.
import type { Env } from './env';

export type Ident = { name: string; description: string; category: string; retail_usd: number | null; confidence: 'high' | 'medium' | 'low' };
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

export async function identifyItem(env: Env, photo: ArrayBuffer, hint?: string | null): Promise<Ident> {
  const { settings } = await loadPricing(env);
  const model = settings.vision_model || '@cf/llava-hf/llava-1.5-7b-hf';
  const prompt = `USER: You are cataloguing an item a neighbor wants to rent out. Look at the photo${hint ? ` (the owner's hint: "${hint}", but trust what you see)` : ''}. Answer ONLY with JSON:
{"name": "<2-5 word product name, brand if visible>", "description": "<one plain sentence a renter would want: what it is, notable features/condition>", "category": "<one of: ${CATS.join(', ')}>", "retail_usd": <estimated new retail price in USD as a number>, "confidence": "<high|medium|low>"}
ASSISTANT:`;
  let text = '';
  try {
    const r: any = await env.AI!.run(model as any, { prompt, image: [...new Uint8Array(photo)], max_tokens: 160 } as any);
    text = String(r?.response || r?.description || '');
  } catch (e) { console.warn('identify failed', e); }
  const m = text.match(/\{[\s\S]*\}/);
  let j: any = {};
  if (m) { try { j = JSON.parse(m[0].replace(/,\s*\}/, '}')); } catch {} }
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
