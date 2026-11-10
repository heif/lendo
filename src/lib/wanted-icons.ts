import type { Env } from './env';
import { drawIcon, makeCutout } from './avatar';
import { WANTED_ALL } from './places';
// Custom emoji-style icons for the wanted catalog (emoji are dated/absent for many items — e.g. 📽️ is a film projector).
// Generated with Flux, cut out to a transparent sticker, stored at wanted/<key>.png. settings.wanted_icons lists keys done.
export const PROMPTS: Record<string, string> = {
  projector: 'a modern compact white home projector with a lens', laptop: 'a modern thin silver laptop, open', monitor: 'a modern slim computer monitor', printer: 'a desktop 3D printer', camera: 'a modern mirrorless camera', camcorder: 'a modern handheld video camera', drone: 'a modern quadcopter camera drone', tv: 'a modern flat-screen TV', console: 'a modern video game controller', speaker: 'a modern portable bluetooth party speaker', mic: 'a modern handheld microphone', dj: 'modern DJ headphones', disco: 'a mirrored disco ball', radio: 'a modern portable boombox speaker',
  guitar: 'an acoustic guitar', piano: 'a digital piano keyboard', violin: 'a violin with bow', drums: 'a drum kit', sax: 'a saxophone', trumpet: 'a trumpet', banjo: 'a banjo', accordion: 'an accordion',
  bike: 'a modern city bicycle', escooter: 'a modern electric kick scooter', skateboard: 'a skateboard', rollerskates: 'a pair of roller skates', moped: 'a modern moped scooter', car: 'a modern compact car', van: 'a modern cargo van', truck: 'a modern pickup truck', kayak: 'a kayak with paddle', sailboat: 'a small sailboat', surf: 'a single surfboard standing upright, side view, no person', wheelchair: 'a modern lightweight wheelchair', crutch: 'a pair of forearm crutches',
  skis: 'a pair of skis with poles', snowboard: 'a single snowboard standing upright on its tail, no person, no rider', skates: 'a pair of ice skates', sled: 'a sled', tent: 'a modern camping tent', umbrella: 'a beach umbrella', telescope: 'a modern telescope on a tripod', microscope: 'a microscope', fishing: 'a fishing rod and reel', bow: 'a modern recurve bow with arrows', kite: 'a kite', scuba: 'a snorkel mask and fins', parachute: 'a paraglider wing with harness',
  pickle: 'a pickleball paddle with a ball', racket: 'a tennis racket', hockey: 'a hockey stick and puck', lacrosse: 'a lacrosse stick', cricket: 'a cricket bat', boxing: 'a pair of boxing gloves', goal: 'a portable soccer goal net',
  ladder: 'an aluminum extension ladder', saw: 'a modern cordless circular saw', axe: 'an axe', toolbox: 'a red toolbox', hammer: 'a hammer', chair: 'a stack of folding chairs', luggage: 'a modern hard-shell rolling suitcase', backpack: 'a hiking backpack', gown: 'an elegant evening gown on a hanger', jacket: 'a puffy ski jacket', heels: 'a pair of high heels', boots: 'a pair of leather boots', tophat: 'a black top hat', vr: 'a modern VR headset', clapper: 'a film clapperboard', battery: 'a portable power station battery',
};
Object.assign(PROMPTS, {
  mixer2: 'a pastel stand mixer with a bowl',
  sewing2: 'a modern white sewing machine',
  cutter: 'a compact craft vinyl cutting machine',
  styler: 'a hair dryer and curling wand set',
  steamer: 'a standing garment steamer',
  handbag: 'an elegant leather handbag',
  dress: 'a cocktail dress on a hanger',
  ringlight: 'a ring light on a tripod',
  backdrop: 'a photo backdrop stand with a pastel backdrop',
  arch: 'a balloon arch kit for parties',
  picnic: 'a wicker picnic basket with a blanket',
  dinnerware: 'a stack of elegant plates and glasses',
  espresso2: 'a modern espresso machine',
  airfryer: 'a modern countertop air fryer kitchen appliance, black plastic with a pull-out basket drawer and a control panel, no food',
  stroller2: 'a modern baby stroller',
  carseat: 'a baby car seat',
  crib: 'a portable travel crib',
  paddle: 'a stand up paddleboard with paddle',
  beachchair: 'two folding beach chairs',
  yogamat: 'a rolled yoga mat with blocks',
  exbike: 'a modern indoor exercise bike',
  massage: 'a handheld massage gun',
  recordplayer: 'a modern record player turntable',
  pottery: 'a tabletop pottery wheel',
  drill: 'a cordless power drill',
  pwasher: 'a pressure washer with hose and wand',
  blower: 'a cordless leaf blower',
  mower: 'a push lawn mower',
  trimmer: 'a cordless hedge trimmer',
  sander: 'a handheld electric random orbital sander power tool with a round sanding pad, like a DeWalt or Makita',
  shopvac: 'a wet dry shop vacuum',
  tilesaw: 'a wet tile saw',
  nailgun: 'a cordless nail gun',
  sprayer: 'a paint sprayer',
  carpet: 'an upright carpet cleaning machine',
  generator: 'a portable generator',
  dolly: 'a hand truck dolly',
  wheelbarrow: 'a wheelbarrow',
  studfinder: 'a laser level on a small tripod',
});
export async function iconsDone(env: Env): Promise<Set<string>> {
  const r = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'wanted_icons'`).first<{ value: string }>();
  return new Set<string>(r ? JSON.parse(r.value) : []);
}
// Vision check: Flux reads "emoji-style air fryer" as fries, "orbital sander" as logs. Ask Haiku whether the
// picture is literally the object; retry with a more literal prompt; never publish a failed icon.
export async function looksLike(env: Env, png: ArrayBuffer, label: string): Promise<boolean | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  const b = new Uint8Array(png); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 5, messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: btoa(bin) } },
        { type: 'text', text: `Would a shopper instantly recognize this icon as "${label}" (the actual product itself, not food, wood, a symbol or a related object, and with no person, baby, face or body part in it)? Answer only YES or NO.` }] }] }) });
    if (!r.ok) return null;
    const j: any = await r.json(); return /^\s*YES/i.test(j?.content?.[0]?.text || '');
  } catch { return null; }
}
export async function makeWantedIcon(env: Env, key: string): Promise<boolean> {
  const w = WANTED_ALL.find(x => x.key === key); if (!w || !env.AI) return false;
  const base = PROMPTS[key] || `a ${w.label}`;
  const tries = [base, `${base} (${w.label}), the real product as sold in a store`, `a ${w.label}: product photo of the actual device/object`];
  let png: ArrayBuffer | null = null, ok: boolean | null = false;
  for (const t of tries) {
    png = await drawIcon(env, t + ', the object itself only, no people, no hands, no food, no logs'); if (!png) continue;
    ok = await looksLike(env, png, w.label); if (ok !== false) break; // null = checker unavailable → accept
  }
  if (!png || ok === false) { await markBad(env, key); return false; }
  const raw = `wanted/${key}-raw.png`; await env.PHOTOS.put(raw, png, { httpMetadata: { contentType: 'image/png' } });
  let out = png; try { const cut = await makeCutout(env, raw); if (cut) out = cut; } catch {}
  await env.PHOTOS.put(`wanted/${key}.png`, out, { httpMetadata: { contentType: 'image/png' } });
  const done = await iconsDone(env); done.add(key);
  await env.DB.prepare(`UPDATE settings SET value = (SELECT json_group_array(value) FROM json_each(settings.value) WHERE value != ?) WHERE key = 'wanted_bad'`).bind(key).run().catch(() => {});
  await env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('wanted_icons', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify([...done])).run();
  return true;
}
// failed 3 tries → listed in settings.wanted_bad (admin shows them; poster falls back to emoji)
async function markBad(env: Env, key: string) {
  const r = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'wanted_bad'`).first<{ value: string }>();
  const bad = new Set<string>(r ? JSON.parse(r.value) : []); bad.add(key);
  await env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('wanted_bad', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify([...bad])).run();
}
// audit existing icons: un-mark any that fail the check so the cron redraws them
export async function auditIcons(env: Env, limit = 8): Promise<string[]> {
  const done = await iconsDone(env);
  const r = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'wanted_audited'`).first<{ value: string }>();
  const seen = new Set<string>(r ? JSON.parse(r.value) : []); const redo: string[] = [];
  for (const key of [...done].filter(k => !seen.has(k)).slice(0, limit)) {
    const w = WANTED_ALL.find(x => x.key === key); const o = await env.PHOTOS.get(`wanted/${key}-raw.png`) || await env.PHOTOS.get(`wanted/${key}.png`);
    if (!w || !o) continue;
    const ok = await looksLike(env, await o.arrayBuffer(), w.label); if (ok === null) break;
    seen.add(key); if (!ok) { done.delete(key); redo.push(key); }
  }
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('wanted_icons', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify([...done])),
    env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('wanted_audited', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify([...seen].filter(k => !redo.includes(k)))),
  ]);
  return redo;
}
