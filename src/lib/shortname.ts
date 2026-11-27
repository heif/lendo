// Short item names for tight spots (Scott, 11/27): the map label ("Scott's Allen Bike Mount"), grid cards, tiles.
// Keep the brand when the full name has one, then the plain kind of thing; drop model numbers, sizes and filler.
// AI writes it in the background after listing / renaming (Haiku); until then `shortGuess` is used.
import type { Env, Listing } from './env';
import { claude } from './value';

const MAX = 24;
const FILLER = /\b(deluxe|premium|pro|plus|max|ultra|edition|series|model|new|version|heavy[- ]duty|professional|portable|compact|adjustable|universal|original|classic|standard|with|and|for|the|a|an|of|in|set|kit)\b/gi;

/** quick rule-based short name: first word (often the brand) + the last 1–2 words (the kind of thing) */
export function shortGuess(name: string): string {
  const n = (name || '').replace(/\s+(with|w\/|incl\.?|including)\s.*$/i, '').replace(/\([^)]*\)/g, ' ').replace(/[–—,|/].*$/, ' ').replace(/\s+/g, ' ').trim();
  if (n.length <= MAX) return n;
  const words = n.split(' ').filter(w => !/\d/.test(w) && !FILLER.test(w)).map(w => (FILLER.lastIndex = 0, w));
  if (!words.length) return n.slice(0, MAX - 1).trim() + '…';
  for (const k of [2, 1]) { const s = [words[0], ...words.slice(-k)].filter((w, i, a) => a.indexOf(w) === i).join(' '); if (s.length <= MAX) return s; }
  return words.slice(-1)[0].slice(0, MAX);
}

export const shortOf = (l: Pick<Listing, 'name'> & { short_name?: string | null }) => l.short_name || shortGuess(l.name);

const SYS = `You shorten item names for a neighborhood rental map. Reply with ONLY the short name, max ${MAX} characters.
Keep the brand if the name has one (e.g. Allen, DeWalt, KitchenAid, GoPro, Yeti). Then the plain kind of thing a neighbor would say.
Drop model numbers, sizes, counts, colors and marketing words, unless the model IS what people call it (e.g. "Vitamix", "GoPro Hero").
Examples: "Allen Sports Deluxe 3-Bike Trunk Mount Rack" → "Allen Bike Rack"; "DeWalt 20V MAX Cordless Drill/Driver Kit" → "DeWalt Drill"; "KitchenAid Artisan 5-Quart Stand Mixer, Empire Red" → "KitchenAid Mixer"; "Folding chair" → "Folding chair"`;

/** ask the AI for a short name and save it; never throws */
export async function ensureShort(env: Env, l: Pick<Listing, 'id' | 'name'>): Promise<string> {
  const guess = shortGuess(l.name);
  if (l.name.length <= MAX) { await env.DB.prepare('UPDATE listings SET short_name = ? WHERE id = ?').bind(l.name, l.id).run().catch(() => {}); return l.name; }
  try {
    const out = (await claude(env, 'claude-haiku-5-5', SYS, [{ type: 'text', text: l.name }], 30, 15000) || '').split('\n')[0].replace(/^["'“]|["'”.]$/g, '').trim();
    const s = out && out.length <= MAX + 4 ? out : guess;
    await env.DB.prepare('UPDATE listings SET short_name = ? WHERE id = ?').bind(s, l.id).run();
    return s;
  } catch { return guess; }
}

/** cron: fill short names for items that have none (20 per run) */
export async function shortDue(env: Env): Promise<number> {
  const rows = await env.DB.prepare(`SELECT id, name FROM listings WHERE short_name IS NULL AND status IN ('live','paused','review') LIMIT 20`).all<{ id: string; name: string }>().then(r => r.results).catch(() => []);
  for (const r of rows) await ensureShort(env, r);
  return rows.length;
}
