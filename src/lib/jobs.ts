// One-shot admin jobs run by the cron (no login needed). Each runs once; result stored in settings as job_<name>.
import type { Env, User } from './env';
import { nearestHood } from './weekly';
import { createListing } from './create-listing';
import { textUser } from './blooio';
import { itemLink } from './urls';

async function flux(env: Env, prompt: string): Promise<ArrayBuffer | null> {
  const r: any = await env.AI!.run('@cf/black-forest-labs/flux-1-schnell' as any, { prompt, steps: 8 } as any);
  if (r?.image) return Uint8Array.from(atob(r.image), ch => ch.charCodeAt(0)).buffer;
  if (r instanceof ReadableStream) return new Response(r).arrayBuffer();
  return null;
}

const JOBS: Record<string, (env: Env, ctx: ExecutionContext) => Promise<string>> = {
  // Scott: Feather Chair wheelchair for rent in Iowa City (photo-real image in the Feather Chair style)
  async feather_iac(env, ctx) {
    const admin = (env.ADMIN_PHONES || '').split(',')[0].trim();
    const u = await env.DB.prepare('SELECT * FROM users WHERE phone = ?').bind(admin).first<User>();
    if (!u) return 'no admin user';
    const img = await flux(env, 'Professional product photo of an ultralight folding manual wheelchair in the style of the Feather Chair: slim matte black aluminum frame, black mesh sling seat and backrest, large quick-release rear wheels with black push rims, small front caster wheels, flip-up footrest, push handles. Three-quarter side view, full chair in frame, standing on a light wooden floor against a plain white wall, soft daylight, sharp focus, realistic. No people, no text, no logos.');
    if (!img) return 'no image';
    const lid = await createListing(env, ctx, u, {
      name: 'Feather Chair wheelchair', priceCents: 1500,
      description: 'Feather Chair ultralight folding wheelchair · 13.5 lbs · quick-release wheels',
      lat: 41.6611, lng: -91.5302, photos: [{ bytes: img, type: 'image/jpeg' }],
    });
    const link = await itemLink(env, lid);
    await textUser(env, u, `Listed: Feather Chair wheelchair in Iowa City ${link}`, 'rental');
    return link;
  },
};

JOBS.feather_iac_hood = async (env) => {
  const l = await env.DB.prepare(`SELECT id, lat, lng FROM listings WHERE name = 'Feather Chair wheelchair' ORDER BY created_at DESC LIMIT 1`).first<{ id: string; lat: number; lng: number }>();
  if (!l) return 'none';
  const nh = nearestHood(l.lat, l.lng);
  await env.DB.prepare('UPDATE listings SET hood = ? WHERE id = ?').bind(nh ? nh.hood.name : 'Iowa City', l.id).run();
  return nh ? nh.hood.name : 'Iowa City';
};

// Scott changed lendo.co/scott → /heif before old links were kept: point the old one at him
JOBS.old_handle_scott = async (env) => {
  const cur = await env.DB.prepare(`SELECT 1 FROM users WHERE handle = 'scott'`).first();
  if (cur) return 'scott is in use';
  await env.DB.prepare(`INSERT OR IGNORE INTO old_handles (handle, user_id, created_at) VALUES ('scott', 'u_7g0ZlRhw9WBH', ?)`).bind(Date.now()).run();
  return 'ok';
};

export async function runJobs(env: Env, ctx: ExecutionContext) {
  for (const [name, fn] of Object.entries(JOBS)) {
    const key = 'job_' + name;
    const done = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
    if (done) continue;
    await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind(key, 'running').run(); // claim first: never runs twice
    let out = '';
    try { out = await fn(env, ctx); } catch (e: any) { out = 'error: ' + (e?.message || e); }
    await env.DB.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(out.slice(0, 300), key).run();
    console.log('job', name, out);
  }
}
